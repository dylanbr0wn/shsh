# Backend Testing Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprehensive test coverage for `credstore`, `store`, and `session` packages, plus fix `GetHostsByGroup` column mismatch.

**Architecture:** Bottom-up by dependency order: credstore (no internal deps) -> store (uses credstore interfaces) -> session (uses store types). Each task is self-contained and commits independently. credstore gets a testability refactor (injectable command runner) before tests.

**Tech Stack:** Go stdlib `testing`, in-memory SQLite (`:memory:`), real `vault.Encrypt`/`vault.Decrypt`, in-process SSH servers via `golang.org/x/crypto/ssh`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `internal/credstore/credstore.go` | Add `cmdRunner` type, make CLI calls injectable |
| Modify | `internal/credstore/resolver.go` | Add fields to `Resolver`, wire injectable deps |
| Create | `internal/credstore/credstore_test.go` | All credstore tests |
| Modify | `internal/store/store.go` | Fix `GetHostsByGroup` SELECT + scan |
| Modify | `internal/store/store_test.go` | Extend `fakeResolver` with vault methods, add all new store tests |
| Modify | `internal/session/session_test.go` | Add `safeFilename` tests |
| Modify | `internal/session/reconnect_test.go` | Extend `ResolveReconnectConfig` tests, add markDead/reconnect tests |
| Create | `internal/session/helpers_test.go` | Shared test infrastructure (recording emitter, test manager, killable server) |
| Create | `internal/session/connection_test.go` | ConnectOrReuse concurrency tests |
| Create | `internal/session/sftp_test.go` | extractTarGz tests |

---

### Task 1: credstore — refactor Resolver for injectable command execution

**Files:**
- Modify: `internal/credstore/credstore.go`
- Modify: `internal/credstore/resolver.go`

- [ ] **Step 1: Add cmdRunner type and fields to Resolver**

In `internal/credstore/resolver.go`, add fields to the `Resolver` struct:

```go
// cmdRunner executes an external command and returns its combined stdout.
type cmdRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

// pathLooker checks if a binary exists on PATH.
type pathLooker func(name string) (string, error)

// Resolver implements store.CredentialResolver using the OS keychain
// for inline secrets and external CLI tools for password managers.
type Resolver struct {
	runCmd   cmdRunner
	lookPath pathLooker
}

// NewResolver returns a Resolver wired to real exec.CommandContext/exec.LookPath.
func NewResolver() *Resolver {
	return &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return exec.CommandContext(ctx, name, args...).Output()
		},
		lookPath: exec.LookPath,
	}
}
```

Add `"os/exec"` to the import block in `resolver.go`.

- [ ] **Step 2: Update credstore.go to use Resolver methods instead of package-level exec calls**

Replace `check1Password()`, `checkBitwarden()`, `fetchFrom1PasswordCtx()`, and `fetchFromBitwardenCtx()` with methods on `*Resolver`. Update the package-level functions (`Check`, `Fetch`, `FetchFrom1Password`, `FetchFromBitwarden`) to delegate to a package-level default resolver:

```go
// defaultResolver is used by package-level convenience functions.
var defaultResolver = NewResolver()

func Check() PasswordManagersStatus {
	return defaultResolver.Check()
}

func Fetch(source Source, ref string) (string, error) {
	return defaultResolver.Fetch(source, ref)
}

func FetchFrom1Password(ref string) (string, error) {
	return defaultResolver.fetchFrom1PasswordCtx(context.Background(), ref)
}

func FetchFromBitwarden(ref string) (string, error) {
	return defaultResolver.fetchFromBitwardenCtx(context.Background(), ref)
}
```

Convert the four private functions to receiver methods on `*Resolver`:

- `func (r *Resolver) Check() PasswordManagersStatus`
- `func (r *Resolver) check1Password() PMStatus` — replace `exec.LookPath` with `r.lookPath`, `exec.Command(...).Output()` with `r.runCmd(context.Background(), ...)`
- `func (r *Resolver) checkBitwarden() PMStatus` — same pattern
- `func (r *Resolver) fetchFrom1PasswordCtx(ctx context.Context, ref string) (string, error)` — replace `exec.LookPath` with `r.lookPath`, `exec.CommandContext(ctx, ...).Output()` with `r.runCmd(ctx, ...)`
- `func (r *Resolver) fetchFromBitwardenCtx(ctx context.Context, ref string) (string, error)` — same pattern

Also update `Resolver.Resolve` to call `r.fetchFrom1PasswordCtx` and `r.fetchFromBitwardenCtx`.

Also update `Resolver.Fetch` to call `r.fetchFrom1PasswordCtx` / `r.fetchFromBitwardenCtx` (not the package-level wrappers).

- [ ] **Step 3: Verify the build compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go build ./internal/credstore/...`
Expected: no errors

- [ ] **Step 4: Run existing tests to confirm no regressions**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/... -race -timeout 60s -count=1`
Expected: all packages pass

- [ ] **Step 5: Commit**

```bash
git add internal/credstore/credstore.go internal/credstore/resolver.go
git commit -m "refactor(credstore): make CLI execution injectable for testability"
```

---

### Task 2: credstore — pure logic and vault round-trip tests

**Files:**
- Create: `internal/credstore/credstore_test.go`

- [ ] **Step 1: Write tests for isKeychainUnavailable, Fetch dispatch, Resolve dispatch, and vault round-trip**

Create `internal/credstore/credstore_test.go`:

```go
package credstore

import (
	"context"
	"errors"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/dylanbr0wn/shsh/internal/vault"
)

// --- isKeychainUnavailable ---

func TestIsKeychainUnavailable(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"freedesktop", errors.New("org.freedesktop.secrets was not provided"), true},
		{"no such interface", errors.New("no such interface on object"), true},
		{"connection refused", errors.New("connection refused by DBus"), true},
		{"unrelated", errors.New("permission denied"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isKeychainUnavailable(tt.err); got != tt.want {
				t.Errorf("isKeychainUnavailable(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// --- Fetch / Resolve dispatch ---

func TestFetch_UnsupportedSource(t *testing.T) {
	_, err := Fetch("inline", "ref")
	if err == nil {
		t.Fatal("expected error for unsupported source")
	}
}

func TestResolve_UnsupportedSource(t *testing.T) {
	r := NewResolver()
	_, err := r.Resolve(context.Background(), "inline", "ref")
	if err == nil {
		t.Fatal("expected error for unsupported source")
	}
}

// --- InlineSecret fallback ---

func TestInlineSecret_KeychainHasValue(t *testing.T) {
	r := &Resolver{} // fields unused for InlineSecret
	// InlineSecret calls KeychainGet which calls the real keychain.
	// We test the fallback logic by testing the Resolver method with a known-empty key.
	// Since tests don't have keychain entries, it should return the fallback.
	pw, err := r.InlineSecret("nonexistent-key-for-test", "fallback-value")
	if err != nil {
		t.Fatalf("InlineSecret error: %v", err)
	}
	if pw != "fallback-value" {
		t.Errorf("InlineSecret = %q, want %q", pw, "fallback-value")
	}
}

// --- Vault round-trip ---

// memSecretStore is an in-memory implementation of store.SecretStore for testing.
type memSecretStore struct {
	secrets map[string]struct {
		nonce, ciphertext []byte
	}
}

func newMemSecretStore() *memSecretStore {
	return &memSecretStore{
		secrets: make(map[string]struct{ nonce, ciphertext []byte }),
	}
}

func (m *memSecretStore) StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error {
	m.secrets[hostID+":"+kind] = struct{ nonce, ciphertext []byte }{nonce, ciphertext}
	return nil
}

func (m *memSecretStore) GetEncryptedSecret(hostID, kind string) ([]byte, []byte, error) {
	s, ok := m.secrets[hostID+":"+kind]
	if !ok {
		return nil, nil, nil
	}
	return s.nonce, s.ciphertext, nil
}

func (m *memSecretStore) DeleteEncryptedSecret(hostID, kind string) error {
	delete(m.secrets, hostID+":"+kind)
	return nil
}

func TestVaultRoundTrip(t *testing.T) {
	r := NewResolver()
	ss := newMemSecretStore()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	err := r.VaultStoreSecret(ss, key, "host1", "password", "s3cret")
	if err != nil {
		t.Fatalf("VaultStoreSecret: %v", err)
	}

	got, err := r.VaultGetSecret(ss, key, "host1", "password")
	if err != nil {
		t.Fatalf("VaultGetSecret: %v", err)
	}
	if got != "s3cret" {
		t.Errorf("VaultGetSecret = %q, want %q", got, "s3cret")
	}
}

func TestVaultGetSecret_NilNonce(t *testing.T) {
	r := NewResolver()
	ss := newMemSecretStore() // empty store
	key := make([]byte, 32)

	got, err := r.VaultGetSecret(ss, key, "host1", "password")
	if err != nil {
		t.Fatalf("VaultGetSecret: %v", err)
	}
	if got != "" {
		t.Errorf("VaultGetSecret = %q, want empty string", got)
	}
}

func TestVaultDeleteSecret(t *testing.T) {
	r := NewResolver()
	ss := newMemSecretStore()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	_ = r.VaultStoreSecret(ss, key, "host1", "password", "s3cret")
	err := r.VaultDeleteSecret(ss, "host1", "password")
	if err != nil {
		t.Fatalf("VaultDeleteSecret: %v", err)
	}

	got, err := r.VaultGetSecret(ss, key, "host1", "password")
	if err != nil {
		t.Fatalf("VaultGetSecret after delete: %v", err)
	}
	if got != "" {
		t.Errorf("VaultGetSecret after delete = %q, want empty", got)
	}
}

func TestVaultStoreSecret_BadKey(t *testing.T) {
	r := NewResolver()
	ss := newMemSecretStore()
	badKey := []byte("too-short")

	err := r.VaultStoreSecret(ss, badKey, "host1", "password", "s3cret")
	if err == nil {
		t.Fatal("expected error for bad key")
	}
}

// --- Compile-time interface checks (already in resolver.go, but verify in test) ---

var _ store.CredentialResolver = (*Resolver)(nil)
var _ store.VaultCredentialResolver = (*Resolver)(nil)
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/credstore/... -race -v -timeout 60s`
Expected: all tests pass. `TestInlineSecret_KeychainHasValue` should pass because no keychain entry exists and fallback is returned.

- [ ] **Step 3: Commit**

```bash
git add internal/credstore/credstore_test.go
git commit -m "test(credstore): add pure logic and vault round-trip tests"
```

---

### Task 3: credstore — PM CLI argument construction and status check tests

**Files:**
- Modify: `internal/credstore/credstore_test.go`

- [ ] **Step 1: Add PM CLI tests with injectable runner**

Append to `internal/credstore/credstore_test.go`:

```go
// --- PM CLI argument construction ---

func TestFetchFrom1Password_OpURI(t *testing.T) {
	var capturedName string
	var capturedArgs []string
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedName = name
			capturedArgs = args
			return []byte("my-password\n"), nil
		},
	}

	pw, err := r.fetchFrom1PasswordCtx(context.Background(), "op://vault/item/field")
	if err != nil {
		t.Fatalf("fetchFrom1PasswordCtx: %v", err)
	}
	if pw != "my-password" {
		t.Errorf("password = %q, want %q", pw, "my-password")
	}
	if capturedName != "op" {
		t.Errorf("command = %q, want %q", capturedName, "op")
	}
	wantArgs := []string{"read", "op://vault/item/field"}
	if len(capturedArgs) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", capturedArgs, wantArgs)
	}
	for i, a := range wantArgs {
		if capturedArgs[i] != a {
			t.Errorf("args[%d] = %q, want %q", i, capturedArgs[i], a)
		}
	}
}

func TestFetchFrom1Password_ItemName(t *testing.T) {
	var capturedArgs []string
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedArgs = args
			return []byte("pw123\n"), nil
		},
	}

	_, err := r.fetchFrom1PasswordCtx(context.Background(), "my-server")
	if err != nil {
		t.Fatalf("fetchFrom1PasswordCtx: %v", err)
	}
	wantArgs := []string{"item", "get", "my-server", "--fields", "label=password", "--reveal"}
	if len(capturedArgs) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", capturedArgs, wantArgs)
	}
	for i, a := range wantArgs {
		if capturedArgs[i] != a {
			t.Errorf("args[%d] = %q, want %q", i, capturedArgs[i], a)
		}
	}
}

func TestFetchFromBitwarden_Basic(t *testing.T) {
	var capturedArgs []string
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedArgs = args
			return []byte("bw-password\n"), nil
		},
	}

	pw, err := r.fetchFromBitwardenCtx(context.Background(), "my-item")
	if err != nil {
		t.Fatalf("fetchFromBitwardenCtx: %v", err)
	}
	if pw != "bw-password" {
		t.Errorf("password = %q, want %q", pw, "bw-password")
	}
	wantArgs := []string{"get", "password", "my-item"}
	if len(capturedArgs) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", capturedArgs, wantArgs)
	}
	for i, a := range wantArgs {
		if capturedArgs[i] != a {
			t.Errorf("args[%d] = %q, want %q", i, capturedArgs[i], a)
		}
	}
}

func TestFetchFromBitwarden_WithSessionKey(t *testing.T) {
	var capturedArgs []string
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedArgs = args
			return []byte("pw\n"), nil
		},
	}

	// Set the package-level bwSessionKey
	mu.Lock()
	old := bwSessionKey
	bwSessionKey = "test-session-key"
	mu.Unlock()
	defer func() {
		mu.Lock()
		bwSessionKey = old
		mu.Unlock()
	}()

	_, err := r.fetchFromBitwardenCtx(context.Background(), "item")
	if err != nil {
		t.Fatalf("fetchFromBitwardenCtx: %v", err)
	}
	wantArgs := []string{"get", "password", "item", "--session", "test-session-key"}
	if len(capturedArgs) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", capturedArgs, wantArgs)
	}
	for i, a := range wantArgs {
		if capturedArgs[i] != a {
			t.Errorf("args[%d] = %q, want %q", i, capturedArgs[i], a)
		}
	}
}

func TestFetchFrom1Password_CLINotFound(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}
	_, err := r.fetchFrom1PasswordCtx(context.Background(), "ref")
	if err == nil {
		t.Fatal("expected error when CLI not found")
	}
	if !strings.Contains(err.Error(), "not installed") {
		t.Errorf("error = %q, want to contain 'not installed'", err.Error())
	}
}

func TestFetchFromBitwarden_CLINotFound(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}
	_, err := r.fetchFromBitwardenCtx(context.Background(), "ref")
	if err == nil {
		t.Fatal("expected error when CLI not found")
	}
	if !strings.Contains(err.Error(), "not installed") {
		t.Errorf("error = %q, want to contain 'not installed'", err.Error())
	}
}

func TestFetchFrom1Password_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return nil, ctx.Err()
		},
	}
	_, err := r.fetchFrom1PasswordCtx(ctx, "ref")
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

// --- PM status checks ---

func TestCheck1Password_CLIMissing(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}
	status := r.check1Password()
	if status.Available {
		t.Error("expected Available=false when CLI missing")
	}
}

func TestCheck1Password_Unlocked(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`[{"id":"abc"}]`), nil
		},
	}
	status := r.check1Password()
	if !status.Available {
		t.Error("expected Available=true")
	}
	if status.Locked {
		t.Error("expected Locked=false")
	}
}

func TestCheck1Password_EmptyAccounts(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`[]`), nil
		},
	}
	status := r.check1Password()
	if !status.Available {
		t.Error("expected Available=true")
	}
	if !status.Locked {
		t.Error("expected Locked=true for empty accounts")
	}
}

func TestCheckBitwarden_Unlocked(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/bw", nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`{"status":"unlocked"}`), nil
		},
	}
	status := r.checkBitwarden()
	if !status.Available {
		t.Error("expected Available=true")
	}
	if status.Locked {
		t.Error("expected Locked=false")
	}
}

func TestCheckBitwarden_Locked(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "/usr/bin/bw", nil },
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`{"status":"locked"}`), nil
		},
	}
	status := r.checkBitwarden()
	if !status.Available {
		t.Error("expected Available=true")
	}
	if !status.Locked {
		t.Error("expected Locked=true")
	}
}

func TestCheckBitwarden_CLIMissing(t *testing.T) {
	r := &Resolver{
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}
	status := r.checkBitwarden()
	if status.Available {
		t.Error("expected Available=false when CLI missing")
	}
}
```

Add `"strings"` to the import block at the top of the file.

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/credstore/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add internal/credstore/credstore_test.go
git commit -m "test(credstore): add PM CLI argument and status check tests"
```

---

### Task 4: store — extend fakeResolver with vault support and add group/profile CRUD tests

**Files:**
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Extend fakeResolver with VaultCredentialResolver methods and add test helpers**

Add to `internal/store/store_test.go`, after the existing `fakeResolver` definition:

```go
// vaultFakeResolver extends fakeResolver with vault credential methods.
type vaultFakeResolver struct {
	fakeResolver
	encryptedSecrets map[string]struct{ nonce, ciphertext []byte }
}

func newVaultFakeResolver() *vaultFakeResolver {
	return &vaultFakeResolver{
		fakeResolver:     fakeResolver{storedSecrets: make(map[string]string)},
		encryptedSecrets: make(map[string]struct{ nonce, ciphertext []byte }),
	}
}

func (v *vaultFakeResolver) VaultStoreSecret(ss store.SecretStore, key []byte, hostID, kind, plaintext string) error {
	nonce, ciphertext, err := vault.Encrypt(key, []byte(plaintext))
	if err != nil {
		return err
	}
	return ss.StoreEncryptedSecret(hostID, kind, nonce, ciphertext)
}

func (v *vaultFakeResolver) VaultGetSecret(ss store.SecretStore, key []byte, hostID, kind string) (string, error) {
	nonce, ciphertext, err := ss.GetEncryptedSecret(hostID, kind)
	if err != nil {
		return "", err
	}
	if nonce == nil {
		return "", nil
	}
	plaintext, err := vault.Decrypt(key, nonce, ciphertext)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func (v *vaultFakeResolver) VaultDeleteSecret(ss store.SecretStore, hostID, kind string) error {
	return ss.DeleteEncryptedSecret(hostID, kind)
}

// testVaultKey is a fixed 32-byte key for vault tests.
var testVaultKey = []byte("01234567890123456789012345678901")

func newTestStoreWithVault(t *testing.T) (*store.Store, *vaultFakeResolver) {
	t.Helper()
	vfr := newVaultFakeResolver()
	s, err := store.New(":memory:", vfr)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	s.SetVaultKeyFunc(func() ([]byte, error) { return testVaultKey, nil })
	t.Cleanup(s.Close)
	return s, vfr
}
```

Add `"github.com/dylanbr0wn/shsh/internal/vault"` to the import block.

Note: `vaultFakeResolver` embeds `fakeResolver` so it satisfies `CredentialResolver` via promotion. It also directly implements the three `VaultCredentialResolver` methods. However, `Store.New` accepts `CredentialResolver`, not `VaultCredentialResolver`. The vault methods on the resolver are used by `AddHost`/`UpdateHost`/`GetHostForConnect` only when `vaultKey != nil`, and in that case the store calls `vault.Encrypt`/`vault.Decrypt` directly (not through the resolver). So `newTestStoreWithVault` passes `vfr` (which satisfies `CredentialResolver` via embedding) and sets `vaultKey`. The store's own vault code path uses `s.StoreEncryptedSecret` / `s.GetEncryptedSecret` + `vault.Encrypt`/`vault.Decrypt` directly, not the resolver's vault methods.

- [ ] **Step 2: Add group CRUD tests**

Append to `internal/store/store_test.go`:

```go
// --- Group CRUD ---

func TestAddGroup(t *testing.T) {
	s, _ := newTestStore(t)

	g, err := s.AddGroup(store.CreateGroupInput{Name: "Production"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	if g.Name != "Production" {
		t.Errorf("Name = %q, want %q", g.Name, "Production")
	}
	if g.SortOrder != 0 {
		t.Errorf("SortOrder = %d, want 0", g.SortOrder)
	}

	g2, err := s.AddGroup(store.CreateGroupInput{Name: "Staging"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	if g2.SortOrder != 1 {
		t.Errorf("SortOrder = %d, want 1", g2.SortOrder)
	}
}

func TestListGroups(t *testing.T) {
	s, _ := newTestStore(t)
	s.AddGroup(store.CreateGroupInput{Name: "B"})
	s.AddGroup(store.CreateGroupInput{Name: "A"})

	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	if len(groups) != 2 {
		t.Fatalf("len = %d, want 2", len(groups))
	}
	// Ordered by sort_order (insertion order)
	if groups[0].Name != "B" || groups[1].Name != "A" {
		t.Errorf("order = [%s, %s], want [B, A]", groups[0].Name, groups[1].Name)
	}
}

func TestListGroups_EmptyReturnsSlice(t *testing.T) {
	s, _ := newTestStore(t)
	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	if groups == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(groups) != 0 {
		t.Fatalf("len = %d, want 0", len(groups))
	}
}

func TestUpdateGroup(t *testing.T) {
	s, _ := newTestStore(t)
	g, _ := s.AddGroup(store.CreateGroupInput{Name: "Old"})

	profileID := "profile-123"
	updated, err := s.UpdateGroup(store.UpdateGroupInput{
		ID:                g.ID,
		Name:              "New",
		SortOrder:         5,
		TerminalProfileID: &profileID,
	})
	if err != nil {
		t.Fatalf("UpdateGroup: %v", err)
	}
	if updated.Name != "New" {
		t.Errorf("Name = %q, want %q", updated.Name, "New")
	}
	if updated.SortOrder != 5 {
		t.Errorf("SortOrder = %d, want 5", updated.SortOrder)
	}
	if updated.TerminalProfileID == nil || *updated.TerminalProfileID != profileID {
		t.Errorf("TerminalProfileID = %v, want %q", updated.TerminalProfileID, profileID)
	}
}

func TestDeleteGroup(t *testing.T) {
	s, _ := newTestStore(t)
	g, _ := s.AddGroup(store.CreateGroupInput{Name: "ToDelete"})
	if err := s.DeleteGroup(g.ID); err != nil {
		t.Fatalf("DeleteGroup: %v", err)
	}
	groups, _ := s.ListGroups()
	if len(groups) != 0 {
		t.Errorf("len = %d, want 0 after delete", len(groups))
	}
}

func TestAddGroup_SortOrderAfterDeletion(t *testing.T) {
	s, _ := newTestStore(t)
	g1, _ := s.AddGroup(store.CreateGroupInput{Name: "A"}) // sort_order=0
	s.AddGroup(store.CreateGroupInput{Name: "B"})           // sort_order=1
	s.DeleteGroup(g1.ID)

	g3, err := s.AddGroup(store.CreateGroupInput{Name: "C"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	// MAX(sort_order) is still 1 (from B), so C should be 2
	if g3.SortOrder != 2 {
		t.Errorf("SortOrder = %d, want 2", g3.SortOrder)
	}
}
```

- [ ] **Step 3: Add terminal profile CRUD tests**

Append to `internal/store/store_test.go`:

```go
// --- Terminal Profile CRUD ---

func TestAddProfile(t *testing.T) {
	s, _ := newTestStore(t)
	p, err := s.AddProfile(store.CreateProfileInput{
		Name:        "Default",
		FontSize:    14,
		CursorStyle: "block",
		CursorBlink: true,
		Scrollback:  5000,
		ColorTheme:  "dracula",
	})
	if err != nil {
		t.Fatalf("AddProfile: %v", err)
	}
	if p.Name != "Default" {
		t.Errorf("Name = %q, want %q", p.Name, "Default")
	}
	if !p.CursorBlink {
		t.Error("CursorBlink = false, want true")
	}
}

func TestListProfiles(t *testing.T) {
	s, _ := newTestStore(t)
	s.AddProfile(store.CreateProfileInput{Name: "A", FontSize: 12, CursorStyle: "block", Scrollback: 1000, ColorTheme: "auto"})
	s.AddProfile(store.CreateProfileInput{Name: "B", FontSize: 16, CursorStyle: "underline", Scrollback: 2000, ColorTheme: "auto"})

	profiles, err := s.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles: %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("len = %d, want 2", len(profiles))
	}
}

func TestUpdateProfile(t *testing.T) {
	s, _ := newTestStore(t)
	p, _ := s.AddProfile(store.CreateProfileInput{
		Name: "Old", FontSize: 12, CursorStyle: "block", CursorBlink: true, Scrollback: 1000, ColorTheme: "auto",
	})

	updated, err := s.UpdateProfile(store.UpdateProfileInput{
		ID: p.ID, Name: "New", FontSize: 18, CursorStyle: "underline", CursorBlink: false, Scrollback: 3000, ColorTheme: "monokai",
	})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if updated.Name != "New" {
		t.Errorf("Name = %q, want %q", updated.Name, "New")
	}
	if updated.FontSize != 18 {
		t.Errorf("FontSize = %d, want 18", updated.FontSize)
	}
	if updated.CursorBlink {
		t.Error("CursorBlink = true, want false")
	}
}

func TestDeleteProfile(t *testing.T) {
	s, _ := newTestStore(t)
	p, _ := s.AddProfile(store.CreateProfileInput{Name: "X", FontSize: 12, CursorStyle: "block", Scrollback: 1000, ColorTheme: "auto"})
	if err := s.DeleteProfile(p.ID); err != nil {
		t.Fatalf("DeleteProfile: %v", err)
	}
	profiles, _ := s.ListProfiles()
	if len(profiles) != 0 {
		t.Errorf("len = %d, want 0", len(profiles))
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/store/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add internal/store/store_test.go
git commit -m "test(store): add group and terminal profile CRUD tests"
```

---

### Task 5: store — vault integration, encrypted secret table, and vault meta tests

**Files:**
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Add vault integration tests for AddHost and GetHostForConnect**

Append to `internal/store/store_test.go`:

```go
// --- Vault integration ---

func TestAddHost_VaultEnabled(t *testing.T) {
	s, vfr := newTestStoreWithVault(t)

	_, err := s.AddHost(store.CreateHostInput{
		Label:    "vault-host",
		Hostname: "10.0.0.1",
		Port:     22,
		Username: "admin",
		AuthMethod: store.AuthPassword,
		Password: "vault-secret",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	// Password should NOT be in the keychain fake
	if len(vfr.storedSecrets) != 0 {
		t.Errorf("expected no keychain secrets, got %d", len(vfr.storedSecrets))
	}

	// Should be retrievable via vault path
	hosts, _ := s.ListHosts()
	if len(hosts) != 1 {
		t.Fatalf("expected 1 host, got %d", len(hosts))
	}
	nonce, ciphertext, err := s.GetEncryptedSecret(hosts[0].ID, "password")
	if err != nil {
		t.Fatalf("GetEncryptedSecret: %v", err)
	}
	if nonce == nil {
		t.Fatal("expected encrypted secret, got nil nonce")
	}

	// Verify decryption
	plaintext, err := vault.Decrypt(testVaultKey, nonce, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if string(plaintext) != "vault-secret" {
		t.Errorf("decrypted = %q, want %q", string(plaintext), "vault-secret")
	}
}

func TestAddHost_VaultKeyError_Rollback(t *testing.T) {
	fr := newFakeResolver()
	s, err := store.New(":memory:", fr)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Close)
	s.SetVaultKeyFunc(func() ([]byte, error) { return nil, fmt.Errorf("vault locked") })

	_, err = s.AddHost(store.CreateHostInput{
		Label: "fail-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthPassword, Password: "pw",
	})
	if err == nil {
		t.Fatal("expected error when vault key fails")
	}

	hosts, _ := s.ListHosts()
	if len(hosts) != 0 {
		t.Errorf("expected host to be rolled back, got %d hosts", len(hosts))
	}
}

func TestGetHostForConnect_VaultPath(t *testing.T) {
	s, _ := newTestStoreWithVault(t)

	host, _ := s.AddHost(store.CreateHostInput{
		Label: "v-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthPassword, Password: "vault-pw",
	})

	h, secret, err := s.GetHostForConnect(host.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if h.Hostname != "10.0.0.1" {
		t.Errorf("Hostname = %q, want %q", h.Hostname, "10.0.0.1")
	}
	if secret != "vault-pw" {
		t.Errorf("secret = %q, want %q", secret, "vault-pw")
	}
}

func TestGetHostForConnect_VaultLocked(t *testing.T) {
	s, _ := newTestStoreWithVault(t)

	host, _ := s.AddHost(store.CreateHostInput{
		Label: "v-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthPassword, Password: "pw",
	})

	// Lock the vault
	s.SetVaultKeyFunc(func() ([]byte, error) { return nil, fmt.Errorf("vault locked") })

	_, _, err := s.GetHostForConnect(host.ID)
	if err == nil {
		t.Fatal("expected error when vault is locked")
	}
}

func TestGetHostForConnect_VaultNoSecret_FallsToKeychain(t *testing.T) {
	s, vfr := newTestStoreWithVault(t)

	// Add host without password (agent auth), then switch to password with vault having no secret
	host, _ := s.AddHost(store.CreateHostInput{
		Label: "v-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthAgent,
	})

	// Manually update to password auth without going through AddHost's vault path
	s.UpdateHost(store.UpdateHostInput{
		ID: host.ID, Label: "v-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthPassword,
	})

	// Set up the keychain fake to return a value
	vfr.InlineSecretFn = func(key, fallback string) (string, error) {
		return "keychain-pw", nil
	}

	h, secret, err := s.GetHostForConnect(host.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if h.Hostname != "10.0.0.1" {
		t.Errorf("Hostname = %q", h.Hostname)
	}
	if secret != "keychain-pw" {
		t.Errorf("secret = %q, want %q (should fall through to keychain)", secret, "keychain-pw")
	}
}
```

- [ ] **Step 2: Add encrypted secret table and vault meta tests**

Append to `internal/store/store_test.go`:

```go
// --- Encrypted secret table ---

func TestStoreEncryptedSecret_RoundTrip(t *testing.T) {
	s, _ := newTestStore(t)
	nonce := []byte("test-nonce-12345")
	ct := []byte("ciphertext-data")
	if err := s.StoreEncryptedSecret("h1", "password", nonce, ct); err != nil {
		t.Fatalf("StoreEncryptedSecret: %v", err)
	}
	gotN, gotCT, err := s.GetEncryptedSecret("h1", "password")
	if err != nil {
		t.Fatalf("GetEncryptedSecret: %v", err)
	}
	if string(gotN) != string(nonce) {
		t.Errorf("nonce = %q, want %q", gotN, nonce)
	}
	if string(gotCT) != string(ct) {
		t.Errorf("ciphertext = %q, want %q", gotCT, ct)
	}
}

func TestGetEncryptedSecret_NotFound(t *testing.T) {
	s, _ := newTestStore(t)
	n, ct, err := s.GetEncryptedSecret("missing", "password")
	if err != nil {
		t.Fatalf("GetEncryptedSecret: %v", err)
	}
	if n != nil || ct != nil {
		t.Errorf("expected (nil, nil), got (%v, %v)", n, ct)
	}
}

func TestDeleteEncryptedSecret(t *testing.T) {
	s, _ := newTestStore(t)
	s.StoreEncryptedSecret("h1", "password", []byte("n"), []byte("c"))
	if err := s.DeleteEncryptedSecret("h1", "password"); err != nil {
		t.Fatalf("DeleteEncryptedSecret: %v", err)
	}
	n, ct, _ := s.GetEncryptedSecret("h1", "password")
	if n != nil || ct != nil {
		t.Error("expected nil after delete")
	}
}

func TestListEncryptedSecrets(t *testing.T) {
	s, _ := newTestStore(t)
	s.StoreEncryptedSecret("h1", "password", []byte("n1"), []byte("c1"))
	s.StoreEncryptedSecret("h1", "passphrase", []byte("n2"), []byte("c2"))
	s.StoreEncryptedSecret("h2", "password", []byte("n3"), []byte("c3"))

	secrets, err := s.ListEncryptedSecrets()
	if err != nil {
		t.Fatalf("ListEncryptedSecrets: %v", err)
	}
	if len(secrets) != 3 {
		t.Errorf("len = %d, want 3", len(secrets))
	}
}

// --- Vault meta ---

func TestSaveVaultMeta_RoundTrip(t *testing.T) {
	s, _ := newTestStore(t)
	meta := &vault.VaultMeta{
		Salt:         []byte("salt-data"),
		Nonce:        []byte("nonce-data"),
		VerifyBlob:   []byte("verify-data"),
		ArgonTime:    3,
		ArgonMemory:  65536,
		ArgonThreads: 4,
	}
	if err := s.SaveVaultMeta(meta); err != nil {
		t.Fatalf("SaveVaultMeta: %v", err)
	}
	got, err := s.GetVaultMeta()
	if err != nil {
		t.Fatalf("GetVaultMeta: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil vault meta")
	}
	if string(got.Salt) != string(meta.Salt) {
		t.Errorf("Salt = %q, want %q", got.Salt, meta.Salt)
	}
	if got.ArgonTime != 3 {
		t.Errorf("ArgonTime = %d, want 3", got.ArgonTime)
	}
}

func TestGetVaultMeta_Empty(t *testing.T) {
	s, _ := newTestStore(t)
	got, err := s.GetVaultMeta()
	if err != nil {
		t.Fatalf("GetVaultMeta: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestDeleteVaultMeta_ClearsSecretsAndMeta(t *testing.T) {
	s, _ := newTestStore(t)
	s.SaveVaultMeta(&vault.VaultMeta{
		Salt: []byte("s"), Nonce: []byte("n"), VerifyBlob: []byte("v"),
		ArgonTime: 1, ArgonMemory: 1, ArgonThreads: 1,
	})
	// Add a host first so the FK on secrets is satisfied
	host, _ := s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u", AuthMethod: store.AuthAgent,
	})
	s.StoreEncryptedSecret(host.ID, "password", []byte("n"), []byte("c"))

	if err := s.DeleteVaultMeta(); err != nil {
		t.Fatalf("DeleteVaultMeta: %v", err)
	}
	meta, _ := s.GetVaultMeta()
	if meta != nil {
		t.Error("expected nil vault meta after delete")
	}
	secrets, _ := s.ListEncryptedSecrets()
	if len(secrets) != 0 {
		t.Errorf("expected 0 secrets, got %d", len(secrets))
	}
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/store/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add internal/store/store_test.go
git commit -m "test(store): add vault integration, encrypted secret, and vault meta tests"
```

---

### Task 6: store — UpdateHost cleanup, MigratePasswordsToKeychain, and remaining tests

**Files:**
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Add UpdateHost credential cleanup tests**

Append to `internal/store/store_test.go`:

```go
// --- UpdateHost credential cleanup ---

func TestUpdateHost_InlineToExternalPM_ClearsKeychainAndVault(t *testing.T) {
	s, vfr := newTestStoreWithVault(t)

	host, _ := s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "inline-pw",
	})

	// Verify secret is in vault
	n, _, _ := s.GetEncryptedSecret(host.ID, "password")
	if n == nil {
		t.Fatal("expected encrypted secret after AddHost")
	}

	// Switch to external PM
	_, err := s.UpdateHost(store.UpdateHostInput{
		ID: host.ID, Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, CredentialSource: "1password", CredentialRef: "op://vault/item",
	})
	if err != nil {
		t.Fatalf("UpdateHost: %v", err)
	}

	// Keychain should have delete called
	found := false
	for _, k := range vfr.deletedSecrets {
		if k == host.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected DeleteSecret called for host ID")
	}

	// Vault secret should be deleted
	n2, _, _ := s.GetEncryptedSecret(host.ID, "password")
	if n2 != nil {
		t.Error("expected vault secret deleted after switching to external PM")
	}
}

func TestUpdateHost_PasswordToAgent_ClearsPasswordEntries(t *testing.T) {
	s, vfr := newTestStoreWithVault(t)

	host, _ := s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "pw",
	})

	_, err := s.UpdateHost(store.UpdateHostInput{
		ID: host.ID, Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthAgent,
	})
	if err != nil {
		t.Fatalf("UpdateHost: %v", err)
	}

	found := false
	for _, k := range vfr.deletedSecrets {
		if k == host.ID {
			found = true
		}
	}
	if !found {
		t.Error("expected keychain delete for password when switching to agent")
	}

	n, _, _ := s.GetEncryptedSecret(host.ID, "password")
	if n != nil {
		t.Error("expected vault password secret deleted")
	}
}

func TestUpdateHost_KeyToPassword_ClearsPassphraseEntries(t *testing.T) {
	s, vfr := newTestStoreWithVault(t)

	keyPath := "/home/user/.ssh/id_rsa"
	host, _ := s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthKey, KeyPath: &keyPath, KeyPassphrase: "passphrase-pw",
	})

	_, err := s.UpdateHost(store.UpdateHostInput{
		ID: host.ID, Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "new-pw",
	})
	if err != nil {
		t.Fatalf("UpdateHost: %v", err)
	}

	// Passphrase keychain entry should be deleted
	found := false
	for _, k := range vfr.deletedSecrets {
		if k == host.ID+":passphrase" {
			found = true
		}
	}
	if !found {
		t.Error("expected keychain delete for passphrase when switching from key to password")
	}

	// Vault passphrase should be deleted
	n, _, _ := s.GetEncryptedSecret(host.ID, "passphrase")
	if n != nil {
		t.Error("expected vault passphrase secret deleted")
	}
}
```

- [ ] **Step 2: Add MigratePasswordsToKeychain tests**

Append to `internal/store/store_test.go`:

```go
// --- MigratePasswordsToKeychain ---

func TestMigratePasswordsToKeychain(t *testing.T) {
	s, fr := newTestStore(t)

	// Insert a host with plaintext password directly via SQL to simulate pre-migration state
	s.AddHost(store.CreateHostInput{
		Label: "old-host", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "plain-pw",
	})
	// The AddHost above stores in keychain. Simulate pre-migration by writing password to DB column.
	hosts, _ := s.ListHosts()
	hostID := hosts[0].ID
	// Clear the keychain entry and set the password column + unset migration flag
	fr.storedSecrets = make(map[string]string) // clear
	// We need direct DB access; use a fresh store to manually insert
	// Instead, test by creating a new store with a resolver that fails StoreSecret initially
	s2, fr2 := newTestStore(t)
	// Insert host that will have password in DB column (simulating old data)
	// We use AddHost which will try to store in keychain; we make it unavailable
	fr2.StoreSecretFn = func(key, value string) error { return store.ErrKeychainUnavailable }
	s2.AddHost(store.CreateHostInput{
		Label: "old-host", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "plain-pw",
	})
	// Now reset StoreSecret to succeed for the migration
	fr2.StoreSecretFn = nil

	if err := s2.MigratePasswordsToKeychain(); err != nil {
		t.Fatalf("MigratePasswordsToKeychain: %v", err)
	}

	// Password should now be in keychain
	hosts2, _ := s2.ListHosts()
	_, secret, err := s2.GetHostForConnect(hosts2[0].ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if secret != "plain-pw" {
		t.Errorf("secret = %q, want %q", secret, "plain-pw")
	}
}

func TestMigratePasswordsToKeychain_KeychainUnavailable(t *testing.T) {
	s, fr := newTestStore(t)
	fr.StoreSecretFn = func(key, value string) error { return store.ErrKeychainUnavailable }

	s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "pw",
	})

	// Migration should not error (it logs and continues)
	if err := s.MigratePasswordsToKeychain(); err != nil {
		t.Fatalf("MigratePasswordsToKeychain: %v", err)
	}
}
```

Note: the `fakeResolver` needs a `StoreSecretFn` field. Add this to the `fakeResolver` struct:

```go
// StoreSecretFn, if set, overrides StoreSecret behavior.
StoreSecretFn func(key, value string) error
```

And update `StoreSecret`:

```go
func (f *fakeResolver) StoreSecret(key, value string) error {
	if f.StoreSecretFn != nil {
		return f.StoreSecretFn(key, value)
	}
	f.storedSecrets[key] = value
	return nil
}
```

- [ ] **Step 3: Add FindHostID and ListInlinePasswordHostIDs tests**

Append to `internal/store/store_test.go`:

```go
// --- FindHostID ---

func TestFindHostID(t *testing.T) {
	s, _ := newTestStore(t)
	host, _ := s.AddHost(store.CreateHostInput{
		Label: "h", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthAgent,
	})

	id, err := s.FindHostID("10.0.0.1", 22, "admin")
	if err != nil {
		t.Fatalf("FindHostID: %v", err)
	}
	if id != host.ID {
		t.Errorf("id = %q, want %q", id, host.ID)
	}

	id2, err := s.FindHostID("10.0.0.2", 22, "admin")
	if err != nil {
		t.Fatalf("FindHostID not found: %v", err)
	}
	if id2 != "" {
		t.Errorf("expected empty string for not-found, got %q", id2)
	}
}

// --- ListInlinePasswordHostIDs ---

func TestListInlinePasswordHostIDs(t *testing.T) {
	s, _ := newTestStore(t)

	// Password host with inline source (default)
	s.AddHost(store.CreateHostInput{
		Label: "pw-inline", Hostname: "10.0.0.1", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, Password: "pw",
	})
	// Key host with inline source
	keyPath := "/home/u/.ssh/id_rsa"
	s.AddHost(store.CreateHostInput{
		Label: "key-inline", Hostname: "10.0.0.2", Port: 22, Username: "u",
		AuthMethod: store.AuthKey, KeyPath: &keyPath,
	})
	// Agent host (should NOT appear)
	s.AddHost(store.CreateHostInput{
		Label: "agent", Hostname: "10.0.0.3", Port: 22, Username: "u",
		AuthMethod: store.AuthAgent,
	})
	// Password host with external PM (should NOT appear)
	s.AddHost(store.CreateHostInput{
		Label: "pw-ext", Hostname: "10.0.0.4", Port: 22, Username: "u",
		AuthMethod: store.AuthPassword, CredentialSource: "1password", CredentialRef: "op://x",
	})

	ids, err := s.ListInlinePasswordHostIDs()
	if err != nil {
		t.Fatalf("ListInlinePasswordHostIDs: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("len = %d, want 2 (password+key inline hosts)", len(ids))
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/store/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add internal/store/store_test.go
git commit -m "test(store): add credential cleanup, migration, and remaining gap tests"
```

---

### Task 7: store — fix GetHostsByGroup column mismatch and add tests

**Files:**
- Modify: `internal/store/store.go:1049-1083`
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Fix GetHostsByGroup SELECT and scan to match ListHosts**

Replace the `GetHostsByGroup` method in `internal/store/store.go` (lines 1049-1083):

```go
// GetHostsByGroup returns all hosts belonging to the given group.
func (s *Store) GetHostsByGroup(groupID string) ([]Host, error) {
	rows, err := s.db.Query(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id, key_path, credential_source, credential_ref, jump_host_id, reconnect_enabled, reconnect_max_retries, reconnect_initial_delay_seconds, reconnect_max_delay_seconds, keep_alive_interval_seconds, keep_alive_max_missed FROM hosts WHERE group_id = ? ORDER BY created_at ASC`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, gid, color, tags, profileID, keyPath, credSrc, credRef, jumpHostID sql.NullString
		var reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed sql.NullInt64
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags, &profileID, &keyPath, &credSrc, &credRef, &jumpHostID, &reconnectEnabled, &reconnectMaxRetries, &reconnectInitialDelay, &reconnectMaxDelay, &keepAliveInterval, &keepAliveMaxMissed); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		if gid.Valid {
			h.GroupID = &gid.String
		}
		if profileID.Valid {
			h.TerminalProfileID = &profileID.String
		}
		if keyPath.Valid {
			h.KeyPath = &keyPath.String
		}
		if credSrc.Valid {
			h.CredentialSource = credSrc.String
		}
		if credRef.Valid {
			h.CredentialRef = credRef.String
		}
		if jumpHostID.Valid {
			h.JumpHostID = &jumpHostID.String
		}
		scanColorTags(&h, color, tags)
		scanReconnectFields(&h, reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}
```

- [ ] **Step 2: Add GetHostsByGroup tests**

Append to `internal/store/store_test.go`:

```go
// --- GetHostsByGroup ---

func TestGetHostsByGroup(t *testing.T) {
	s, _ := newTestStore(t)
	g, _ := s.AddGroup(store.CreateGroupInput{Name: "prod"})

	keyPath := "/home/u/.ssh/id_rsa"
	retries := 10
	s.AddHost(store.CreateHostInput{
		Label: "full-host", Hostname: "10.0.0.1", Port: 22, Username: "admin",
		AuthMethod: store.AuthKey, KeyPath: &keyPath,
		GroupID: &g.ID, Color: "red", Tags: []string{"web"},
		CredentialSource: "inline", ReconnectMaxRetries: &retries,
	})

	hosts, err := s.GetHostsByGroup(g.ID)
	if err != nil {
		t.Fatalf("GetHostsByGroup: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("len = %d, want 1", len(hosts))
	}
	h := hosts[0]
	if h.Hostname != "10.0.0.1" {
		t.Errorf("Hostname = %q", h.Hostname)
	}
	if h.KeyPath == nil || *h.KeyPath != keyPath {
		t.Errorf("KeyPath = %v, want %q", h.KeyPath, keyPath)
	}
	if h.CredentialSource != "inline" {
		t.Errorf("CredentialSource = %q, want %q", h.CredentialSource, "inline")
	}
	if h.ReconnectMaxRetries == nil || *h.ReconnectMaxRetries != 10 {
		t.Errorf("ReconnectMaxRetries = %v, want 10", h.ReconnectMaxRetries)
	}
	if h.Color != "red" {
		t.Errorf("Color = %q, want %q", h.Color, "red")
	}
}

func TestGetHostsByGroup_Empty(t *testing.T) {
	s, _ := newTestStore(t)
	g, _ := s.AddGroup(store.CreateGroupInput{Name: "empty"})

	hosts, err := s.GetHostsByGroup(g.ID)
	if err != nil {
		t.Fatalf("GetHostsByGroup: %v", err)
	}
	if hosts == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(hosts) != 0 {
		t.Errorf("len = %d, want 0", len(hosts))
	}
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/store/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add internal/store/store.go internal/store/store_test.go
git commit -m "fix(store): align GetHostsByGroup columns with ListHosts and add tests

The SELECT in GetHostsByGroup was missing key_path, credential_source,
credential_ref, jump_host_id, and all reconnect override columns.

Closes #<issue>"
```

(Replace `<issue>` with the appropriate issue number, or remove the footer if there is no associated issue.)

---

### Task 8: session — shared test infrastructure

**Files:**
- Create: `internal/session/helpers_test.go`
- Modify: `internal/session/localfs_test.go` (remove duplicate `stubEmitter` and `newTestManager`)

- [ ] **Step 1: Create helpers_test.go with shared test infrastructure**

Create `internal/session/helpers_test.go`:

```go
package session

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"sync"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"golang.org/x/crypto/ssh"
)

// recordingEmitter implements EventEmitter and records all emitted events.
type recordingEmitter struct {
	mu     sync.Mutex
	events []emittedEvent
}

type emittedEvent struct {
	Topic string
	Data  any
}

func (e *recordingEmitter) Emit(topic string, data any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, emittedEvent{Topic: topic, Data: data})
}

func (e *recordingEmitter) Events() []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	cp := make([]emittedEvent, len(e.events))
	copy(cp, e.events)
	return cp
}

func (e *recordingEmitter) EventsByTopic(topic string) []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []emittedEvent
	for _, ev := range e.events {
		if ev.Topic == topic {
			out = append(out, ev)
		}
	}
	return out
}

// noopDebugEmitter implements DebugEmitter as a no-op.
type noopDebugEmitter struct{}

func (n *noopDebugEmitter) EmitDebug(category, level, channelID, channelLabel, message string, fields map[string]any) {
}

// testManagerResult holds the manager and associated test resources.
type testManagerResult struct {
	Manager  *Manager
	Emitter  *recordingEmitter
	Cancel   context.CancelFunc
	Ctx      context.Context
}

// newRecordingTestManager creates a Manager with a recording emitter and fast reconnect config.
func newRecordingTestManager(t *testing.T) testManagerResult {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	emitter := &recordingEmitter{}
	cfg := config.Default()
	cfg.SSH.ConnectionTimeoutSeconds = 5
	cfg.SSH.ReconnectEnabled = true
	cfg.SSH.ReconnectMaxRetries = 3
	cfg.SSH.ReconnectInitialDelaySeconds = 0 // no delay in tests
	cfg.SSH.ReconnectMaxDelaySeconds = 1
	cfg.SSH.KeepAliveIntervalSeconds = 0 // disabled by default in tests
	m := NewManager(ctx, cfg, emitter, &noopDebugEmitter{})
	t.Cleanup(func() {
		cancel()
		m.Shutdown()
	})
	return testManagerResult{Manager: m, Emitter: emitter, Cancel: cancel, Ctx: ctx}
}

// killableServer is a test SSH server that can drop all connections on demand.
type killableServer struct {
	Addr    string
	Signer  ssh.Signer
	mu      sync.Mutex
	ln      net.Listener
	conns   []net.Conn
	stopped bool
}

// newKillableSSHServer starts an SSH server that supports session channels with PTY/shell.
func newKillableSSHServer(t *testing.T, password string) *killableServer {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("wrong password")
		},
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ks := &killableServer{Addr: ln.Addr().String(), Signer: signer, ln: ln}
	t.Cleanup(func() { ks.Kill() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			ks.mu.Lock()
			if ks.stopped {
				ks.mu.Unlock()
				conn.Close()
				return
			}
			ks.conns = append(ks.conns, conn)
			ks.mu.Unlock()
			go ks.handleConn(conn, cfg)
		}
	}()

	return ks
}

func (ks *killableServer) handleConn(conn net.Conn, cfg *ssh.ServerConfig) {
	sConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		conn.Close()
		return
	}
	defer sConn.Close()
	go ssh.DiscardRequests(reqs)

	for newCh := range chans {
		if newCh.ChannelType() != "session" {
			newCh.Reject(ssh.Prohibited, "only session channels")
			continue
		}
		ch, requests, err := newCh.Accept()
		if err != nil {
			continue
		}
		go func() {
			for req := range requests {
				switch req.Type {
				case "pty-req", "shell":
					req.Reply(true, nil)
				case "keepalive@openssh.com":
					req.Reply(true, nil)
				default:
					req.Reply(false, nil)
				}
			}
		}()
		// Write some initial output then keep channel open
		ch.Write([]byte("welcome\r\n"))
		// Keep channel open until connection closes
		go func() {
			buf := make([]byte, 1024)
			for {
				_, err := ch.Read(buf)
				if err != nil {
					return
				}
			}
		}()
	}
}

// Kill drops all connections and stops accepting new ones.
func (ks *killableServer) Kill() {
	ks.mu.Lock()
	defer ks.mu.Unlock()
	ks.stopped = true
	ks.ln.Close()
	for _, c := range ks.conns {
		c.Close()
	}
	ks.conns = nil
}

// Restart starts accepting connections again on a new listener at the same port.
// Returns error if the port is no longer available.
func (ks *killableServer) Restart(t *testing.T) {
	t.Helper()
	ks.mu.Lock()
	defer ks.mu.Unlock()

	ln, err := net.Listen("tcp", ks.Addr)
	if err != nil {
		t.Fatalf("restart listener: %v", err)
	}
	ks.ln = ln
	ks.stopped = false

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			// Accept any password on restart (reconnect uses cached creds)
			return nil, nil
		},
	}
	cfg.AddHostKey(ks.Signer)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			ks.mu.Lock()
			if ks.stopped {
				ks.mu.Unlock()
				conn.Close()
				return
			}
			ks.conns = append(ks.conns, conn)
			ks.mu.Unlock()
			go ks.handleConn(conn, cfg)
		}
	}()
}
```

- [ ] **Step 2: Update localfs_test.go to use the shared infrastructure**

In `internal/session/localfs_test.go`, remove the `stubEmitter` struct and `newTestManager` function (lines 12-18). Replace with:

```go
// newLocalTestManager creates a basic manager for local FS tests (no recording needed).
func newLocalTestManager() *Manager {
	return NewManager(context.Background(), &config.Config{}, &stubEmitter{}, nil)
}
```

Wait — `localfs_test.go` already uses `stubEmitter` and `newTestManager`. The shared `helpers_test.go` has `recordingEmitter` which is different. To avoid breaking existing tests, keep `stubEmitter` in `helpers_test.go` as well:

Add to `helpers_test.go`:

```go
// stubEmitter is a no-op EventEmitter for tests that don't need event recording.
type stubEmitter struct{}

func (s *stubEmitter) Emit(topic string, data any) {}
```

Then in `localfs_test.go`, remove only the `stubEmitter` type and `newTestManager` func definitions (they'll come from `helpers_test.go` since both are in `package session`). Keep `newTestManager` in `helpers_test.go`:

```go
func newTestManager() *Manager {
	return NewManager(context.Background(), &config.Config{}, &stubEmitter{}, nil)
}
```

- [ ] **Step 3: Verify build and existing tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s`
Expected: all existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add internal/session/helpers_test.go internal/session/localfs_test.go
git commit -m "test(session): add shared test infrastructure for session tests"
```

---

### Task 9: session — safeFilename and ResolveReconnectConfig tests

**Files:**
- Modify: `internal/session/session_test.go`
- Modify: `internal/session/reconnect_test.go`

- [ ] **Step 1: Add safeFilename tests**

Add to `internal/session/session_test.go` (this is `package session_test`, so we need to test via the exported path or move to white-box). Since `safeFilename` is unexported and in `package session`, add the test to a white-box test file. Actually, `session_test.go` is `package session_test` (black-box). Add safeFilename tests in a new section of `helpers_test.go` or create a small white-box test.

Append to `internal/session/helpers_test.go` (which is `package session`):

```go
// --- safeFilename ---

func TestSafeFilename(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"my-server", "my-server"},
		{"My Server 2", "My_Server_2"},
		{"", "session"},
		{"!!@@##", "______"},
		{"a", "a"},
		{"abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOP", "abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOP"},                     // exactly 40+5 chars
		{"abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMN"}, // truncated to 40
		{"host@domain.com:2222", "host_domain-com_2222"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := safeFilename(tt.input)
			if got != tt.want {
				t.Errorf("safeFilename(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
```

Note: verify the expected values match the actual implementation. The function replaces non-alphanumeric/non-dash chars with `_`, returns `"session"` for empty result, truncates at 40. The `.` in `domain.com` becomes `_`, the `@` becomes `_`, the `:` becomes `_`.

- [ ] **Step 2: Extend ResolveReconnectConfig to cover all override fields**

In `internal/session/reconnect_test.go`, replace or extend the existing `TestResolveReconnectConfig` with full coverage:

```go
func TestResolveReconnectConfig_AllOverrides(t *testing.T) {
	sshCfg := config.SSHConfig{
		ReconnectEnabled:             true,
		ReconnectMaxRetries:          5,
		ReconnectInitialDelaySeconds: 2,
		ReconnectMaxDelaySeconds:     30,
		KeepAliveIntervalSeconds:     30,
		KeepAliveMaxMissed:           3,
	}

	enabled := false
	retries := 10
	initDelay := 5
	maxDelay := 60
	kaInterval := 15
	kaMissed := 5

	host := store.Host{
		ReconnectEnabled:             &enabled,
		ReconnectMaxRetries:          &retries,
		ReconnectInitialDelaySeconds: &initDelay,
		ReconnectMaxDelaySeconds:     &maxDelay,
		KeepAliveIntervalSeconds:     &kaInterval,
		KeepAliveMaxMissed:           &kaMissed,
	}

	rc := session.ResolveReconnectConfig(sshCfg, host)

	if rc.Enabled != false {
		t.Errorf("Enabled = %v, want false", rc.Enabled)
	}
	if rc.MaxRetries != 10 {
		t.Errorf("MaxRetries = %d, want 10", rc.MaxRetries)
	}
	if rc.InitialDelay != 5*time.Second {
		t.Errorf("InitialDelay = %v, want 5s", rc.InitialDelay)
	}
	if rc.MaxDelay != 60*time.Second {
		t.Errorf("MaxDelay = %v, want 60s", rc.MaxDelay)
	}
	if rc.KeepAliveInterval != 15*time.Second {
		t.Errorf("KeepAliveInterval = %v, want 15s", rc.KeepAliveInterval)
	}
	if rc.KeepAliveMaxMissed != 5 {
		t.Errorf("KeepAliveMaxMissed = %d, want 5", rc.KeepAliveMaxMissed)
	}
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add internal/session/helpers_test.go internal/session/session_test.go internal/session/reconnect_test.go
git commit -m "test(session): add safeFilename and full ResolveReconnectConfig tests"
```

---

### Task 10: session — ConnectOrReuse concurrency tests

**Files:**
- Create: `internal/session/connection_test.go`

- [ ] **Step 1: Write ConnectOrReuse tests**

Create `internal/session/connection_test.go`:

```go
package session

import (
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/store"
	"golang.org/x/crypto/ssh"
)

func hostFromKillable(t *testing.T, ks *killableServer) (store.Host, ssh.HostKeyCallback) {
	t.Helper()
	host, portStr, _ := net.SplitHostPort(ks.Addr)
	port, _ := strconv.Atoi(portStr)
	return store.Host{
			ID:         "test-host-1",
			Label:      "test",
			Hostname:   host,
			Port:       port,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		}, ssh.FixedHostKey(ks.Signer.PublicKey())
}

func TestConnectOrReuse_ReusesExistingConnection(t *testing.T) {
	const pw = "test-pw"
	ks := newKillableSSHServer(t, pw)
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, _ := hostFromKillable(t, ks)

	// Override the host key callback by setting it on the manager's config
	// ConnectOrReuse uses m.connHostKeyCallback which checks known_hosts.
	// For tests, we need to bypass this. We can swap the resolveReconnectConfig var
	// and use InsecureIgnoreHostKey via the Dial path.
	// Actually, ConnectOrReuse calls Dial internally with m.connHostKeyCallback.
	// The simplest approach: use ssh.InsecureIgnoreHostKey in the known_hosts path
	// by creating a temporary known_hosts file.

	// Alternative: test via Connect which wraps ConnectOrReuse, but same issue.
	// For now, test the reuse logic by calling ConnectOrReuse twice.
	// The host key issue is that connHostKeyCallback checks ~/.ssh/known_hosts.
	// In tests, the host won't be in known_hosts, so it'll emit an event and block.
	// We need to respond to the host key event.

	// Start a goroutine to accept host keys
	go func() {
		time.Sleep(100 * time.Millisecond)
		for {
			evts := tm.Emitter.EventsByTopic("connection:hostkey")
			for _, evt := range evts {
				if hk, ok := evt.Data.(ConnHostKeyEvent); ok {
					m.RespondConnHostKey(hk.ConnectionID, true)
				}
			}
			time.Sleep(50 * time.Millisecond)
			// Check if context is done
			select {
			case <-tm.Ctx.Done():
				return
			default:
			}
		}
	}()

	res1, err := m.ConnectOrReuse(host, pw, nil, "", nil)
	if err != nil {
		t.Fatalf("first ConnectOrReuse: %v", err)
	}

	res2, err := m.ConnectOrReuse(host, pw, nil, "", nil)
	if err != nil {
		t.Fatalf("second ConnectOrReuse: %v", err)
	}

	if res1.ConnectionID != res2.ConnectionID {
		t.Errorf("expected same connection ID, got %q and %q", res1.ConnectionID, res2.ConnectionID)
	}
	if !res2.Reused {
		t.Error("expected Reused=true for second call")
	}
}

func TestConnectOrReuse_InFlightDedup(t *testing.T) {
	const pw = "test-pw"
	ks := newKillableSSHServer(t, pw)
	tm := newRecordingTestManager(t)
	m := tm.Manager
	host, _ := hostFromKillable(t, ks)

	// Accept host keys in background
	go func() {
		for {
			select {
			case <-tm.Ctx.Done():
				return
			default:
			}
			evts := tm.Emitter.EventsByTopic("connection:hostkey")
			for _, evt := range evts {
				if hk, ok := evt.Data.(ConnHostKeyEvent); ok {
					m.RespondConnHostKey(hk.ConnectionID, true)
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()

	var wg sync.WaitGroup
	results := make([]ConnectResult, 2)
	errs := make([]error, 2)

	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx], errs[idx] = m.ConnectOrReuse(host, pw, nil, "", nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d error: %v", i, err)
		}
	}

	if results[0].ConnectionID != results[1].ConnectionID {
		t.Errorf("expected same connection, got %q and %q", results[0].ConnectionID, results[1].ConnectionID)
	}
}
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s -run TestConnectOrReuse`
Expected: both tests pass

- [ ] **Step 3: Commit**

```bash
git add internal/session/connection_test.go
git commit -m "test(session): add ConnectOrReuse concurrency tests"
```

---

### Task 11: session — markDead and reconnect tests

**Files:**
- Modify: `internal/session/reconnect_test.go`

- [ ] **Step 1: Add markDead generation guard tests**

These are white-box tests (package `session`). The existing `reconnect_test.go` is `package session_test`. We need a white-box file. Add to `internal/session/helpers_test.go` (which is `package session`):

```go
// --- markDead ---

func TestMarkDead_StaleGeneration(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:            "conn-1",
		hostLabel:     "test",
		state:         stateConnected,
		generation:    5,
		reconnectDone: make(chan struct{}),
		reconnCfg:     ReconnectConfig{Enabled: false},
	}
	m.mu.Lock()
	m.connections["conn-1"] = conn
	m.mu.Unlock()

	// Call markDead with stale generation — should be a no-op
	m.markDead(conn, 3)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateConnected {
		t.Errorf("state = %d, want stateConnected (%d)", state, stateConnected)
	}
}

func TestMarkDead_ReconnectDisabled(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	done := make(chan struct{})
	conn := &Connection{
		id:            "conn-1",
		hostLabel:     "test",
		state:         stateConnected,
		generation:    0,
		reconnectDone: done,
		reconnCfg:     ReconnectConfig{Enabled: false},
		cancel:        func() {}, // no-op cancel
	}
	m.mu.Lock()
	m.connections["conn-1"] = conn
	m.mu.Unlock()

	m.markDead(conn, 0)

	// reconnectDone should be closed
	select {
	case <-done:
		// good
	case <-time.After(time.Second):
		t.Fatal("reconnectDone not closed")
	}

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed (%d)", state, stateFailed)
	}

	// Check emitted events
	evts := tm.Emitter.EventsByTopic("connection:status")
	foundFailed := false
	for _, evt := range evts {
		if cse, ok := evt.Data.(ConnectionStatusEvent); ok && cse.Status == StatusFailed {
			foundFailed = true
		}
	}
	if !foundFailed {
		t.Error("expected StatusFailed event")
	}
}

func TestMarkDead_FirstCallerWins(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:            "conn-1",
		hostLabel:     "test",
		state:         stateConnected,
		generation:    0,
		reconnectDone: make(chan struct{}),
		reconnCfg:     ReconnectConfig{Enabled: false},
		cancel:        func() {},
	}
	m.mu.Lock()
	m.connections["conn-1"] = conn
	m.mu.Unlock()

	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.markDead(conn, 0)
		}()
	}
	wg.Wait()

	// Only one should have transitioned; state should be stateFailed
	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed", state)
	}

	// reconnectDone should be closed exactly once (no panic from double close)
	select {
	case <-conn.reconnectDone:
	default:
		t.Error("reconnectDone not closed")
	}
}
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s -run TestMarkDead`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add internal/session/helpers_test.go
git commit -m "test(session): add markDead generation guard and reconnect-disabled tests"
```

---

### Task 12: session — reconnectLoop tests

**Files:**
- Modify: `internal/session/helpers_test.go`

- [ ] **Step 1: Add reconnectLoop tests**

Append to `internal/session/helpers_test.go`:

```go
// --- reconnectLoop ---

func TestReconnectLoop_ExhaustsRetries(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager
	m.cfg.SSH.ReconnectMaxRetries = 2

	// Create a connection to a dead server
	ks := newKillableSSHServer(t, "pw")
	host, _ := hostFromKillable(t, ks)
	ks.Kill() // server is dead

	done := make(chan struct{})
	conn := &Connection{
		id:        "conn-retry",
		hostLabel: "test",
		host:      host,
		password:  "pw",
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   2,
			InitialDelay: time.Millisecond,
			MaxDelay:     10 * time.Millisecond,
		},
		reconnectDone: done,
		portForwards:  make(map[string]*portForward),
	}
	m.mu.Lock()
	m.connections["conn-retry"] = conn
	m.mu.Unlock()

	m.reconnectLoop(conn)

	// Should be in failed state
	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed", state)
	}

	// reconnectDone should be closed
	select {
	case <-done:
	default:
		t.Fatal("reconnectDone not closed after exhausting retries")
	}

	// Should have emitted StatusFailed
	evts := tm.Emitter.EventsByTopic("connection:status")
	foundFailed := false
	for _, evt := range evts {
		if cse, ok := evt.Data.(ConnectionStatusEvent); ok && cse.Status == StatusFailed {
			foundFailed = true
		}
	}
	if !foundFailed {
		t.Error("expected StatusFailed event after exhausting retries")
	}
}

func TestReconnectLoop_AllChannelsClosedAbort(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	ks := newKillableSSHServer(t, "pw")
	host, _ := hostFromKillable(t, ks)
	ks.Kill()

	done := make(chan struct{})
	conn := &Connection{
		id:        "conn-abort",
		hostLabel: "test",
		host:      host,
		password:  "pw",
		state:     stateReconnecting,
		hostID:    "test-host-1",
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   10,
			InitialDelay: time.Millisecond,
			MaxDelay:     10 * time.Millisecond,
		},
		reconnectDone: done,
		cancel:        func() {},
		portForwards:  make(map[string]*portForward),
	}
	m.mu.Lock()
	m.connections["conn-abort"] = conn
	// No channels registered for this connection — loop should abort immediately
	m.mu.Unlock()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed (aborted due to no channels)", state)
	}
}

func TestReconnectLoop_ManagerContextCancelled(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	ks := newKillableSSHServer(t, "pw")
	host, _ := hostFromKillable(t, ks)
	ks.Kill()

	done := make(chan struct{})
	// Use a fake channel so the loop doesn't abort due to no channels
	fakeCh := &LocalFSChannel{id: "ch-1", connectionID: "conn-cancel"}
	m.mu.Lock()
	m.channels["ch-1"] = fakeCh
	m.mu.Unlock()

	conn := &Connection{
		id:        "conn-cancel",
		hostLabel: "test",
		host:      host,
		password:  "pw",
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   100,
			InitialDelay: 500 * time.Millisecond, // long enough to cancel during
			MaxDelay:     time.Second,
		},
		reconnectDone: done,
		portForwards:  make(map[string]*portForward),
	}
	m.mu.Lock()
	m.connections["conn-cancel"] = conn
	m.mu.Unlock()

	// Cancel manager context after a short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		tm.Cancel()
	}()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed (context cancelled)", state)
	}
}
```

Note: `hostFromKillable` is defined in `connection_test.go` which is also `package session`, so it's available here.

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s -run TestReconnectLoop`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add internal/session/helpers_test.go
git commit -m "test(session): add reconnectLoop tests (retry exhaustion, abort, context cancel)"
```

---

### Task 13: session — startKeepAlive and reconnectLoop success tests

**Files:**
- Modify: `internal/session/helpers_test.go`

- [ ] **Step 1: Add startKeepAlive miss counter test**

Append to `internal/session/helpers_test.go`:

```go
// --- startKeepAlive ---

func TestStartKeepAlive_MissedPingsCallMarkDead(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager
	m.cfg.SSH.KeepAliveIntervalSeconds = 1 // will be overridden by conn's reconnCfg

	ks := newKillableSSHServer(t, "pw")
	host, hkCb := hostFromKillable(t, ks)

	// Dial manually to get a real SSH client
	res, err := Dial(DialRequest{
		Host: host, Password: "pw", Timeout: 5 * time.Second,
		HostKeyCallback: hkCb,
	})
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	conn := &Connection{
		id:        "conn-ka",
		hostLabel: "test",
		host:      host,
		client:    res.Client,
		ctx:       ctx,
		cancel:    cancel,
		state:     stateConnected,
		generation: 0,
		reconnCfg: ReconnectConfig{
			Enabled:            false, // so markDead doesn't start reconnectLoop
			KeepAliveInterval:  50 * time.Millisecond,
			KeepAliveMaxMissed: 2,
		},
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
	}

	m.mu.Lock()
	m.connections["conn-ka"] = conn
	m.mu.Unlock()

	// Kill the server so keepalive pings fail
	ks.Kill()

	kaCancel := m.startKeepAlive(conn)
	defer kaCancel()

	// Wait for markDead to fire (should happen after ~2 missed pings)
	time.Sleep(500 * time.Millisecond)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Errorf("state = %d, want stateFailed after missed keepalives", state)
	}
}

func TestReconnectLoop_Success(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	ks := newKillableSSHServer(t, "pw")
	host, _ := hostFromKillable(t, ks)

	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())

	conn := &Connection{
		id:        "conn-success",
		hostLabel: "test",
		host:      host,
		password:  "pw",
		ctx:       ctx,
		cancel:    cancel,
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:           true,
			MaxRetries:        5,
			InitialDelay:      50 * time.Millisecond,
			MaxDelay:          100 * time.Millisecond,
			KeepAliveInterval: 0, // disabled
		},
		reconnectDone: done,
		portForwards:  make(map[string]*portForward),
	}

	// Register a fake channel so the loop doesn't abort
	fakeCh := &LocalFSChannel{id: "ch-1", connectionID: "conn-success"}
	m.mu.Lock()
	m.connections["conn-success"] = conn
	m.channels["ch-1"] = fakeCh
	m.mu.Unlock()

	// Kill server, start reconnect, then restart server after a delay
	ks.Kill()
	go func() {
		time.Sleep(200 * time.Millisecond)
		ks.Restart(t)
	}()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateConnected {
		t.Errorf("state = %d, want stateConnected after successful reconnect", state)
	}
}
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s -run "TestStartKeepAlive|TestReconnectLoop_Success"`
Expected: both pass

- [ ] **Step 3: Commit**

```bash
git add internal/session/helpers_test.go
git commit -m "test(session): add startKeepAlive and reconnectLoop success tests"
```

---

### Task 14: session — extractTarGz path traversal tests

**Files:**
- Create: `internal/session/sftp_test.go`

- [ ] **Step 1: Write extractTarGz tests**

Create `internal/session/sftp_test.go`:

```go
package session

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

// createTestTarGz creates a .tar.gz archive at archivePath with the given entries.
func createTestTarGz(t *testing.T, archivePath string, entries []struct {
	Name    string
	Content string
	IsDir   bool
}) {
	t.Helper()
	f, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	for _, e := range entries {
		if e.IsDir {
			tw.WriteHeader(&tar.Header{
				Name:     e.Name,
				Typeflag: tar.TypeDir,
				Mode:     0755,
			})
		} else {
			tw.WriteHeader(&tar.Header{
				Name:     e.Name,
				Typeflag: tar.TypeReg,
				Mode:     0644,
				Size:     int64(len(e.Content)),
			})
			tw.Write([]byte(e.Content))
		}
	}
}

func TestExtractTarGz_Normal(t *testing.T) {
	tmpDir := t.TempDir()
	archivePath := filepath.Join(tmpDir, "test.tar.gz")
	destDir := filepath.Join(tmpDir, "dest")
	os.MkdirAll(destDir, 0755)

	createTestTarGz(t, archivePath, []struct {
		Name    string
		Content string
		IsDir   bool
	}{
		{Name: "subdir/", IsDir: true},
		{Name: "subdir/file.txt", Content: "hello world"},
		{Name: "root.txt", Content: "root content"},
	})

	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// Verify files exist
	content, err := os.ReadFile(filepath.Join(destDir, "subdir", "file.txt"))
	if err != nil {
		t.Fatalf("read file.txt: %v", err)
	}
	if string(content) != "hello world" {
		t.Errorf("content = %q, want %q", string(content), "hello world")
	}

	content2, err := os.ReadFile(filepath.Join(destDir, "root.txt"))
	if err != nil {
		t.Fatalf("read root.txt: %v", err)
	}
	if string(content2) != "root content" {
		t.Errorf("content = %q, want %q", string(content2), "root content")
	}
}

func TestExtractTarGz_PathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	archivePath := filepath.Join(tmpDir, "evil.tar.gz")
	destDir := filepath.Join(tmpDir, "dest")
	os.MkdirAll(destDir, 0755)

	createTestTarGz(t, archivePath, []struct {
		Name    string
		Content string
		IsDir   bool
	}{
		{Name: "../../etc/passwd", Content: "evil content"},
		{Name: "safe.txt", Content: "safe"},
	})

	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// The traversal entry should have been skipped
	if _, err := os.Stat(filepath.Join(destDir, "..", "..", "etc", "passwd")); err == nil {
		t.Error("path traversal file should not have been extracted")
	}

	// The safe file should exist
	if _, err := os.Stat(filepath.Join(destDir, "safe.txt")); err != nil {
		t.Error("safe.txt should have been extracted")
	}
}
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -race -v -timeout 60s -run TestExtractTarGz`
Expected: both pass

- [ ] **Step 3: Commit**

```bash
git add internal/session/sftp_test.go
git commit -m "test(session): add extractTarGz tests including path traversal guard"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/... -race -timeout 60s -count=1 -v 2>&1 | tail -50`
Expected: all packages pass, no failures

- [ ] **Step 2: Run go vet**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go vet ./internal/...`
Expected: no issues

- [ ] **Step 3: Verify test count increased**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/credstore/... -v 2>&1 | grep -c "^--- PASS"`
Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/store/... -v 2>&1 | grep -c "^--- PASS"`
Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/backend-testing-improvements && go test ./internal/session/... -v 2>&1 | grep -c "^--- PASS"`
Expected: credstore ~20+, store ~40+, session ~25+
