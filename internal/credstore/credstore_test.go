package credstore

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// ---------------------------------------------------------------------------
// memSecretStore — in-memory implementation of store.SecretStore for vault tests
// ---------------------------------------------------------------------------

type secretEntry struct {
	nonce      []byte
	ciphertext []byte
}

type memSecretStore struct {
	mu   sync.Mutex
	data map[string]secretEntry
}

func newMemSecretStore() *memSecretStore {
	return &memSecretStore{data: make(map[string]secretEntry)}
}

func (m *memSecretStore) key(hostID, kind string) string {
	return hostID + "::" + kind
}

func (m *memSecretStore) StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[m.key(hostID, kind)] = secretEntry{nonce: nonce, ciphertext: ciphertext}
	return nil
}

func (m *memSecretStore) GetEncryptedSecret(hostID, kind string) ([]byte, []byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.data[m.key(hostID, kind)]
	if !ok {
		return nil, nil, nil
	}
	return e.nonce, e.ciphertext, nil
}

func (m *memSecretStore) DeleteEncryptedSecret(hostID, kind string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, m.key(hostID, kind))
	return nil
}

// ---------------------------------------------------------------------------
// Part 1: Pure logic and vault round-trip tests
// ---------------------------------------------------------------------------

func TestIsKeychainUnavailable(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error", nil, false},
		{"freedesktop secrets", errors.New("org.freedesktop.secrets was not provided"), true},
		{"no such interface", errors.New("no such interface on object"), true},
		{"connection refused", errors.New("dial: connection refused"), true},
		{"unrelated error", errors.New("something else entirely"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isKeychainUnavailable(tt.err)
			if got != tt.want {
				t.Errorf("isKeychainUnavailable(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestFetchDispatch_UnsupportedSource(t *testing.T) {
	r := &Resolver{
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", nil },
	}
	_, err := r.Fetch(Source("unknown"), "ref")
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported error, got: %v", err)
	}
}

func TestResolveDispatch_UnsupportedSource(t *testing.T) {
	r := &Resolver{
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", nil },
	}
	_, err := r.Resolve(context.Background(), "unknown", "ref")
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported error, got: %v", err)
	}
}

func TestInlineSecret_Fallback(t *testing.T) {
	// InlineSecret calls KeychainGet which will likely fail or return empty
	// in a test environment. It should fall back to the provided fallback.
	r := NewResolver()
	got, err := r.InlineSecret("nonexistent-test-key-shsh", "my-fallback")
	if err != nil {
		t.Fatalf("InlineSecret returned error: %v", err)
	}
	if got != "my-fallback" {
		t.Errorf("InlineSecret = %q, want %q", got, "my-fallback")
	}
}

func TestSecretManager_VaultRoundTrip(t *testing.T) {
	ss := newMemSecretStore()
	sm := NewSecretManager(ss)

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	sm.SetVaultKeyFunc(func() ([]byte, error) { return key, nil })

	plaintext := "super-secret-password"
	hostID := "host-1"
	kind := "password"

	if err := sm.Put(hostID, kind, plaintext, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, err := sm.Get(hostID, kind, "")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != plaintext {
		t.Errorf("Get = %q, want %q", got, plaintext)
	}
}

func TestSecretManager_Get_NilNonce(t *testing.T) {
	ss := newMemSecretStore() // empty store
	sm := NewSecretManager(ss)

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	sm.SetVaultKeyFunc(func() ([]byte, error) { return key, nil })

	got, err := sm.Get("no-host", "password", "")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "" {
		t.Errorf("Get = %q, want empty string", got)
	}
}

func TestSecretManager_Delete(t *testing.T) {
	ss := newMemSecretStore()
	sm := NewSecretManager(ss)

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	sm.SetVaultKeyFunc(func() ([]byte, error) { return key, nil })

	hostID := "host-del"
	kind := "password"

	if err := sm.Put(hostID, kind, "secret", nil); err != nil {
		t.Fatal(err)
	}
	if err := sm.Delete(hostID, kind); err != nil {
		t.Fatal(err)
	}

	got, err := sm.Get(hostID, kind, "")
	if err != nil {
		t.Fatalf("Get after delete: %v", err)
	}
	if got != "" {
		t.Errorf("Get after delete = %q, want empty", got)
	}
}

func TestSecretManager_Put_BadKey(t *testing.T) {
	ss := newMemSecretStore()
	sm := NewSecretManager(ss)

	shortKey := []byte("too-short")
	sm.SetVaultKeyFunc(func() ([]byte, error) { return shortKey, nil })

	err := sm.Put("h", "password", "secret", nil)
	if err == nil {
		t.Fatal("expected error for short key, got nil")
	}
}

// ---------------------------------------------------------------------------
// Part 2: PM CLI argument construction and status check tests
// ---------------------------------------------------------------------------

func TestFetchFrom1Password_OpURI(t *testing.T) {
	var capturedName string
	var capturedArgs []string

	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedName = name
			capturedArgs = args
			return []byte("the-password\n"), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
	}

	ref := "op://vault/item/field"
	got, err := r.fetchFrom1PasswordCtx(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if got != "the-password" {
		t.Errorf("got %q, want %q", got, "the-password")
	}
	if capturedName != "op" {
		t.Errorf("command = %q, want %q", capturedName, "op")
	}
	wantArgs := []string{"read", ref}
	if fmt.Sprintf("%v", capturedArgs) != fmt.Sprintf("%v", wantArgs) {
		t.Errorf("args = %v, want %v", capturedArgs, wantArgs)
	}
}

func TestFetchFrom1Password_ItemName(t *testing.T) {
	var capturedArgs []string

	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedArgs = args
			return []byte("pw123"), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
	}

	ref := "my-server-login"
	_, err := r.fetchFrom1PasswordCtx(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	wantArgs := []string{"item", "get", ref, "--fields", "label=password", "--reveal"}
	if fmt.Sprintf("%v", capturedArgs) != fmt.Sprintf("%v", wantArgs) {
		t.Errorf("args = %v, want %v", capturedArgs, wantArgs)
	}
}

func TestFetchFromBitwarden_Basic(t *testing.T) {
	var capturedName string
	var capturedArgs []string

	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedName = name
			capturedArgs = args
			return []byte("bw-pass\n"), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
	}

	ref := "my-item"
	got, err := r.fetchFromBitwardenCtx(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if got != "bw-pass" {
		t.Errorf("got %q, want %q", got, "bw-pass")
	}
	if capturedName != "bw" {
		t.Errorf("command = %q, want %q", capturedName, "bw")
	}
	wantArgs := []string{"get", "password", ref}
	if fmt.Sprintf("%v", capturedArgs) != fmt.Sprintf("%v", wantArgs) {
		t.Errorf("args = %v, want %v", capturedArgs, wantArgs)
	}
}

func TestFetchFromBitwarden_WithSessionKey(t *testing.T) {
	var capturedArgs []string

	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			capturedArgs = args
			return []byte("pw"), nil
		},
		lookPath:     func(name string) (string, error) { return "/usr/bin/" + name, nil },
		bwSessionKey: "ses-abc123",
	}

	ref := "item-uuid"
	_, err := r.fetchFromBitwardenCtx(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	wantArgs := []string{"get", "password", ref, "--session", "ses-abc123"}
	if fmt.Sprintf("%v", capturedArgs) != fmt.Sprintf("%v", wantArgs) {
		t.Errorf("args = %v, want %v", capturedArgs, wantArgs)
	}
}

func TestFetchFrom1Password_CLINotFound(t *testing.T) {
	r := &Resolver{
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}

	_, err := r.fetchFrom1PasswordCtx(context.Background(), "ref")
	if err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("expected 'not installed' error, got: %v", err)
	}
}

func TestFetchFromBitwarden_CLINotFound(t *testing.T) {
	r := &Resolver{
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}

	_, err := r.fetchFromBitwardenCtx(context.Background(), "ref")
	if err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("expected 'not installed' error, got: %v", err)
	}
}

func TestFetchFrom1Password_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return nil, ctx.Err()
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
	}

	_, err := r.fetchFrom1PasswordCtx(ctx, "ref")
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
	if !errors.Is(err, context.Canceled) {
		if !strings.Contains(err.Error(), "canceled") {
			t.Errorf("expected context.Canceled in error, got: %v", err)
		}
	}
}

func TestCheck1Password_CLIMissing(t *testing.T) {
	r := &Resolver{
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}

	status := r.check1Password()
	if status.Available {
		t.Error("expected Available=false when CLI is missing")
	}
}

func TestCheck1Password_Unlocked(t *testing.T) {
	r := &Resolver{
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`[{"id":"abc"}]`), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
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
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`[]`), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/op", nil },
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
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`{"status":"unlocked"}`), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/bw", nil },
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
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return []byte(`{"status":"locked"}`), nil
		},
		lookPath: func(name string) (string, error) { return "/usr/bin/bw", nil },
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
		runCmd:   func(ctx context.Context, name string, args ...string) ([]byte, error) { return nil, nil },
		lookPath: func(name string) (string, error) { return "", errors.New("not found") },
	}

	status := r.checkBitwarden()
	if status.Available {
		t.Error("expected Available=false when CLI is missing")
	}
}
