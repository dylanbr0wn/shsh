package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	KeyLen       = 32          // AES-256
	SaltLen      = 32
	NonceLen     = 12          // GCM standard
	ArgonTime    = 3
	ArgonMemory  = 64 * 1024   // 64 MB
	ArgonThreads = 4
)

// VaultMeta holds the parameters needed to verify a master password
// and derive the encryption key. Stored in the vault_meta DB table.
type VaultMeta struct {
	Salt         []byte
	Nonce        []byte // nonce for VerifyBlob
	VerifyBlob   []byte // encrypted known plaintext
	ArgonTime    uint32
	ArgonMemory  uint32
	ArgonThreads uint8
}

var (
	ErrWrongPassword = errors.New("vault: wrong master password")
	verifyPlaintext  = []byte("shsh-vault-verify-v1")
)

// DeriveKey derives a 256-bit key from a password and salt using Argon2id.
func DeriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, ArgonTime, ArgonMemory, ArgonThreads, KeyLen)
}

// Encrypt encrypts plaintext with the given key using AES-256-GCM.
// Returns a random nonce and the ciphertext (which includes the GCM tag).
func Encrypt(key, plaintext []byte) (nonce, ciphertext []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, fmt.Errorf("vault: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("vault: new gcm: %w", err)
	}

	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("vault: random nonce: %w", err)
	}

	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return nonce, ciphertext, nil
}

// Decrypt decrypts ciphertext with the given key and nonce using AES-256-GCM.
func Decrypt(key, nonce, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("vault: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("vault: new gcm: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrWrongPassword
	}
	return plaintext, nil
}

// NewVaultMeta creates a new VaultMeta with a random salt and a verification
// blob encrypted with the derived key. Returns the meta and the derived key.
func NewVaultMeta(password string) (*VaultMeta, []byte, error) {
	salt := make([]byte, SaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, nil, fmt.Errorf("vault: random salt: %w", err)
	}

	key := DeriveKey(password, salt)

	nonce, blob, err := Encrypt(key, verifyPlaintext)
	if err != nil {
		return nil, nil, err
	}

	meta := &VaultMeta{
		Salt:         salt,
		Nonce:        nonce,
		VerifyBlob:   blob,
		ArgonTime:    ArgonTime,
		ArgonMemory:  ArgonMemory,
		ArgonThreads: ArgonThreads,
	}
	return meta, key, nil
}

// VerifyAndDeriveKey derives a key from the password and verifies it against
// the stored verification blob. Returns the derived key on success.
func VerifyAndDeriveKey(password string, meta *VaultMeta) ([]byte, error) {
	key := argon2.IDKey([]byte(password), meta.Salt, meta.ArgonTime, meta.ArgonMemory, meta.ArgonThreads, KeyLen)

	plaintext, err := Decrypt(key, meta.Nonce, meta.VerifyBlob)
	if err != nil {
		return nil, ErrWrongPassword
	}
	if subtle.ConstantTimeCompare(plaintext, verifyPlaintext) == 0 {
		ZeroKey(key)
		return nil, ErrWrongPassword
	}
	return key, nil
}

// ZeroKey overwrites a key slice with zeros.
func ZeroKey(key []byte) {
	for i := range key {
		key[i] = 0
	}
}
