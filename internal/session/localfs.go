package session

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/google/uuid"
)

// localConnectionID is the fixed ID for the virtual local-filesystem connection.
const localConnectionID = "local"

// LocalFSChannel is a virtual channel representing a local filesystem pane.
// It does not require a real SSH connection.
type LocalFSChannel struct {
	id string
}

func (l *LocalFSChannel) ID() string           { return l.id }
func (l *LocalFSChannel) Kind() ChannelKind    { return ChannelLocalFS }
func (l *LocalFSChannel) ConnectionID() string { return localConnectionID }
func (l *LocalFSChannel) Close() error         { return nil }

// ensureLocalConnection lazily creates the singleton virtual Connection for the
// local filesystem. It is stored in both m.connections and m.connByIdent so that
// existing lookup paths work. The connection has no real SSH client and its cancel
// is a no-op — it persists for the lifetime of the app.
func (m *Manager) ensureLocalConnection() *Connection {
	m.mu.Lock()
	defer m.mu.Unlock()

	if conn, ok := m.connections[localConnectionID]; ok {
		return conn
	}

	connCtx, cancel := context.WithCancel(m.ctx)
	conn := &Connection{
		id:           localConnectionID,
		hostID:       localConnectionID,
		hostLabel:    "Local",
		ctx:          connCtx,
		cancel:       cancel,
		portForwards: make(map[string]*portForward),
	}

	ident := connIdentity{hostID: localConnectionID}
	m.connections[localConnectionID] = conn
	m.connByIdent[ident] = conn
	return conn
}

// OpenLocalFSChannel creates a new LocalFSChannel, increments the virtual
// connection's ref count, and emits a channel:status connected event.
func (m *Manager) OpenLocalFSChannel() (string, error) {
	conn := m.ensureLocalConnection()

	channelID := uuid.New().String()
	ch := &LocalFSChannel{id: channelID}

	conn.incrRefs()

	m.mu.Lock()
	m.channels[channelID] = ch
	m.mu.Unlock()

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: localConnectionID,
		Kind:         ChannelLocalFS,
		Status:       StatusConnected,
	})

	return channelID, nil
}

// getLocalFSChannel looks up a LocalFSChannel by channelID.
func (m *Manager) getLocalFSChannel(channelID string) (*LocalFSChannel, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelID)
	}
	lc, ok := ch.(*LocalFSChannel)
	if !ok {
		return nil, fmt.Errorf("channel %s is not a local FS channel", channelID)
	}
	return lc, nil
}

// LocalListDir lists the contents of path, returning entries sorted with
// directories first and then alphabetically by name within each group.
func (m *Manager) LocalListDir(channelID, path string) ([]SFTPEntry, error) {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return nil, err
	}

	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("LocalListDir: %w", err)
	}

	entries := make([]SFTPEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		info, err := de.Info()
		if err != nil {
			continue
		}
		entries = append(entries, SFTPEntry{
			Name:    de.Name(),
			Path:    filepath.Join(path, de.Name()),
			IsDir:   de.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
			Mode:    info.Mode().String(),
		})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})

	return entries, nil
}

// LocalMkdir creates path and any missing parents (os.MkdirAll).
func (m *Manager) LocalMkdir(channelID, path string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("LocalMkdir: %w", err)
	}
	return nil
}

// LocalDelete removes path and everything beneath it (os.RemoveAll).
func (m *Manager) LocalDelete(channelID, path string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("LocalDelete: %w", err)
	}
	return nil
}

// LocalRename renames (moves) oldPath to newPath.
func (m *Manager) LocalRename(channelID, oldPath, newPath string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return fmt.Errorf("LocalRename: %w", err)
	}
	return nil
}
