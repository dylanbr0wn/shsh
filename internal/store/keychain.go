package store

import (
	"errors"
	"strings"

	"github.com/zalando/go-keyring"
)

const keychainService = "shsh"

// ErrKeychainUnavailable is returned when the OS credential store cannot be
// reached (e.g., headless Linux without a Secret Service daemon).
var ErrKeychainUnavailable = errors.New("keychain unavailable")

// keychainSet stores a password for the given hostID in the OS keychain.
func keychainSet(hostID, password string) error {
	err := keyring.Set(keychainService, hostID, password)
	if err != nil {
		if isKeychainUnavailable(err) {
			return ErrKeychainUnavailable
		}
		return err
	}
	return nil
}

// keychainGet retrieves the password for the given hostID.
// Returns ("", nil) when no entry exists — this is normal for agent-auth hosts.
func keychainGet(hostID string) (string, error) {
	pw, err := keyring.Get(keychainService, hostID)
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

// keychainDelete removes the password for the given hostID.
// Silently succeeds if no entry exists.
func keychainDelete(hostID string) error {
	err := keyring.Delete(keychainService, hostID)
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
