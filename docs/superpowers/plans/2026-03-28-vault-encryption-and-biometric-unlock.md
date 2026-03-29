# Vault Encryption & Biometric Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional master password vault encryption with macOS Touch ID convenience unlock, so stored credentials are encrypted at rest and the app locks after idle.

**Architecture:** Three new Go packages (`internal/vault`, `internal/biometric`, `internal/lockstate`) plus a `VaultFacade` bound to Wails. The vault package handles Argon2id key derivation and AES-256-GCM encryption. The biometric package wraps macOS LocalAuthentication via cgo (build-tagged darwin). The lockstate package manages in-memory unlock state and idle timer. Frontend adds a lock overlay modal and a security settings section.

**Tech Stack:** Go stdlib `crypto/aes`, `crypto/cipher`, `crypto/rand`, `golang.org/x/crypto/argon2`, macOS `LocalAuthentication.framework` + `Security.framework` via cgo, React/TypeScript frontend with shadcn components.

**Spec:** `docs/superpowers/specs/2026-03-28-vault-encryption-and-biometric-unlock-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `internal/vault/vault.go` | Key derivation (Argon2id), AES-256-GCM encrypt/decrypt, vault setup/teardown |
| `internal/vault/vault_test.go` | Unit tests for crypto round-trips, wrong-password rejection |
| `internal/biometric/biometric_darwin.go` | Touch ID via LAContext, Secure Enclave key storage (cgo, build-tagged) |
| `internal/biometric/biometric_stub.go` | No-op stub for non-darwin builds |
| `internal/biometric/biometric_test.go` | Interface compliance tests (stub path) |
| `internal/lockstate/lockstate.go` | Unlock state machine, derived key holder, idle timer |
| `internal/lockstate/lockstate_test.go` | State machine tests, timer tests with mock clock |
| `vault_facade.go` | Wails-bound methods: SetupVault, UnlockVault, LockVault, etc. |
| `frontend/src/components/modals/VaultLockOverlay.tsx` | Lock overlay modal (Touch ID + password) |
| `frontend/src/components/settings/SecuritySettings.tsx` | Vault enable/disable, Touch ID toggle, timeout selector |
| `frontend/src/atoms/vault.ts` | Jotai atoms for vault lock state |

### Modified Files

| File | Changes |
|------|---------|
| `go.mod` | Add `golang.org/x/crypto` dependency |
| `internal/store/store.go` | Add `vault_meta` and `secrets` tables, new methods for secret CRUD |
| `internal/store/credentials.go` | Extend `CredentialResolver` interface with vault-aware methods |
| `internal/credstore/resolver.go` | Implement new interface methods, vault-mode credential routing |
| `internal/config/config.go` | Add `VaultConfig` sub-struct |
| `internal/deps/deps.go` | Add `LockState` field |
| `app.go` | Initialize lockstate, wire vault facade, lock on shutdown |
| `main.go` | Bind VaultFacade to Wails |
| `host_facade.go` | Touch lockstate on credential access |
| `session_facade.go` | Touch lockstate on connect, handle locked error |
| `frontend/src/App.tsx` | Add VaultLockOverlay, listen for vault:locked event |
| `frontend/src/components/modals/SettingsModal.tsx` | Add SecuritySettings section |
| `frontend/src/components/modals/HostFormTabs.tsx` | Conditional label: "Stored in vault" vs "macOS Keychain" |
| `frontend/src/types/index.ts` | Add vault-related types |

---

## Task 1: Add `golang.org/x/crypto` Dependency

**Files:**
- Modify: `go.mod`

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go get golang.org/x/crypto
```

- [ ] **Step 2: Tidy modules**

```bash
go mod tidy && go build ./...
```

Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: add golang.org/x/crypto dependency for argon2id"
```

---

## Task 2: `internal/vault` — Key Derivation & Encryption

**Files:**
- Create: `internal/vault/vault.go`
- Create: `internal/vault/vault_test.go`

- [ ] **Step 1: Write failing tests for key derivation and encrypt/decrypt**

```go
// internal/vault/vault_test.go
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/vault/... -v
```

Expected: Compilation errors — package and functions don't exist yet.

- [ ] **Step 3: Implement the vault package**

```go
// internal/vault/vault.go
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	KeyLen      = 32     // AES-256
	SaltLen     = 32
	NonceLen    = 12     // GCM standard
	ArgonTime   = 3
	ArgonMemory = 64 * 1024 // 64 MB
	ArgonThreads = 4
)

// VaultMeta holds the parameters needed to verify a master password
// and derive the encryption key. Stored in the vault_meta DB table.
type VaultMeta struct {
	Salt       []byte
	Nonce      []byte // nonce for VerifyBlob
	VerifyBlob []byte // encrypted known plaintext
	ArgonTime   uint32
	ArgonMemory uint32
	ArgonThreads uint8
}

var (
	ErrWrongPassword = errors.New("vault: wrong master password")
	verifyPlaintext  = []byte("shsh-vault-verify-v1")
)

// DeriveKey derives a 256-bit key from a password and salt using Argon2id.
func DeriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, ArgonTime, ArgonMemory, ArgonThreads, KeyLen)
}

// Encrypt encrypts plaintext with the given key using AES-256-GCM.
// Returns a random nonce and the ciphertext (which includes the GCM tag).
func Encrypt(key, plaintext []byte) (nonce, ciphertext []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, fmt.Errorf("vault: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("vault: new gcm: %w", err)
	}

	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("vault: random nonce: %w", err)
	}

	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return nonce, ciphertext, nil
}

// Decrypt decrypts ciphertext with the given key and nonce using AES-256-GCM.
func Decrypt(key, nonce, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("vault: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("vault: new gcm: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrWrongPassword
	}
	return plaintext, nil
}

// NewVaultMeta creates a new VaultMeta with a random salt and a verification
// blob encrypted with the derived key. Returns the meta and the derived key.
func NewVaultMeta(password string) (*VaultMeta, []byte, error) {
	salt := make([]byte, SaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, nil, fmt.Errorf("vault: random salt: %w", err)
	}

	key := DeriveKey(password, salt)

	nonce, blob, err := Encrypt(key, verifyPlaintext)
	if err != nil {
		return nil, nil, err
	}

	meta := &VaultMeta{
		Salt:         salt,
		Nonce:        nonce,
		VerifyBlob:   blob,
		ArgonTime:    ArgonTime,
		ArgonMemory:  ArgonMemory,
		ArgonThreads: ArgonThreads,
	}
	return meta, key, nil
}

// VerifyAndDeriveKey derives a key from the password and verifies it against
// the stored verification blob. Returns the derived key on success.
func VerifyAndDeriveKey(password string, meta *VaultMeta) ([]byte, error) {
	key := argon2.IDKey([]byte(password), meta.Salt, meta.ArgonTime, meta.ArgonMemory, meta.ArgonThreads, KeyLen)

	plaintext, err := Decrypt(key, meta.Nonce, meta.VerifyBlob)
	if err != nil {
		return nil, ErrWrongPassword
	}
	if string(plaintext) != string(verifyPlaintext) {
		ZeroKey(key)
		return nil, ErrWrongPassword
	}
	return key, nil
}

// ZeroKey overwrites a key slice with zeros.
func ZeroKey(key []byte) {
	for i := range key {
		key[i] = 0
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/vault/... -race -v
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/vault/
git commit -m "feat(vault): add key derivation and AES-256-GCM encrypt/decrypt

Argon2id for key derivation, AES-256-GCM for authenticated encryption.
Includes vault meta creation and password verification."
```

---

## Task 3: `internal/biometric` — Touch ID Stub & Darwin Implementation

**Files:**
- Create: `internal/biometric/biometric_stub.go`
- Create: `internal/biometric/biometric_darwin.go`
- Create: `internal/biometric/biometric_test.go`

- [ ] **Step 1: Write test for stub interface compliance**

```go
// internal/biometric/biometric_test.go
package biometric

import (
	"testing"
)

func TestAvailable_ReturnsWithoutPanic(t *testing.T) {
	// Should not panic on any platform
	_ = Available()
}

func TestStoreAndRetrieve_ErrorOnUnsupported(t *testing.T) {
	if Available() {
		t.Skip("biometric hardware available, skipping stub test")
	}

	err := StoreKey([]byte("test-key-32-bytes-long-xxxxxxxx"))
	if err == nil {
		t.Fatal("StoreKey should return error when biometrics unavailable")
	}

	_, err = RetrieveKey()
	if err == nil {
		t.Fatal("RetrieveKey should return error when biometrics unavailable")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/biometric/... -v
```

Expected: Compilation error — package doesn't exist.

- [ ] **Step 3: Write the stub (non-darwin)**

```go
// internal/biometric/biometric_stub.go
//go:build !darwin

package biometric

import "errors"

var ErrUnsupported = errors.New("biometric: not supported on this platform")

func Available() bool                    { return false }
func StoreKey(key []byte) error          { return ErrUnsupported }
func RetrieveKey() ([]byte, error)       { return nil, ErrUnsupported }
func DeleteKey() error                   { return ErrUnsupported }
```

- [ ] **Step 4: Write the darwin implementation**

```go
// internal/biometric/biometric_darwin.go
//go:build darwin

package biometric

/*
#cgo LDFLAGS: -framework LocalAuthentication -framework Security -framework Foundation
#include <LocalAuthentication/LocalAuthentication.h>
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>

// checkBiometric returns 1 if Touch ID is available, 0 otherwise.
static int checkBiometric() {
    @autoreleasepool {
        LAContext *ctx = [[LAContext alloc] init];
        NSError *err = nil;
        BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&err];
        return ok ? 1 : 0;
    }
}

// storeDerivedKey stores a key in the Keychain with biometric access control.
// Returns 0 on success, errSecDuplicateItem (-25299) if exists, or other OSStatus.
static int32_t storeDerivedKey(const void *keyData, int keyLen) {
    @autoreleasepool {
        SecAccessControlRef acl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAccessControlBiometryCurrentSet,
            NULL
        );
        if (!acl) return -1;

        NSData *data = [NSData dataWithBytes:keyData length:keyLen];

        // Delete any existing item first
        NSDictionary *delQuery = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
        };
        SecItemDelete((__bridge CFDictionaryRef)delQuery);

        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
            (__bridge id)kSecValueData: data,
            (__bridge id)kSecAttrAccessControl: (__bridge id)acl,
            (__bridge id)kSecUseAuthenticationContext: [[LAContext alloc] init],
        };

        OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        CFRelease(acl);
        return (int32_t)status;
    }
}

// retrieveDerivedKey retrieves the key from Keychain (triggers Touch ID).
// On success, copies up to bufLen bytes into buf and sets outLen. Returns OSStatus.
static int32_t retrieveDerivedKey(void *buf, int bufLen, int *outLen) {
    @autoreleasepool {
        LAContext *ctx = [[LAContext alloc] init];
        ctx.localizedReason = @"Unlock shsh vault";

        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
            (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecUseAuthenticationContext: ctx,
        };

        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (status != errSecSuccess) {
            return (int32_t)status;
        }

        NSData *data = (__bridge_transfer NSData *)result;
        int len = (int)data.length;
        if (len > bufLen) len = bufLen;
        memcpy(buf, data.bytes, len);
        *outLen = len;
        return 0;
    }
}

// deleteDerivedKey removes the stored key from Keychain.
static int32_t deleteDerivedKey() {
    @autoreleasepool {
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
        };
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        if (status == errSecItemNotFound) return 0;
        return (int32_t)status;
    }
}
*/
import "C"
import (
	"errors"
	"fmt"
	"unsafe"
)

var ErrUnsupported = errors.New("biometric: not supported on this platform")

func Available() bool {
	return C.checkBiometric() == 1
}

func StoreKey(key []byte) error {
	if !Available() {
		return ErrUnsupported
	}
	status := C.storeDerivedKey(unsafe.Pointer(&key[0]), C.int(len(key)))
	if status != 0 {
		return fmt.Errorf("biometric: store key failed (OSStatus %d)", status)
	}
	return nil
}

func RetrieveKey() ([]byte, error) {
	if !Available() {
		return nil, ErrUnsupported
	}
	buf := make([]byte, 64)
	var outLen C.int
	status := C.retrieveDerivedKey(unsafe.Pointer(&buf[0]), C.int(len(buf)), &outLen)
	if status != 0 {
		return nil, fmt.Errorf("biometric: retrieve key failed (OSStatus %d)", status)
	}
	return buf[:outLen], nil
}

func DeleteKey() error {
	status := C.deleteDerivedKey()
	if status != 0 {
		return fmt.Errorf("biometric: delete key failed (OSStatus %d)", status)
	}
	return nil
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/biometric/... -v
```

Expected: Tests pass. On macOS with Touch ID hardware, `Available()` returns true and stub tests are skipped. On CI/non-darwin, stub tests run.

- [ ] **Step 6: Commit**

```bash
git add internal/biometric/
git commit -m "feat(biometric): add Touch ID integration via LocalAuthentication

macOS-only cgo implementation stores/retrieves derived key from
Keychain with biometric access control. No-op stub for other platforms."
```

---

## Task 4: `internal/lockstate` — Unlock State Machine & Idle Timer

**Files:**
- Create: `internal/lockstate/lockstate.go`
- Create: `internal/lockstate/lockstate_test.go`

- [ ] **Step 1: Write failing tests**

```go
// internal/lockstate/lockstate_test.go
package lockstate

import (
	"testing"
	"time"
)

func TestNewState_StartsLocked(t *testing.T) {
	s := New(5*time.Minute, nil)
	if !s.IsLocked() {
		t.Fatal("new state should be locked")
	}
}

func TestUnlock_StoresKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")

	s.Unlock(key)

	if s.IsLocked() {
		t.Fatal("should be unlocked after Unlock()")
	}

	got, err := s.GetKey()
	if err != nil {
		t.Fatalf("GetKey: %v", err)
	}
	if string(got) != string(key) {
		t.Fatal("GetKey returned wrong key")
	}
}

func TestLock_ZeroesKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")
	keyCopy := make([]byte, len(key))
	copy(keyCopy, key)

	s.Unlock(key)
	s.Lock()

	if !s.IsLocked() {
		t.Fatal("should be locked after Lock()")
	}

	_, err := s.GetKey()
	if err != ErrLocked {
		t.Fatalf("GetKey should return ErrLocked, got %v", err)
	}

	// Original key slice should be zeroed
	for i, b := range key {
		if b != 0 {
			t.Fatalf("key byte %d not zeroed: %d", i, b)
		}
	}
}

func TestTouch_ResetsTimer(t *testing.T) {
	locked := make(chan struct{}, 1)
	s := New(100*time.Millisecond, func() { locked <- struct{}{} })
	s.Unlock([]byte("test-key-32-bytes-long-xxxxxxxx"))

	// Touch before timeout
	time.Sleep(60 * time.Millisecond)
	s.Touch()

	// Should not have locked yet (timer was reset)
	select {
	case <-locked:
		t.Fatal("should not have locked yet after Touch()")
	case <-time.After(60 * time.Millisecond):
		// Good — still unlocked
	}

	// Wait for full timeout after last touch
	select {
	case <-locked:
		// Good — locked after idle
	case <-time.After(200 * time.Millisecond):
		t.Fatal("should have locked after idle timeout")
	}
}

func TestIdleTimeout_LocksAutomatically(t *testing.T) {
	locked := make(chan struct{}, 1)
	s := New(50*time.Millisecond, func() { locked <- struct{}{} })
	s.Unlock([]byte("test-key-32-bytes-long-xxxxxxxx"))

	select {
	case <-locked:
		if !s.IsLocked() {
			t.Fatal("should be locked after timeout")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("idle timeout did not fire")
	}
}

func TestSetTimeout_UpdatesDuration(t *testing.T) {
	s := New(5*time.Minute, nil)
	s.SetTimeout(10 * time.Minute)
	// No panic, timeout updated
}

func TestShutdown_ZeroesKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")
	s.Unlock(key)
	s.Shutdown()

	if !s.IsLocked() {
		t.Fatal("should be locked after Shutdown()")
	}
	for _, b := range key {
		if b != 0 {
			t.Fatal("key not zeroed after Shutdown()")
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/lockstate/... -v
```

Expected: Compilation error — package doesn't exist.

- [ ] **Step 3: Implement lockstate**

```go
// internal/lockstate/lockstate.go
package lockstate

import (
	"errors"
	"sync"
	"time"
)

var ErrLocked = errors.New("vault is locked")

// State manages the in-memory vault unlock state and idle timer.
type State struct {
	mu       sync.RWMutex
	locked   bool
	key      []byte
	timeout  time.Duration
	timer    *time.Timer
	onLock   func()
	shutdown bool
}

// New creates a locked State with the given idle timeout.
// onLock is called (in a goroutine) when the vault auto-locks.
func New(timeout time.Duration, onLock func()) *State {
	return &State{
		locked:  true,
		timeout: timeout,
		onLock:  onLock,
	}
}

// IsLocked returns whether the vault is currently locked.
func (s *State) IsLocked() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.locked
}

// Unlock stores the derived key and starts the idle timer.
func (s *State) Unlock(key []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.key = key
	s.locked = false
	s.resetTimerLocked()
}

// Lock zeroes the key and stops the idle timer.
func (s *State) Lock() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lockLocked()
}

// GetKey returns the derived key if unlocked, or ErrLocked.
func (s *State) GetKey() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.locked {
		return nil, ErrLocked
	}
	return s.key, nil
}

// Touch resets the idle timer. Call on every credential access.
func (s *State) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.locked {
		s.resetTimerLocked()
	}
}

// SetTimeout updates the idle timeout duration.
func (s *State) SetTimeout(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeout = d
	if !s.locked {
		s.resetTimerLocked()
	}
}

// Shutdown zeroes the key and prevents further unlocks.
func (s *State) Shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shutdown = true
	s.lockLocked()
}

func (s *State) lockLocked() {
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.key != nil {
		for i := range s.key {
			s.key[i] = 0
		}
		s.key = nil
	}
	s.locked = true
}

func (s *State) resetTimerLocked() {
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(s.timeout, func() {
		s.Lock()
		if s.onLock != nil {
			s.onLock()
		}
	})
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go test ./internal/lockstate/... -race -v
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/lockstate/
git commit -m "feat(lockstate): add vault unlock state machine with idle timer

Manages derived key in memory, zeroes on lock/shutdown.
Configurable idle timeout with Touch() to reset on activity."
```

---

## Task 5: Config — Add VaultConfig

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Read current config file**

Read `internal/config/config.go` to confirm exact struct layout before editing.

- [ ] **Step 2: Add VaultConfig sub-struct and field**

Add after the existing `DebugConfig` struct (around line 48) and add the field to `Config`:

```go
// Add the VaultConfig struct after DebugConfig
type VaultConfig struct {
	Enabled             bool `json:"enabled"`
	LockTimeoutMinutes  int  `json:"lockTimeoutMinutes"`
	TouchIDEnabled      bool `json:"touchIdEnabled"`
}
```

Add to the `Config` struct:

```go
type Config struct {
	SSH    SSHConfig    `json:"ssh"`
	SFTP   SFTPConfig   `json:"sftp"`
	Window WindowConfig `json:"window"`
	Log    LogConfig    `json:"log"`
	Debug  DebugConfig  `json:"debug"`
	Vault  VaultConfig  `json:"vault"`
}
```

Set default in the `Default()` function:

```go
Vault: VaultConfig{
	Enabled:            false,
	LockTimeoutMinutes: 15,
	TouchIDEnabled:     false,
},
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./...
```

Expected: Clean build.

- [ ] **Step 4: Run existing tests**

```bash
go test ./internal/... -race -timeout 60s
```

Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go
git commit -m "feat(config): add VaultConfig for master password settings

Adds enabled, lockTimeoutMinutes, touchIdEnabled fields.
Default: disabled, 15 min timeout."
```

---

## Task 6: Store — Add vault_meta and secrets Tables

**Files:**
- Modify: `internal/store/store.go`

- [ ] **Step 1: Read current store.go schema section**

Read `internal/store/store.go` lines 180-263 to see the current table creation and migration pattern.

- [ ] **Step 2: Add table creation for vault_meta and secrets**

Add after the existing `CREATE TABLE IF NOT EXISTS workspace_templates` block (inside the `New()` function, before the ALTER TABLE migrations):

```sql
CREATE TABLE IF NOT EXISTS vault_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt BLOB NOT NULL,
    nonce BLOB NOT NULL,
    verify_blob BLOB NOT NULL,
    argon2_time INTEGER NOT NULL DEFAULT 3,
    argon2_memory INTEGER NOT NULL DEFAULT 65536,
    argon2_threads INTEGER NOT NULL DEFAULT 4,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    nonce BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    PRIMARY KEY (host_id, kind)
);
```

- [ ] **Step 3: Add vault CRUD methods to Store**

Add at the end of `store.go`:

```go
// GetVaultMeta returns the vault metadata, or nil if vault is not set up.
func (s *Store) GetVaultMeta() (*vault.VaultMeta, error) {
	row := s.db.QueryRow(`SELECT salt, nonce, verify_blob, argon2_time, argon2_memory, argon2_threads FROM vault_meta WHERE id = 1`)
	meta := &vault.VaultMeta{}
	err := row.Scan(&meta.Salt, &meta.Nonce, &meta.VerifyBlob, &meta.ArgonTime, &meta.ArgonMemory, &meta.ArgonThreads)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get vault meta: %w", err)
	}
	return meta, nil
}

// SaveVaultMeta inserts or replaces the vault metadata row.
func (s *Store) SaveVaultMeta(meta *vault.VaultMeta) error {
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO vault_meta (id, salt, nonce, verify_blob, argon2_time, argon2_memory, argon2_threads, created_at)
		 VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))`,
		meta.Salt, meta.Nonce, meta.VerifyBlob, meta.ArgonTime, meta.ArgonMemory, meta.ArgonThreads,
	)
	return err
}

// DeleteVaultMeta removes the vault metadata and all encrypted secrets.
func (s *Store) DeleteVaultMeta() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM secrets`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vault_meta`); err != nil {
		return err
	}
	return tx.Commit()
}

// StoreEncryptedSecret stores an encrypted secret for a host.
func (s *Store) StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error {
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO secrets (host_id, kind, nonce, ciphertext) VALUES (?, ?, ?, ?)`,
		hostID, kind, nonce, ciphertext,
	)
	return err
}

// GetEncryptedSecret retrieves an encrypted secret for a host.
func (s *Store) GetEncryptedSecret(hostID, kind string) (nonce, ciphertext []byte, err error) {
	row := s.db.QueryRow(`SELECT nonce, ciphertext FROM secrets WHERE host_id = ? AND kind = ?`, hostID, kind)
	err = row.Scan(&nonce, &ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	return nonce, ciphertext, err
}

// ListEncryptedSecrets returns all encrypted secrets (for migration/re-encryption).
func (s *Store) ListEncryptedSecrets() ([]struct {
	HostID     string
	Kind       string
	Nonce      []byte
	Ciphertext []byte
}, error) {
	rows, err := s.db.Query(`SELECT host_id, kind, nonce, ciphertext FROM secrets`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []struct {
		HostID     string
		Kind       string
		Nonce      []byte
		Ciphertext []byte
	}
	for rows.Next() {
		var r struct {
			HostID     string
			Kind       string
			Nonce      []byte
			Ciphertext []byte
		}
		if err := rows.Scan(&r.HostID, &r.Kind, &r.Nonce, &r.Ciphertext); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// DeleteEncryptedSecret removes a specific encrypted secret.
func (s *Store) DeleteEncryptedSecret(hostID, kind string) error {
	_, err := s.db.Exec(`DELETE FROM secrets WHERE host_id = ? AND kind = ?`, hostID, kind)
	return err
}

// ClearHostPassword clears the plaintext password fallback column for a host.
func (s *Store) ClearHostPassword(hostID string) error {
	_, err := s.db.Exec(`UPDATE hosts SET password = NULL WHERE id = ?`, hostID)
	return err
}

// ListInlinePasswordHostIDs returns IDs of hosts using inline credential source.
func (s *Store) ListInlinePasswordHostIDs() ([]string, error) {
	rows, err := s.db.Query(
		`SELECT id FROM hosts WHERE auth_method IN ('password', 'key') AND (credential_source = 'inline' OR credential_source = '' OR credential_source IS NULL)`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
```

Add the import for the vault package at the top of `store.go`.

- [ ] **Step 4: Build and run tests**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./... && go test ./internal/store/... -race -v
```

Expected: Clean build, existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/store/store.go
git commit -m "feat(store): add vault_meta and secrets tables with CRUD methods

New tables for encrypted vault storage. Methods for storing/retrieving
encrypted secrets, vault metadata, and migration helpers."
```

---

## Task 7: Credential Resolver — Vault-Aware Routing

**Files:**
- Modify: `internal/store/credentials.go`
- Modify: `internal/credstore/resolver.go`

- [ ] **Step 1: Read current files**

Read `internal/store/credentials.go` and `internal/credstore/resolver.go`.

- [ ] **Step 2: Add vault methods to CredentialResolver interface**

In `internal/store/credentials.go`, add a new interface for vault-aware credential resolution:

```go
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
```

- [ ] **Step 3: Implement vault methods on Resolver**

In `internal/credstore/resolver.go`, add:

```go
import (
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/dylanbr0wn/shsh/internal/vault"
)

// VaultStoreSecret encrypts a plaintext secret and stores it in the DB.
func (r *Resolver) VaultStoreSecret(ss store.SecretStore, key []byte, hostID, kind, plaintext string) error {
	nonce, ciphertext, err := vault.Encrypt(key, []byte(plaintext))
	if err != nil {
		return fmt.Errorf("vault encrypt: %w", err)
	}
	return ss.StoreEncryptedSecret(hostID, kind, nonce, ciphertext)
}

// VaultGetSecret retrieves and decrypts a secret from the DB.
func (r *Resolver) VaultGetSecret(ss store.SecretStore, key []byte, hostID, kind string) (string, error) {
	nonce, ciphertext, err := ss.GetEncryptedSecret(hostID, kind)
	if err != nil {
		return "", fmt.Errorf("vault get secret: %w", err)
	}
	if nonce == nil {
		return "", nil // no secret stored
	}
	plaintext, err := vault.Decrypt(key, nonce, ciphertext)
	if err != nil {
		return "", fmt.Errorf("vault decrypt: %w", err)
	}
	return string(plaintext), nil
}

// VaultDeleteSecret removes an encrypted secret.
func (r *Resolver) VaultDeleteSecret(ss store.SecretStore, hostID, kind string) error {
	return ss.DeleteEncryptedSecret(hostID, kind)
}
```

- [ ] **Step 4: Build and test**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./... && go test ./internal/... -race -timeout 60s
```

Expected: Clean build, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/store/credentials.go internal/credstore/resolver.go
git commit -m "feat(credstore): add vault-aware credential resolver methods

VaultCredentialResolver interface and implementation for encrypting/
decrypting secrets via the vault package."
```

---

## Task 8: Deps — Add LockState Field

**Files:**
- Modify: `internal/deps/deps.go`

- [ ] **Step 1: Read current deps.go**

Read `internal/deps/deps.go`.

- [ ] **Step 2: Add LockState field**

```go
import (
	"github.com/dylanbr0wn/shsh/internal/lockstate"
)

type Deps struct {
	Ctx       context.Context
	Store     *store.Store
	Manager   *session.Manager
	Cfg       *config.Config
	CfgPath   string
	DebugSink *debuglog.DebugSink
	LockState *lockstate.State
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./...
```

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add internal/deps/deps.go
git commit -m "chore(deps): add LockState field to Deps struct"
```

---

## Task 9: VaultFacade — Wails-Bound Methods

**Files:**
- Create: `vault_facade.go`
- Modify: `app.go`
- Modify: `main.go`

- [ ] **Step 1: Create VaultFacade**

```go
// vault_facade.go
package main

import (
	"fmt"
	"time"

	"github.com/dylanbr0wn/shsh/internal/biometric"
	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/vault"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type VaultFacade struct {
	d *deps.Deps
}

func NewVaultFacade(d *deps.Deps) *VaultFacade {
	return &VaultFacade{d: d}
}

// SetupVault creates the vault, encrypts existing inline secrets, and removes them from the keychain.
func (f *VaultFacade) SetupVault(password string) error {
	meta, key, err := vault.NewVaultMeta(password)
	if err != nil {
		return fmt.Errorf("create vault: %w", err)
	}

	if err := f.d.Store.SaveVaultMeta(meta); err != nil {
		vault.ZeroKey(key)
		return fmt.Errorf("save vault meta: %w", err)
	}

	// Migrate inline secrets from keychain to vault
	hostIDs, err := f.d.Store.ListInlinePasswordHostIDs()
	if err != nil {
		vault.ZeroKey(key)
		return fmt.Errorf("list hosts: %w", err)
	}

	for _, hostID := range hostIDs {
		// Try to get password from keychain
		pw, _ := f.d.Store.GetCredentials().InlineSecret(hostID, "")
		if pw != "" {
			if err := f.d.Store.GetCredentials().(interface {
				VaultStoreSecret(interface {
					StoreEncryptedSecret(string, string, []byte, []byte) error
					GetEncryptedSecret(string, string) ([]byte, []byte, error)
					DeleteEncryptedSecret(string, string) error
				}, []byte, string, string, string) error
			}).VaultStoreSecret(f.d.Store, key, hostID, "password", pw); err != nil {
				vault.ZeroKey(key)
				return fmt.Errorf("migrate password for %s: %w", hostID, err)
			}
			f.d.Store.GetCredentials().DeleteSecret(hostID)
			f.d.Store.ClearHostPassword(hostID)
		}

		// Try to get passphrase from keychain
		pp, _ := f.d.Store.GetCredentials().InlineSecret(hostID+":passphrase", "")
		if pp != "" {
			if err := f.d.Store.GetCredentials().(interface {
				VaultStoreSecret(interface {
					StoreEncryptedSecret(string, string, []byte, []byte) error
					GetEncryptedSecret(string, string) ([]byte, []byte, error)
					DeleteEncryptedSecret(string, string) error
				}, []byte, string, string, string) error
			}).VaultStoreSecret(f.d.Store, key, hostID, "passphrase", pp); err != nil {
				vault.ZeroKey(key)
				return fmt.Errorf("migrate passphrase for %s: %w", hostID, err)
			}
			f.d.Store.GetCredentials().DeleteSecret(hostID + ":passphrase")
		}
	}

	// Store key via Touch ID if available and enabled
	if f.d.Cfg.Vault.TouchIDEnabled && biometric.Available() {
		biometric.StoreKey(key)
	}

	// Unlock
	f.d.Cfg.Vault.Enabled = true
	f.d.LockState.Unlock(key)
	return nil
}

// UnlockVault verifies the master password and unlocks the vault.
func (f *VaultFacade) UnlockVault(password string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return fmt.Errorf("get vault meta: %w", err)
	}
	if meta == nil {
		return fmt.Errorf("vault not set up")
	}

	key, err := vault.VerifyAndDeriveKey(password, meta)
	if err != nil {
		return err
	}

	f.d.LockState.Unlock(key)
	return nil
}

// UnlockVaultBiometric retrieves the key from Touch ID and unlocks.
func (f *VaultFacade) UnlockVaultBiometric() error {
	key, err := biometric.RetrieveKey()
	if err != nil {
		return fmt.Errorf("biometric unlock: %w", err)
	}
	f.d.LockState.Unlock(key)
	return nil
}

// LockVault manually locks the vault.
func (f *VaultFacade) LockVault() {
	f.d.LockState.Lock()
	wailsruntime.EventsEmit(f.d.Ctx, "vault:locked")
}

// IsVaultEnabled returns whether the vault is set up.
func (f *VaultFacade) IsVaultEnabled() bool {
	return f.d.Cfg.Vault.Enabled
}

// IsVaultLocked returns whether the vault is currently locked.
func (f *VaultFacade) IsVaultLocked() bool {
	if !f.d.Cfg.Vault.Enabled {
		return false
	}
	return f.d.LockState.IsLocked()
}

// IsBiometricAvailable returns whether Touch ID is available.
func (f *VaultFacade) IsBiometricAvailable() bool {
	return biometric.Available()
}

// DisableVault decrypts all secrets back to keychain and removes the vault.
func (f *VaultFacade) DisableVault(password string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return err
	}
	if meta == nil {
		return fmt.Errorf("vault not set up")
	}

	key, err := vault.VerifyAndDeriveKey(password, meta)
	if err != nil {
		return err
	}
	defer vault.ZeroKey(key)

	// Decrypt all secrets and move back to keychain
	secrets, err := f.d.Store.ListEncryptedSecrets()
	if err != nil {
		return fmt.Errorf("list secrets: %w", err)
	}

	for _, s := range secrets {
		plaintext, err := vault.Decrypt(key, s.Nonce, s.Ciphertext)
		if err != nil {
			return fmt.Errorf("decrypt secret %s/%s: %w", s.HostID, s.Kind, err)
		}
		keychainKey := s.HostID
		if s.Kind == "passphrase" {
			keychainKey = s.HostID + ":passphrase"
		}
		if err := f.d.Store.GetCredentials().StoreSecret(keychainKey, string(plaintext)); err != nil {
			return fmt.Errorf("restore to keychain %s: %w", keychainKey, err)
		}
	}

	if err := f.d.Store.DeleteVaultMeta(); err != nil {
		return err
	}

	biometric.DeleteKey()
	f.d.Cfg.Vault.Enabled = false
	f.d.LockState.Lock()
	return nil
}

// ChangeVaultPassword re-encrypts all secrets with a new master password.
func (f *VaultFacade) ChangeVaultPassword(oldPassword, newPassword string) error {
	meta, err := f.d.Store.GetVaultMeta()
	if err != nil {
		return err
	}
	if meta == nil {
		return fmt.Errorf("vault not set up")
	}

	oldKey, err := vault.VerifyAndDeriveKey(oldPassword, meta)
	if err != nil {
		return err
	}

	// Create new vault meta with new password
	newMeta, newKey, err := vault.NewVaultMeta(newPassword)
	if err != nil {
		vault.ZeroKey(oldKey)
		return err
	}

	// Re-encrypt all secrets
	secrets, err := f.d.Store.ListEncryptedSecrets()
	if err != nil {
		vault.ZeroKey(oldKey)
		vault.ZeroKey(newKey)
		return err
	}

	for _, s := range secrets {
		plaintext, err := vault.Decrypt(oldKey, s.Nonce, s.Ciphertext)
		if err != nil {
			vault.ZeroKey(oldKey)
			vault.ZeroKey(newKey)
			return fmt.Errorf("decrypt %s/%s: %w", s.HostID, s.Kind, err)
		}
		nonce, ciphertext, err := vault.Encrypt(newKey, plaintext)
		if err != nil {
			vault.ZeroKey(oldKey)
			vault.ZeroKey(newKey)
			return err
		}
		if err := f.d.Store.StoreEncryptedSecret(s.HostID, s.Kind, nonce, ciphertext); err != nil {
			vault.ZeroKey(oldKey)
			vault.ZeroKey(newKey)
			return err
		}
	}

	vault.ZeroKey(oldKey)

	if err := f.d.Store.SaveVaultMeta(newMeta); err != nil {
		vault.ZeroKey(newKey)
		return err
	}

	// Update Touch ID stored key
	if f.d.Cfg.Vault.TouchIDEnabled && biometric.Available() {
		biometric.StoreKey(newKey)
	}

	f.d.LockState.Unlock(newKey)
	return nil
}

// EnableTouchID stores the current derived key in the Secure Enclave.
func (f *VaultFacade) EnableTouchID() error {
	key, err := f.d.LockState.GetKey()
	if err != nil {
		return fmt.Errorf("vault must be unlocked to enable Touch ID")
	}
	if err := biometric.StoreKey(key); err != nil {
		return err
	}
	f.d.Cfg.Vault.TouchIDEnabled = true
	return nil
}

// DisableTouchID removes the key from the Secure Enclave.
func (f *VaultFacade) DisableTouchID() error {
	if err := biometric.DeleteKey(); err != nil {
		return err
	}
	f.d.Cfg.Vault.TouchIDEnabled = false
	return nil
}

// SetLockTimeout updates the idle lock timeout.
func (f *VaultFacade) SetLockTimeout(minutes int) {
	f.d.Cfg.Vault.LockTimeoutMinutes = minutes
	f.d.LockState.SetTimeout(time.Duration(minutes) * time.Minute)
}
```

**Note:** The `SetupVault` method above uses type assertions for `VaultStoreSecret` which is ugly. A cleaner approach is to add a `GetCredentials()` method that returns the resolver, or to pass the vault encrypt/decrypt functions directly. During implementation, simplify this — the key pattern is:

1. Read secret from keychain via `InlineSecret`
2. Encrypt with `vault.Encrypt(key, []byte(secret))`
3. Store with `Store.StoreEncryptedSecret`
4. Delete from keychain with `DeleteSecret`

The implementer should refactor this to avoid the type assertions — use the `vault` package directly rather than going through the resolver interface for migration.

- [ ] **Step 2: Add Store.GetCredentials() accessor**

In `internal/store/store.go`, add:

```go
// GetCredentials returns the credential resolver.
func (s *Store) GetCredentials() CredentialResolver {
	return s.credentials
}
```

- [ ] **Step 3: Wire VaultFacade into App**

In `app.go`, add the vault field and initialization:

```go
type App struct {
	deps     *deps.Deps
	hosts    *HostFacade
	sessions *SessionFacade
	keys     *KeysFacade
	tools    *ToolsFacade
	vault    *VaultFacade
}
```

In `NewApp()`:

```go
func NewApp(cfg *config.Config) *App {
	d := &deps.Deps{Cfg: cfg}
	return &App{
		deps:     d,
		hosts:    NewHostFacade(d),
		sessions: NewSessionFacade(d),
		keys:     NewKeysFacade(d),
		tools:    NewToolsFacade(d),
		vault:    NewVaultFacade(d),
	}
}
```

In `startup()`, after store initialization (after line 81 — the `MigratePasswordsToKeychain` call), add lockstate initialization:

```go
// Initialize lock state
onLock := func() {
	wailsruntime.EventsEmit(ctx, "vault:locked")
}
a.deps.LockState = lockstate.New(
	time.Duration(a.deps.Cfg.Vault.LockTimeoutMinutes)*time.Minute,
	onLock,
)
```

In `shutdown()`, add before existing cleanup:

```go
if a.deps.LockState != nil {
	a.deps.LockState.Shutdown()
}
```

- [ ] **Step 4: Bind VaultFacade in main.go**

In `main.go`, add `app.vault` to the `Bind` slice:

```go
Bind: []any{
	app,
	app.hosts,
	app.sessions,
	app.keys,
	app.tools,
	app.vault,
},
```

- [ ] **Step 5: Build**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./...
```

Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add vault_facade.go app.go main.go internal/store/store.go
git commit -m "feat(vault): add VaultFacade with setup, unlock, lock, and migration

Wails-bound methods for vault lifecycle: setup with keychain migration,
unlock via password or Touch ID, lock, disable, change password.
Wired into App struct and Wails bindings."
```

---

## Task 10: Integrate Lock Checks into Session & Host Facades

**Files:**
- Modify: `session_facade.go`
- Modify: `host_facade.go`

- [ ] **Step 1: Read current facade files**

Read `session_facade.go` and `host_facade.go` to see current method signatures.

- [ ] **Step 2: Add lock check to session facade**

In `session_facade.go`, modify `resolveWithJump` (or the method that calls `GetHostForConnect`) to check lock state when vault is enabled:

```go
// Add at the top of ConnectHost, ConnectForSFTP, and QuickConnect
// (any method that ultimately calls GetHostForConnect)
func (f *SessionFacade) checkVaultUnlocked() error {
	if f.d.Cfg.Vault.Enabled && f.d.LockState != nil && f.d.LockState.IsLocked() {
		return fmt.Errorf("vault is locked")
	}
	if f.d.LockState != nil {
		f.d.LockState.Touch()
	}
	return nil
}
```

Add a call to `checkVaultUnlocked()` at the start of `ConnectHost` and `ConnectForSFTP`:

```go
func (f *SessionFacade) ConnectHost(hostID string) (session.ConnectHostResult, error) {
	if err := f.checkVaultUnlocked(); err != nil {
		return session.ConnectHostResult{}, err
	}
	// ... existing code
}
```

- [ ] **Step 3: Touch lockstate on host credential operations**

In `host_facade.go`, add lockstate touch to `AddHost` and `UpdateHost` when they include passwords:

```go
func (f *HostFacade) AddHost(input store.CreateHostInput) (store.Host, error) {
	if f.d.Cfg.Vault.Enabled && f.d.LockState != nil {
		if f.d.LockState.IsLocked() {
			return store.Host{}, fmt.Errorf("vault is locked")
		}
		f.d.LockState.Touch()
	}
	return f.d.Store.AddHost(input)
}
```

- [ ] **Step 4: Build and test**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./... && go test ./internal/... -race -timeout 60s
```

Expected: Clean build, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add session_facade.go host_facade.go
git commit -m "feat(session): add vault lock checks to session and host facades

Connection and credential operations now check vault lock state.
Idle timer resets on credential access."
```

---

## Task 11: Regenerate Wails Bindings

**Files:**
- Regenerated: `frontend/wailsjs/go/`

- [ ] **Step 1: Generate bindings**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && wails generate module
```

Expected: New TypeScript bindings for `VaultFacade` methods appear in `frontend/wailsjs/go/main/`.

- [ ] **Step 2: Verify new bindings exist**

```bash
ls frontend/wailsjs/go/main/ | grep -i vault
```

Expected: `VaultFacade.js` and `VaultFacade.d.ts` (or similar) should be present.

- [ ] **Step 3: Commit**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for VaultFacade"
```

---

## Task 12: Frontend — Vault Atoms & Types

**Files:**
- Create: `frontend/src/atoms/vault.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Read current types**

Read `frontend/src/types/index.ts` to see existing type definitions.

- [ ] **Step 2: Add vault types**

In `frontend/src/types/index.ts`, add:

```typescript
export interface VaultConfig {
  enabled: boolean;
  lockTimeoutMinutes: number;
  touchIdEnabled: boolean;
}
```

- [ ] **Step 3: Create vault atoms**

```typescript
// frontend/src/atoms/vault.ts
import { atom } from "jotai";

export const vaultLockedAtom = atom<boolean>(false);
export const vaultEnabledAtom = atom<boolean>(false);
export const biometricAvailableAtom = atom<boolean>(false);
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/atoms/vault.ts frontend/src/types/index.ts
git commit -m "feat(ui): add vault atoms and types"
```

---

## Task 13: Frontend — VaultLockOverlay Component

**Files:**
- Create: `frontend/src/components/modals/VaultLockOverlay.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create VaultLockOverlay**

```tsx
// frontend/src/components/modals/VaultLockOverlay.tsx
import { useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { vaultLockedAtom, biometricAvailableAtom } from "@/atoms/vault";
import { VaultFacade } from "../../wailsjs/go/main/VaultFacade";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Fingerprint } from "lucide-react";

export function VaultLockOverlay() {
  const [locked, setLocked] = useAtom(vaultLockedAtom);
  const [biometricAvailable] = useAtom(biometricAvailableAtom);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      await VaultFacade.UnlockVault(password);
      setLocked(false);
      setPassword("");
    } catch (e: any) {
      setError(e?.message || "Wrong password");
    } finally {
      setLoading(false);
    }
  }, [password, setLocked]);

  const handleBiometric = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await VaultFacade.UnlockVaultBiometric();
      setLocked(false);
    } catch (e: any) {
      setError("Touch ID failed. Enter your master password.");
    } finally {
      setLoading(false);
    }
  }, [setLocked]);

  // Auto-trigger Touch ID on mount if available
  useEffect(() => {
    if (locked && biometricAvailable) {
      handleBiometric();
    }
  }, [locked, biometricAvailable, handleBiometric]);

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop blur */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Lock dialog */}
      <div className="relative z-10 flex flex-col items-center gap-6 rounded-xl border bg-card p-8 shadow-lg w-[360px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="text-center">
          <h2 className="text-lg font-semibold">Vault Locked</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your master password to unlock
          </p>
        </div>

        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleUnlock();
          }}
        >
          <Input
            type="password"
            placeholder="Master password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            disabled={loading}
          />

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={loading || !password.trim()}>
            {loading ? "Unlocking..." : "Unlock"}
          </Button>

          {biometricAvailable && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBiometric}
              disabled={loading}
              className="gap-2"
            >
              <Fingerprint className="h-4 w-4" />
              Use Touch ID
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

Read `frontend/src/App.tsx`, then add:

1. Import the overlay and atoms
2. Add event listener for `vault:locked`
3. Check vault state on mount
4. Render `<VaultLockOverlay />` at the top level

```tsx
// Add imports
import { VaultLockOverlay } from "@/components/modals/VaultLockOverlay";
import { vaultLockedAtom, vaultEnabledAtom, biometricAvailableAtom } from "@/atoms/vault";
import { VaultFacade } from "../wailsjs/go/main/VaultFacade";
import { EventsOn } from "../wailsjs/runtime/runtime";

// Inside the App component, add:
const [, setVaultLocked] = useAtom(vaultLockedAtom);
const [, setVaultEnabled] = useAtom(vaultEnabledAtom);
const [, setBiometricAvailable] = useAtom(biometricAvailableAtom);

useEffect(() => {
  // Check vault state on mount
  VaultFacade.IsVaultEnabled().then((enabled) => {
    setVaultEnabled(enabled);
    if (enabled) {
      VaultFacade.IsVaultLocked().then(setVaultLocked);
    }
  });
  VaultFacade.IsBiometricAvailable().then(setBiometricAvailable);

  // Listen for lock events
  const cleanup = EventsOn("vault:locked", () => {
    setVaultLocked(true);
  });
  return cleanup;
}, [setVaultLocked, setVaultEnabled, setBiometricAvailable]);

// Add <VaultLockOverlay /> as the first child inside the outermost fragment/div
```

- [ ] **Step 3: Build frontend**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm build
```

Expected: TypeScript check + build succeed.

- [ ] **Step 4: Lint and format check**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm lint && pnpm format:check
```

Expected: Pass (fix any formatting issues with `pnpm format`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/modals/VaultLockOverlay.tsx frontend/src/App.tsx
git commit -m "feat(ui): add vault lock overlay with Touch ID and password unlock

Full-screen overlay with backdrop blur, password input, Touch ID
button. Auto-triggers biometric on mount. Listens for vault:locked event."
```

---

## Task 14: Frontend — Security Settings Section

**Files:**
- Create: `frontend/src/components/settings/SecuritySettings.tsx`
- Modify: `frontend/src/components/modals/SettingsModal.tsx`

- [ ] **Step 1: Read current SettingsModal**

Read `frontend/src/components/modals/SettingsModal.tsx`.

- [ ] **Step 2: Create SecuritySettings component**

```tsx
// frontend/src/components/settings/SecuritySettings.tsx
import { useState, useCallback } from "react";
import { useAtom } from "jotai";
import { vaultEnabledAtom, biometricAvailableAtom } from "@/atoms/vault";
import { VaultFacade } from "../../../wailsjs/go/main/VaultFacade";
import { App } from "../../../wailsjs/go/main/App";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, Fingerprint, Lock } from "lucide-react";

export function SecuritySettings() {
  const [vaultEnabled, setVaultEnabled] = useAtom(vaultEnabledAtom);
  const [biometricAvailable] = useAtom(biometricAvailableAtom);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [touchIdEnabled, setTouchIdEnabled] = useState(false);
  const [lockTimeout, setLockTimeout] = useState("15");

  // Load initial state
  useState(() => {
    App.GetConfig().then((cfg: any) => {
      setTouchIdEnabled(cfg.vault?.touchIdEnabled ?? false);
      setLockTimeout(String(cfg.vault?.lockTimeoutMinutes ?? 15));
    });
  });

  const handleSetupVault = useCallback(async () => {
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await VaultFacade.SetupVault(password);
      setVaultEnabled(true);
      setShowSetup(false);
      setPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      setError(e?.message || "Failed to set up vault");
    } finally {
      setLoading(false);
    }
  }, [password, confirmPassword, setVaultEnabled]);

  const handleDisableVault = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await VaultFacade.DisableVault(password);
      setVaultEnabled(false);
      setShowDisable(false);
      setPassword("");
    } catch (e: any) {
      setError(e?.message || "Wrong password");
    } finally {
      setLoading(false);
    }
  }, [password, setVaultEnabled]);

  const handleToggleTouchId = useCallback(
    async (enabled: boolean) => {
      try {
        if (enabled) {
          await VaultFacade.EnableTouchID();
        } else {
          await VaultFacade.DisableTouchID();
        }
        setTouchIdEnabled(enabled);
      } catch (e: any) {
        setError(e?.message || "Failed to toggle Touch ID");
      }
    },
    [],
  );

  const handleTimeoutChange = useCallback(async (value: string) => {
    setLockTimeout(value);
    VaultFacade.SetLockTimeout(parseInt(value, 10));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" />
        <h3 className="text-sm font-medium">Security</h3>
      </div>

      {!vaultEnabled && !showSetup && (
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground mb-3">
            Encrypt your stored credentials with a master password.
          </p>
          <Button variant="outline" onClick={() => setShowSetup(true)}>
            Set Up Vault Encryption
          </Button>
        </div>
      )}

      {!vaultEnabled && showSetup && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="vault-password">Master Password</Label>
            <Input
              id="vault-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-confirm">Confirm Password</Label>
            <Input
              id="vault-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSetupVault} disabled={loading}>
              {loading ? "Setting up..." : "Enable Vault"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowSetup(false);
                setPassword("");
                setConfirmPassword("");
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {vaultEnabled && (
        <div className="space-y-4">
          {biometricAvailable && (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <Fingerprint className="h-4 w-4" />
                <div>
                  <p className="text-sm font-medium">Touch ID</p>
                  <p className="text-xs text-muted-foreground">
                    Unlock vault with fingerprint
                  </p>
                </div>
              </div>
              <Switch
                checked={touchIdEnabled}
                onCheckedChange={handleToggleTouchId}
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Auto-Lock Timeout</p>
              <p className="text-xs text-muted-foreground">
                Lock vault after inactivity
              </p>
            </div>
            <Select value={lockTimeout} onValueChange={handleTimeoutChange}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="10">10 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">60 min</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4" />
              <p className="text-sm font-medium">Lock Now</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => VaultFacade.LockVault()}
            >
              Lock
            </Button>
          </div>

          <div className="pt-2 border-t">
            {!showDisable && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setShowDisable(true)}
              >
                Disable Vault Encryption
              </Button>
            )}
            {showDisable && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enter your master password to decrypt credentials back to the
                  macOS Keychain.
                </p>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Master password"
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleDisableVault}
                    disabled={loading}
                  >
                    {loading ? "Disabling..." : "Disable Vault"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowDisable(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add SecuritySettings to SettingsModal**

In `frontend/src/components/modals/SettingsModal.tsx`, import and render:

```tsx
import { SecuritySettings } from "@/components/settings/SecuritySettings";

// Add after the existing Appearance / Sessions sections:
<SecuritySettings />
```

- [ ] **Step 4: Build, lint, format**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm build && pnpm lint && pnpm format:check
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/SecuritySettings.tsx frontend/src/components/modals/SettingsModal.tsx
git commit -m "feat(ui): add security settings section for vault management

Enable/disable vault, Touch ID toggle, lock timeout selector,
lock now button, and disable vault with password confirmation."
```

---

## Task 15: Frontend — Header Lock Button & Keyboard Shortcut

**Files:**
- Modify: `frontend/src/components/TitleBar.tsx` (or wherever the header is)

- [ ] **Step 1: Find the header/title bar component**

Search for the title bar or header component that renders across the top of the app.

- [ ] **Step 2: Add lock button**

Add a lock icon button that's visible when vault is enabled:

```tsx
import { useAtom } from "jotai";
import { vaultEnabledAtom } from "@/atoms/vault";
import { VaultFacade } from "../../wailsjs/go/main/VaultFacade";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

// Inside the component:
const [vaultEnabled] = useAtom(vaultEnabledAtom);

// In the JSX, add near the header actions:
{vaultEnabled && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => VaultFacade.LockVault()}
    title="Lock vault (⌘L)"
    className="h-7 w-7"
  >
    <Lock className="h-3.5 w-3.5" />
  </Button>
)}
```

- [ ] **Step 3: Add Cmd+L keyboard shortcut**

In `App.tsx` (or wherever global keybindings are registered), add:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === "l") {
      e.preventDefault();
      VaultFacade.IsVaultEnabled().then((enabled) => {
        if (enabled) VaultFacade.LockVault();
      });
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

- [ ] **Step 4: Build, lint, format**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm build && pnpm lint && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TitleBar.tsx frontend/src/App.tsx
git commit -m "feat(ui): add header lock button and Cmd+L shortcut"
```

---

## Task 16: Frontend — Update Host Form Credential Label

**Files:**
- Modify: `frontend/src/components/modals/HostFormTabs.tsx`

- [ ] **Step 1: Read HostFormTabs credential section**

Read `frontend/src/components/modals/HostFormTabs.tsx` lines 184-232.

- [ ] **Step 2: Update inline credential label**

Change the inline option label and help text to be vault-aware:

```tsx
import { useAtom } from "jotai";
import { vaultEnabledAtom } from "@/atoms/vault";

// Inside the component:
const [vaultEnabled] = useAtom(vaultEnabledAtom);

// Update the inline option label (around line 209):
// From: "Inline (macOS Keychain)"
// To:
<SelectItem value="inline">
  {vaultEnabled ? "Stored in vault" : "Inline (macOS Keychain)"}
</SelectItem>

// Update the help text (around line 229):
// From: "Stored securely in macOS Keychain, never in plain text."
// To:
<p className="text-xs text-muted-foreground">
  {vaultEnabled
    ? "Encrypted in vault with your master password."
    : "Stored securely in macOS Keychain, never in plain text."}
</p>
```

- [ ] **Step 3: Build, lint, format**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm build && pnpm lint && pnpm format:check
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/modals/HostFormTabs.tsx
git commit -m "feat(ui): show 'Stored in vault' when vault is enabled

Dynamic credential source label and help text based on vault state."
```

---

## Task 17: Store Integration — Vault-Aware Credential Storage on AddHost/UpdateHost

**Files:**
- Modify: `internal/store/store.go`

- [ ] **Step 1: Read AddHost and UpdateHost credential handling**

Read `internal/store/store.go` lines 485-603.

- [ ] **Step 2: Add vault-aware credential storage**

The `Store` needs to know whether vault mode is active. Add a vault key accessor that the facades set:

```go
// Add to Store struct:
type Store struct {
    db          *sql.DB
    credentials CredentialResolver
    vaultKey    func() ([]byte, error) // returns key or lockstate.ErrLocked; nil means vault disabled
}

// Add setter:
func (s *Store) SetVaultKeyFunc(fn func() ([]byte, error)) {
    s.vaultKey = fn
}
```

Modify `AddHost` credential storage (around line 534) to route through vault when enabled:

```go
// Replace the existing inline password storage block with:
if input.Password != "" && credentialSource == SourceInline {
    if s.vaultKey != nil {
        key, err := s.vaultKey()
        if err != nil {
            return Host{}, fmt.Errorf("vault locked: %w", err)
        }
        nonce, ciphertext, err := vault.Encrypt(key, []byte(input.Password))
        if err != nil {
            return Host{}, fmt.Errorf("vault encrypt: %w", err)
        }
        if err := s.StoreEncryptedSecret(host.ID, "password", nonce, ciphertext); err != nil {
            return Host{}, err
        }
    } else {
        // Existing keychain path
        if err := s.credentials.StoreSecret(host.ID, input.Password); err != nil {
            // existing fallback...
        }
    }
}
```

Apply the same pattern to `UpdateHost` and key passphrase storage.

Modify `GetHostForConnect` (around line 682) to decrypt from vault when enabled:

```go
if s.vaultKey != nil {
    key, err := s.vaultKey()
    if err != nil {
        return Host{}, "", fmt.Errorf("vault locked: %w", err)
    }
    nonce, ciphertext, err := s.GetEncryptedSecret(id, "password")
    if err != nil {
        return Host{}, "", err
    }
    if nonce != nil {
        plaintext, err := vault.Decrypt(key, nonce, ciphertext)
        if err != nil {
            return Host{}, "", err
        }
        secret = string(plaintext)
    }
} else {
    // Existing keychain path
    secret, err = s.credentials.InlineSecret(id, dbPassword.String)
}
```

- [ ] **Step 3: Wire vaultKey in app.go startup**

After lockstate initialization in `startup()`:

```go
if a.deps.Cfg.Vault.Enabled {
    a.deps.Store.SetVaultKeyFunc(a.deps.LockState.GetKey)
}
```

- [ ] **Step 4: Build and test**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./... && go test ./internal/... -race -timeout 60s
```

- [ ] **Step 5: Commit**

```bash
git add internal/store/store.go app.go
git commit -m "feat(store): vault-aware credential storage and retrieval

AddHost, UpdateHost, and GetHostForConnect now route through vault
encryption when enabled, falling back to keychain when not."
```

---

## Task 18: Save Config on Vault State Changes

**Files:**
- Modify: `vault_facade.go`

- [ ] **Step 1: Persist config changes**

After every method that modifies `f.d.Cfg.Vault.*`, persist the config:

```go
import "github.com/dylanbr0wn/shsh/internal/config"

// Add a helper at the bottom of vault_facade.go:
func (f *VaultFacade) saveConfig() error {
    return config.Save(f.d.Cfg, f.d.CfgPath)
}
```

Add `f.saveConfig()` calls at the end of: `SetupVault`, `DisableVault`, `EnableTouchID`, `DisableTouchID`, `SetLockTimeout`.

- [ ] **Step 2: Build**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add vault_facade.go
git commit -m "fix(vault): persist config changes to disk after vault operations"
```

---

## Task 19: Full Integration Test

**Files:**
- No new files — validation pass

- [ ] **Step 1: Run full Go test suite**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go vet ./internal/... && go test ./internal/... -race -timeout 60s
```

Expected: All tests pass, no vet warnings.

- [ ] **Step 2: Run full frontend checks**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket/frontend && pnpm build && pnpm lint && pnpm format:check
```

Expected: All pass.

- [ ] **Step 3: Run go mod tidy**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && go mod tidy && git diff --exit-code go.mod go.sum
```

Expected: No changes (deps already clean).

- [ ] **Step 4: Run wails build**

```bash
cd /Users/dylan/.superset/worktrees/shsh/horse-bracket && wails build
```

Expected: Clean production build.

- [ ] **Step 5: Manual smoke test checklist**

1. Launch app — should start normally (no vault prompt)
2. Open Settings → Security → "Set Up Vault Encryption"
3. Enter master password, confirm, click Enable
4. Verify: existing hosts still connect (credentials migrated)
5. Wait for idle timeout → lock overlay appears
6. Unlock with password → works
7. If Touch ID hardware available: enable Touch ID, lock, verify Touch ID unlock
8. Cmd+L → locks immediately
9. Header lock icon → locks immediately
10. Add new host with password → connects successfully
11. Settings → Disable Vault → enter password → credentials return to keychain
12. Restart app → no vault prompt (disabled)
