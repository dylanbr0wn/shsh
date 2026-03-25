# Universal Panes & Workspace Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local file browser panes, universal drag-and-drop transfers between any pane combination, named multi-host workspaces, and saveable workspace templates.

**Architecture:** Channel-first approach — local filesystem becomes a virtual channel (`LocalFSChannel`) in the Go backend so every pane has a channelId. Transfers are always channel-to-channel. Workspaces gain identity (name, connection dots) and can be saved/restored as templates via a new store table.

**Tech Stack:** Go (backend channels, local FS ops, store), React/TypeScript (pane tree, drag-drop, workspace UI), Jotai (state), shadcn (UI components), SQLite (template persistence)

**Spec:** `docs/superpowers/specs/2026-03-24-universal-panes-and-workspaces-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `internal/session/localfs.go` | `LocalFSChannel` struct, local FS operations (list, mkdir, delete, rename, stat, read/write for transfers) |
| `frontend/src/components/localfs/LocalFSPanel.tsx` | Local file browser component (mirrors SFTPPanel but for local filesystem) |
| `frontend/src/components/workspace/WorkspaceTabBar.tsx` | Workspace tab bar with named tabs, connection dots, context menu, "+" button |
| `frontend/src/components/workspace/AddPaneMenu.tsx` | Menu for adding panes (local files, terminal, SFTP with host picker) |
| `frontend/src/components/workspace/SaveTemplateDialog.tsx` | Dialog for naming and saving a workspace as a template |

### Modified Files

| File | Changes |
|------|---------|
| `internal/session/channel.go:16-22` | Add `ChannelLocalFS` constant, update `Channel` interface if needed |
| `internal/session/channel.go:219-252` | `CloseChannel` — guard for local virtual connection (skip teardown) |
| `internal/session/channel.go:255-285` | `teardownConnection` — early return when `conn.id == "local"` |
| `internal/session/session.go:70-82` | No struct changes needed — `channels` map already holds `Channel` interface |
| `internal/session/transfer.go:14-135` | Rename to `TransferBetweenChannels`, add local FS read/write branches |
| `internal/store/store.go` | Add workspace template table migration, CRUD methods |
| `app.go` | Add `OpenLocalFSChannel`, `LocalListDir`, `LocalMkdir`, `LocalDelete`, `LocalRename`, template CRUD, rename `TransferBetweenHosts` |
| `frontend/src/store/workspaces.ts:4-51` | Add `LocalFSLeaf` type, update `PaneLeaf` union, add `name` and `savedTemplateId` to `Workspace` |
| `frontend/src/lib/paneTree.ts` | No changes needed — utilities work on `PaneNode` generically |
| `frontend/src/components/terminal/PaneTree.tsx:21-113` | Add `LocalFSPanel` rendering branch for `kind === 'local'` |
| `frontend/src/components/sftp/SFTPPanel.tsx:274-304` | Rename drag dataTransfer type from `application/x-shsh-sftp` to `application/x-shsh-transfer` |
| `frontend/src/components/terminal/WorkspaceView.tsx:23-223` | Add "open local files" action, wire up add-pane menu |
| `frontend/src/store/useAppInit.ts:80-150` | Handle `channel:status` for local channels, rename progress event |
| `frontend/src/types/index.ts` | Add `WorkspaceTemplate`, `TemplateNode`, `TemplateLeaf` types |

---

## Task 1: LocalFSChannel & Virtual Connection (Backend)

**Files:**
- Create: `internal/session/localfs.go`
- Modify: `internal/session/channel.go:16-22` (add constant)
- Modify: `internal/session/channel.go:255-285` (teardown guard)
- Test: `internal/session/localfs_test.go`

- [ ] **Step 1: Write test for OpenLocalFSChannel**

Create `internal/session/localfs_test.go`:

```go
package session

import (
	"context"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubEmitter struct{}

func (s *stubEmitter) Emit(topic string, data any) {}

func TestOpenLocalFSChannel(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})

	channelID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)
	assert.NotEmpty(t, channelID)

	ch, ok := m.channels[channelID]
	require.True(t, ok)
	assert.Equal(t, ChannelLocalFS, ch.Kind())
	assert.Equal(t, "local", ch.ConnectionID())

	// Virtual connection should exist
	conn, ok := m.connections["local"]
	require.True(t, ok)
	assert.Equal(t, 1, conn.channelRefs)
}

func TestOpenMultipleLocalFSChannels(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})

	ch1, err := m.OpenLocalFSChannel()
	require.NoError(t, err)
	ch2, err := m.OpenLocalFSChannel()
	require.NoError(t, err)
	assert.NotEqual(t, ch1, ch2)

	conn := m.connections["local"]
	assert.Equal(t, 2, conn.channelRefs)
}

func TestCloseLocalFSChannel(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})

	chID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	err = m.CloseChannel(chID)
	require.NoError(t, err)

	// Channel removed but virtual connection persists
	_, ok := m.channels[chID]
	assert.False(t, ok)
	_, ok = m.connections["local"]
	assert.True(t, ok, "virtual connection should persist after last channel closes")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/session/ -run TestOpenLocalFSChannel -v`
Expected: FAIL — `ChannelLocalFS` and `OpenLocalFSChannel` not defined

- [ ] **Step 3: Add ChannelLocalFS constant**

In `internal/session/channel.go`, add to the const block at lines 19-21:

```go
const (
	ChannelTerminal ChannelKind = "terminal"
	ChannelSFTP     ChannelKind = "sftp"
	ChannelLocalFS  ChannelKind = "local"
)
```

- [ ] **Step 4: Implement LocalFSChannel and OpenLocalFSChannel**

Create `internal/session/localfs.go`:

```go
package session

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/google/uuid"
)

// LocalFSChannel implements Channel for the local filesystem.
type LocalFSChannel struct {
	id string
}

func (c *LocalFSChannel) ID() string           { return c.id }
func (c *LocalFSChannel) Kind() ChannelKind    { return ChannelLocalFS }
func (c *LocalFSChannel) ConnectionID() string { return "local" }
func (c *LocalFSChannel) Close() error         { return nil }

const localConnectionID = "local"

// ensureLocalConnection lazily creates the singleton virtual connection.
func (m *Manager) ensureLocalConnection() *Connection {
	if conn, ok := m.connections[localConnectionID]; ok {
		return conn
	}
	conn := &Connection{
		id:           localConnectionID,
		hostID:       localConnectionID,
		hostLabel:    "Local",
		ctx:          m.ctx,
		cancel:       func() {}, // no-op — never torn down
		portForwards: make(map[string]*portForward),
	}
	m.connections[localConnectionID] = conn
	ident := connIdentity{hostID: localConnectionID}
	m.connByIdent[ident] = conn
	return conn
}

// OpenLocalFSChannel creates a new local filesystem channel.
func (m *Manager) OpenLocalFSChannel() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	conn := m.ensureLocalConnection()
	ch := &LocalFSChannel{id: uuid.New().String()}
	m.channels[ch.id] = ch
	conn.incrRefs()

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    ch.id,
		ConnectionID: localConnectionID,
		Kind:         ChannelLocalFS,
		Status:       StatusConnected,
	})

	return ch.id, nil
}

// getLocalFSChannel retrieves a LocalFSChannel by ID.
func (m *Manager) getLocalFSChannel(channelID string) (*LocalFSChannel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch, ok := m.channels[channelID]
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelID)
	}
	lfs, ok := ch.(*LocalFSChannel)
	if !ok {
		return nil, fmt.Errorf("channel %s is not a local FS channel", channelID)
	}
	return lfs, nil
}
```

- [ ] **Step 5: Add teardown guard for virtual connection**

In `internal/session/channel.go`, at the top of `teardownConnection` (line 255), add:

```go
func (m *Manager) teardownConnection(conn *Connection) {
	if conn.id == localConnectionID {
		return
	}
	// ... existing teardown logic
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go test ./internal/session/ -run TestOpenLocalFSChannel -v && go test ./internal/session/ -run TestOpenMultipleLocalFSChannels -v && go test ./internal/session/ -run TestCloseLocalFSChannel -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add internal/session/localfs.go internal/session/localfs_test.go internal/session/channel.go
git commit -m "feat(session): add LocalFSChannel and virtual connection

Introduces ChannelLocalFS kind, LocalFSChannel struct implementing
the Channel interface, and a singleton virtual connection for local
filesystem panes. The virtual connection persists for the app's
lifetime and is never torn down."
```

---

## Task 2: Local FS Operations (Backend)

**Files:**
- Modify: `internal/session/localfs.go`
- Test: `internal/session/localfs_test.go`

- [ ] **Step 1: Write tests for LocalListDir**

Append to `internal/session/localfs_test.go`:

```go
func TestLocalListDir(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})
	chID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	tmpDir := t.TempDir()
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("hello"), 0644)
	os.Mkdir(filepath.Join(tmpDir, "subdir"), 0755)

	entries, err := m.LocalListDir(chID, tmpDir)
	require.NoError(t, err)
	assert.Len(t, entries, 2)
	// Directories sort first
	assert.True(t, entries[0].IsDir)
	assert.Equal(t, "subdir", entries[0].Name)
	assert.Equal(t, "file.txt", entries[1].Name)
}

func TestLocalMkdir(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})
	chID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	tmpDir := t.TempDir()
	newDir := filepath.Join(tmpDir, "newdir")

	err = m.LocalMkdir(chID, newDir)
	require.NoError(t, err)

	info, err := os.Stat(newDir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestLocalDelete(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})
	chID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	tmpDir := t.TempDir()
	f := filepath.Join(tmpDir, "file.txt")
	os.WriteFile(f, []byte("hello"), 0644)

	err = m.LocalDelete(chID, f)
	require.NoError(t, err)

	_, err = os.Stat(f)
	assert.True(t, os.IsNotExist(err))
}

func TestLocalRename(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})
	chID, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	tmpDir := t.TempDir()
	oldPath := filepath.Join(tmpDir, "old.txt")
	newPath := filepath.Join(tmpDir, "new.txt")
	os.WriteFile(oldPath, []byte("hello"), 0644)

	err = m.LocalRename(chID, oldPath, newPath)
	require.NoError(t, err)

	_, err = os.Stat(oldPath)
	assert.True(t, os.IsNotExist(err))
	_, err = os.Stat(newPath)
	assert.NoError(t, err)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/session/ -run TestLocalListDir -v`
Expected: FAIL — `LocalListDir` not defined

- [ ] **Step 3: Implement local FS operations**

Append to `internal/session/localfs.go`:

```go
// LocalListDir lists directory contents on the local filesystem.
func (m *Manager) LocalListDir(channelID string, path string) ([]SFTPEntry, error) {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return nil, err
	}

	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
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

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})

	return entries, nil
}

// LocalMkdir creates a directory on the local filesystem.
func (m *Manager) LocalMkdir(channelID string, path string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	return os.MkdirAll(path, 0755)
}

// LocalDelete removes a file or directory on the local filesystem.
func (m *Manager) LocalDelete(channelID string, path string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	return os.RemoveAll(path)
}

// LocalRename renames a file or directory on the local filesystem.
func (m *Manager) LocalRename(channelID string, oldPath string, newPath string) error {
	if _, err := m.getLocalFSChannel(channelID); err != nil {
		return err
	}
	return os.Rename(oldPath, newPath)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/session/ -run "TestLocal" -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add internal/session/localfs.go internal/session/localfs_test.go
git commit -m "feat(session): add local filesystem operations

LocalListDir, LocalMkdir, LocalDelete, LocalRename — mirror the SFTP
method signatures so the frontend can call them uniformly."
```

---

## Task 3: Unified TransferBetweenChannels (Backend)

**Files:**
- Modify: `internal/session/transfer.go:14-135`
- Test: `internal/session/transfer_test.go` (create)

- [ ] **Step 1: Write test for local-to-local transfer**

Create `internal/session/transfer_test.go`:

```go
package session

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTransferBetweenChannels_LocalToLocal(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})

	srcCh, err := m.OpenLocalFSChannel()
	require.NoError(t, err)
	dstCh, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	srcDir := t.TempDir()
	dstDir := t.TempDir()

	content := []byte("transfer test content")
	srcFile := filepath.Join(srcDir, "test.txt")
	os.WriteFile(srcFile, content, 0644)

	dstFile := filepath.Join(dstDir, "test.txt")

	err = m.TransferBetweenChannels(srcCh, srcFile, dstCh, dstFile)
	require.NoError(t, err)

	got, err := os.ReadFile(dstFile)
	require.NoError(t, err)
	assert.Equal(t, content, got)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/session/ -run TestTransferBetweenChannels_LocalToLocal -v`
Expected: FAIL — `TransferBetweenChannels` not defined

- [ ] **Step 3: Refactor transfer.go to support channel-agnostic transfers**

Replace the contents of `internal/session/transfer.go` with:

```go
package session

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const transferChunkSize = 32 * 1024 // 32KB

// channelReader opens a file for reading from any channel type.
func (m *Manager) channelReader(channelID string, path string) (io.ReadCloser, int64, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, 0, fmt.Errorf("channel %s not found", channelID)
	}

	switch ch.Kind() {
	case ChannelSFTP:
		sftp, err := m.getSFTPChannel(channelID)
		if err != nil {
			return nil, 0, err
		}
		sftp.mu.Lock()
		defer sftp.mu.Unlock()
		info, err := sftp.client.Stat(path)
		if err != nil {
			return nil, 0, fmt.Errorf("stat source: %w", err)
		}
		f, err := sftp.client.Open(path)
		if err != nil {
			return nil, 0, fmt.Errorf("open source: %w", err)
		}
		return f, info.Size(), nil

	case ChannelLocalFS:
		info, err := os.Stat(path)
		if err != nil {
			return nil, 0, fmt.Errorf("stat source: %w", err)
		}
		f, err := os.Open(path)
		if err != nil {
			return nil, 0, fmt.Errorf("open source: %w", err)
		}
		return f, info.Size(), nil

	default:
		return nil, 0, fmt.Errorf("channel %s (kind %s) does not support file reads", channelID, ch.Kind())
	}
}

// channelWriter opens a file for writing on any channel type.
func (m *Manager) channelWriter(channelID string, path string) (io.WriteCloser, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelID)
	}

	switch ch.Kind() {
	case ChannelSFTP:
		sftp, err := m.getSFTPChannel(channelID)
		if err != nil {
			return nil, err
		}
		sftp.mu.Lock()
		defer sftp.mu.Unlock()
		f, err := sftp.client.Create(path)
		if err != nil {
			return nil, fmt.Errorf("create dest: %w", err)
		}
		return f, nil

	case ChannelLocalFS:
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return nil, fmt.Errorf("mkdir dest parent: %w", err)
		}
		f, err := os.Create(path)
		if err != nil {
			return nil, fmt.Errorf("create dest: %w", err)
		}
		return f, nil

	default:
		return nil, fmt.Errorf("channel %s (kind %s) does not support file writes", channelID, ch.Kind())
	}
}

// combinedContext returns a context that cancels when either connection's context is done.
func (m *Manager) combinedContext(srcChannelID, dstChannelID string) (context.Context, context.CancelFunc) {
	m.mu.Lock()
	srcCh := m.channels[srcChannelID]
	dstCh := m.channels[dstChannelID]
	m.mu.Unlock()

	srcConn := m.connections[srcCh.ConnectionID()]
	dstConn := m.connections[dstCh.ConnectionID()]

	ctx, cancel := context.WithCancel(m.ctx)
	go func() {
		select {
		case <-srcConn.ctx.Done():
			cancel()
		case <-dstConn.ctx.Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}

// TransferBetweenChannels streams a file from one channel to another.
// Works for any combination of SFTP and LocalFS channels.
func (m *Manager) TransferBetweenChannels(srcChannelID, srcPath, dstChannelID, dstPath string) error {
	ctx, cancel := m.combinedContext(srcChannelID, dstChannelID)
	defer cancel()

	reader, total, err := m.channelReader(srcChannelID, srcPath)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer reader.Close()

	writer, err := m.channelWriter(dstChannelID, dstPath)
	if err != nil {
		return fmt.Errorf("open dest: %w", err)
	}

	buf := make([]byte, transferChunkSize)
	var transferred int64
	cleanupDst := true

	defer func() {
		writer.Close()
		if cleanupDst {
			// Best-effort cleanup on failure
			m.mu.Lock()
			ch, ok := m.channels[dstChannelID]
			m.mu.Unlock()
			if ok {
				switch ch.Kind() {
				case ChannelSFTP:
					if sftp, err := m.getSFTPChannel(dstChannelID); err == nil {
						sftp.mu.Lock()
						sftp.client.Remove(dstPath)
						sftp.mu.Unlock()
					}
				case ChannelLocalFS:
					os.Remove(dstPath)
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		n, readErr := reader.Read(buf)
		if n > 0 {
			if _, err := writer.Write(buf[:n]); err != nil {
				return fmt.Errorf("write: %w", err)
			}
			transferred += int64(n)
			m.emitter.Emit(
				fmt.Sprintf("channel:transfer-progress:%s", dstChannelID),
				SFTPProgressEvent{
					Path:  filepath.Base(srcPath),
					Bytes: transferred,
					Total: total,
				},
			)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read: %w", readErr)
		}
	}

	cleanupDst = false
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/session/ -run TestTransferBetweenChannels -v`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `go test ./...`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add internal/session/transfer.go internal/session/transfer_test.go
git commit -m "feat(session): unified TransferBetweenChannels

Replaces TransferBetweenHosts with channel-agnostic transfer that
works for any combination of SFTP and LocalFS channels. Uses chunked
streaming with progress events on the destination channel."
```

---

## Task 4: App Layer — Expose Local FS Methods to Frontend

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Add OpenLocalFSChannel method to App**

In `app.go`, after the `OpenSFTPChannel` method (line 525), add:

```go
func (a *App) OpenLocalFSChannel() (string, error) {
	return a.manager.OpenLocalFSChannel()
}
```

- [ ] **Step 2: Add local FS operation methods to App**

After the SFTP methods section (around line 587), add:

```go
func (a *App) LocalListDir(channelID string, path string) ([]session.SFTPEntry, error) {
	return a.manager.LocalListDir(channelID, path)
}

func (a *App) LocalMkdir(channelID string, path string) error {
	return a.manager.LocalMkdir(channelID, path)
}

func (a *App) LocalDelete(channelID string, path string) error {
	return a.manager.LocalDelete(channelID, path)
}

func (a *App) LocalRename(channelID string, oldPath string, newPath string) error {
	return a.manager.LocalRename(channelID, oldPath, newPath)
}
```

- [ ] **Step 3: Rename TransferBetweenHosts to TransferBetweenChannels**

In `app.go`, find the `TransferBetweenHosts` method (line 587) and rename:

```go
func (a *App) TransferBetweenChannels(srcChannelID string, srcPath string, dstChannelID string, dstPath string) error {
	return a.manager.TransferBetweenChannels(srcChannelID, srcPath, dstChannelID, dstPath)
}
```

Keep the old `TransferBetweenHosts` as a deprecated wrapper temporarily until frontend references are updated:

```go
// Deprecated: use TransferBetweenChannels
func (a *App) TransferBetweenHosts(srcChannelID string, srcPath string, dstChannelID string, dstPath string) error {
	return a.manager.TransferBetweenChannels(srcChannelID, srcPath, dstChannelID, dstPath)
}
```

- [ ] **Step 4: Regenerate Wails bindings**

Run: `wails build`
Expected: Build succeeds, new TypeScript bindings generated in `frontend/wailsjs/go/`

- [ ] **Step 5: Verify bindings include new methods**

Check that `frontend/wailsjs/go/main/App.js` contains `OpenLocalFSChannel`, `LocalListDir`, `LocalMkdir`, `LocalDelete`, `LocalRename`, `TransferBetweenChannels`.

- [ ] **Step 6: Commit**

```bash
git add app.go frontend/wailsjs/
git commit -m "feat: expose local FS and unified transfer methods to frontend

Adds OpenLocalFSChannel, LocalListDir, LocalMkdir, LocalDelete,
LocalRename, and TransferBetweenChannels to the App struct."
```

---

## Task 5: Frontend Types — LocalFSLeaf & Workspace Identity

**Files:**
- Modify: `frontend/src/store/workspaces.ts:4-51`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add LocalFSLeaf type**

In `frontend/src/store/workspaces.ts`, after the `SFTPLeaf` type (line 25), add:

```typescript
export type LocalFSLeaf = {
  type: 'leaf';
  kind: 'local';
  paneId: string;
  connectionId: 'local';
  channelId: string;
  hostId: 'local';
  hostLabel: 'Local';
  status: SessionStatus;
};
```

Update the `PaneLeaf` union (line 27):

```typescript
export type PaneLeaf = TerminalLeaf | SFTPLeaf | LocalFSLeaf;
```

- [ ] **Step 2: Add name and savedTemplateId to Workspace**

Update the `Workspace` interface (lines 40-48):

```typescript
export interface Workspace {
  id: string;
  label: string;
  name?: string;
  savedTemplateId?: string;
  layout: PaneNode;
  focusedPaneId: string | null;
}
```

- [ ] **Step 3: Add WorkspaceTemplate types**

In `frontend/src/types/index.ts`, add:

```typescript
export type TemplateTerminalLeaf = {
  kind: 'terminal';
  hostId: string;
};

export type TemplateSFTPLeaf = {
  kind: 'sftp';
  hostId: string;
};

export type TemplateLocalLeaf = {
  kind: 'local';
  defaultPath?: string;
};

export type TemplateLeaf = TemplateTerminalLeaf | TemplateSFTPLeaf | TemplateLocalLeaf;

export type TemplateSplitNode = {
  direction: 'horizontal' | 'vertical';
  ratio: number;
  left: TemplateNode;
  right: TemplateNode;
};

export type TemplateNode = TemplateLeaf | TemplateSplitNode;

export interface WorkspaceTemplate {
  id: string;
  name: string;
  layout: TemplateNode;
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds (no type errors)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/workspaces.ts frontend/src/types/index.ts
git commit -m "feat(ui): add LocalFSLeaf type and workspace template types

Adds LocalFSLeaf to PaneLeaf union, name/savedTemplateId to Workspace,
and WorkspaceTemplate/TemplateNode types for persistence."
```

---

## Task 6: LocalFSPanel Component

**Files:**
- Create: `frontend/src/components/localfs/LocalFSPanel.tsx`
- Modify: `frontend/src/components/terminal/PaneTree.tsx:21-113`

- [ ] **Step 1: Create LocalFSPanel component**

Create `frontend/src/components/localfs/LocalFSPanel.tsx`. This component mirrors `SFTPPanel.tsx` but calls `LocalListDir`, `LocalMkdir`, `LocalDelete`, `LocalRename` instead of the SFTP equivalents. Key differences:

- No `connectionId` prop needed (always `"local"`)
- Uses `LocalListDir` / `LocalMkdir` / `LocalDelete` / `LocalRename` from Wails bindings
- Same drag-and-drop protocol: sets `application/x-shsh-transfer` with `{channelId, paths[]}`
- Accepts drops from SFTP panes (calls `TransferBetweenChannels`)
- Accepts drops from other local panes (calls `TransferBetweenChannels`)
- Accepts OS file drops (calls `TransferBetweenChannels` with source being the dropped file path via a temporary local channel, or simply copies via `LocalRename` if same filesystem — implementer should use `TransferBetweenChannels` for uniformity)
- Default path: `os.homedir()` equivalent — call a new `GetHomeDir()` Go method or use the `~` convention that `LocalListDir` resolves

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import {
  LocalListDir,
  LocalMkdir,
  LocalDelete,
  LocalRename,
  TransferBetweenChannels,
} from '../../wailsjs/go/main/App';
import { sftpStateAtom } from '../store/atoms';
import { useChannelPanelState } from '../../store/useChannelPanelState';
import { SFTPEntry } from '../types';

// Follow the same structure as SFTPPanel.tsx:
// - Breadcrumb navigation
// - File/folder list with icons
// - Right-click context menu (rename, delete, new folder)
// - Drag source: set application/x-shsh-transfer dataTransfer
// - Drop target: accept application/x-shsh-transfer and OS file drops
// - Call TransferBetweenChannels for all cross-pane transfers

// The component reuses sftpStateAtom for its directory state since the
// SFTPState shape (currentPath, entries, isLoading, error) is identical
// for local filesystem browsing.
```

Note: The implementer should closely follow `SFTPPanel.tsx` (lines 68-630) as a template, replacing SFTP-specific calls with local equivalents. The component structure, state management via `useChannelPanelState`, breadcrumb nav, file list rendering, context menu, and drag-drop handling are nearly identical.

- [ ] **Step 2: Add LocalFSPanel rendering to PaneTree**

In `frontend/src/components/terminal/PaneTree.tsx`, in the leaf rendering section (around line 70-90 where it checks `node.kind`), add a branch:

```typescript
{node.kind === 'local' && (
  <LocalFSPanel channelId={node.channelId} />
)}
```

Add the import at the top:

```typescript
import { LocalFSPanel } from '../localfs/LocalFSPanel';
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/localfs/LocalFSPanel.tsx frontend/src/components/terminal/PaneTree.tsx
git commit -m "feat(ui): add LocalFSPanel component and wire into PaneTree

Local file browser pane with breadcrumb navigation, file list,
drag-and-drop transfers, and context menu. Renders alongside
terminal and SFTP panes in the split pane tree."
```

---

## Task 7: Update Drag-and-Drop Protocol

**Files:**
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx:274-304`
- Modify: `frontend/src/components/localfs/LocalFSPanel.tsx`
- Modify: `internal/session/sftp.go` (rename progress event emissions)

- [ ] **Step 1: Rename progress event in sftp.go**

In `internal/session/sftp.go`, find all occurrences of `channel:sftp-progress` and replace with `channel:transfer-progress`. These are in `SFTPDownload` (around line 113), `SFTPDownloadDir` (around lines 186-192), `SFTPUpload` (around line 263), and `SFTPUploadPath` (around line 328). Use find-and-replace — the format string pattern is:

```go
fmt.Sprintf("channel:transfer-progress:%s", channelId)
```

- [ ] **Step 2: Rename dataTransfer type in SFTPPanel**

In `frontend/src/components/sftp/SFTPPanel.tsx`, find all occurrences of `application/x-shsh-sftp` and replace with `application/x-shsh-transfer`:

- Drag start handler (around line 274): `e.dataTransfer.setData('application/x-shsh-transfer', ...)`
- Drop handler (around line 290): `e.dataTransfer.getData('application/x-shsh-transfer')`

- [ ] **Step 3: Update SFTPPanel to call TransferBetweenChannels**

In `SFTPPanel.tsx`, replace calls to `TransferBetweenHosts` with `TransferBetweenChannels`:

```typescript
import { TransferBetweenChannels } from '../../wailsjs/go/main/App';
// ... in drop handler:
await TransferBetweenChannels(srcChannelId, srcPath, channelId, destPath);
```

- [ ] **Step 4: Ensure LocalFSPanel uses the same protocol**

Verify `LocalFSPanel.tsx` uses `application/x-shsh-transfer` for both drag source and drop target (should already be the case from Task 6).

- [ ] **Step 5: Update progress event listener**

In `frontend/src/store/useAppInit.ts`, or wherever `channel:sftp-progress` is listened to, rename to `channel:transfer-progress`. Search for all references to the old event name across the frontend.

- [ ] **Step 6: Verify frontend builds and lint passes**

Run: `cd frontend && pnpm build && pnpm lint`
Expected: Both pass

- [ ] **Step 7: Commit**

```bash
git add internal/session/sftp.go frontend/src/components/sftp/SFTPPanel.tsx frontend/src/components/localfs/LocalFSPanel.tsx frontend/src/store/useAppInit.ts
git commit -m "feat(ui): unify drag-and-drop transfer protocol

Rename application/x-shsh-sftp to application/x-shsh-transfer and
TransferBetweenHosts to TransferBetweenChannels. All pane types
use the same drag-and-drop protocol and transfer API."
```

---

## Task 8: Workspace Identity UI

**Files:**
- Create: `frontend/src/components/workspace/WorkspaceTabBar.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Create WorkspaceTabBar component**

Create `frontend/src/components/workspace/WorkspaceTabBar.tsx`:

This component renders the workspace tab bar with:
- Named tabs (shows `workspace.name ?? workspace.label`)
- Colored dots per unique connection in the workspace (collect leaves, group by `connectionId`, use host color)
- Active tab highlighting
- Right-click context menu: Rename, Save as template, Close, Close all
- "+" button at the end of the tab bar

The implementer should check how the current tab bar is rendered in `WorkspaceView.tsx` and extract/replace that logic into this dedicated component. Use shadcn `ContextMenu` for right-click and shadcn `DropdownMenu` for the "+" button.

- [ ] **Step 2: Add rename functionality**

Double-click on a workspace tab → inline edit field (controlled input, save on Enter/blur, cancel on Escape). Updates `workspace.name` in the `workspacesAtom`.

- [ ] **Step 3: Wire WorkspaceTabBar into WorkspaceView**

In `WorkspaceView.tsx`, replace the existing tab rendering with `<WorkspaceTabBar />`. Pass:
- `workspaces`, `activeWorkspaceId` from atoms
- `onActivate(workspaceId)` — sets `activeWorkspaceIdAtom`
- `onClose(workspaceId)` — closes all panes in workspace
- `onRename(workspaceId, name)` — updates workspace name
- `onSaveTemplate(workspaceId)` — opens save template dialog
- `onNewWorkspace()` — creates empty workspace
- `onOpenTemplate(templateId)` — opens a saved template

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/WorkspaceTabBar.tsx frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): workspace tab bar with names and connection dots

Named workspace tabs with colored connection indicators, rename on
double-click, right-click context menu, and '+' button for new
workspaces and templates."
```

---

## Task 9: Add Pane Menu & Sidebar Drag

**Files:**
- Create: `frontend/src/components/workspace/AddPaneMenu.tsx`
- Modify: `frontend/src/components/terminal/PaneTree.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Create AddPaneMenu component**

Create `frontend/src/components/workspace/AddPaneMenu.tsx`:

A dropdown menu component with sections:
- "Local file browser" — calls `OpenLocalFSChannel()`, creates `LocalFSLeaf`, splits focused pane
- "Terminal → pick host..." — opens host picker, then calls `ConnectHost(hostId)`, creates `TerminalLeaf`
- "SFTP → pick host..." — opens host picker, then calls `ConnectHost(hostId)` + `OpenSFTPChannel(connId)`, creates `SFTPLeaf`

Use shadcn `DropdownMenu` with `DropdownMenuSub` for the host picker submenu. The host list comes from `hostsAtom`.

- [ ] **Step 2: Wire AddPaneMenu into PaneTree header**

In `PaneTree.tsx`, add a "+" button to `PaneHeader` that opens the `AddPaneMenu`. When a pane type is selected, split the current pane with the new leaf.

- [ ] **Step 3: Add sidebar drag-to-workspace support**

In the sidebar host list component (find where hosts are rendered), add `draggable` attribute and set `application/x-shsh-host` dataTransfer with `{hostId}`.

In `PaneTree.tsx`, add a drop handler on each leaf pane that accepts `application/x-shsh-host`:
- Default: create terminal pane for that host
- With Shift held (`e.shiftKey`): create SFTP pane for that host
- Split alongside the drop target pane

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/AddPaneMenu.tsx frontend/src/components/terminal/PaneTree.tsx frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): add-pane menu and sidebar drag-to-workspace

'+' button in pane header to add local/terminal/SFTP panes. Drag
hosts from sidebar into workspace to create panes — default terminal,
shift+drag for SFTP."
```

---

## Task 10: Workspace Template Persistence (Backend)

**Files:**
- Modify: `internal/store/store.go`
- Modify: `app.go`

- [ ] **Step 1: Write test for workspace template CRUD**

Create `internal/store/template_test.go`:

```go
package store

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := New(dbPath)
	require.NoError(t, err)
	return s
}

func TestWorkspaceTemplateCRUD(t *testing.T) {
	s := setupTestStore(t)
	defer s.Close()

	layout := json.RawMessage(`{"kind":"terminal","hostId":"abc"}`)

	// Create
	tmpl, err := s.SaveWorkspaceTemplate(CreateTemplateInput{
		Name:   "Test Template",
		Layout: layout,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, tmpl.ID)
	assert.Equal(t, "Test Template", tmpl.Name)

	// List
	templates, err := s.ListWorkspaceTemplates()
	require.NoError(t, err)
	assert.Len(t, templates, 1)

	// Update
	tmpl.Name = "Updated"
	updated, err := s.SaveWorkspaceTemplate(CreateTemplateInput{
		ID:     tmpl.ID,
		Name:   "Updated",
		Layout: layout,
	})
	require.NoError(t, err)
	assert.Equal(t, "Updated", updated.Name)

	// Delete
	err = s.DeleteWorkspaceTemplate(tmpl.ID)
	require.NoError(t, err)
	templates, err = s.ListWorkspaceTemplates()
	require.NoError(t, err)
	assert.Len(t, templates, 0)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/store/ -run TestWorkspaceTemplateCRUD -v`
Expected: FAIL — types and methods not defined

- [ ] **Step 3: Add workspace template table and types to store**

In `internal/store/store.go`, add to the migration in `New()`:

```sql
CREATE TABLE IF NOT EXISTS workspace_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Add types:

```go
type WorkspaceTemplate struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Layout    json.RawMessage `json:"layout"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type CreateTemplateInput struct {
	ID     string          `json:"id"`     // empty for create, set for update
	Name   string          `json:"name"`
	Layout json.RawMessage `json:"layout"`
}
```

Add CRUD methods:

```go
func (s *Store) SaveWorkspaceTemplate(input CreateTemplateInput) (WorkspaceTemplate, error) {
	// If input.ID is empty, generate new UUID
	// INSERT OR REPLACE
}

func (s *Store) ListWorkspaceTemplates() ([]WorkspaceTemplate, error) {
	// SELECT * FROM workspace_templates ORDER BY updated_at DESC
}

func (s *Store) GetWorkspaceTemplate(id string) (WorkspaceTemplate, error) {
	// SELECT * WHERE id = ?
}

func (s *Store) DeleteWorkspaceTemplate(id string) error {
	// DELETE WHERE id = ?
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/store/ -run TestWorkspaceTemplateCRUD -v`
Expected: PASS

- [ ] **Step 5: Add App methods for templates**

In `app.go`, add:

```go
func (a *App) SaveWorkspaceTemplate(input store.CreateTemplateInput) (store.WorkspaceTemplate, error) {
	return a.store.SaveWorkspaceTemplate(input)
}

func (a *App) ListWorkspaceTemplates() ([]store.WorkspaceTemplate, error) {
	return a.store.ListWorkspaceTemplates()
}

func (a *App) DeleteWorkspaceTemplate(id string) error {
	return a.store.DeleteWorkspaceTemplate(id)
}
```

- [ ] **Step 6: Regenerate Wails bindings**

Run: `wails build`
Expected: Build succeeds, new bindings generated

- [ ] **Step 7: Commit**

```bash
git add internal/store/store.go internal/store/template_test.go app.go frontend/wailsjs/
git commit -m "feat(store): workspace template persistence

SQLite table for workspace templates with CRUD operations.
Templates store layout tree structure with host references
and pane types."
```

---

## Task 11: Save & Open Templates (Frontend)

**Files:**
- Create: `frontend/src/components/workspace/SaveTemplateDialog.tsx`
- Modify: `frontend/src/components/workspace/WorkspaceTabBar.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Create SaveTemplateDialog**

Create `frontend/src/components/workspace/SaveTemplateDialog.tsx`:

A shadcn `Dialog` with:
- Text input for template name (pre-filled with workspace name if set)
- "Save" button that:
  1. Converts the live `PaneNode` tree to a `TemplateNode` tree (replace live channelIds/connectionIds with hostId references, keep split structure and ratios)
  2. Calls `SaveWorkspaceTemplate({ name, layout })`
  3. Sets `workspace.savedTemplateId` to the returned ID
  4. Closes dialog

Helper function `paneNodeToTemplate(node: PaneNode): TemplateNode`:
- For `SplitNode`: recursively convert children, preserve direction and ratio
- For `TerminalLeaf`: `{ kind: 'terminal', hostId: leaf.hostId }`
- For `SFTPLeaf`: `{ kind: 'sftp', hostId: leaf.hostId }`
- For `LocalFSLeaf`: `{ kind: 'local', defaultPath: currentPath }`

- [ ] **Step 2: Add template opening logic to WorkspaceView**

In `WorkspaceView.tsx`, add a function `openTemplate(template: WorkspaceTemplate)`:

1. Parse `template.layout` as `TemplateNode`
2. Walk the tree, for each leaf:
   - `terminal`: call `ConnectHost(hostId)` → get `connectionId`, `channelId` → create `TerminalLeaf`
   - `sftp`: call `ConnectHost(hostId)` → get `connectionId`, then `OpenSFTPChannel(connectionId)` → create `SFTPLeaf`
   - `local`: call `OpenLocalFSChannel()` → create `LocalFSLeaf`
3. All connections fire in parallel (Promise.all or Promise.allSettled)
4. Build live `PaneNode` tree from results
5. Create workspace with `name: template.name`, `savedTemplateId: template.id`
6. Panes that fail to connect show error status (from `Promise.allSettled`)

- [ ] **Step 3: Wire "+" tab menu to load templates**

In `WorkspaceTabBar.tsx`, the "+" dropdown should:
1. On mount, call `ListWorkspaceTemplates()` and cache results
2. Show "New empty workspace" + list of templates
3. Clicking a template calls `openTemplate(template)`

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/SaveTemplateDialog.tsx frontend/src/components/workspace/WorkspaceTabBar.tsx frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): save and open workspace templates

Save current workspace layout as a named template. Open templates
from the '+' tab menu — all connections fire in parallel with
progressive loading."
```

---

## Task 12: Integration Testing & Polish

**Files:**
- Multiple files for fixes

- [ ] **Step 1: Run full backend test suite**

Run: `go test ./...`
Expected: All PASS. Fix any regressions.

- [ ] **Step 2: Run full frontend build and lint**

Run: `cd frontend && pnpm build && pnpm lint && pnpm format:check`
Expected: All pass. Fix any issues.

- [ ] **Step 3: Manual smoke test checklist**

Run `wails dev` and verify:
- [ ] Open a local file browser pane (from "+" menu)
- [ ] Navigate directories in local pane
- [ ] Create/rename/delete files and folders in local pane
- [ ] Drag file from local pane to SFTP pane (upload)
- [ ] Drag file from SFTP pane to local pane (download)
- [ ] Drag file between two SFTP panes on different hosts (relay transfer)
- [ ] Drag file between two local panes (local copy)
- [ ] OS file drop onto SFTP pane still works
- [ ] OS file drop onto local pane works
- [ ] Rename a workspace via double-click on tab
- [ ] Workspace tab shows colored connection dots
- [ ] Save workspace as template
- [ ] Open workspace from template (verify progressive connection)
- [ ] Template with deleted host shows error on that pane
- [ ] "+" button in pane header opens add-pane menu
- [ ] Drag host from sidebar into workspace creates terminal pane
- [ ] Shift+drag host from sidebar creates SFTP pane

- [ ] **Step 4: Fix any issues found during smoke testing**

Address bugs and UI polish issues.

- [ ] **Step 5: Final commit**

```bash
git add internal/session/ internal/store/ app.go frontend/src/
git commit -m "fix(ui): integration fixes for universal panes and workspaces"
```
