# Connection Layer and Pane Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `sshSession` with a Connection + Channel abstraction, make SFTP a first-class pane type in the split tree, and move port forwards to a connection-scoped popover.

**Architecture:** The backend `session.Manager` splits into connections (SSH transport + ref counting) and channels (terminal, SFTP, port-forward). The frontend pane tree gains a `kind` discriminator on leaves, and the entire `sessionId`-based keying scheme migrates to `connectionId` + `channelId`.

**Tech Stack:** Go (backend session layer), React/TypeScript with Jotai (frontend state), Wails v2 (RPC bindings + events)

**Spec:** `docs/superpowers/specs/2026-03-23-connection-layer-and-pane-types-design.md`

---

## File Map

### Backend — new files
- `internal/session/connection.go` — `Connection` struct, dial logic, ref counting, in-flight dedup, host-key callback
- `internal/session/channel.go` — `Channel` interface, `TerminalChannel`, `SFTPChannel` structs
- `internal/session/transfer.go` — `TransferBetweenHosts` cross-host SFTP streaming

### Backend — major rewrites
- `internal/session/session.go` — `Manager` struct gutted: `sessions` map → `connections` + `channels` maps. `Connect()` becomes connection-level. `SplitSession()` removed (replaced by `OpenTerminal`). Event topics renamed.
- `internal/session/sftp.go` — All SFTP methods re-keyed from `sessionID` to `channelId`, `OpenSFTP` returns `channelId`
- `internal/session/portforward.go` — Re-keyed from `sessionID` to `connectionId`. Port forwards no longer count toward `channelRefs`.
- `app.go` — All Wails-bound methods updated: `ConnectHost` returns `connectionId` + `channelId`, new `OpenTerminal`/`OpenSFTP`/`CloseChannel` bindings, SFTP methods take `channelId`, port forward methods take `connectionId`. `SplitSession` removed.

### Backend — tests
- `internal/session/session_test.go` — Updated for new Manager API
- `internal/session/export_test.go` — Updated for new exported types

### Frontend — modified files
- `frontend/src/store/workspaces.ts` — `LeafNode` → `PaneLeaf` (union of `TerminalLeaf | SFTPLeaf`), `sessionId` → `connectionId` + `channelId`
- `frontend/src/lib/paneTree.ts` — Types updated, `updateLeafBySessionId` → `updateLeafByChannelId`, `leafToSession` removed
- `frontend/src/types/index.ts` — `Session` type removed, `SFTPState`/`PortForwardPanelState` kept
- `frontend/src/store/atoms.ts` — `sessionsAtom` replaced with `channelsAtom`; `sftpStateAtom`/`portForwardsAtom`/`searchAddonsAtom`/`sessionProfileOverridesAtom` rekeyed; `focusedSessionIdAtom` → `focusedChannelIdAtom`; `sessionActivityAtom` → `channelActivityAtom`
- `frontend/src/store/useSessionPanelState.ts` — Rename to `useChannelPanelState.ts`, `sessionId` param → `channelId`
- `frontend/src/store/useAppInit.ts` — Event listeners updated for new event topics (`channel:status`, `connection:status`, `connection:hostkey`, etc.)
- `frontend/src/hooks/useTerminal.ts` — `sessionId` → `channelId`, event topics updated (`channel:output:<channelId>`), Wails RPC calls updated
- `frontend/src/components/terminal/PaneTree.tsx` — Render `TerminalPane` or `SFTPPanel` based on `leaf.kind`
- `frontend/src/components/terminal/PaneHeader.tsx` — Add pane kind icon, "Open Files" split action, port-forward popover trigger
- `frontend/src/components/terminal/TerminalInstance.tsx` — `session` prop → `channelId` prop
- `frontend/src/components/terminal/WorkspaceView.tsx` — Remove SFTP/PF side panels, remove `TerminalSidebar` SFTP/PF toggles, simplify to pane tree + logging sidebar
- `frontend/src/components/terminal/TerminalSidebar.tsx` — Remove SFTP and PF buttons, keep logging + settings only
- `frontend/src/components/sftp/SFTPPanel.tsx` — Props from `sessionId` → `channelId` + `connectionId`, cross-pane drag data includes `channelId`
- `frontend/src/components/portforward/PortForwardsPanel.tsx` — Converted to `PortForwardPopover.tsx`, keyed by `connectionId`
- `frontend/src/components/sidebar/HostListItem.tsx` — Add "Open Files" context menu item + `onOpenFiles` prop
- `frontend/src/components/sessions/TabBar.tsx` — Add pane-kind icon on tabs
- `frontend/src/components/sessions/TabItem.tsx` — Accept and render pane-kind icon

---

## Task 1: Backend — Connection struct and dial logic

**Files:**
- Create: `internal/session/connection.go`
- Modify: `internal/session/session.go`

This task extracts the SSH transport layer into a standalone `Connection` struct with in-flight dedup and connection reuse.

- [ ] **Step 1: Create `connection.go` with Connection struct**

```go
// internal/session/connection.go
package session

import (
	"context"
	"sync"

	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
)

// Connection represents an SSH transport to a single host.
// Multiple channels (terminal, SFTP, port-forward) share one Connection.
type Connection struct {
	id          string
	hostID      string
	jumpHostID  string // empty for direct connections
	hostLabel   string
	client      *goph.Client
	jumpClient  *ssh.Client // non-nil when connected via a jump host
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	channelRefs int // interactive channels only (terminal + SFTP)
}

// connIdentity is the key used for connection reuse and in-flight dedup.
type connIdentity struct {
	hostID     string
	jumpHostID string
}

func (c *Connection) ID() string        { return c.id }
func (c *Connection) HostID() string     { return c.hostID }
func (c *Connection) HostLabel() string  { return c.hostLabel }
func (c *Connection) SSHClient() *ssh.Client { return c.client.Client }

// incrRefs increments the interactive channel ref count.
func (c *Connection) incrRefs() {
	c.mu.Lock()
	c.channelRefs++
	c.mu.Unlock()
}

// decrRefs decrements the interactive channel ref count.
// Returns true if the count hit zero (caller should tear down).
func (c *Connection) decrRefs() bool {
	c.mu.Lock()
	c.channelRefs--
	shouldClose := c.channelRefs <= 0
	c.mu.Unlock()
	return shouldClose
}
```

- [ ] **Step 2: Add pending-connection gate to Manager**

Add to `session.go` (new fields on Manager):

```go
// In Manager struct, replace sessions/clientRefs/jumpRefs with:
connections    map[string]*Connection          // connectionId → Connection
connByIdent   map[connIdentity]*Connection     // for reuse lookups
channels       map[string]Channel              // channelId → Channel
pending        map[connIdentity]chan struct{}   // in-flight connection gate
```

Don't remove the old fields yet — they'll be removed in Task 3 when the old `Connect` is replaced. Also update `NewManager` to initialize the new maps:

```go
connections: make(map[string]*Connection),
connByIdent: make(map[connIdentity]*Connection),
channels:    make(map[string]Channel),
pending:     make(map[connIdentity]chan struct{}),
```

- [ ] **Step 3: Implement `ConnectOrReuse` on Manager**

```go
// ConnectResult is returned by ConnectOrReuse.
type ConnectResult struct {
	ConnectionID string `json:"connectionId"`
	Reused       bool   `json:"reused"`
}
```

The method:
1. Checks `connByIdent` for existing connection → returns it.
2. Checks `pending` for in-flight dial → waits on the channel, then checks `connByIdent` again.
3. Otherwise, adds to `pending`, dials (reusing the existing `resolveAuth` + host-key callback logic from current `Connect`), stores in `connections` + `connByIdent`, removes from `pending`, closes the gate channel.

- [ ] **Step 4: Move `hostKeyCallback` to use `connectionId`**

Update `hostKeyCallback` signature to take `connectionId` instead of `sessionID`. Update `pendingKeys` map key type. Update event emission from `session:hostkey` to `connection:hostkey`.

- [ ] **Step 5: Run `go test ./internal/session/...`**

Expected: existing tests fail (they use old API). That's fine — we fix them in Task 3.

- [ ] **Step 6: Commit**

```bash
git add internal/session/connection.go internal/session/session.go
git commit -m "feat(session): add Connection struct with reuse and in-flight dedup"
```

---

## Task 2: Backend — Channel interface and implementations

**Files:**
- Create: `internal/session/channel.go`
- Modify: `internal/session/sftp.go`

- [ ] **Step 1: Create `channel.go` with Channel interface and TerminalChannel**

```go
// internal/session/channel.go
package session

import (
	"context"
	"io"
	"os"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// ChannelKind identifies the type of channel.
type ChannelKind string

const (
	ChannelTerminal    ChannelKind = "terminal"
	ChannelSFTP        ChannelKind = "sftp"
	ChannelPortForward ChannelKind = "portforward"
)

// Channel is an SSH subsystem opened on a Connection.
type Channel interface {
	ID() string
	Kind() ChannelKind
	ConnectionID() string
	Close() error
}

// TerminalChannel owns an SSH session with PTY.
type TerminalChannel struct {
	id           string
	connectionID string
	sshSess      *ssh.Session
	stdin        io.WriteCloser
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	logFile      *os.File
	logMu        sync.Mutex
	logPath      string
}

func (t *TerminalChannel) ID() string           { return t.id }
func (t *TerminalChannel) Kind() ChannelKind    { return ChannelTerminal }
func (t *TerminalChannel) ConnectionID() string { return t.connectionID }
func (t *TerminalChannel) Close() error         { t.cancel(); t.sshSess.Close(); return nil }

// SFTPChannel owns an SFTP client subsystem.
type SFTPChannel struct {
	id           string
	connectionID string
	client       *sftp.Client
	mu           sync.Mutex
}

func (s *SFTPChannel) ID() string           { return s.id }
func (s *SFTPChannel) Kind() ChannelKind    { return ChannelSFTP }
func (s *SFTPChannel) ConnectionID() string { return s.connectionID }
func (s *SFTPChannel) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil {
		err := s.client.Close()
		s.client = nil
		return err
	}
	return nil
}
```

- [ ] **Step 2: Add `OpenTerminal` to Manager**

This extracts the PTY/shell setup from the current `Connect` method into a standalone method that takes a `connectionId` and returns a `channelId`. It:
1. Looks up the connection.
2. Opens a new `ssh.Session` on `connection.SSHClient()`.
3. Requests PTY, gets stdin/stdout pipes, starts shell.
4. Creates a `TerminalChannel`, stores in `channels` map, increments connection refs.
5. Starts the output reader goroutine (emitting `channel:output:<channelId>`).
6. Emits `channel:status` with kind `"terminal"`.
7. Returns the channelId.

- [ ] **Step 3: Add `OpenSFTPChannel` to Manager**

New method that takes a `connectionId` and returns a `channelId`. It:
1. Looks up the connection.
2. Opens an `sftp.Client` on `connection.SSHClient()`.
3. Creates an `SFTPChannel`, stores in `channels` map, increments connection refs.
4. Emits `channel:status` with kind `"sftp"` and status `"connected"`.
5. Returns the channelId.

- [ ] **Step 4: Add `CloseChannel` to Manager**

Generic method that:
1. Looks up channel by ID.
2. Calls `channel.Close()`.
3. Removes from `channels` map.
4. For interactive channels (terminal, SFTP): decrements connection refs. If refs hit zero, tears down connection (cancel context, close port forwards, close SSH client).
5. Emits `channel:status` with status `"disconnected"`.

- [ ] **Step 5: Commit**

```bash
git add internal/session/channel.go internal/session/session.go internal/session/sftp.go
git commit -m "feat(session): add Channel interface with Terminal and SFTP implementations"
```

---

## Task 3: Backend — Migrate Manager, remove old sshSession, and update app.go

> **Important:** This task updates `internal/session/` AND `app.go` together in one commit so the project compiles at every step. Updating one without the other would break the build.

**Files:**
- Modify: `internal/session/session.go` — remove `sshSession`, `SplitSession`, old `Connect`. Wire `ConnectOrReuse` + `OpenTerminal` as the new flow.
- Modify: `internal/session/sftp.go` — all methods take `channelId` instead of `sessionID`, operate on `SFTPChannel`
- Modify: `internal/session/portforward.go` — all methods take `connectionId` instead of `sessionID`, port forwards stored on `Connection`
- Modify: `internal/session/session_test.go`
- Modify: `internal/session/export_test.go` — update or remove tests referencing `clientRefs`/`incrClientRefs`/`releaseClient`
- Modify: `app.go` — all Wails-bound methods updated simultaneously

- [ ] **Step 1: Remove `sshSession` struct and old `sessions` map from Manager**

Replace with the new `connections`/`connByIdent`/`channels`/`pending` maps (added in Task 1). Remove `clientRefs`/`jumpRefs` and their helper methods (`incrClientRefs`, `releaseClient`).

- [ ] **Step 2: Remove old `Connect` method, rename `ConnectOrReuse` → `Connect`**

The new `Connect` returns `ConnectResult{ConnectionID, Reused}`. Remove `SplitSession` entirely.

- [ ] **Step 3: Update `Write` and `Resize` to use `channelId`**

```go
func (m *Manager) Write(channelId, data string) error {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("channel %s not found", channelId)
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return fmt.Errorf("channel %s is not a terminal", channelId)
	}
	_, err := io.WriteString(tc.stdin, data)
	return err
}
```

Same pattern for `Resize`.

- [ ] **Step 4: Rewrite SFTP methods in `sftp.go`**

All methods (`SFTPListDir`, `SFTPDownload`, `SFTPUpload`, etc.) now take `channelId` as first param, look up `SFTPChannel` from `channels` map, use `sftpCh.client` directly. `OpenSFTP`/`CloseSFTP` are removed (replaced by `OpenSFTPChannel`/`CloseChannel`). Progress events emit on `channel:sftp-progress:<channelId>`.

- [ ] **Step 5: Rewrite port forward methods in `portforward.go`**

Move `portForwards` map and `pfMu` from `sshSession` to `Connection`. Methods take `connectionId`. Port forward channels are NOT added to `channels` map and do NOT count toward `channelRefs` — they're stored directly on the `Connection` and cleaned up when the connection tears down.

- [ ] **Step 6: Update event emissions throughout**

- `session:status` → `channel:status` (payload: `{channelId, connectionId, kind, status, error?}`)
- `session:output:<sessionId>` → `channel:output:<channelId>`
- `sftp:progress:<sessionId>` → `channel:sftp-progress:<channelId>`
- `session:hostkey` → `connection:hostkey` (payload: `{connectionId, fingerprint, isNew, hasChanged}`)
- Add new `connection:status` emission on connection up/down

- [ ] **Step 7: Implement connection death fan-out**

When a connection dies (context canceled, network drop), iterate all channels in `m.channels` that reference that `connectionId` and emit `channel:status` with `status: "disconnected"` for each. Then emit `connection:status` with `status: "disconnected"`. This goes in the teardown path of `CloseChannel` (when refs hit zero) and in the connection's goroutine that watches for context cancellation.

- [ ] **Step 8: Update `Shutdown` to iterate connections instead of sessions**

- [ ] **Step 9: Update logging methods to use channelId**

`StartSessionLog`, `StopSessionLog`, `GetSessionLogPath` — take `channelId`, look up `TerminalChannel`.

- [ ] **Step 10: Update `app.go` — all Wails-bound methods**

This MUST happen in the same commit as the session package changes:

- `ConnectHost` returns `ConnectHostResult{ConnectionID, ChannelID}` — calls `Connect` then `OpenTerminal`
- Add `OpenTerminal(connectionId)`, `OpenSFTPChannel(connectionId)`, `CloseChannel(channelId)`
- Add `ConnectForSFTP(hostID)` — like `ConnectHost` but opens SFTP channel
- Add `TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath)`
- `WriteToSession` → `WriteToChannel(channelId, data)`
- `ResizeSession` → `ResizeChannel(channelId, cols, rows)`
- `DisconnectSession` → removed (use `CloseChannel`)
- Remove `SplitSession`
- `RespondHostKey(connectionId, accepted)` — takes connectionId now
- SFTP methods take `channelId`: `SFTPListDir(channelId, path)`, etc.
- Port forward methods take `connectionId`: `AddPortForward(connectionId, ...)`, etc.
- `QuickConnect` returns `ConnectHostResult`
- `BulkConnectGroup` returns `[]ConnectHostResult`
- Logging methods take `channelId`

- [ ] **Step 11: Update `export_test.go`**

Update or remove tests that reference `clientRefs`, `incrClientRefs`, `releaseClient`. These are gone — replace with tests for connection ref counting via `Connection.incrRefs()`/`decrRefs()`.

- [ ] **Step 12: Update tests in `session_test.go`**

Update to use new API: `Connect` → `OpenTerminal`, assertions on `channelId` instead of `sessionId`.

- [ ] **Step 13: Run `go test ./...`**

Expected: PASS (full project, including `app.go` in `main` package)

- [ ] **Step 14: Commit**

```bash
git add internal/session/ app.go
git commit -m "refactor(session,app): replace sshSession with Connection+Channel model"
```

---

## Task 4: Backend — Cross-host transfer

**Files:**
- Create: `internal/session/transfer.go`

- [ ] **Step 1: Implement `TransferBetweenHosts`**

```go
func (m *Manager) TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath string) error
```

1. Look up both channels, assert they're `*SFTPChannel`.
2. Open reader on `src.client.Open(srcPath)`, get file size from `Stat`.
3. Open writer on `dst.client.Create(dstPath)`.
4. Copy in buffered loop, emitting progress on both `channel:sftp-progress:<srcChannelId>` and `channel:sftp-progress:<dstChannelId>`.
5. On write error: `dst.client.Remove(dstPath)` best-effort cleanup.
6. Use a context derived from both connections' contexts (`context.WithCancel` + goroutine watching both).

- [ ] **Step 2: Run `go test ./...`**

- [ ] **Step 3: Commit**

```bash
git add internal/session/transfer.go
git commit -m "feat(session): add cross-host SFTP transfer"
```

---

## Task 5: Backend — Regenerate Wails bindings

**Files:**
- (Generated) `frontend/wailsjs/go/main/App.js` and types

- [ ] **Step 1: Run `go build ./...` to verify Go compiles**

Expected: PASS

- [ ] **Step 2: Run `wails build` to regenerate frontend TypeScript bindings**

This will regenerate `frontend/wailsjs/go/main/App.js` and associated TypeScript types. The frontend will NOT compile yet (TypeScript consumers still use old binding names). That's expected — fixed in Tasks 6-14.

- [ ] **Step 3: Commit generated bindings**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for Connection+Channel API"
```

---

## Task 6: Frontend — Update types and store

> **Note on frontend compile state:** Tasks 6-13 each modify parts of the frontend. The frontend will NOT compile (`pnpm build`) until Task 14 completes, because type changes cascade through many consumers. Each task's commit represents a coherent unit of work, but `pnpm build` is only expected to pass at Task 14 Step 4. Go backend (`go build ./...`) should remain green throughout.

**Files:**
- Modify: `frontend/src/store/workspaces.ts`
- Modify: `frontend/src/lib/paneTree.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/store/atoms.ts`
- Rename: `frontend/src/store/useSessionPanelState.ts` → `frontend/src/store/useChannelPanelState.ts`

- [ ] **Step 1: Update `workspaces.ts` — replace `LeafNode` with `PaneLeaf`**

```typescript
export type TerminalLeaf = {
  type: 'leaf'
  kind: 'terminal'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
}

export type SFTPLeaf = {
  type: 'leaf'
  kind: 'sftp'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
}

export type PaneLeaf = TerminalLeaf | SFTPLeaf

export type SplitNode = {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  ratio: number
  left: PaneNode
  right: PaneNode
}

export type PaneNode = PaneLeaf | SplitNode
```

Remove the old `LeafNode` export. Update `Workspace` to use `PaneNode`.

- [ ] **Step 2: Update `paneTree.ts`**

- `collectLeaves` return type: `PaneLeaf[]`
- Remove `leafToSession`
- `updateLeafBySessionId` → `updateLeafByChannelId` (match on `channelId`)
- `splitLeaf` — `newLeaf` param type becomes `PaneLeaf`
- `removeLeaf`, `firstLeaf` — return types become `PaneLeaf` / `PaneNode`

- [ ] **Step 3: Update `types/index.ts`**

Remove `Session` interface. Remove `isOpen` field from `SFTPState` (SFTP is now a pane — if the pane exists, it's open). Remove `isOpen` from `PortForwardPanelState` (the popover manages its own open state). Keep the rest of both types.

- [ ] **Step 4: Update `atoms.ts`**

- Remove `sessionsAtom` (derived from workspace leaves via `leafToSession`)
- Add `terminalLeavesAtom` derived atom (collects all terminal leaves from workspaces)
- `sftpStateAtom`: keep, but now keyed by `channelId`
- `portForwardsAtom`: now keyed by `connectionId`
- `searchAddonsAtom`: keyed by `channelId`
- `sessionProfileOverridesAtom` → `channelProfileOverridesAtom`: keyed by `channelId`
- `focusedSessionIdAtom` → `focusedChannelIdAtom`: returns `channelId` of focused leaf
- `sessionActivityAtom` → `channelActivityAtom`: stores `channelId[]`
- `addPortForwardSessionIdAtom` → `addPortForwardConnectionIdAtom`: stores `connectionId | null`
- `activeLogsAtom`: keyed by `channelId`
- `pendingHostKeyAtom`: `sessionId` → `connectionId` in `PendingHostKey` interface

- [ ] **Step 5: Rename `useSessionPanelState.ts` → `useChannelPanelState.ts`**

Rename `sessionId` param to `channelId`. Update all internal references.

- [ ] **Step 6: Run `cd frontend && pnpm build`**

Expected: many type errors from consumers not yet updated. That's expected — we fix them in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/ frontend/src/lib/paneTree.ts frontend/src/types/
git commit -m "refactor(ui): migrate store from sessionId to connectionId+channelId"
```

---

## Task 7: Frontend — Update useAppInit event listeners

**Files:**
- Modify: `frontend/src/store/useAppInit.ts`

- [ ] **Step 1: Update `session:status` listener → `channel:status`**

New event payload: `{ channelId, connectionId, kind, status, error? }`. Update the handler to use `updateLeafByChannelId`. Use `channelId` for all leaf lookups. Use `connectionId` for port-forward cleanup on disconnect.

- [ ] **Step 2: Add `connection:status` listener**

Listen for `connection:status` events. On `disconnected`, iterate all workspace leaves matching the `connectionId` and mark them `disconnected`.

- [ ] **Step 3: Update `session:hostkey` → `connection:hostkey`**

Update `PendingHostKey` to use `connectionId`. Update the listener.

- [ ] **Step 4: Update menu event handlers**

- `requireActiveSession` → `requireActiveChannel`: get focused leaf's `channelId`
- `DisconnectSession(id)` → `CloseChannel(id)`
- `setAddPortForwardSessionId` → `setAddPortForwardConnectionId` (pass `connectionId` from focused leaf)
- Logging methods: pass `channelId`

- [ ] **Step 5: Update Wails RPC imports**

Update imports from `../wailsjs/go/main/App` to use new method names: `CloseChannel`, `WriteToChannel`, `ResizeChannel`, etc.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/useAppInit.ts
git commit -m "refactor(ui): update event listeners for channel/connection model"
```

---

## Task 8: Frontend — Update useTerminal hook

**Files:**
- Modify: `frontend/src/hooks/useTerminal.ts`

- [ ] **Step 1: Rename `sessionId` parameter to `channelId`**

Update all internal uses of `sessionId` → `channelId`.

- [ ] **Step 2: Update event topic**

`session:output:${sessionId}` → `channel:output:${channelId}`

- [ ] **Step 3: Update Wails RPC calls**

- `WriteToSession(sessionId, data)` → `WriteToChannel(channelId, data)`
- `ResizeSession(sessionId, cols, rows)` → `ResizeChannel(channelId, cols, rows)`

- [ ] **Step 4: Update atom references**

- `sessionsAtom` usage for profile resolution: instead of finding `session` by id, derive `hostId` from the leaf passed as context (the caller should pass `hostId` as a prop now, or the hook can accept it as a parameter).
- `searchAddonsAtom` keyed by `channelId` — already updated in atoms
- `sessionActivityAtom` → `channelActivityAtom`
- `sessionProfileOverridesAtom` → `channelProfileOverridesAtom`

- [ ] **Step 5: Update hook signature**

Add `hostId` parameter so the hook can resolve terminal profiles without needing `sessionsAtom`:

```typescript
export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  channelId: string,
  hostId: string,
  isActive: boolean
)
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useTerminal.ts
git commit -m "refactor(ui): update useTerminal hook for channelId"
```

---

## Task 9: Frontend — Update PaneTree to render SFTP panes

**Files:**
- Modify: `frontend/src/components/terminal/PaneTree.tsx`
- Modify: `frontend/src/components/terminal/TerminalInstance.tsx`
- Modify: `frontend/src/components/terminal/PaneHeader.tsx`

- [ ] **Step 1: Update PaneTree leaf rendering**

Replace the single `TerminalInstance` render with a switch on `leaf.kind`:

```tsx
if (leaf.kind === 'sftp') {
  return (
    <div className="group/pane relative h-full w-full" ...>
      <PaneHeader ... kind="sftp" />
      <SFTPPanel channelId={leaf.channelId} connectionId={leaf.connectionId} />
    </div>
  )
}
// Default: terminal
return (
  <div className="group/pane relative h-full w-full" ...>
    <PaneHeader ... kind="terminal" />
    <TerminalInstance channelId={leaf.channelId} hostId={leaf.hostId} isActive={isActive} />
    ...
  </div>
)
```

- [ ] **Step 2: Update TerminalInstance props**

Change from `session: Session` to `channelId: string` + `hostId: string`:

```tsx
interface Props {
  channelId: string
  hostId: string
  isActive: boolean
}

export function TerminalInstance({ channelId, hostId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(containerRef, channelId, hostId, isActive)
  return <div ref={containerRef} className="h-full w-full" />
}
```

- [ ] **Step 3: Update PaneHeader**

Add `kind` prop and "Open Files" split option:

```tsx
interface Props {
  hostLabel: string
  hostColor?: string
  kind: 'terminal' | 'sftp'
  connectionId: string
  onSplitVertical: () => void
  onSplitHorizontal: () => void
  onOpenFiles?: () => void  // only for terminal panes
  onClose: () => void
  canClose: boolean
}
```

Add a folder icon button for "Open Files" (split into SFTP pane). Show a terminal or folder icon next to the host label based on `kind`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/PaneTree.tsx frontend/src/components/terminal/TerminalInstance.tsx frontend/src/components/terminal/PaneHeader.tsx
git commit -m "feat(ui): render SFTP panes in split tree"
```

---

## Task 10: Frontend — Update WorkspaceView (remove side panels)

**Files:**
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`
- Modify: `frontend/src/components/terminal/TerminalSidebar.tsx`

- [ ] **Step 1: Remove SFTP and port-forward side panels from WorkspaceView**

Remove the `PanelDescriptor[]` array, the `ResizablePanelGroup` wrapping panels, the `toggleSFTP`/`togglePortForwards` functions, and all references to `sftpStateAtom`/`portForwardsAtom`.

The workspace now renders just:
```tsx
<div className="absolute inset-0 flex">
  <div className="h-full min-w-0 flex-1 flex flex-col overflow-hidden">
    <PaneTree ... />
    {isWorkspaceActive && searchOpen && focusedChannelId && (
      <TerminalSearch channelId={focusedChannelId} onClose={() => setSearchOpen(false)} />
    )}
  </div>
  {isWorkspaceActive && focusedChannelId && (
    <TerminalSidebar
      loggingActive={activeLogs.has(focusedChannelId)}
      logPath={activeLogs.get(focusedChannelId)}
      onToggleLogging={() => toggleLogging(focusedChannelId)}
      onViewLogs={() => setLogViewerOpen(true)}
    />
  )}
</div>
```

- [ ] **Step 2: Add split handlers for SFTP panes**

Add `handleOpenFiles` callback that calls `OpenSFTPChannel(connectionId)` on the backend, then inserts a new `SFTPLeaf` via `splitLeaf`. Pass this down to `PaneTree`.

- [ ] **Step 3: Simplify TerminalSidebar**

Remove SFTP and port-forward toggle buttons. Keep only:
- Terminal settings
- Logging toggle + view logs

Update props interface to remove `sftpOpen`, `pfOpen`, `onToggleSFTP`, `onTogglePF`.

- [ ] **Step 4: Update logging to use `channelId`**

`toggleLogging` function: replace `sessionId` with `channelId` in all `StartSessionLog`/`StopSessionLog` calls.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/terminal/WorkspaceView.tsx frontend/src/components/terminal/TerminalSidebar.tsx
git commit -m "refactor(ui): remove SFTP/PF side panels from WorkspaceView"
```

---

## Task 11: Frontend — Update SFTPPanel for pane-tree usage

**Files:**
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx`

- [ ] **Step 1: Update props from `sessionId` to `channelId` + `connectionId`**

```tsx
interface Props {
  channelId: string
  connectionId: string
}
```

- [ ] **Step 2: Update all Wails RPC calls**

All calls (`SFTPListDir`, `SFTPDownload`, `SFTPUpload`, etc.) pass `channelId` instead of `sessionId`.

- [ ] **Step 3: Update `useChannelPanelState` usage**

Replace `useSessionPanelState(sftpStateAtom, sessionId, ...)` with `useChannelPanelState(sftpStateAtom, channelId, ...)`.

- [ ] **Step 4: Update event topics**

`sftp:progress:${sessionId}` → `channel:sftp-progress:${channelId}`

- [ ] **Step 5: Update drag data for cross-pane transfer**

Extend the `application/x-shsh-sftp` drag data to include `channelId`:

```tsx
e.dataTransfer.setData('application/x-shsh-sftp', JSON.stringify({
  path: entry.path,
  channelId: channelId,
}))
```

On drop in a different SFTP pane, detect if source `channelId` differs from this pane's `channelId`. If so, call `TransferBetweenHosts(srcChannelId, srcPath, channelId, dstPath)`.

- [ ] **Step 6: Remove `PanelHeader` import**

`SFTPPanel` currently imports `PanelHeader` from `../terminal/PanelHeader`. Since SFTP is now a pane in the tree with its own `PaneHeader`, remove this import and the `<PanelHeader>` usage in the JSX. The pane header is rendered by `PaneTree`, not by `SFTPPanel` itself.

- [ ] **Step 7: Remove mount-time `OpenSFTP`/`CloseSFTP` calls**

The SFTP channel is already opened before the pane is created. Remove the `useEffect` that calls `OpenSFTP` on mount and `CloseSFTP` on unmount — the channel lifecycle is managed by `WorkspaceView` via `OpenSFTPChannel`/`CloseChannel`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/sftp/SFTPPanel.tsx
git commit -m "refactor(ui): update SFTPPanel for channelId props and cross-pane transfer"
```

---

## Task 12: Frontend — Port forward popover

**Files:**
- Modify: `frontend/src/components/portforward/PortForwardsPanel.tsx` → rename to `PortForwardPopover.tsx`
- Modify: `frontend/src/components/terminal/PaneHeader.tsx`
- Modify: `frontend/src/components/modals/AddPortForwardModal.tsx`

- [ ] **Step 1: Convert PortForwardsPanel to PortForwardPopover**

Rename the file. Wrap the content in a `Popover` from shadcn. Props change from `{ sessionId }` to `{ connectionId }`. RPC calls use `connectionId`: `ListPortForwards(connectionId)`, `RemovePortForward(connectionId, forwardId)`.

- [ ] **Step 2: Add popover trigger to PaneHeader**

Add a `Network` icon button to `PaneHeader` that opens the `PortForwardPopover`. Show a badge dot when the connection has active forwards. The popover is only shown on terminal and SFTP panes.

- [ ] **Step 3: Update AddPortForwardModal**

Change `addPortForwardSessionIdAtom` → `addPortForwardConnectionIdAtom`. The modal passes `connectionId` to `AddPortForward(connectionId, ...)`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/portforward/ frontend/src/components/terminal/PaneHeader.tsx frontend/src/components/modals/AddPortForwardModal.tsx
git commit -m "feat(ui): port forward popover on pane header"
```

---

## Task 13: Frontend — Sidebar "Open Files" and workspace labels

**Files:**
- Modify: `frontend/src/components/sidebar/HostListItem.tsx`
- Modify: `frontend/src/components/sidebar/HostList.tsx` (or wherever `onConnect` is wired)
- Modify: `frontend/src/components/sessions/TabBar.tsx`
- Modify: `frontend/src/components/sessions/TabItem.tsx`

- [ ] **Step 1: Add "Open Files" to HostListItem context menu**

Add an `onOpenFiles` prop. In both the `ContextMenu` and `DropdownMenu`, add an "Open Files" item that calls `onOpenFiles()`.

- [ ] **Step 2: Wire `onOpenFiles` in HostList**

The handler calls `ConnectForSFTP(hostId)` on the backend, creates a new workspace with a single `SFTPLeaf`, sets it as active.

- [ ] **Step 3: Update workspace label logic**

In `TabBar`/`TabItem`, derive the tab label:
- If all leaves are SFTP: `"{hostLabel} (Files)"`
- Otherwise: `"{hostLabel}"`

Add a subtle icon (terminal or folder) to the tab based on the dominant pane kind.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/ frontend/src/components/sessions/
git commit -m "feat(ui): sidebar 'Open Files' action and workspace tab icons"
```

---

## Task 14: Frontend — Update remaining consumers

**Files:**
- Modify: `frontend/src/components/terminal/TerminalSearch.tsx` — `sessionId` → `channelId`
- Modify: `frontend/src/components/sessions/CloseConfirmDialog.tsx` — if it references sessionId
- Modify: `frontend/src/components/modals/HostKeyDialog.tsx` — `sessionId` → `connectionId`
- Modify: `frontend/src/components/terminal/TerminalSettings.tsx` — if it references sessionId
- Modify: `frontend/src/components/layout/MainArea.tsx` — if it references sessions

- [ ] **Step 1: Update TerminalSearch**

Props: `sessionId` → `channelId`. Use `searchAddonsAtom` with `channelId` key.

- [ ] **Step 2: Update HostKeyDialog**

Use `connectionId` from `pendingHostKeyAtom`. Call `RespondHostKey(connectionId, accepted)`.

- [ ] **Step 3: Delete dead code `TerminalPane.tsx`**

`frontend/src/components/terminal/TerminalPane.tsx` is the old pre-workspace view, superseded by `WorkspaceView.tsx`. It references `sessionsAtom`, `SFTPPanel`, etc. Delete it.

- [ ] **Step 4: Grep for remaining `sessionId` references**

Run: `grep -r "sessionId\|session_id\|SessionID\|sessionID" frontend/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v wailsjs`

Fix any remaining references.

- [ ] **Step 5: Run `cd frontend && pnpm build`**

Expected: PASS (no type errors)

- [ ] **Step 6: Run `cd frontend && pnpm lint`**

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "refactor(ui): fix remaining sessionId references"
```

---

## Task 15: Integration — Regenerate bindings and full build

**Files:**
- (Generated) `frontend/wailsjs/go/main/App.js` and types

- [ ] **Step 1: Run `wails build`**

This regenerates the Wails TypeScript bindings and does a full production build of both Go and frontend.

Expected: PASS

- [ ] **Step 2: Run `go test ./...`**

Expected: PASS

- [ ] **Step 3: Run `cd frontend && pnpm build && pnpm lint && pnpm format:check`**

Expected: All PASS

- [ ] **Step 4: Manual smoke test**

Run `wails dev` and verify:
1. Connect to a host → terminal pane opens
2. Split terminal (Cmd+D) → new terminal pane on same connection
3. "Open Files" from pane header → SFTP pane opens in split
4. "Open Files" from sidebar context menu → new SFTP-only workspace
5. Port forward popover works from pane header
6. Close all panes in a workspace → workspace removed
7. Cross-host drag between two SFTP panes (if two hosts available)

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "fix: integration fixups after Connection+Channel refactor"
```
