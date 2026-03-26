package credstore

import (
	"context"
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/store"
)

// Resolver implements store.CredentialResolver using the OS keychain
// for inline secrets and external CLI tools for password managers.
type Resolver struct{}

// NewResolver returns a Resolver ready for use.
func NewResolver() *Resolver { return &Resolver{} }

// Resolve fetches a secret from an external credential source.
func (r *Resolver) Resolve(ctx context.Context, source, ref string) (string, error) {
	switch Source(source) {
	case Source1Password:
		return fetchFrom1PasswordCtx(ctx, ref)
	case SourceBitwarden:
		return fetchFromBitwardenCtx(ctx, ref)
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

// Compile-time check that Resolver satisfies store.CredentialResolver.
var _ store.CredentialResolver = (*Resolver)(nil)
