package store

import (
	"context"

	"github.com/dylanbr0wn/shsh/internal/credstore"
)

// ErrKeychainUnavailable is returned when the OS credential store cannot be
// reached (e.g., headless Linux without a Secret Service daemon).
// It is an alias for credstore.ErrKeychainUnavailable.
var ErrKeychainUnavailable = credstore.ErrKeychainUnavailable

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
