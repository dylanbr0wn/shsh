package credstore

import (
	"context"
	"fmt"
	"os/exec"
	"sync"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/dylanbr0wn/shsh/internal/vault"
)

// cmdRunner executes an external command and returns its combined stdout.
type cmdRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

// pathLooker checks if a binary exists on PATH.
type pathLooker func(name string) (string, error)

// Resolver implements store.CredentialResolver using the OS keychain
// for inline secrets and external CLI tools for password managers.
type Resolver struct {
	runCmd   cmdRunner
	lookPath pathLooker

	bwMu         sync.Mutex
	bwSessionKey string
}

// NewResolver returns a Resolver wired to real exec.CommandContext/exec.LookPath.
func NewResolver() *Resolver {
	return &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return exec.CommandContext(ctx, name, args...).Output()
		},
		lookPath: exec.LookPath,
	}
}

// Resolve fetches a secret from an external credential source.
func (r *Resolver) Resolve(ctx context.Context, source, ref string) (string, error) {
	switch Source(source) {
	case Source1Password:
		return r.fetchFrom1PasswordCtx(ctx, ref)
	case SourceBitwarden:
		return r.fetchFromBitwardenCtx(ctx, ref)
	default:
		return "", fmt.Errorf("unsupported credential source: %s", source)
	}
}

// InlineSecret returns the locally-stored secret from the OS keychain,
// falling back to fallback if the keychain entry is empty or unavailable.
func (r *Resolver) InlineSecret(key, fallback string) (string, error) {
	pw, err := KeychainGet(key)
	if err == nil && pw != "" {
		return pw, nil
	}
	// Keychain unavailable or no entry — use fallback (DB column value).
	return fallback, nil
}

// StoreSecret persists a secret to the OS keychain.
func (r *Resolver) StoreSecret(key, value string) error {
	return KeychainSet(key, value)
}

// DeleteSecret removes a secret from the OS keychain.
func (r *Resolver) DeleteSecret(key string) error {
	return KeychainDelete(key)
}

// VaultStoreSecret encrypts a plaintext secret and stores it in the DB.
func (r *Resolver) VaultStoreSecret(ss store.SecretStore, key []byte, hostID, kind, plaintext string) error {
	nonce, ciphertext, err := vault.Encrypt(key, []byte(plaintext))
	if err != nil {
		return fmt.Errorf("vault encrypt: %w", err)
	}
	return ss.StoreEncryptedSecret(hostID, kind, nonce, ciphertext)
}

// VaultGetSecret retrieves and decrypts a secret from the DB.
func (r *Resolver) VaultGetSecret(ss store.SecretStore, key []byte, hostID, kind string) (string, error) {
	nonce, ciphertext, err := ss.GetEncryptedSecret(hostID, kind)
	if err != nil {
		return "", fmt.Errorf("vault get secret: %w", err)
	}
	if nonce == nil {
		return "", nil // no secret stored
	}
	plaintext, err := vault.Decrypt(key, nonce, ciphertext)
	if err != nil {
		return "", fmt.Errorf("vault decrypt: %w", err)
	}
	return string(plaintext), nil
}

// VaultDeleteSecret removes an encrypted secret.
func (r *Resolver) VaultDeleteSecret(ss store.SecretStore, hostID, kind string) error {
	return ss.DeleteEncryptedSecret(hostID, kind)
}

// Compile-time check that Resolver satisfies store.CredentialResolver.
var _ store.CredentialResolver = (*Resolver)(nil)

// Compile-time check that Resolver satisfies store.VaultCredentialResolver.
var _ store.VaultCredentialResolver = (*Resolver)(nil)
