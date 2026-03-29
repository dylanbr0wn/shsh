package main

import (
	"fmt"
	"time"

	"github.com/dylanbr0wn/shsh/internal/biometric"
	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/vault"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// VaultFacade exposes vault lifecycle operations to the Wails frontend.
type VaultFacade struct {
	d *deps.Deps
}

// NewVaultFacade creates a new VaultFacade.
func NewVaultFacade(d *deps.Deps) *VaultFacade {
	return &VaultFacade{d: d}
}

// SetupVault creates the vault and migrates inline secrets from keychain to
// encrypted storage. It enables vault in config and unlocks the lockstate.
func (f *VaultFacade) SetupVault(password string) error {
	meta, key, err := vault.NewVaultMeta(password)
	if err != nil {
		return fmt.Errorf("setup vault: create meta: %w", err)
	}
	defer vault.ZeroKey(key)

	if err := f.d.Store.SaveVaultMeta(meta); err != nil {
		return fmt.Errorf("setup vault: save meta: %w", err)
	}

	resolver := f.d.Store.GetCredentials()

	// Migrate inline password hosts to encrypted storage.
	hostIDs, err := f.d.Store.ListInlinePasswordHostIDs()
	if err != nil {
		return fmt.Errorf("setup vault: list hosts: %w", err)
	}

	for _, hostID := range hostIDs {
		// Migrate password secret.
		pw, pwErr := resolver.InlineSecret(hostID, "")
		if pwErr == nil && pw != "" {
			nonce, ciphertext, encErr := vault.Encrypt(key, []byte(pw))
			if encErr != nil {
				return fmt.Errorf("setup vault: encrypt password for %s: %w", hostID, encErr)
			}
			if storeErr := f.d.Store.StoreEncryptedSecret(hostID, "password", nonce, ciphertext); storeErr != nil {
				return fmt.Errorf("setup vault: store encrypted password for %s: %w", hostID, storeErr)
			}
			_ = resolver.DeleteSecret(hostID)
			_ = f.d.Store.ClearHostPassword(hostID)
		}

		// Migrate key passphrase secret.
		passphraseKey := hostID + ":passphrase"
		pass, passErr := resolver.InlineSecret(passphraseKey, "")
		if passErr == nil && pass != "" {
			nonce, ciphertext, encErr := vault.Encrypt(key, []byte(pass))
			if encErr != nil {
				return fmt.Errorf("setup vault: encrypt passphrase for %s: %w", hostID, encErr)
			}
			if storeErr := f.d.Store.StoreEncryptedSecret(hostID, "passphrase", nonce, ciphertext); storeErr != nil {
				return fmt.Errorf("setup vault: store encrypted passphrase for %s: %w", hostID, storeErr)
			}
			_ = resolver.DeleteSecret(passphraseKey)
		}
	}

	// Store key in Secure Enclave if Touch ID is enabled.
	if f.d.Cfg.Vault.TouchIDEnabled && biometric.Available() {
		if bioErr := biometric.StoreKey(key); bioErr != nil {
			return fmt.Errorf("setup vault: store biometric key: %w", bioErr)
		}
	}

	// Unlock lockstate with a copy of the key (ZeroKey will zero our local copy).
	keyCopy := make([]byte, len(key))
	copy(keyCopy, key)
	f.d.LockState.Unlock(keyCopy)

	// Persist config.
	f.d.Cfg.Vault.Enabled = true
	if err := f.d.Cfg.Save(f.d.CfgPath); err != nil {
		return fmt.Errorf("setup vault: save config: %w", err)
	}

	f.d.Store.SetVaultKeyFunc(f.d.LockState.GetKey)

	return nil
}

// UnlockVault verifies the master password and unlocks the lockstate.
func (f *VaultFacade) UnlockVault(password string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return fmt.Errorf("unlock vault: get meta: %w", err)
	}
	if meta == nil {
		return fmt.Errorf("unlock vault: vault not set up")
	}

	key, err := vault.VerifyAndDeriveKey(password, meta)
	if err != nil {
		return err
	}

	f.d.LockState.Unlock(key)
	return nil
}

// UnlockVaultBiometric retrieves the derived key from Touch ID and unlocks.
func (f *VaultFacade) UnlockVaultBiometric() error {
	key, err := biometric.RetrieveKey()
	if err != nil {
		return fmt.Errorf("unlock vault: biometric retrieve: %w", err)
	}

	f.d.LockState.Unlock(key)
	return nil
}

// LockVault manually locks the vault and emits a "vault:locked" event.
func (f *VaultFacade) LockVault() {
	f.d.LockState.Lock()
	wailsruntime.EventsEmit(f.d.Ctx, "vault:locked")
}

// IsVaultEnabled returns whether vault is set up (enabled in config).
func (f *VaultFacade) IsVaultEnabled() bool {
	return f.d.Cfg.Vault.Enabled
}

// IsVaultLocked returns the current lock state. Returns false if vault is not enabled.
func (f *VaultFacade) IsVaultLocked() bool {
	if !f.d.Cfg.Vault.Enabled {
		return false
	}
	return f.d.LockState.IsLocked()
}

// IsBiometricAvailable returns whether Touch ID hardware is present.
func (f *VaultFacade) IsBiometricAvailable() bool {
	return biometric.Available()
}

// DisableVault decrypts all secrets back to keychain, removes vault data,
// and updates config.
func (f *VaultFacade) DisableVault(password string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return fmt.Errorf("disable vault: get meta: %w", err)
	}
	if meta == nil {
		return fmt.Errorf("disable vault: vault not set up")
	}

	key, err := vault.VerifyAndDeriveKey(password, meta)
	if err != nil {
		return err
	}
	defer vault.ZeroKey(key)

	// Decrypt all secrets and restore to keychain.
	secrets, err := f.d.Store.ListEncryptedSecrets()
	if err != nil {
		return fmt.Errorf("disable vault: list secrets: %w", err)
	}

	resolver := f.d.Store.GetCredentials()

	for _, s := range secrets {
		plaintext, decErr := vault.Decrypt(key, s.Nonce, s.Ciphertext)
		if decErr != nil {
			return fmt.Errorf("disable vault: decrypt secret %s/%s: %w", s.HostID, s.Kind, decErr)
		}

		keychainKey := s.HostID
		if s.Kind == "passphrase" {
			keychainKey = s.HostID + ":passphrase"
		}
		if storeErr := resolver.StoreSecret(keychainKey, string(plaintext)); storeErr != nil {
			return fmt.Errorf("disable vault: restore secret %s/%s to keychain: %w", s.HostID, s.Kind, storeErr)
		}
	}

	// Remove vault data from DB.
	if err := f.d.Store.DeleteVaultMeta(); err != nil {
		return fmt.Errorf("disable vault: delete vault meta: %w", err)
	}

	// Remove biometric key if present.
	_ = biometric.DeleteKey()

	// Lock and update config.
	f.d.LockState.Lock()

	f.d.Store.SetVaultKeyFunc(nil)

	f.d.Cfg.Vault.Enabled = false
	f.d.Cfg.Vault.TouchIDEnabled = false
	if err := f.d.Cfg.Save(f.d.CfgPath); err != nil {
		return fmt.Errorf("disable vault: save config: %w", err)
	}

	return nil
}

// ChangeVaultPassword re-encrypts all secrets with a new key derived from newPassword.
func (f *VaultFacade) ChangeVaultPassword(oldPassword, newPassword string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return fmt.Errorf("change vault password: get meta: %w", err)
	}
	if meta == nil {
		return fmt.Errorf("change vault password: vault not set up")
	}

	oldKey, err := vault.VerifyAndDeriveKey(oldPassword, meta)
	if err != nil {
		return err
	}
	defer vault.ZeroKey(oldKey)

	// Derive new key.
	newMeta, newKey, err := vault.NewVaultMeta(newPassword)
	if err != nil {
		return fmt.Errorf("change vault password: create new meta: %w", err)
	}
	defer vault.ZeroKey(newKey)

	// Re-encrypt all secrets.
	secrets, err := f.d.Store.ListEncryptedSecrets()
	if err != nil {
		return fmt.Errorf("change vault password: list secrets: %w", err)
	}

	for _, s := range secrets {
		plaintext, decErr := vault.Decrypt(oldKey, s.Nonce, s.Ciphertext)
		if decErr != nil {
			return fmt.Errorf("change vault password: decrypt %s/%s: %w", s.HostID, s.Kind, decErr)
		}
		nonce, ciphertext, encErr := vault.Encrypt(newKey, plaintext)
		if encErr != nil {
			return fmt.Errorf("change vault password: re-encrypt %s/%s: %w", s.HostID, s.Kind, encErr)
		}
		if storeErr := f.d.Store.StoreEncryptedSecret(s.HostID, s.Kind, nonce, ciphertext); storeErr != nil {
			return fmt.Errorf("change vault password: store %s/%s: %w", s.HostID, s.Kind, storeErr)
		}
	}

	// Save new vault meta.
	if err := f.d.Store.SaveVaultMeta(newMeta); err != nil {
		return fmt.Errorf("change vault password: save new meta: %w", err)
	}

	// Update biometric key if Touch ID was enabled.
	if f.d.Cfg.Vault.TouchIDEnabled && biometric.Available() {
		if bioErr := biometric.StoreKey(newKey); bioErr != nil {
			return fmt.Errorf("change vault password: update biometric key: %w", bioErr)
		}
	}

	// Re-unlock with new key.
	newKeyCopy := make([]byte, len(newKey))
	copy(newKeyCopy, newKey)
	f.d.LockState.Unlock(newKeyCopy)

	return nil
}

// EnableTouchID stores the current derived key in the Secure Enclave.
func (f *VaultFacade) EnableTouchID() error {
	key, err := f.d.LockState.GetKey()
	if err != nil {
		return fmt.Errorf("enable touch id: vault is locked")
	}

	if !biometric.Available() {
		return fmt.Errorf("enable touch id: Touch ID not available on this device")
	}

	if err := biometric.StoreKey(key); err != nil {
		return fmt.Errorf("enable touch id: %w", err)
	}

	f.d.Cfg.Vault.TouchIDEnabled = true
	if err := f.d.Cfg.Save(f.d.CfgPath); err != nil {
		return fmt.Errorf("enable touch id: save config: %w", err)
	}

	return nil
}

// DisableTouchID removes the derived key from the Secure Enclave.
func (f *VaultFacade) DisableTouchID() error {
	if err := biometric.DeleteKey(); err != nil {
		return fmt.Errorf("disable touch id: %w", err)
	}

	f.d.Cfg.Vault.TouchIDEnabled = false
	if err := f.d.Cfg.Save(f.d.CfgPath); err != nil {
		return fmt.Errorf("disable touch id: save config: %w", err)
	}

	return nil
}

// SetLockTimeout updates the idle lock timeout in minutes and persists config.
func (f *VaultFacade) SetLockTimeout(minutes int) {
	f.d.Cfg.Vault.LockTimeoutMinutes = minutes
	if f.d.LockState != nil {
		f.d.LockState.SetTimeout(time.Duration(minutes) * time.Minute)
	}
	_ = f.d.Cfg.Save(f.d.CfgPath)
}
