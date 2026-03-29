package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenLocalFSChannel(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	m.mu.Lock()
	ch, ok := m.channels[channelID]
	conn, connOk := m.connections[localConnectionID]
	m.mu.Unlock()

	if !ok {
		t.Fatalf("channel %s not found in map", channelID)
	}
	if ch.Kind() != ChannelLocalFS {
		t.Errorf("Kind() = %q, want %q", ch.Kind(), ChannelLocalFS)
	}
	if ch.ConnectionID() != localConnectionID {
		t.Errorf("ConnectionID() = %q, want %q", ch.ConnectionID(), localConnectionID)
	}
	if !connOk {
		t.Fatalf("virtual connection %q not found", localConnectionID)
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 1 {
		t.Errorf("channelRefs = %d, want 1", refs)
	}
}

func TestOpenMultipleLocalFSChannels(t *testing.T) {
	m := newTestManager()

	_, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("first OpenLocalFSChannel() error = %v", err)
	}
	_, err = m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("second OpenLocalFSChannel() error = %v", err)
	}

	m.mu.Lock()
	conn, connOk := m.connections[localConnectionID]
	m.mu.Unlock()

	if !connOk {
		t.Fatalf("virtual connection %q not found", localConnectionID)
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 2 {
		t.Errorf("channelRefs = %d, want 2", refs)
	}
}

func TestCloseLocalFSChannel(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	if err := m.CloseChannel(channelID); err != nil {
		t.Fatalf("CloseChannel() error = %v", err)
	}

	m.mu.Lock()
	_, channelExists := m.channels[channelID]
	conn, connExists := m.connections[localConnectionID]
	m.mu.Unlock()

	if channelExists {
		t.Error("channel should have been removed from map after close")
	}
	if !connExists {
		t.Error("virtual connection should persist after last channel closes")
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 0 {
		t.Errorf("channelRefs = %d, want 0", refs)
	}
}

func TestLocalListDir(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	dir := t.TempDir()
	subDir := filepath.Join(dir, "subdir")
	if err := os.Mkdir(subDir, 0o755); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	entries, err := m.LocalListDir(channelID, dir)
	if err != nil {
		t.Fatalf("LocalListDir() error = %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2", len(entries))
	}

	// Dirs first, then files
	if !entries[0].IsDir {
		t.Errorf("entries[0].IsDir = false, want true (dirs should come first)")
	}
	if entries[0].Name != "subdir" {
		t.Errorf("entries[0].Name = %q, want %q", entries[0].Name, "subdir")
	}
	if entries[1].IsDir {
		t.Errorf("entries[1].IsDir = true, want false")
	}
	if entries[1].Name != "file.txt" {
		t.Errorf("entries[1].Name = %q, want %q", entries[1].Name, "file.txt")
	}
	if entries[1].Path != filepath.Join(dir, "file.txt") {
		t.Errorf("entries[1].Path = %q, want %q", entries[1].Path, filepath.Join(dir, "file.txt"))
	}
}

func TestLocalMkdir(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	dir := t.TempDir()
	newDir := filepath.Join(dir, "newdir", "nested")

	if err := m.LocalMkdir(channelID, newDir); err != nil {
		t.Fatalf("LocalMkdir() error = %v", err)
	}

	info, err := os.Stat(newDir)
	if err != nil {
		t.Fatalf("Stat() error = %v; directory was not created", err)
	}
	if !info.IsDir() {
		t.Errorf("expected %q to be a directory", newDir)
	}
}

func TestLocalDelete(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	dir := t.TempDir()
	file := filepath.Join(dir, "todelete.txt")
	if err := os.WriteFile(file, []byte("bye"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := m.LocalDelete(channelID, file); err != nil {
		t.Fatalf("LocalDelete() error = %v", err)
	}

	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("expected file %q to be gone, got err = %v", file, err)
	}
}

func TestLocalRename(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	dir := t.TempDir()
	oldPath := filepath.Join(dir, "old.txt")
	newPath := filepath.Join(dir, "new.txt")
	if err := os.WriteFile(oldPath, []byte("content"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := m.LocalRename(channelID, oldPath, newPath); err != nil {
		t.Fatalf("LocalRename() error = %v", err)
	}

	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Errorf("expected old path %q to be gone, got err = %v", oldPath, err)
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("expected new path %q to exist, got err = %v", newPath, err)
	}
}
