package credstore

import (
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/dylanbr0wn/shsh/internal/vault"
)

// secretManager implements store.SecretManager, routing Put/Get/Delete to
// either the vault (encrypted DB secrets) or the OS keychain, depending on
// whether a vault key function has been set.
type secretManager struct {
	vaultKeyFn func() ([]byte, error) // nil = vault disabled
	lockTouch  func()                 // resets idle timer; nil-safe
	secrets    store.SecretStore       // for encrypted secret persistence
}

// Compile-time check that secretManager satisfies store.SecretManager.
var _ store.SecretManager = (*secretManager)(nil)

// Compile-time check that secretManager satisfies store.VaultKeyConfigurable.
var _ store.VaultKeyConfigurable = (*secretManager)(nil)

// NewSecretManager returns a new secretManager backed by the given SecretStore.
func NewSecretManager(secrets store.SecretStore) *secretManager {
	return &secretManager{secrets: secrets}
}

// SetVaultKeyFunc sets (or clears) the function used to retrieve the vault key.
func (m *secretManager) SetVaultKeyFunc(fn func() ([]byte, error)) {
	m.vaultKeyFn = fn
}

// SetLockTouch sets the function called after every secret operation to reset
// the vault idle-lock timer.
func (m *secretManager) SetLockTouch(fn func()) {
	m.lockTouch = fn
}

// touchLock calls the lock-touch function if set.
func (m *secretManager) touchLock() {
	if m.lockTouch != nil {
		m.lockTouch()
	}
}

// keychainKey maps (hostID, kind) to the keychain key string.
// "password" kind uses bare hostID; "passphrase" uses hostID + ":passphrase".
func keychainKey(hostID, kind string) string {
	if kind == "passphrase" {
		return hostID + ":passphrase"
	}
	return hostID
}

// Put persists a plaintext secret for the given host and kind.
func (m *secretManager) Put(hostID, kind, plaintext string, dbFallback func(string) error) error {
	defer m.touchLock()

	if m.vaultKeyFn != nil {
		key, err := m.vaultKeyFn()
		if err != nil {
			return fmt.Errorf("vault locked: %w", err)
		}
		nonce, ciphertext, err := vault.Encrypt(key, []byte(plaintext))
		if err != nil {
			return fmt.Errorf("vault encrypt: %w", err)
		}
		return m.secrets.StoreEncryptedSecret(hostID, kind, nonce, ciphertext)
	}

	// Non-vault path: OS keychain with DB fallback.
	if err := KeychainSet(keychainKey(hostID, kind), plaintext); err != nil {
		if err == store.ErrKeychainUnavailable && dbFallback != nil {
			return dbFallback(plaintext)
		}
		return err
	}
	return nil
}

// Get retrieves the plaintext secret for the given host and kind.
func (m *secretManager) Get(hostID, kind, dbValue string) (string, error) {
	defer m.touchLock()

	if m.vaultKeyFn != nil {
		key, err := m.vaultKeyFn()
		if err != nil {
			return "", fmt.Errorf("vault locked: %w", err)
		}
		nonce, ciphertext, err := m.secrets.GetEncryptedSecret(hostID, kind)
		if err != nil {
			return "", err
		}
		if nonce != nil {
			plaintext, err := vault.Decrypt(key, nonce, ciphertext)
			if err != nil {
				return "", err
			}
			return string(plaintext), nil
		}
		// No encrypted secret found -- fall through to keychain/DB fallback.
	}

	// Keychain path (also used as fallback when vault has no entry).
	pw, err := KeychainGet(keychainKey(hostID, kind))
	if err == nil && pw != "" {
		return pw, nil
	}
	return dbValue, nil
}

// Delete removes the secret from both keychain and encrypted secrets storage.
// This handles vault-to-keychain transitions gracefully.
func (m *secretManager) Delete(hostID, kind string) error {
	defer m.touchLock()

	_ = KeychainDelete(keychainKey(hostID, kind))
	_ = m.secrets.DeleteEncryptedSecret(hostID, kind)
	return nil
}
