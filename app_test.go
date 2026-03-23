package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadPublicKeyText(t *testing.T) {
	content := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest test@machine\n"

	t.Run("reads .pub file directly", func(t *testing.T) {
		dir := t.TempDir()
		pubPath := filepath.Join(dir, "id_ed25519.pub")
		if err := os.WriteFile(pubPath, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		app := &App{}
		got, err := app.ReadPublicKeyText(pubPath)
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
		app := &App{}
		privPath := filepath.Join(dir, "id_ed25519")
		got, err := app.ReadPublicKeyText(privPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != content[:len(content)-1] {
			t.Fatalf("got %q, want %q", got, content[:len(content)-1])
		}
	})

	t.Run("returns error for missing file", func(t *testing.T) {
		app := &App{}
		_, err := app.ReadPublicKeyText("/nonexistent/path/id_ed25519")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestDeployPublicKeyErrors(t *testing.T) {
	t.Run("missing public key file returns error", func(t *testing.T) {
		app := &App{}
		_, err := app.DeployPublicKey("any-id", "/nonexistent/id_ed25519")
		if err == nil {
			t.Fatal("expected error for missing pub key file, got nil")
		}
	})

	t.Run("invalid pub key content returns error", func(t *testing.T) {
		dir := t.TempDir()
		pubPath := filepath.Join(dir, "bad.pub")
		os.WriteFile(pubPath, []byte("not a valid key\n"), 0600)
		app := &App{}
		_, err := app.DeployPublicKey("any-id", pubPath)
		if err == nil {
			t.Fatal("expected error for invalid key content, got nil")
		}
	})
}
