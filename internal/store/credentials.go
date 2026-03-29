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

// VaultCredentialResolver extends CredentialResolver with vault support.
type VaultCredentialResolver interface {
	CredentialResolver
	// VaultStoreSecret encrypts and stores a secret using the provided key.
	VaultStoreSecret(store SecretStore, key []byte, hostID, kind, plaintext string) error
	// VaultGetSecret decrypts and returns a secret using the provided key.
	VaultGetSecret(store SecretStore, key []byte, hostID, kind string) (string, error)
	// VaultDeleteSecret removes an encrypted secret.
	VaultDeleteSecret(store SecretStore, hostID, kind string) error
}

// SecretStore is the subset of Store needed for vault secret operations.
type SecretStore interface {
	StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error
	GetEncryptedSecret(hostID, kind string) (nonce, ciphertext []byte, err error)
	DeleteEncryptedSecret(hostID, kind string) error
}
