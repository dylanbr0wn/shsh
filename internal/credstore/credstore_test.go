package credstore

import (
	"context"
	"crypto/rand"
	"errors"
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

func TestVaultRoundTrip(t *testing.T) {
	ss := newMemSecretStore()
	r := &Resolver{}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}

	plaintext := "super-secret-password"
	hostID := "host-1"
	kind := "password"

	if err := r.VaultStoreSecret(ss, key, hostID, kind, plaintext); err != nil {
		t.Fatalf("VaultStoreSecret: %v", err)
	}

	got, err := r.VaultGetSecret(ss, key, hostID, kind)
	if err != nil {
		t.Fatalf("VaultGetSecret: %v", err)
	}
	if got != plaintext {
		t.Errorf("VaultGetSecret = %q, want %q", got, plaintext)
	}
}

func TestVaultGetSecret_NilNonce(t *testing.T) {
	ss := newMemSecretStore() // empty store
	r := &Resolver{}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}

	got, err := r.VaultGetSecret(ss, key, "no-host", "password")
	if err != nil {
		t.Fatalf("VaultGetSecret: %v", err)
	}
	if got != "" {
		t.Errorf("VaultGetSecret = %q, want empty string", got)
	}
}

func TestVaultDeleteSecret(t *testing.T) {
	ss := newMemSecretStore()
	r := &Resolver{}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}

	hostID := "host-del"
	kind := "password"

	if err := r.VaultStoreSecret(ss, key, hostID, kind, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := r.VaultDeleteSecret(ss, hostID, kind); err != nil {
		t.Fatal(err)
	}

	got, err := r.VaultGetSecret(ss, key, hostID, kind)
	if err != nil {
		t.Fatalf("VaultGetSecret after delete: %v", err)
	}
	if got != "" {
		t.Errorf("VaultGetSecret after delete = %q, want empty", got)
	}
}

func TestVaultStoreSecret_BadKey(t *testing.T) {
	ss := newMemSecretStore()
	r := &Resolver{}

	shortKey := []byte("too-short")
	err := r.VaultStoreSecret(ss, shortKey, "h", "password", "secret")
	if err == nil {
		t.Fatal("expected error for short key, got nil")
	}
}
