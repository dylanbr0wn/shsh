package sshconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	return path
}

// listFromFile swaps the real ~/.ssh/config for a temp file during the test.
func listFromFile(t *testing.T, configPath string) ([]Entry, error) {
	t.Helper()

	// Point HOME at a temp dir containing an .ssh/config symlink to our file.
	home := t.TempDir()
	sshDir := filepath.Join(home, ".ssh")
	if err := os.Mkdir(sshDir, 0700); err != nil {
		t.Fatalf("mkdir .ssh: %v", err)
	}
	if err := os.Symlink(configPath, filepath.Join(sshDir, "config")); err != nil {
		t.Fatalf("symlink config: %v", err)
	}

	orig := os.Getenv("HOME")
	t.Setenv("HOME", home)
	defer os.Setenv("HOME", orig)

	return List()
}

func TestList_EmptyFile(t *testing.T) {
	path := writeConfig(t, "")
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(entries))
	}
	if entries == nil {
		t.Error("expected empty slice, got nil")
	}
}

func TestList_NonexistentFile(t *testing.T) {
	home := t.TempDir()
	// No .ssh/config created.
	t.Setenv("HOME", home)

	entries, err := List()
	if err != nil {
		t.Fatalf("List with missing file: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(entries))
	}
}

func TestList_BasicEntry(t *testing.T) {
	path := writeConfig(t, `
Host myserver
  HostName 192.168.1.10
  Port 2222
  User deploy
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	e := entries[0]
	if e.Alias != "myserver" {
		t.Errorf("Alias = %q, want %q", e.Alias, "myserver")
	}
	if e.Hostname != "192.168.1.10" {
		t.Errorf("Hostname = %q, want %q", e.Hostname, "192.168.1.10")
	}
	if e.Port != 2222 {
		t.Errorf("Port = %d, want 2222", e.Port)
	}
	if e.User != "deploy" {
		t.Errorf("User = %q, want %q", e.User, "deploy")
	}
}

func TestList_MissingHostnameDefaultsToAlias(t *testing.T) {
	path := writeConfig(t, `
Host myalias
  User alice
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Hostname != "myalias" {
		t.Errorf("Hostname = %q, want alias %q", entries[0].Hostname, "myalias")
	}
}

func TestList_MissingPortDefaultsTo22(t *testing.T) {
	path := writeConfig(t, `
Host myserver
  HostName 10.0.0.1
  User alice
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if entries[0].Port != 22 {
		t.Errorf("Port = %d, want 22", entries[0].Port)
	}
}

func TestList_WildcardEntriesFiltered(t *testing.T) {
	path := writeConfig(t, `
Host *
  ServerAliveInterval 60

Host *.internal
  User corp

Host prod
  HostName prod.example.com
  User alice

Host dev?
  HostName dev.example.com
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// Only "prod" should survive; * and *.internal and dev? are wildcards.
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry after wildcard filter, got %d: %+v", len(entries), entries)
	}
	if entries[0].Alias != "prod" {
		t.Errorf("Alias = %q, want %q", entries[0].Alias, "prod")
	}
}

func TestList_SortedByAlias(t *testing.T) {
	path := writeConfig(t, `
Host zebra
  HostName z.example.com

Host alpha
  HostName a.example.com

Host mango
  HostName m.example.com
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	want := []string{"alpha", "mango", "zebra"}
	for i, w := range want {
		if entries[i].Alias != w {
			t.Errorf("entries[%d].Alias = %q, want %q", i, entries[i].Alias, w)
		}
	}
}

func TestList_MultipleHosts(t *testing.T) {
	path := writeConfig(t, `
Host web
  HostName web.example.com
  Port 22
  User www

Host db
  HostName db.example.com
  Port 5432
  User dbadmin
`)
	entries, err := listFromFile(t, path)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	// sorted: db before web
	if entries[0].Alias != "db" {
		t.Errorf("entries[0].Alias = %q, want %q", entries[0].Alias, "db")
	}
	if entries[0].Port != 5432 {
		t.Errorf("entries[0].Port = %d, want 5432", entries[0].Port)
	}
}
