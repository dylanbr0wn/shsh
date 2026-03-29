package vault

import (
	"testing"
)

func TestDeriveKey_Deterministic(t *testing.T) {
	salt := make([]byte, 32)
	salt[0] = 0x42

	k1 := DeriveKey("hunter2", salt)
	k2 := DeriveKey("hunter2", salt)

	if len(k1) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(k1))
	}
	if string(k1) != string(k2) {
		t.Fatal("same password+salt must produce same key")
	}
}

func TestDeriveKey_DifferentPasswords(t *testing.T) {
	salt := make([]byte, 32)

	k1 := DeriveKey("password1", salt)
	k2 := DeriveKey("password2", salt)

	if string(k1) == string(k2) {
		t.Fatal("different passwords must produce different keys")
	}
}

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	key := DeriveKey("test", make([]byte, 32))

	plaintext := []byte("ssh-secret-password")
	nonce, ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if len(nonce) != 12 {
		t.Fatalf("expected 12-byte nonce, got %d", len(nonce))
	}

	got, err := Decrypt(key, nonce, ciphertext)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("round-trip failed: got %q, want %q", got, plaintext)
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	key1 := DeriveKey("correct", make([]byte, 32))
	key2 := DeriveKey("wrong", make([]byte, 32))

	nonce, ciphertext, err := Encrypt(key1, []byte("secret"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	_, err = Decrypt(key2, nonce, ciphertext)
	if err == nil {
		t.Fatal("decrypt with wrong key should fail")
	}
}

func TestNewVaultMeta_And_Verify(t *testing.T) {
	meta, key, err := NewVaultMeta("my-master-password")
	if err != nil {
		t.Fatalf("NewVaultMeta: %v", err)
	}
	if len(meta.Salt) != 32 {
		t.Fatalf("expected 32-byte salt, got %d", len(meta.Salt))
	}

	// Verify with correct password
	gotKey, err := VerifyAndDeriveKey("my-master-password", meta)
	if err != nil {
		t.Fatalf("verify correct password: %v", err)
	}
	if string(gotKey) != string(key) {
		t.Fatal("verified key must match original derived key")
	}

	// Verify with wrong password
	_, err = VerifyAndDeriveKey("wrong-password", meta)
	if err == nil {
		t.Fatal("verify wrong password should fail")
	}
}

func TestZeroKey(t *testing.T) {
	key := []byte{1, 2, 3, 4, 5}
	ZeroKey(key)
	for i, b := range key {
		if b != 0 {
			t.Fatalf("byte %d not zeroed: %d", i, b)
		}
	}
}
