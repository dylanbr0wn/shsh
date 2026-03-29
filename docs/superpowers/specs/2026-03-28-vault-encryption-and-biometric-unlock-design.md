# Vault Encryption & Biometric Unlock

**Issues:** #25 (Touch ID / biometric unlock), #26 (master password / vault lock)
**Date:** 2026-03-28

## Overview

Add an optional master password that encrypts stored credentials at rest, with macOS Touch ID as a convenient unlock method. Users who don't enable the vault continue using the OS keychain as today — zero changes for them.

## Security Model

The master password is the source of truth. It derives the encryption key via Argon2id. Touch ID stores that derived key in the macOS Secure Enclave so the user doesn't have to type the password every time. Touch ID is a convenience layer, not an independent auth mechanism.

### What Gets Encrypted

Only secrets (passwords, key passphrases). Host metadata (hostname, username, port, labels, groups) remains plaintext in SQLite. This means the host list and sidebar are usable without unlocking — authentication is only required to connect or view a saved password.

### What Doesn't Change

- External credential sources (1Password, Bitwarden) keep their own auth flows
- SSH agent auth has no password involved
- Quick connect passwords are ephemeral, never stored

## Architecture

Three new packages, each with a single responsibility:

### `internal/vault` — Encryption & Key Derivation

Pure Go, no platform dependencies. Handles:

- **Key derivation:** `argon2id(password, salt, time=3, mem=64MB, threads=4)` → 256-bit key
- **Encrypt/decrypt:** AES-256-GCM with per-secret random nonces
- **Vault setup:** Create salt, derive key, store verification blob
- **Vault teardown:** Decrypt all secrets back to keychain, drop vault tables
- **Password change:** Re-encrypt all secrets with new derived key
- **Verification:** Decrypt a known-plaintext blob to confirm correct password

### `internal/biometric` — Touch ID (macOS only)

Build-tagged `darwin`. Uses cgo to call `LocalAuthentication.framework`:

- `Available() bool` — checks for biometric hardware + enrolled fingerprints
- `StoreKey(key []byte) error` — stores derived key in macOS Keychain with `kSecAccessControlBiometryCurrentSet` access control (tied to current enrolled fingerprints)
- `RetrieveKey() ([]byte, error)` — reads derived key, OS prompts Touch ID
- `DeleteKey() error` — removes stored key

Non-macOS builds get a no-op stub that returns `ErrUnsupported`.

### `internal/lockstate` — Unlock State & Idle Timer

Manages the in-memory unlock state:

- Holds the derived key in memory while unlocked
- Zeroes the key on lock
- Runs an idle timer that auto-locks after the configured timeout
- Resets timer on every credential access (`Touch()`)
- Emits `vault:locked` Wails event to frontend on lock

## Database Changes

### New `vault_meta` table (singleton)

```sql
CREATE TABLE vault_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt BLOB NOT NULL,                          -- 32-byte random
    nonce BLOB NOT NULL,                         -- 12-byte for verify_blob
    verify_blob BLOB NOT NULL,                   -- AES-256-GCM encrypted known plaintext
    argon2_time INTEGER NOT NULL DEFAULT 3,
    argon2_memory INTEGER NOT NULL DEFAULT 65536, -- 64 MB
    argon2_threads INTEGER NOT NULL DEFAULT 4,
    created_at TEXT NOT NULL
);
```

### New `secrets` table

```sql
CREATE TABLE secrets (
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,        -- 'password' | 'passphrase'
    nonce BLOB NOT NULL,      -- 12-byte, unique per row
    ciphertext BLOB NOT NULL, -- AES-256-GCM encrypted
    PRIMARY KEY (host_id, kind)
);
```

## Config Changes

New `vault` section in `config.json`:

```json
{
  "vault": {
    "enabled": false,
    "lockTimeoutMinutes": 15,
    "touchIdEnabled": false
  }
}
```

## Wails API

New methods bound to the frontend:

| Method | Purpose |
|---|---|
| `SetupVault(password string) error` | Create vault_meta, migrate secrets from keychain, optionally enable Touch ID |
| `UnlockVault(password string) error` | Derive key, verify against vault_meta, unlock lockstate |
| `UnlockVaultBiometric() error` | Retrieve key from Secure Enclave via Touch ID, unlock lockstate |
| `LockVault()` | Zero key, lock lockstate, emit event |
| `IsVaultEnabled() bool` | Check if vault is set up |
| `IsVaultLocked() bool` | Check current lock state |
| `IsBiometricAvailable() bool` | Check for Touch ID hardware + enrollment |
| `DisableVault(password string) error` | Decrypt secrets back to keychain, drop vault tables |
| `ChangeVaultPassword(old, new string) error` | Re-derive key, re-encrypt all secrets |

## Frontend Changes

### Lock Overlay

An overlay modal that appears over the existing UI (content blurred/dimmed behind it):

- Shown on app launch if vault is enabled, and when idle timeout triggers
- Touch ID prompt fires automatically if enabled
- Master password field as fallback
- Listens for `vault:locked` Wails event

### Settings — Security Section

- Toggle to enable/disable vault (calls `SetupVault` / `DisableVault`)
- Enable/disable Touch ID (only shown on macOS with sensor)
- Lock timeout selector (5 / 10 / 15 / 30 / 60 minutes)
- "Lock Now" button

### Header

- Lock icon button (visible when vault enabled) that calls `LockVault()`
- Keyboard shortcut `Cmd+L` to lock

### Host Form

When vault is enabled, the inline credential source label changes from "Inline (macOS Keychain)" to "Stored in vault". External PM sources are unchanged.

## Credential Flow (Vault Enabled)

### On host creation/update (inline password)

1. `lockstate.GetKey()` → derived key
2. `vault.Encrypt(key, password)` → nonce + ciphertext
3. Store in `secrets` table

### On connection

1. `lockstate.GetKey()` → if locked, return error (frontend shows unlock overlay)
2. Read `secrets` row for host
3. `vault.Decrypt(key, nonce, ciphertext)` → plaintext password
4. `lockstate.Touch()` → reset idle timer
5. Proceed with SSH auth

### Migration (enabling vault)

1. User enters master password in settings
2. Derive key, create `vault_meta`
3. For each host with inline credentials: read from keychain → encrypt → store in `secrets`
4. Delete keychain entries
5. Clear `hosts.password` column for migrated rows (removes plaintext DB fallback)
6. If Touch ID enabled: store derived key in Secure Enclave

### Migration (disabling vault)

1. User confirms with master password
2. For each secret: decrypt → store in keychain
3. Drop `vault_meta` and `secrets` tables
4. Delete Secure Enclave key if present

## Lock Lifecycle

1. **App launch** → check `vault.enabled` in config → if true, app starts locked
2. **Unlock** → Touch ID (auto-prompted) or master password → derived key held in `lockstate`
3. **Active use** → every credential access calls `lockstate.Touch()` → timer resets
4. **Idle timeout** → `lockstate` zeroes key, emits `vault:locked` → frontend shows overlay
5. **Manual lock** → `Cmd+L` or header button → same as idle timeout
6. **App shutdown** → `lockstate` zeroes key in shutdown hook

## Testing Strategy

- `internal/vault`: Unit tests for encrypt/decrypt round-trips, wrong-password rejection, key derivation determinism (same salt+password → same key)
- `internal/biometric`: Build-tag tests on macOS CI only; stub tests on all platforms
- `internal/lockstate`: Unit tests for lock/unlock state machine, timer behavior (mock clock), concurrent access
- Integration: Test the full flow from `SetupVault` through `GetHostForConnect` with an in-memory SQLite DB
