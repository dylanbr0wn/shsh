package store

import (
	"context"
	"errors"
)

// ErrKeychainUnavailable is returned when the OS credential store cannot be
// reached (e.g., headless Linux without a Secret Service daemon).
var ErrKeychainUnavailable = errors.New("keychain unavailable")

// CredentialResolver abstracts secret storage and retrieval so the store
// package has no direct dependency on credential backends.
type CredentialResolver interface {
	// Resolve fetches a secret from an external credential source (e.g., 1Password, Bitwarden).
	// Implementations must respect ctx for timeout/cancellation.
	Resolve(ctx context.Context, source, ref string) (string, error)

	// InlineSecret returns the locally-stored secret (OS keychain with DB fallback).
	InlineSecret(key, fallback string) (string, error)

	// StoreSecret persists a secret to the OS keychain.
	StoreSecret(key, value string) error

	// DeleteSecret removes a secret from the OS keychain. No error if not found.
	DeleteSecret(key string) error
}

// SecretManager abstracts vault-or-keychain secret lifecycle so the Store
// never needs to branch on vault state directly.
type SecretManager interface {
	// Put persists a plaintext secret for the given host and kind ("password" or "passphrase").
	// dbFallback is called when keychain is unavailable in non-vault mode, allowing
	// the Store to write plaintext to the DB column as last resort.
	Put(hostID, kind, plaintext string, dbFallback func(string) error) error

	// Get retrieves the plaintext secret for the given host and kind.
	// dbValue is the hosts.password column value (already fetched by the caller's SELECT).
	Get(hostID, kind, dbValue string) (string, error)

	// Delete removes the secret from whichever backend is active (vault + keychain).
	Delete(hostID, kind string) error
}

// VaultKeyConfigurable is implemented by SecretManager implementations that
// support optional vault key injection after construction.
type VaultKeyConfigurable interface {
	SetVaultKeyFunc(fn func() ([]byte, error))
	SetLockTouch(fn func())
}

// SecretStore is the subset of Store needed for vault secret operations.
type SecretStore interface {
	StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error
	GetEncryptedSecret(hostID, kind string) (nonce, ciphertext []byte, err error)
	DeleteEncryptedSecret(hostID, kind string) error
}
