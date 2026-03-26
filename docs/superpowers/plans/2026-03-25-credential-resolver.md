# Credential Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the `store` package from `credstore` by injecting a `CredentialResolver` interface, enabling testable credential paths and timeout enforcement on external CLI calls.

**Architecture:** Define a `CredentialResolver` interface in `store` with 4 methods (Resolve, InlineSecret, StoreSecret, DeleteSecret). The concrete implementation lives in `credstore/resolver.go` and uses `exec.CommandContext` for timeout-safe PM calls. Keychain helpers move from `store/keychain.go` to `credstore/keychain.go` (exported). The `store` package has zero imports of `credstore`.

**Tech Stack:** Go, SQLite (modernc.org/sqlite), zalando/go-keyring, os/exec

**Spec:** `docs/superpowers/specs/2026-03-25-credential-resolver-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `internal/store/credentials.go` | `CredentialResolver` interface + `ErrKeychainUnavailable` sentinel |
| Create | `internal/credstore/resolver.go` | Concrete `Resolver` implementing `store.CredentialResolver` |
| Create | `internal/credstore/keychain.go` | Exported keychain helpers (moved from `store/keychain.go`) |
| Modify | `internal/store/store.go` | Add `credentials` field, update `New`, rewrite credential calls, change `CredentialSource` to `string` |
| Modify | `internal/credstore/credstore.go` | Add context-aware fetch functions |
| Modify | `internal/store/store_test.go` | Add `fakeResolver`, update `newTestStore`, add credential-path tests |
| Modify | `app.go` | Pass `credstore.NewResolver()` to `store.New` |
| Delete | `internal/store/keychain.go` | Replaced by `internal/credstore/keychain.go` |

---

### Task 1: Define CredentialResolver interface

**Files:**
- Create: `internal/store/credentials.go`

- [ ] **Step 1: Create the interface file**

```go
// internal/store/credentials.go
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go build ./internal/store/...`
Expected: success (no errors)

- [ ] **Step 3: Commit**

```bash
git add internal/store/credentials.go
git commit -m "refactor(store): define CredentialResolver interface

Introduces the CredentialResolver interface that will replace direct
credstore calls, and moves ErrKeychainUnavailable to this file.

Closes #48"
```

---

### Task 2: Move and export keychain helpers to credstore

**Files:**
- Create: `internal/credstore/keychain.go`
- Delete: `internal/store/keychain.go`

- [ ] **Step 1: Create `internal/credstore/keychain.go`**

```go
// internal/credstore/keychain.go
package credstore

import (
	"errors"
	"strings"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/zalando/go-keyring"
)

const keychainService = "shsh"

// KeychainSet stores a password for the given key in the OS keychain.
func KeychainSet(key, password string) error {
	err := keyring.Set(keychainService, key, password)
	if err != nil {
		if isKeychainUnavailable(err) {
			return store.ErrKeychainUnavailable
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
			return "", store.ErrKeychainUnavailable
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
			return store.ErrKeychainUnavailable
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
```

- [ ] **Step 2: Delete `internal/store/keychain.go`**

```bash
rm internal/store/keychain.go
```

- [ ] **Step 3: Remove `ErrKeychainUnavailable` from `internal/store/keychain.go` references in store.go**

The old `keychain.go` defined `ErrKeychainUnavailable`. It's now in `credentials.go` (Task 1). The `store.go` file references `ErrKeychainUnavailable` directly (same package) — those references still work. No change needed in `store.go` for this step.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go build ./internal/credstore/...`
Expected: success

Note: `go build ./internal/store/...` will fail at this point because `store.go` still calls `keychainSet`/`keychainGet`/`keychainDelete` which no longer exist. This is expected — Task 4 fixes it.

- [ ] **Step 5: Commit**

```bash
git add internal/credstore/keychain.go
git rm internal/store/keychain.go
git commit -m "refactor(store): move keychain helpers to credstore package

Exports KeychainGet/KeychainSet/KeychainDelete from credstore.
The old store/keychain.go is removed. Store will call these through
the CredentialResolver interface after the next step."
```

---

### Task 3: Implement concrete Resolver in credstore

**Files:**
- Create: `internal/credstore/resolver.go`
- Modify: `internal/credstore/credstore.go`

- [ ] **Step 1: Add context-aware fetch functions to `credstore.go`**

Add these two functions to the end of `internal/credstore/credstore.go` (before the closing of the file, after the existing `Fetch` function):

```go
// fetchFrom1PasswordCtx is like FetchFrom1Password but respects context for timeout.
func fetchFrom1PasswordCtx(ctx context.Context, ref string) (string, error) {
	if _, err := exec.LookPath("op"); err != nil {
		return "", fmt.Errorf("1Password CLI (op) not installed")
	}

	var args []string
	if strings.HasPrefix(ref, "op://") {
		args = []string{"read", ref}
	} else {
		args = []string{"item", "get", ref, "--fields", "label=password", "--reveal"}
	}

	out, err := exec.CommandContext(ctx, "op", args...).Output() //nolint:gosec
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("1Password: %w", ctx.Err())
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("1Password: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("1Password fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}

// fetchFromBitwardenCtx is like FetchFromBitwarden but respects context for timeout.
func fetchFromBitwardenCtx(ctx context.Context, ref string) (string, error) {
	if _, err := exec.LookPath("bw"); err != nil {
		return "", fmt.Errorf("Bitwarden CLI (bw) not installed")
	}

	mu.Lock()
	sessionKey := bwSessionKey
	mu.Unlock()

	args := []string{"get", "password", ref}
	if sessionKey != "" {
		args = append(args, "--session", sessionKey)
	}

	out, err := exec.CommandContext(ctx, "bw", args...).Output() //nolint:gosec
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("Bitwarden: %w", ctx.Err())
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("Bitwarden: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("Bitwarden fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}
```

Also add `"context"` to the import block in `credstore.go`.

- [ ] **Step 2: Create `internal/credstore/resolver.go`**

```go
// internal/credstore/resolver.go
package credstore

import (
	"context"
	"fmt"
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
```

- [ ] **Step 3: Verify credstore compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go build ./internal/credstore/...`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add internal/credstore/resolver.go internal/credstore/credstore.go
git commit -m "refactor(store): implement concrete CredentialResolver in credstore

Adds Resolver struct with Resolve, InlineSecret, StoreSecret,
DeleteSecret methods. Resolve uses exec.CommandContext for timeout
enforcement on 1Password/Bitwarden CLI calls."
```

---

### Task 4: Rewire store.go to use CredentialResolver

**Files:**
- Modify: `internal/store/store.go`

This is the largest task. It makes these changes:
1. Change `CredentialSource` field type from `credstore.Source` to `string` in `Host`, `CreateHostInput`, `UpdateHostInput`
2. Add `credentials CredentialResolver` field to `Store`
3. Update `New` to accept `creds CredentialResolver`
4. Replace all `keychainSet`/`keychainGet`/`keychainDelete` calls with `s.credentials.*`
5. Replace all `credstore.SourceInline` / `credstore.Source(...)` with string literals/casts
6. Rewrite `GetHostForConnect` to delegate to the interface
7. Remove the `credstore` import

- [ ] **Step 1: Change CredentialSource type to string**

In `internal/store/store.go`, change these three struct fields:

In `Host` (line 96):
```go
// Before:
CredentialSource  credstore.Source `json:"credentialSource,omitempty"`
// After:
CredentialSource  string           `json:"credentialSource,omitempty"`
```

In `CreateHostInput` (line 122):
```go
// Before:
CredentialSource             credstore.Source `json:"credentialSource,omitempty"`
// After:
CredentialSource             string           `json:"credentialSource,omitempty"`
```

In `UpdateHostInput` (line 147):
```go
// Before:
CredentialSource             credstore.Source `json:"credentialSource,omitempty"`
// After:
CredentialSource             string           `json:"credentialSource,omitempty"`
```

- [ ] **Step 2: Add credentials field to Store and update New**

Change the `Store` struct (line 175):
```go
// Before:
type Store struct {
	db *sql.DB
}
// After:
type Store struct {
	db          *sql.DB
	credentials CredentialResolver
}
```

Change the `New` function signature (line 180):
```go
// Before:
func New(dbPath string) (*Store, error) {
// After:
func New(dbPath string, creds CredentialResolver) (*Store, error) {
```

Change the return at end of `New` (line 262):
```go
// Before:
return &Store{db: db}, nil
// After:
return &Store{db: db, credentials: creds}, nil
```

- [ ] **Step 3: Replace credstore.SourceInline references with string literal**

In `AddHost` (line 488):
```go
// Before:
credSrc = credstore.SourceInline
// After:
credSrc = "inline"
```

In `AddHost` (line 533):
```go
// Before:
if input.AuthMethod == AuthPassword && credSrc == credstore.SourceInline && input.Password != "" {
// After:
if input.AuthMethod == AuthPassword && credSrc == "inline" && input.Password != "" {
```

In `UpdateHost` (line 558):
```go
// Before:
credSrc = credstore.SourceInline
// After:
credSrc = "inline"
```

In `UpdateHost` (line 581):
```go
// Before:
if input.AuthMethod == AuthPassword && credSrc == credstore.SourceInline && input.Password != "" {
// After:
if input.AuthMethod == AuthPassword && credSrc == "inline" && input.Password != "" {
```

In `UpdateHost` (line 592):
```go
// Before:
} else if input.AuthMethod == AuthPassword && credSrc != credstore.SourceInline {
// After:
} else if input.AuthMethod == AuthPassword && credSrc != "inline" {
```

- [ ] **Step 4: Replace credstore.Source(...) casts with plain string**

In `ListHosts` (line 465-466):
```go
// Before:
if credSrc.Valid {
    h.CredentialSource = credstore.Source(credSrc.String)
}
// After:
if credSrc.Valid {
    h.CredentialSource = credSrc.String
}
```

In `UpdateHost` (line 628-629):
```go
// Before:
if credSrcCol.Valid {
    h.CredentialSource = credstore.Source(credSrcCol.String)
}
// After:
if credSrcCol.Valid {
    h.CredentialSource = credSrcCol.String
}
```

In `GetHostForConnect` (line 668-669):
```go
// Before:
if credSrc.Valid {
    h.CredentialSource = credstore.Source(credSrc.String)
}
// After:
if credSrc.Valid {
    h.CredentialSource = credSrc.String
}
```

- [ ] **Step 5: Replace keychainSet/keychainGet/keychainDelete with s.credentials methods**

In `AddHost` (line 534):
```go
// Before:
if err := keychainSet(host.ID, input.Password); err != nil {
// After:
if err := s.credentials.StoreSecret(host.ID, input.Password); err != nil {
```

In `AddHost` (line 548):
```go
// Before:
keychainSet(host.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
// After:
s.credentials.StoreSecret(host.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
```

In `UpdateHost` (line 582):
```go
// Before:
if err := keychainSet(input.ID, input.Password); err != nil {
// After:
if err := s.credentials.StoreSecret(input.ID, input.Password); err != nil {
```

In `UpdateHost` (line 594):
```go
// Before:
keychainDelete(input.ID)                                         //nolint:errcheck
// After:
s.credentials.DeleteSecret(input.ID)                                         //nolint:errcheck
```

In `UpdateHost` (line 597):
```go
// Before:
keychainDelete(input.ID)                                         //nolint:errcheck
// After:
s.credentials.DeleteSecret(input.ID)                                         //nolint:errcheck
```

In `UpdateHost` (line 602):
```go
// Before:
keychainSet(input.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
// After:
s.credentials.StoreSecret(input.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
```

In `UpdateHost` (line 604):
```go
// Before:
keychainDelete(input.ID + ":passphrase") //nolint:errcheck
// After:
s.credentials.DeleteSecret(input.ID + ":passphrase") //nolint:errcheck
```

In `DeleteHost` (line 644-645):
```go
// Before:
keychainDelete(id)                 //nolint:errcheck
keychainDelete(id + ":passphrase") //nolint:errcheck
// After:
s.credentials.DeleteSecret(id)                 //nolint:errcheck
s.credentials.DeleteSecret(id + ":passphrase") //nolint:errcheck
```

In `MigratePasswordsToKeychain` (line 736):
```go
// Before:
if err := keychainSet(p.id, p.password); err != nil {
// After:
if err := s.credentials.StoreSecret(p.id, p.password); err != nil {
```

- [ ] **Step 6: Rewrite GetHostForConnect credential dispatch**

Replace lines 679-709 (the `switch h.AuthMethod` block) with:

```go
	switch h.AuthMethod {
	case AuthPassword:
		if h.CredentialSource == "inline" || h.CredentialSource == "" {
			pw, err := s.credentials.InlineSecret(id, dbPassword.String)
			if err != nil {
				return h, dbPassword.String, nil
			}
			return h, pw, nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		pw, err := s.credentials.Resolve(ctx, h.CredentialSource, h.CredentialRef)
		if err != nil {
			log.Warn().Err(err).Str("hostID", id).Msg("external credential fetch failed")
			return h, "", fmt.Errorf("credential fetch (%s): %w", h.CredentialSource, err)
		}
		return h, pw, nil
	case AuthKey:
		passphrase, _ := s.credentials.InlineSecret(id+":passphrase", "")
		return h, passphrase, nil
	default:
		return h, "", nil
	}
```

Also add `"context"` and `"time"` to the import block if not already present, and remove the `"github.com/dylanbr0wn/shsh/internal/credstore"` import.

- [ ] **Step 7: Remove credstore import**

Remove from the import block:
```go
"github.com/dylanbr0wn/shsh/internal/credstore"
```

Add to the import block (if not already present):
```go
"context"
"time"
```

- [ ] **Step 8: Verify store compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go build ./internal/store/...`
Expected: success

- [ ] **Step 9: Commit**

```bash
git add internal/store/store.go
git commit -m "refactor(store): use CredentialResolver interface for all credential ops

Store no longer imports credstore. All keychain and PM operations go
through the injected CredentialResolver. GetHostForConnect uses a
10-second context timeout for external PM calls."
```

---

### Task 5: Wire up app.go

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Update store.New call in app.go**

In `app.go` line 72-73, change:
```go
// Before:
s, err := store.New(dbPath)
// After:
s, err := store.New(dbPath, credstore.NewResolver())
```

Add `"github.com/dylanbr0wn/shsh/internal/credstore"` to the import block (it may not be imported yet in `app.go`).

- [ ] **Step 2: Verify full project compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go build ./...`
Expected: success (or warnings about unused imports in test files — that's OK for now)

- [ ] **Step 3: Commit**

```bash
git add app.go
git commit -m "refactor(store): inject credstore.Resolver into store.New

Wires up the concrete CredentialResolver at app startup."
```

---

### Task 6: Update store tests with fakeResolver

**Files:**
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Write fakeResolver and update newTestStore**

Add to the top of `store_test.go` (after the `import` block):

```go
// fakeResolver is a test double for CredentialResolver that records calls
// and returns canned values.
type fakeResolver struct {
	// InlineSecretFn, if set, overrides InlineSecret behavior.
	InlineSecretFn func(key, fallback string) (string, error)
	// ResolveFn, if set, overrides Resolve behavior.
	ResolveFn func(ctx context.Context, source, ref string) (string, error)

	storedSecrets  map[string]string
	deletedSecrets []string
}

func newFakeResolver() *fakeResolver {
	return &fakeResolver{storedSecrets: make(map[string]string)}
}

func (f *fakeResolver) Resolve(ctx context.Context, source, ref string) (string, error) {
	if f.ResolveFn != nil {
		return f.ResolveFn(ctx, source, ref)
	}
	return "", fmt.Errorf("unexpected Resolve call: source=%s ref=%s", source, ref)
}

func (f *fakeResolver) InlineSecret(key, fallback string) (string, error) {
	if f.InlineSecretFn != nil {
		return f.InlineSecretFn(key, fallback)
	}
	// Default: return whatever was stored, else fallback.
	if pw, ok := f.storedSecrets[key]; ok {
		return pw, nil
	}
	return fallback, nil
}

func (f *fakeResolver) StoreSecret(key, value string) error {
	f.storedSecrets[key] = value
	return nil
}

func (f *fakeResolver) DeleteSecret(key string) error {
	delete(f.storedSecrets, key)
	f.deletedSecrets = append(f.deletedSecrets, key)
	return nil
}
```

Update `newTestStore`:

```go
func newTestStore(t *testing.T) (*Store, *fakeResolver) {
	t.Helper()
	fr := newFakeResolver()
	s, err := New(":memory:", fr)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Close)
	return s, fr
}
```

Also add `"context"` and `"fmt"` to the test file's import block.

- [ ] **Step 2: Update all existing test call sites**

Every call to `newTestStore(t)` returns two values now. Update all existing tests:

```go
// Before (in each test):
s := newTestStore(t)
// After:
s, _ := newTestStore(t)
```

This applies to: `TestNew_MigrationIdempotent`, `TestListHosts_EmptyReturnsSliceNotNil`, `TestAddHost`, `TestListHosts_OrderedByCreatedAt`, `TestUpdateHost`, `TestDeleteHost`, `TestGetHostForConnect`, `TestGetHostForConnect_EmptyPasswordCoalesces`, `TestAddHost_CredentialSourceStored`, `TestUpdateHost_CredentialSourceRoundTrip`, `TestGetHostForConnect_NotFound`, `TestTouchLastConnected`, `TestTouchLastConnected_UnknownIDSilent`, `TestHostExists`.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/store/... -race -timeout 60s`
Expected: all existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add internal/store/store_test.go
git commit -m "refactor(store): add fakeResolver and update test helper

All existing tests pass through the fakeResolver with no regressions."
```

---

### Task 7: Add credential-path tests

**Files:**
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Write TestGetHostForConnect_InlineKeychain**

```go
func TestGetHostForConnect_InlineKeychain(t *testing.T) {
	s, fr := newTestStore(t)
	fr.InlineSecretFn = func(key, fallback string) (string, error) {
		return "keychain-pw", nil
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "db-pw",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, pw, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if pw != "keychain-pw" {
		t.Errorf("password = %q, want %q", pw, "keychain-pw")
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/store/... -run TestGetHostForConnect_InlineKeychain -v`
Expected: PASS

- [ ] **Step 3: Write TestGetHostForConnect_ExternalPM**

```go
func TestGetHostForConnect_ExternalPM(t *testing.T) {
	s, fr := newTestStore(t)
	fr.ResolveFn = func(ctx context.Context, source, ref string) (string, error) {
		if source != "1password" {
			t.Errorf("source = %q, want 1password", source)
		}
		if ref != "op://Vault/Item/password" {
			t.Errorf("ref = %q, want op://Vault/Item/password", ref)
		}
		return "pm-secret", nil
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "pm", Hostname: "pm.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword,
		CredentialSource: "1password",
		CredentialRef:    "op://Vault/Item/password",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, pw, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if pw != "pm-secret" {
		t.Errorf("password = %q, want %q", pw, "pm-secret")
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/store/... -run TestGetHostForConnect_ExternalPM -v`
Expected: PASS

- [ ] **Step 5: Write TestGetHostForConnect_ExternalPMTimeout**

```go
func TestGetHostForConnect_ExternalPMTimeout(t *testing.T) {
	s, fr := newTestStore(t)
	fr.ResolveFn = func(ctx context.Context, source, ref string) (string, error) {
		return "", context.DeadlineExceeded
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "pm", Hostname: "pm.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword,
		CredentialSource: "bitwarden",
		CredentialRef:    "MyServer",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, _, err = s.GetHostForConnect(added.ID)
	if err == nil {
		t.Fatal("expected error for timed-out PM fetch, got nil")
	}
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/store/... -run TestGetHostForConnect_ExternalPMTimeout -v`
Expected: PASS

- [ ] **Step 7: Write TestAddHost_StoresSecret and TestDeleteHost_DeletesSecrets**

```go
func TestAddHost_StoresSecret(t *testing.T) {
	s, fr := newTestStore(t)

	_, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "s3cret",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	if len(fr.storedSecrets) == 0 {
		t.Fatal("expected StoreSecret to be called")
	}
	// The stored value should be the password we provided.
	for _, v := range fr.storedSecrets {
		if v == "s3cret" {
			return
		}
	}
	t.Errorf("expected stored secret to contain %q, got %v", "s3cret", fr.storedSecrets)
}

func TestDeleteHost_DeletesSecrets(t *testing.T) {
	s, fr := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "pw",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	fr.deletedSecrets = nil // reset

	if err := s.DeleteHost(added.ID); err != nil {
		t.Fatalf("DeleteHost: %v", err)
	}

	if len(fr.deletedSecrets) < 2 {
		t.Fatalf("expected at least 2 DeleteSecret calls, got %d", len(fr.deletedSecrets))
	}
	// Should delete both the password key and the passphrase key.
	found := map[string]bool{}
	for _, k := range fr.deletedSecrets {
		found[k] = true
	}
	if !found[added.ID] {
		t.Errorf("expected DeleteSecret(%q), not found in %v", added.ID, fr.deletedSecrets)
	}
	if !found[added.ID+":passphrase"] {
		t.Errorf("expected DeleteSecret(%q), not found in %v", added.ID+":passphrase", fr.deletedSecrets)
	}
}
```

- [ ] **Step 8: Run all store tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/store/... -race -timeout 60s -v`
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add internal/store/store_test.go
git commit -m "test(store): add credential-path tests for GetHostForConnect

Tests inline keychain, external PM, PM timeout, AddHost secret storage,
and DeleteHost secret cleanup — all via fakeResolver."
```

---

### Task 8: Run full CI checks

**Files:** None (validation only)

- [ ] **Step 1: Go vet**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go vet ./internal/...`
Expected: clean

- [ ] **Step 2: Go tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go test ./internal/... -race -timeout 60s`
Expected: all PASS

- [ ] **Step 3: Go mod tidy**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && go mod tidy && git diff --exit-code go.mod go.sum`
Expected: no diff

- [ ] **Step 4: Frontend build**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain/frontend && pnpm build`
Expected: success (frontend is unaffected)

- [ ] **Step 5: Frontend lint**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain/frontend && pnpm lint`
Expected: clean

- [ ] **Step 6: Verify no credstore import in store package**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/credential-chain && grep -r 'credstore' internal/store/`
Expected: no output (zero matches)
