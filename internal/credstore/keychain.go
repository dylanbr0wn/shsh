package credstore

import (
	"errors"
	"strings"

	"github.com/zalando/go-keyring"
)

// ErrKeychainUnavailable is returned when the OS credential store cannot be
// reached (e.g., headless Linux without a Secret Service daemon).
var ErrKeychainUnavailable = errors.New("keychain unavailable")

const keychainService = "shsh"

// KeychainSet stores a password for the given key in the OS keychain.
func KeychainSet(key, password string) error {
	err := keyring.Set(keychainService, key, password)
	if err != nil {
		if isKeychainUnavailable(err) {
			return ErrKeychainUnavailable
		}
		return err
	}
	return nil
}

// KeychainGet retrieves the password for the given key.
// Returns ("", nil) when no entry exists.
func KeychainGet(key string) (string, error) {
	pw, err := keyring.Get(keychainService, key)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", nil
		}
		if isKeychainUnavailable(err) {
			return "", ErrKeychainUnavailable
		}
		return "", err
	}
	return pw, nil
}

// KeychainDelete removes the password for the given key.
// Silently succeeds if no entry exists.
func KeychainDelete(key string) error {
	err := keyring.Delete(keychainService, key)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		if isKeychainUnavailable(err) {
			return ErrKeychainUnavailable
		}
		return err
	}
	return nil
}

// isKeychainUnavailable detects errors that indicate the OS credential store
// daemon is not running or is unreachable.
func isKeychainUnavailable(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "org.freedesktop.secrets") ||
		strings.Contains(s, "no such interface") ||
		strings.Contains(s, "connection refused")
}
