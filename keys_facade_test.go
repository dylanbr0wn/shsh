package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/deps"
)

func TestReadPublicKeyText(t *testing.T) {
	content := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest test@machine\n"

	t.Run("reads .pub file directly", func(t *testing.T) {
		dir := t.TempDir()
		pubPath := filepath.Join(dir, "id_ed25519.pub")
		if err := os.WriteFile(pubPath, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		facade := &KeysFacade{d: &deps.Deps{}}
		got, err := facade.ReadPublicKeyText(pubPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != content[:len(content)-1] { // trimmed newline
			t.Fatalf("got %q, want %q", got, content[:len(content)-1])
		}
	})

	t.Run("derives .pub from private key path", func(t *testing.T) {
		dir := t.TempDir()
		pubPath := filepath.Join(dir, "id_ed25519.pub")
		if err := os.WriteFile(pubPath, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		facade := &KeysFacade{d: &deps.Deps{}}
		privPath := filepath.Join(dir, "id_ed25519")
		got, err := facade.ReadPublicKeyText(privPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != content[:len(content)-1] {
			t.Fatalf("got %q, want %q", got, content[:len(content)-1])
		}
	})

	t.Run("returns error for missing file", func(t *testing.T) {
		facade := &KeysFacade{d: &deps.Deps{}}
		_, err := facade.ReadPublicKeyText("/nonexistent/path/id_ed25519")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestDeployPublicKeyErrors(t *testing.T) {
	t.Run("missing public key file returns error", func(t *testing.T) {
		facade := &KeysFacade{d: &deps.Deps{}}
		_, err := facade.DeployPublicKey("any-id", "/nonexistent/id_ed25519")
		if err == nil {
			t.Fatal("expected error for missing pub key file, got nil")
		}
	})

	t.Run("invalid pub key content returns error", func(t *testing.T) {
		dir := t.TempDir()
		pubPath := filepath.Join(dir, "bad.pub")
		os.WriteFile(pubPath, []byte("not a valid key\n"), 0600)
		facade := &KeysFacade{d: &deps.Deps{}}
		_, err := facade.DeployPublicKey("any-id", pubPath)
		if err == nil {
			t.Fatal("expected error for invalid key content, got nil")
		}
	})
}
