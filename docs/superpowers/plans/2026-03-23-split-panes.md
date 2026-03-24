# Split Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat sessions model with a workspace+pane-tree model, enabling horizontal/vertical terminal splits within a tab, each pane backed by a new PTY on the existing SSH connection.

**Architecture:** Tabs become `Workspace` objects containing a binary `PaneNode` tree. Each leaf is a `Session` with its own xterm.js instance and PTY. The existing `sessionsAtom` becomes a derived read-only atom flattened from workspace leaves. Go gains a `SplitSession` method that opens a new SSH session on an existing client.

**Tech Stack:** Go, Wails v2, React, TypeScript, Jotai atoms, xterm.js, shadcn `ResizablePanelGroup`

---

## File Map

**Create:**
- `frontend/src/store/workspaces.ts` — `Workspace`, `PaneNode`, `LeafNode` types + `workspacesAtom`, `activeWorkspaceIdAtom`
- `frontend/src/lib/paneTree.ts` — pure tree helpers: `collectLeaves`, `leafToSession`, `findLeafBySessionId`, `updateLeafBySessionId`, `splitLeaf`, `removeLeaf`, `firstLeaf`, `findSiblingLeaves`
- `frontend/src/components/terminal/WorkspaceView.tsx` — replaces `TerminalPane`; renders the active workspace's pane tree + workspace-level SFTP/PF panel
- `frontend/src/components/terminal/PaneTree.tsx` — recursive renderer: `PaneTree`, `PaneLeaf`, `PaneSplit`
- `frontend/src/components/terminal/PaneHeader.tsx` — per-pane header: host label, split buttons, close button (shown on hover)
- `internal/session/session_test.go` — Go unit tests for `SplitSession`

**Modify:**
- `internal/session/session.go` — add `SplitSessionResult` type + `Manager.SplitSession()` + `ownsClient bool` on `sshSession`
- `app.go` — expose `SplitSession` on `App` struct
- `frontend/src/store/atoms.ts` — remove writable `sessionsAtom` and `activeSessionIdAtom`; add derived `sessionsAtom`
- `frontend/src/store/useAppInit.ts` — remove `pendingConnects`; rewrite `session:status` handler to mutate workspace leaves
- `frontend/src/components/sessions/TabBar.tsx` — map over `workspacesAtom`; rewrite close/disconnect against workspaces
- `frontend/src/components/sidebar/HostList.tsx` — remove `pendingConnects` write; create workspace after `ConnectHost`
- `frontend/src/components/sidebar/HostGroupSection.tsx` — remove `pendingConnects` write; create workspaces after `BulkConnectGroup`
- `frontend/src/components/welcome/WelcomeScreen.tsx` — remove `pendingConnects` write; create workspace after `ConnectHost`
- `frontend/src/components/modals/QuickConnectModal.tsx` — remove `pendingConnects` write; create workspace after `QuickConnect`
- `frontend/src/components/terminal/TerminalPane.tsx` — interim: derive active session from `activeWorkspaceIdAtom` + `focusedPaneId` (replaced entirely in Task 7)
- `frontend/src/components/terminal/TerminalSidebar.tsx` — read `focusedPaneId` instead of `activeSessionId`
- `frontend/src/components/terminal/TerminalSearch.tsx` — read active session from workspace's `focusedPaneId`
- `frontend/src/hooks/useTerminal.ts` — `isActive` now passed from `PaneLeaf` based on `focusedPaneId`
- `frontend/src/components/layout/MainArea.tsx` — swap `TerminalPane` for `WorkspaceView`; check `workspacesAtom` instead of `sessionsAtom` for empty state

---

## ⚠️ Atomic Commit Warning

**Tasks 2–6 must be committed together in a single commit.** After Task 2 alone, the app will not compile (consumers of the removed atoms break). After Tasks 2–5, the app compiles but renders incorrectly (TabBar still uses old API). Only after Task 6 is the app fully functional. Do not commit intermediate states.

---

## Task 1: Go — Add `SplitSession` to the session manager

**Files:**
- Modify: `internal/session/session.go`
- Create: `internal/session/session_test.go`
- Modify: `app.go`

This task is independent and can land before the frontend refactor.

- [ ] **Step 1: Add `ownsClient` field and `SplitSessionResult` type to `session.go`**

In `internal/session/session.go`, add after the `portForward` struct (around line 80):

```go
// SplitSessionResult is returned by SplitSession.
type SplitSessionResult struct {
    SessionID       string `json:"sessionId"`
    ParentSessionID string `json:"parentSessionId"`
}
```

Add `ownsClient bool` to `sshSession` struct (after `logPath string`, around line 99):

```go
ownsClient bool // true = this session owns the SSH client and must close it on disconnect
```

- [ ] **Step 2: Set `ownsClient = true` in `Connect()`**

In `Manager.Connect()`, in the two places where `sess := &sshSession{...}` is constructed (around lines 334 and 259), add `ownsClient: true` to the struct literal.

- [ ] **Step 3: Guard client close in `Connect()` cleanup with `ownsClient`**

Find the cleanup block in `Manager.Connect()` after `<-sessCtx.Done()` (around line 362). Change the client close calls to:

```go
sshSess.Close()
if sess.ownsClient {
    client.Close()
    if sess.jumpClient != nil {
        sess.jumpClient.Close()
    }
}
sess.wg.Wait()
```

- [ ] **Step 4: Implement `Manager.SplitSession()`**

> Note on `start()`: Looking at `session.go`, `start()` launches a goroutine via `s.wg.Go()` and returns immediately. The `StatusConnected` emit after `newSess.start(...)` is therefore correct — it fires before the session ends, not after.

Add this method to `internal/session/session.go`, after `Manager.Disconnect()`:

```go
// SplitSession opens a new PTY on the existing SSH connection for existingSessionID.
// The new session shares the underlying SSH client but has its own shell and PTY.
func (m *Manager) SplitSession(existingSessionID string) (SplitSessionResult, error) {
    m.mu.Lock()
    parent, ok := m.sessions[existingSessionID]
    m.mu.Unlock()
    if !ok {
        return SplitSessionResult{}, fmt.Errorf("session %s not found", existingSessionID)
    }

    // Use the inner *ssh.Client, not the outer goph.Client wrapper.
    // This correctly targets the destination host even for jump-host connections.
    targetClient := parent.client.Client

    sshSess, err := targetClient.NewSession()
    if err != nil {
        return SplitSessionResult{}, fmt.Errorf("failed to create SSH session: %w", err)
    }

    if err := sshSess.RequestPty(m.cfg.SSH.TerminalType, 24, 80, ssh.TerminalModes{}); err != nil {
        sshSess.Close()
        return SplitSessionResult{}, fmt.Errorf("failed to request PTY: %w", err)
    }

    stdin, err := sshSess.StdinPipe()
    if err != nil {
        sshSess.Close()
        return SplitSessionResult{}, fmt.Errorf("failed to get stdin pipe: %w", err)
    }

    stdout, err := sshSess.StdoutPipe()
    if err != nil {
        sshSess.Close()
        return SplitSessionResult{}, fmt.Errorf("failed to get stdout pipe: %w", err)
    }

    if err := sshSess.Shell(); err != nil {
        sshSess.Close()
        return SplitSessionResult{}, fmt.Errorf("failed to start shell: %w", err)
    }

    newID := uuid.New().String()
    sessCtx, cancel := context.WithCancel(context.Background())
    newSess := &sshSession{
        id:           newID,
        hostID:       parent.hostID,
        hostLabel:    parent.hostLabel,
        client:       parent.client,
        sshSess:      sshSess,
        stdin:        stdin,
        ctx:          sessCtx,
        cancel:       cancel,
        portForwards: make(map[string]*portForward),
        ownsClient:   false, // parent owns the client
    }

    m.mu.Lock()
    m.sessions[newID] = newSess
    m.mu.Unlock()

    runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
        SessionID: newID,
        Status:    StatusConnecting,
    })

    // Start the output reader goroutine and cleanup goroutine.
    m.wg.Go(func() {
        newSess.start(m.ctx, stdout)

        runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
            SessionID: newID,
            Status:    StatusConnected,
        })

        <-sessCtx.Done()
        newSess.pfMu.Lock()
        for _, pf := range newSess.portForwards {
            pf.listener.Close()
        }
        newSess.pfMu.Unlock()
        sshSess.Close()
        // Do NOT close parent.client — parent session owns it.
        newSess.wg.Wait()

        m.mu.Lock()
        delete(m.sessions, newID)
        m.mu.Unlock()
    })

    return SplitSessionResult{
        SessionID:       newID,
        ParentSessionID: existingSessionID,
    }, nil
}
```

- [ ] **Step 5: Write the unit test**

Create `internal/session/session_test.go`:

```go
package session_test

import (
    "context"
    "testing"

    "github.com/dylanbr0wn/shsh/internal/config"
    "github.com/dylanbr0wn/shsh/internal/session"
)

func TestSplitSession_UnknownSession(t *testing.T) {
    cfg := config.DefaultConfig()
    m := session.NewManager(context.Background(), cfg)
    _, err := m.SplitSession("nonexistent-session-id")
    if err == nil {
        t.Fatal("expected error for unknown session, got nil")
    }
}
```

- [ ] **Step 6: Run Go tests to verify**

```bash
go test ./...
```

Expected: PASS (all existing tests pass, new test passes)

- [ ] **Step 7: Expose `SplitSession` on the `App` struct in `app.go`**

Find `func (a *App) DisconnectSession` (around line 450) and add after it:

```go
// SplitSession opens a new PTY on the same SSH connection as existingSessionID.
func (a *App) SplitSession(existingSessionID string) (session.SplitSessionResult, error) {
    return a.manager.SplitSession(existingSessionID)
}
```

- [ ] **Step 8: Regenerate Wails bindings**

```bash
wails build
```

Expected: build succeeds; `frontend/wailsjs/go/main/App.js` and `.d.ts` now contain `SplitSession`.

- [ ] **Step 9: Commit**

```bash
git add internal/session/session.go internal/session/session_test.go app.go frontend/wailsjs/
git commit -m "feat(session): add SplitSession — new PTY on existing SSH connection"
```

---

## Task 2: Frontend — New workspace types and atoms

> ⚠️ Do NOT commit after this task. This is part of the atomic batch (Tasks 2–6).

**Files:**
- Create: `frontend/src/store/workspaces.ts`
- Create: `frontend/src/lib/paneTree.ts`
- Modify: `frontend/src/store/atoms.ts`

- [ ] **Step 1: Create `frontend/src/store/workspaces.ts`**

```typescript
import { atom } from 'jotai'
import type { SessionStatus } from '../types'

export type LeafNode = {
  type: 'leaf'
  paneId: string
  sessionId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
  // Set when this pane was created via SplitSession.
  // Points to the sessionId whose SSH client is shared.
  parentSessionId?: string
}

export type SplitNode = {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  // 0–1 proportion given to left/top panel. Starts at 0.5, updated via onLayout.
  ratio: number
  left: PaneNode
  right: PaneNode
}

export type PaneNode = LeafNode | SplitNode

export interface Workspace {
  id: string
  // Derived from first pane's host label on creation.
  label: string
  layout: PaneNode
  // INVARIANT: never null on a rendered workspace.
  // Only null as part of an atomic workspace-removal write.
  focusedPaneId: string | null
}

export const workspacesAtom = atom<Workspace[]>([])
export const activeWorkspaceIdAtom = atom<string | null>(null)
```

- [ ] **Step 2: Create `frontend/src/lib/paneTree.ts`**

```typescript
import type { LeafNode, PaneNode } from '../store/workspaces'
import type { Session } from '../types'

/** Flatten all leaf nodes from a pane tree. */
export function collectLeaves(node: PaneNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.left), ...collectLeaves(node.right)]
}

/** Convert a LeafNode to the Session shape expected by existing consumers. */
export function leafToSession(leaf: LeafNode): Session {
  return {
    id: leaf.sessionId,
    hostId: leaf.hostId,
    hostLabel: leaf.hostLabel,
    status: leaf.status,
    connectedAt: leaf.connectedAt,
  }
}

/** Find a leaf by sessionId. Returns null if not found. */
export function findLeafBySessionId(node: PaneNode, sessionId: string): LeafNode | null {
  if (node.type === 'leaf') return node.sessionId === sessionId ? node : null
  return (
    findLeafBySessionId(node.left, sessionId) ??
    findLeafBySessionId(node.right, sessionId)
  )
}

/** Find a leaf by paneId. Returns null if not found. */
export function findLeafByPaneId(node: PaneNode, paneId: string): LeafNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null
  return (
    findLeafByPaneId(node.left, paneId) ??
    findLeafByPaneId(node.right, paneId)
  )
}

/** Return a new tree with the matching leaf updated by patch. */
export function updateLeafBySessionId(
  node: PaneNode,
  sessionId: string,
  patch: Partial<LeafNode>
): PaneNode {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? { ...node, ...patch } : node
  }
  return {
    ...node,
    left: updateLeafBySessionId(node.left, sessionId, patch),
    right: updateLeafBySessionId(node.right, sessionId, patch),
  }
}

/**
 * Replace the leaf with paneId with a SplitNode containing the old leaf
 * (left/top) and newLeaf (right/bottom).
 */
export function splitLeaf(
  node: PaneNode,
  paneId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: LeafNode
): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return node
    return { type: 'split', direction, ratio: 0.5, left: node, right: newLeaf }
  }
  return {
    ...node,
    left: splitLeaf(node.left, paneId, direction, newLeaf),
    right: splitLeaf(node.right, paneId, direction, newLeaf),
  }
}

/**
 * Remove the leaf with paneId. Returns the sibling when a SplitNode collapses,
 * or null if the removed leaf was the root (last pane in the workspace).
 */
export function removeLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? null : node
  }
  const newLeft = removeLeaf(node.left, paneId)
  if (newLeft !== node.left) {
    return newLeft === null ? node.right : { ...node, left: newLeft }
  }
  const newRight = removeLeaf(node.right, paneId)
  if (newRight !== node.right) {
    return newRight === null ? node.left : { ...node, right: newRight }
  }
  return node
}

/** Return the first (leftmost) leaf in a tree. Used for focus fallback. */
export function firstLeaf(node: PaneNode): LeafNode {
  if (node.type === 'leaf') return node
  return firstLeaf(node.left)
}

/**
 * Find sibling leaves: leaves that share the same SSH client as sessionId.
 * A sibling is any leaf where leaf.sessionId === parentId OR leaf.parentSessionId === parentId
 * (excluding the target itself).
 */
export function findSiblingLeaves(allLeaves: LeafNode[], sessionId: string): LeafNode[] {
  const target = allLeaves.find((l) => l.sessionId === sessionId)
  if (!target) return []
  const parentId = target.parentSessionId ?? target.sessionId
  return allLeaves.filter(
    (l) =>
      l.sessionId !== sessionId &&
      (l.sessionId === parentId || l.parentSessionId === parentId)
  )
}
```

- [ ] **Step 3: Update `frontend/src/store/atoms.ts`**

Remove the following lines:
```typescript
export const sessionsAtom = atom<Session[]>([])
export const activeSessionIdAtom = atom<string | null>(null)
```

Add at the top of the file (after existing imports):
```typescript
import { workspacesAtom } from './workspaces'
import { collectLeaves, leafToSession } from '../lib/paneTree'
```

Add the derived `sessionsAtom` (read-only) in place of the removed writable one:
```typescript
// Derived: flattens all workspace leaf nodes into the Session shape.
// Read-only — mutate workspacesAtom instead.
export const sessionsAtom = atom<Session[]>((get) =>
  get(workspacesAtom).flatMap((w) => collectLeaves(w.layout).map(leafToSession))
)
```

Also export `activeWorkspaceIdAtom` from this file for convenience (re-export from workspaces.ts):
```typescript
export { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
```

Remove the `Session` type import from `../types` in `atoms.ts` if it's no longer used directly (the derived atom still needs it — keep it).

---

## Task 3: Frontend — Rewrite `useAppInit`

> ⚠️ Do NOT commit after this task. This is part of the atomic batch (Tasks 2–6).

**Files:**
- Modify: `frontend/src/store/useAppInit.ts`

- [ ] **Step 1: Remove `pendingConnects` export and update imports**

Remove this line:
```typescript
export const pendingConnects = new Map<string, { hostId: string; hostLabel: string }>()
```

Update imports to add `workspacesAtom`, `activeWorkspaceIdAtom`, and the paneTree helpers:
```typescript
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
} from './workspaces'
import { updateLeafBySessionId, collectLeaves, findSiblingLeaves } from '../lib/paneTree'
```

Remove `sessionsAtom` and `activeSessionIdAtom` from the existing import block.

- [ ] **Step 2: Update the hook's atom bindings**

Replace:
```typescript
const setSessions = useSetAtom(sessionsAtom)
const setActiveSessionId = useSetAtom(activeSessionIdAtom)
const activeSessionId = useAtomValue(activeSessionIdAtom)
const sessions = useAtomValue(sessionsAtom)
```

With:
```typescript
const setWorkspaces = useSetAtom(workspacesAtom)
const workspaces = useAtomValue(workspacesAtom)
```

Add a ref to read current workspaces from event handlers without re-registering:
```typescript
const workspacesRef = useRef(workspaces)
useLayoutEffect(() => { workspacesRef.current = workspaces }, [workspaces])
```

(Add `useLayoutEffect` and `useRef` to the React imports at the top of the file.)

- [ ] **Step 3: Rewrite the `session:status` event handler**

Replace the existing `session:status` `useEffect` (lines 76–143) with:

```typescript
useEffect(() => {
  const cancel = EventsOn(
    'session:status',
    (event: { sessionId: string; status: SessionStatus; error?: string }) => {
      const { sessionId, status } = event

      if (status === 'connecting') return

      if (status === 'connected') {
        // Clear connectingHostIds using the hostId stored in the leaf.
        const allLeaves = workspacesRef.current.flatMap((w) =>
          collectLeaves(w.layout)
        )
        const leaf = allLeaves.find((l) => l.sessionId === sessionId)
        if (leaf) {
          setConnectingIds((prev) => {
            const next = new Set(prev)
            next.delete(leaf.hostId)
            return next
          })
        }
        setWorkspaces((prev) =>
          prev.map((w) => ({
            ...w,
            layout: updateLeafBySessionId(w.layout, sessionId, {
              status: 'connected',
              connectedAt: new Date().toISOString(),
            }),
          }))
        )
        return
      }

      if (status === 'error') {
        const allLeaves = workspacesRef.current.flatMap((w) =>
          collectLeaves(w.layout)
        )
        const leaf = allLeaves.find((l) => l.sessionId === sessionId)
        if (leaf) {
          setConnectingIds((prev) => {
            const next = new Set(prev)
            next.delete(leaf.hostId)
            return next
          })
        }
        setWorkspaces((prev) =>
          prev.map((w) => ({
            ...w,
            layout: updateLeafBySessionId(w.layout, sessionId, { status: 'error' }),
          }))
        )
        toast.error('SSH session error', { description: event.error })
        return
      }

      if (status === 'disconnected') {
        const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
        const siblings = findSiblingLeaves(allLeaves, sessionId)
        const allToDisconnect = [sessionId, ...siblings.map((s) => s.sessionId)]

        setWorkspaces((prev) =>
          prev.map((w) => {
            let layout = w.layout
            for (const id of allToDisconnect) {
              layout = updateLeafBySessionId(layout, id, { status: 'disconnected' })
            }
            return { ...w, layout }
          })
        )

        if (siblings.length > 0) {
          toast.warning('Connection lost — all panes on this host disconnected')
        }

        setPortForwards((prev) => {
          const next = { ...prev }
          for (const id of allToDisconnect) delete next[id]
          return next
        })
      }
    }
  )
  return () => cancel()
}, [setConnectingIds, setWorkspaces, setPortForwards])
```

- [ ] **Step 4: Update the menu event handlers**

The `requireActiveSession` helper (around line 180) uses `sessions` and `activeSessionId`. Replace:

```typescript
function requireActiveSession(action: (sessionId: string) => void) {
  const connected = sessions.find((s) => s.id === activeSessionId && s.status === 'connected')
  if (!connected) {
    toast.error('No active session')
    return
  }
  action(connected.id)
}
```

With a version that reads from workspaces:

```typescript
function requireActiveSession(action: (sessionId: string) => void) {
  const activeId = workspacesRef.current.find(
    (w) => w.id === /* activeWorkspaceId */ undefined // placeholder — see next step
  )
  // Use the ref directly:
  const ws = workspacesRef.current
  // We need activeWorkspaceIdAtom here too — add a ref for it:
  // (see Step 5)
}
```

Actually, add a second ref for `activeWorkspaceId`:

```typescript
const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
const activeWorkspaceIdRef = useRef(activeWorkspaceId)
useLayoutEffect(() => { activeWorkspaceIdRef.current = activeWorkspaceId }, [activeWorkspaceId])
```

Then:

```typescript
function requireActiveSession(action: (sessionId: string) => void) {
  const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceIdRef.current)
  if (!ws || !ws.focusedPaneId) {
    toast.error('No active session')
    return
  }
  const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
  if (!leaf || leaf.status !== 'connected') {
    toast.error('No active session')
    return
  }
  action(leaf.sessionId)
}
```

Also update the `disconnect-all` handler to iterate workspace leaves:

```typescript
const c2 = EventsOn('menu:session:disconnect-all', async () => {
  const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
  const connected = allLeaves.filter((l) => l.status === 'connected')
  if (connected.length === 0) {
    toast.error('No active sessions')
    return
  }
  await Promise.allSettled(connected.map((l) => DisconnectSession(l.sessionId)))
})
```

Remove `activeSessionId` and `sessions` from the `useEffect` dependency arrays for the menu handlers. Replace with `workspaces` (via ref — no dep needed).

---

## Task 4: Frontend — Update connect call sites

> ⚠️ Do NOT commit after this task. This is part of the atomic batch (Tasks 2–6).

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx`
- Modify: `frontend/src/components/sidebar/HostGroupSection.tsx`
- Modify: `frontend/src/components/welcome/WelcomeScreen.tsx`
- Modify: `frontend/src/components/modals/QuickConnectModal.tsx`

All four files currently import `pendingConnects` and write to it after calling `ConnectHost`/`BulkConnectGroup`/`QuickConnect`. The new pattern: immediately create a `LeafNode` + `Workspace` and push to `workspacesAtom` after the RPC call returns.

Add this helper at the top of each file (or extract to a shared util — but since there are only 4 call sites, inline is fine):

```typescript
import { v4 as uuid } from 'uuid' // already available via @xterm packages' deps; or use crypto.randomUUID()
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
import type { Workspace } from '../../store/workspaces'
import { useSetAtom } from 'jotai'
```

> `crypto.randomUUID()` is available in modern browsers/Electron; prefer it over importing uuid.

- [ ] **Step 1: Update `HostList.tsx`**

Remove:
```typescript
import { pendingConnects } from '../../store/useAppInit'
```

Add to atom imports:
```typescript
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
```

Add inside `HostList()`:
```typescript
const setWorkspaces = useSetAtom(workspacesAtom)
const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
```

Replace `handleConnect`:
```typescript
async function handleConnect(hostId: string, hostLabel: string) {
  setConnectingIds((prev) => new Set([...prev, hostId]))
  try {
    const sessionId = await ConnectHost(hostId)
    const paneId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    const workspace: Workspace = {
      id: workspaceId,
      label: hostLabel,
      layout: { type: 'leaf', paneId, sessionId, hostId, hostLabel, status: 'connecting' },
      focusedPaneId: paneId,
    }
    setWorkspaces((prev) => [...prev, workspace])
    setActiveWorkspaceId(workspaceId)
  } catch (err) {
    setConnectingIds((prev) => {
      const next = new Set(prev)
      next.delete(hostId)
      return next
    })
    toast.error('Connection failed', { description: String(err) })
  }
}
```

- [ ] **Step 2: Update `HostGroupSection.tsx`**

Remove the `pendingConnects` import line.

Add workspace atoms import and `useSetAtom` calls (same as HostList step).

Replace `handleBulkConnect`:
```typescript
async function handleBulkConnect() {
  if (hosts.length === 0) return
  setBulkConnecting(true)
  try {
    const results = await BulkConnectGroup(group.id)
    const newWorkspaces: Workspace[] = results
      .map(({ sessionId, hostId }: { sessionId: string; hostId: string }) => {
        const host = hosts.find((h) => h.id === hostId)
        if (!host) return null
        const paneId = crypto.randomUUID()
        return {
          id: crypto.randomUUID(),
          label: host.label,
          layout: { type: 'leaf' as const, paneId, sessionId, hostId, hostLabel: host.label, status: 'connecting' as const },
          focusedPaneId: paneId,
        }
      })
      .filter(Boolean) as Workspace[]
    if (newWorkspaces.length === 0) return
    setWorkspaces((prev) => [...prev, ...newWorkspaces])
    setActiveWorkspaceId(newWorkspaces[0].id)
  } catch (err) {
    toast.error('Bulk connect failed', { description: String(err) })
  } finally {
    setBulkConnecting(false)
  }
}
```

- [ ] **Step 3: Update `WelcomeScreen.tsx`**

Remove `pendingConnects` import.

Add workspace atom imports and setters.

Replace `handleConnect`:
```typescript
async function handleConnect(host: Host) {
  setConnectingIds((prev) => new Set([...prev, host.id]))
  try {
    const sessionId = await ConnectHost(host.id)
    const paneId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    setWorkspaces((prev) => [
      ...prev,
      {
        id: workspaceId,
        label: host.label,
        layout: { type: 'leaf', paneId, sessionId, hostId: host.id, hostLabel: host.label, status: 'connecting' },
        focusedPaneId: paneId,
      },
    ])
    setActiveWorkspaceId(workspaceId)
  } catch (err) {
    setConnectingIds((prev) => {
      const next = new Set(prev)
      next.delete(host.id)
      return next
    })
    toast.error('Connection failed', { description: String(err) })
  }
}
```

- [ ] **Step 4: Update `QuickConnectModal.tsx`**

Remove `pendingConnects` import.

Add workspace atom imports and setters.

Replace the `pendingConnects.set(...)` call in `handleSubmit` with workspace creation:
```typescript
const sessionId = await QuickConnect({ ... })
const paneId = crypto.randomUUID()
const workspaceId = crypto.randomUUID()
const label = `${resolved.username}@${resolved.hostname}`
setWorkspaces((prev) => [
  ...prev,
  {
    id: workspaceId,
    label,
    layout: { type: 'leaf', paneId, sessionId, hostId: sessionId, hostLabel: label, status: 'connecting' },
    focusedPaneId: paneId,
  },
])
setActiveWorkspaceId(workspaceId)
close()
```

> Note: For `QuickConnect`, `hostId` is set to `sessionId` as a placeholder (quick connect has no persistent host record).

---

## Task 5: Frontend — Update atom consumers

> ⚠️ Do NOT commit after this task. This is part of the atomic batch (Tasks 2–6).

**Files:**
- Modify: `frontend/src/components/terminal/TerminalPane.tsx` (interim update)
- Modify: `frontend/src/components/terminal/TerminalSidebar.tsx`
- Modify: `frontend/src/components/terminal/TerminalSearch.tsx`
- Modify: `frontend/src/components/layout/MainArea.tsx`

These files read `activeSessionIdAtom` which no longer exists. Update them to derive the active session from the workspace's `focusedPaneId`.

- [ ] **Step 1: Create a shared derived atom for `focusedSessionId`**

Add to `frontend/src/store/atoms.ts`:

```typescript
// The sessionId of the focused pane in the active workspace.
// Replaces activeSessionIdAtom for components that only need the current session.
export const focusedSessionIdAtom = atom<string | null>((get) => {
  const id = get(activeWorkspaceIdAtom)
  if (!id) return null
  const ws = get(workspacesAtom).find((w) => w.id === id)
  if (!ws || !ws.focusedPaneId) return null
  const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
  return leaf?.sessionId ?? null
})
```

- [ ] **Step 2: Update `TerminalPane.tsx`**

This is an interim update — `TerminalPane` will be replaced by `WorkspaceView` in Task 7, but it must compile now.

Replace:
```typescript
import { sessionsAtom, activeSessionIdAtom, ... } from '../../store/atoms'
```

With:
```typescript
import { sessionsAtom, focusedSessionIdAtom, ... } from '../../store/atoms'
```

Replace `useAtomValue(activeSessionIdAtom)` with `useAtomValue(focusedSessionIdAtom)`. The rest of the component logic is unchanged — `focusedSessionId` is used exactly where `activeSessionId` was.

- [ ] **Step 3: Update `TerminalSearch.tsx`**

Replace `activeSessionIdAtom` import/usage with `focusedSessionIdAtom`. Run a search for `activeSessionIdAtom` in the file to catch all references.

- [ ] **Step 4: Update `TerminalSidebar.tsx`**

Replace `activeSessionIdAtom` import/usage with `focusedSessionIdAtom`.

- [ ] **Step 5: Update `MainArea.tsx`**

`MainArea` currently checks `sessions.length === 0` to show the welcome screen. The derived `sessionsAtom` still works here. No change needed for the sessions check.

However, `MainArea` still imports `sessionsAtom` from atoms — that's fine since it's still exported (as derived). No changes needed.

---

## Task 6: Frontend — Rewrite `TabBar`

> ⚠️ This is the final task in the atomic batch. Commit here covers Tasks 2–6.

**Files:**
- Modify: `frontend/src/components/sessions/TabBar.tsx`

`TabBar` currently reads from `sessionsAtom` (writable) and `activeSessionIdAtom`. Rewrite it to use `workspacesAtom` and `activeWorkspaceIdAtom`.

- [ ] **Step 1: Rewrite `TabBar.tsx`**

Replace the entire file content:

```typescript
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
} from '../../store/workspaces'
import {
  isAddHostOpenAtom,
  closeConfirmPrefAtom,
  hostsAtom,
  sessionActivityAtom,
} from '../../store/atoms'
import { collectLeaves } from '../../lib/paneTree'
import { DisconnectSession } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TabItem } from './TabItem'
import { CloseConfirmDialog } from './CloseConfirmDialog'
import type { Workspace } from '../../store/workspaces'

export function TabBar() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const hosts = useAtomValue(hostsAtom)
  const hostById = useMemo(() => Object.fromEntries(hosts.map((h) => [h.id, h])), [hosts])
  const [sessionActivity, setSessionActivity] = useAtom(sessionActivityAtom)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [pendingCount, setPendingCount] = useState(1)

  function requestClose(action: () => void, count: number) {
    if (closeConfirmPref === false) {
      action()
    } else {
      setPendingAction(() => action)
      setPendingCount(count)
      setDialogOpen(true)
    }
  }

  function handleDialogConfirm(dontAskAgain: boolean) {
    if (dontAskAgain) setCloseConfirmPref(false)
    pendingAction?.()
    setDialogOpen(false)
    setPendingAction(null)
  }

  function handleDialogCancel() {
    setDialogOpen(false)
    setPendingAction(null)
  }

  /** Disconnect all sessions in a workspace and remove it from the list. */
  function closeWorkspace(workspaceId: string) {
    const ws = workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const leaves = collectLeaves(ws.layout)
    leaves.forEach((leaf) => DisconnectSession(leaf.sessionId).catch(() => {}))
    const sessionIds = new Set(leaves.map((l) => l.sessionId))
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.id !== workspaceId)
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspaceId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
    setSessionActivity((prev) => prev.filter((id) => !sessionIds.has(id)))
  }

  function handleClose(workspaceId: string) {
    requestClose(() => closeWorkspace(workspaceId), 1)
  }

  function handleCloseOthers(workspaceId: string) {
    const toClose = workspaces.filter((w) => w.id !== workspaceId).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseToLeft(workspaceId: string) {
    const idx = workspaces.findIndex((w) => w.id === workspaceId)
    const toClose = workspaces.slice(0, idx).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseToRight(workspaceId: string) {
    const idx = workspaces.findIndex((w) => w.id === workspaceId)
    const toClose = workspaces.slice(idx + 1).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseAll() {
    requestClose(() => {
      workspaces.forEach((w) => closeWorkspace(w.id))
    }, workspaces.length)
  }

  // Derive a "session" for TabItem from the first leaf's hostId
  // TabItem currently expects a Session shape; pass a minimal compatible object.
  function workspaceToTabSession(ws: Workspace) {
    const leaves = collectLeaves(ws.layout)
    const primaryLeaf = leaves[0]
    return {
      id: ws.id, // TabItem uses this as key/identity
      hostId: primaryLeaf?.hostId ?? '',
      hostLabel: ws.label,
      status: primaryLeaf?.status ?? 'disconnected',
      connectedAt: primaryLeaf?.connectedAt,
    }
  }

  const workspaceHasActivity = (ws: Workspace) =>
    collectLeaves(ws.layout).some((l) => sessionActivity.includes(l.sessionId))

  return (
    <>
      <div className="border-border bg-muted/30 flex h-8 shrink-0 items-stretch overflow-x-auto border-b">
        {workspaces.map((ws, idx) => (
          <TabItem
            key={ws.id}
            session={workspaceToTabSession(ws)}
            host={hostById[collectLeaves(ws.layout)[0]?.hostId ?? '']}
            isActive={ws.id === activeWorkspaceId}
            hasActivity={workspaceHasActivity(ws)}
            isFirst={idx === 0}
            isLast={idx === workspaces.length - 1}
            onActivate={() => {
              setActiveWorkspaceId(ws.id)
              const ids = new Set(collectLeaves(ws.layout).map((l) => l.sessionId))
              setSessionActivity((prev) => prev.filter((id) => !ids.has(id)))
            }}
            onClose={() => handleClose(ws.id)}
            onCloseOthers={() => handleCloseOthers(ws.id)}
            onCloseToLeft={() => handleCloseToLeft(ws.id)}
            onCloseToRight={() => handleCloseToRight(ws.id)}
            onCloseAll={handleCloseAll}
          />
        ))}
        <div className="ml-auto flex shrink-0 items-center px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => setIsAddHostOpen(true)}>
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New connection</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <CloseConfirmDialog
        open={dialogOpen}
        sessionCount={pendingCount}
        onConfirm={handleDialogConfirm}
        onCancel={handleDialogCancel}
      />
    </>
  )
}
```

- [ ] **Step 2: Verify the app builds**

```bash
cd frontend && pnpm build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit the atomic batch (Tasks 2–6)**

```bash
git add \
  frontend/src/store/workspaces.ts \
  frontend/src/lib/paneTree.ts \
  frontend/src/store/atoms.ts \
  frontend/src/store/useAppInit.ts \
  frontend/src/components/sessions/TabBar.tsx \
  frontend/src/components/sidebar/HostList.tsx \
  frontend/src/components/sidebar/HostGroupSection.tsx \
  frontend/src/components/welcome/WelcomeScreen.tsx \
  frontend/src/components/modals/QuickConnectModal.tsx \
  frontend/src/components/terminal/TerminalPane.tsx \
  frontend/src/components/terminal/TerminalSidebar.tsx \
  frontend/src/components/terminal/TerminalSearch.tsx \
  frontend/src/components/layout/MainArea.tsx
git commit -m "refactor(ui): replace sessionsAtom with workspace+pane-tree model

Removes sessionsAtom (writable) and activeSessionIdAtom. All sessions
are now leaf nodes in Workspace objects stored in workspacesAtom.
Removes pendingConnects coordination map; host metadata is written into
LeafNode at connect time. TabBar maps over workspaces. useAppInit routes
session:status events into workspace leaf mutations.

Closes #<issue>"
```

---

## Task 7: WorkspaceView and PaneTree (single-pane rendering)

**Files:**
- Create: `frontend/src/components/terminal/WorkspaceView.tsx`
- Create: `frontend/src/components/terminal/PaneTree.tsx`
- Create: `frontend/src/components/terminal/PaneHeader.tsx`
- Modify: `frontend/src/components/layout/MainArea.tsx`

This task replaces `TerminalPane` with the new component tree. Splits are not yet wired — this handles single-pane workspaces and the foundation for splits.

- [ ] **Step 1: Create `PaneHeader.tsx`**

```typescript
import { SplitSquareVertical, SplitSquareHorizontal, X } from 'lucide-react'
import { Button } from '../ui/button'

interface Props {
  hostLabel: string
  hostColor?: string
  onSplitVertical: () => void
  onSplitHorizontal: () => void
  onClose: () => void
  canClose: boolean // false when this is the only pane in the workspace
}

export function PaneHeader({
  hostLabel,
  hostColor,
  onSplitVertical,
  onSplitHorizontal,
  onClose,
  canClose,
}: Props) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex h-7 items-center gap-1 px-2 opacity-0 transition-opacity group-hover/pane:opacity-100">
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        style={hostColor ? { color: hostColor } : undefined}
      >
        {hostLabel}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          title="Split vertically (⌘D)"
          onClick={onSplitVertical}
        >
          <SplitSquareVertical className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Split horizontally (⌘⇧D)"
          onClick={onSplitHorizontal}
        >
          <SplitSquareHorizontal className="size-3" />
        </Button>
        {canClose && (
          <Button variant="ghost" size="icon-xs" title="Close pane" onClick={onClose}>
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `PaneTree.tsx`**

```typescript
import React, { useLayoutEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
import type { PaneNode, LeafNode, Workspace } from '../../store/workspaces'
import { collectLeaves, splitLeaf, removeLeaf, firstLeaf } from '../../lib/paneTree'
import { TerminalInstance } from './TerminalInstance'
import { PaneHeader } from './PaneHeader'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { hostsAtom } from '../../store/atoms'
import { DisconnectSession, SplitSession } from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'

interface PaneTreeProps {
  node: PaneNode
  workspace: Workspace
  isWorkspaceActive: boolean
}

export function PaneTree({ node, workspace, isWorkspaceActive }: PaneTreeProps) {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const hosts = useAtomValue(hostsAtom)

  function setFocused(paneId: string) {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspace.id ? { ...w, focusedPaneId: paneId } : w))
    )
  }

  async function handleSplit(paneId: string, direction: 'horizontal' | 'vertical') {
    const leaf = collectLeaves(workspace.layout).find((l) => l.paneId === paneId)
    if (!leaf) return
    try {
      const result = await SplitSession(leaf.sessionId)
      const newPaneId = crypto.randomUUID()
      const newLeaf: LeafNode = {
        type: 'leaf',
        paneId: newPaneId,
        sessionId: result.sessionId,
        hostId: leaf.hostId,
        hostLabel: leaf.hostLabel,
        status: 'connecting',
        parentSessionId: result.parentSessionId,
      }
      setWorkspaces((prev) =>
        prev.map((w) => {
          if (w.id !== workspace.id) return w
          return {
            ...w,
            layout: splitLeaf(w.layout, paneId, direction, newLeaf),
            focusedPaneId: newPaneId,
          }
        })
      )
    } catch (err) {
      toast.error('Split failed', { description: String(err) })
    }
  }

  function handleClose(paneId: string) {
    setWorkspaces((prev) => {
      const ws = prev.find((w) => w.id === workspace.id)
      if (!ws) return prev
      const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
      if (leaf) DisconnectSession(leaf.sessionId).catch(() => {})
      const newLayout = removeLeaf(ws.layout, paneId)
      if (newLayout === null) {
        // Last pane — remove workspace
        return prev.filter((w) => w.id !== workspace.id)
      }
      // Update focusedPaneId if needed
      const newFocused =
        ws.focusedPaneId === paneId ? firstLeaf(newLayout).paneId : ws.focusedPaneId
      return prev.map((w) =>
        w.id === workspace.id ? { ...w, layout: newLayout, focusedPaneId: newFocused } : w
      )
    })
  }

  if (node.type === 'split') {
    const leftPct = node.ratio * 100
    const rightPct = (1 - node.ratio) * 100
    return (
      <ResizablePanelGroup
        direction={node.direction === 'vertical' ? 'horizontal' : 'vertical'}
        className="h-full w-full"
        onLayout={(sizes) => {
          setWorkspaces((prev) =>
            prev.map((w) => {
              if (w.id !== workspace.id) return w
              // Update ratio for this split node — requires finding it in the tree
              // For simplicity, pass a layout updater callback here
              // (Ratio persistence is nice-to-have; layout is ephemeral per spec)
              return w
            })
          )
        }}
      >
        <ResizablePanel defaultSize={leftPct} minSize={15}>
          <PaneTree node={node.left} workspace={workspace} isWorkspaceActive={isWorkspaceActive} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={rightPct} minSize={15}>
          <PaneTree node={node.right} workspace={workspace} isWorkspaceActive={isWorkspaceActive} />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  // Leaf node
  const leaf = node
  const isFocused = leaf.paneId === workspace.focusedPaneId
  const isActive = isWorkspaceActive && isFocused
  const host = hosts.find((h) => h.id === leaf.hostId)
  const totalLeaves = collectLeaves(workspace.layout).length
  const canClose = totalLeaves > 1

  return (
    <div
      className="group/pane relative h-full w-full"
      style={
        isFocused && host?.color
          ? { boxShadow: `inset 0 0 0 1px ${host.color}` }
          : undefined
      }
      onMouseDown={() => setFocused(leaf.paneId)}
    >
      <PaneHeader
        hostLabel={leaf.hostLabel}
        hostColor={host?.color}
        onSplitVertical={() => handleSplit(leaf.paneId, 'vertical')}
        onSplitHorizontal={() => handleSplit(leaf.paneId, 'horizontal')}
        onClose={() => handleClose(leaf.paneId)}
        canClose={canClose}
      />
      <InitialFitTrigger isActive={isActive} />
      <TerminalInstance session={{ id: leaf.sessionId, hostId: leaf.hostId, hostLabel: leaf.hostLabel, status: leaf.status, connectedAt: leaf.connectedAt }} isActive={isActive} />
      {leaf.status === 'disconnected' || leaf.status === 'error' ? (
        <DisconnectedOverlay />
      ) : null}
    </div>
  )
}

/** Triggers an initial fit when a pane is first mounted and not the focused pane. */
function InitialFitTrigger({ isActive }: { isActive: boolean }) {
  const didFit = useRef(false)
  useLayoutEffect(() => {
    if (!didFit.current && !isActive) {
      // Dispatch a resize event so FitAddon fires via ResizeObserver
      window.dispatchEvent(new Event('resize'))
      didFit.current = true
    }
  }, [])
  return null
}

function DisconnectedOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <p className="text-sm text-muted-foreground">Disconnected</p>
    </div>
  )
}
```

- [ ] **Step 3: Create `WorkspaceView.tsx`**

```typescript
import { useAtomValue } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
import { PaneTree } from './PaneTree'
import { TerminalSidebar } from './TerminalSidebar'
import { TerminalSearch } from './TerminalSearch'
import { useState, useCallback, useEffect } from 'react'
import { sftpStateAtom, portForwardsAtom, activeLogsAtom, isLogViewerOpenAtom, focusedSessionIdAtom } from '../../store/atoms'
import { useAtom } from 'jotai'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { StartSessionLog, StopSessionLog } from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'
import { collectLeaves } from '../../lib/paneTree'

export function WorkspaceView() {
  const workspaces = useAtomValue(workspacesAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [pfState, setPfState] = useAtom(portForwardsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen((o) => !o)
    }
  }, [])
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  function toggleSFTP(sessionId: string) {
    const willOpen = !(sftpState[sessionId]?.isOpen ?? false)
    if (willOpen) setPfState((p) => ({ ...p, [sessionId]: { ...(p[sessionId] ?? { isOpen: false, forwards: [] }), isOpen: false } }))
    setSftpState((p) => ({ ...p, [sessionId]: { ...(p[sessionId] ?? { isOpen: false, currentPath: '~', entries: [], isLoading: false, error: null }), isOpen: willOpen } }))
  }

  function togglePortForwards(sessionId: string) {
    const willOpen = !(pfState[sessionId]?.isOpen ?? false)
    if (willOpen) setSftpState((p) => ({ ...p, [sessionId]: { ...(p[sessionId] ?? { isOpen: false, currentPath: '~', entries: [], isLoading: false, error: null }), isOpen: false } }))
    setPfState((p) => ({ ...p, [sessionId]: { ...(p[sessionId] ?? { isOpen: false, forwards: [] }), isOpen: willOpen } }))
  }

  async function toggleLogging(sessionId: string) {
    if (activeLogs.has(sessionId)) {
      const logPath = activeLogs.get(sessionId)!
      await StopSessionLog(sessionId)
      setActiveLogs((p) => { const n = new Map(p); n.delete(sessionId); return n })
      toast.success('Log saved', { description: logPath })
    } else {
      try {
        const logPath = await StartSessionLog(sessionId)
        setActiveLogs((p) => new Map(p).set(sessionId, logPath))
        toast.info('Logging started', { description: logPath })
      } catch (e) {
        toast.error('Failed to start logging', { description: String(e) })
      }
    }
  }

  const sftp = focusedSessionId ? (sftpState[focusedSessionId] ?? { isOpen: false }) : { isOpen: false }
  const pf = focusedSessionId ? (pfState[focusedSessionId] ?? { isOpen: false }) : { isOpen: false }
  const sidebarOpen = sftp.isOpen || pf.isOpen

  return (
    <div className="relative h-full w-full flex">
      {workspaces.map((ws) => {
        const isActive = ws.id === activeWorkspaceId
        return (
          <div
            key={ws.id}
            className="absolute inset-0 flex"
            style={isActive ? { visibility: 'visible', pointerEvents: 'auto' } : { visibility: 'hidden', pointerEvents: 'none' }}
          >
            <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0 flex-1">
              <ResizablePanel defaultSize={sidebarOpen ? 60 : 100} minSize={30} className="flex h-full min-w-0 flex-col overflow-hidden!">
                <div className="relative h-full min-h-0 flex-1 py-3 pl-3">
                  <PaneTree node={ws.layout} workspace={ws} isWorkspaceActive={isActive} />
                  {isActive && searchOpen && focusedSessionId && (
                    <TerminalSearch sessionId={focusedSessionId} onClose={() => setSearchOpen(false)} />
                  )}
                </div>
              </ResizablePanel>
              {focusedSessionId && sftp.isOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={40} minSize={20} collapsible collapsedSize={0}
                    onResize={(size) => { if (size.inPixels === 0 && focusedSessionId) setSftpState((p) => ({ ...p, [focusedSessionId]: { ...(p[focusedSessionId]!), isOpen: false } })) }}
                    className="flex min-w-0 flex-col"
                  >
                    <SFTPPanel sessionId={focusedSessionId} />
                  </ResizablePanel>
                </>
              )}
              {focusedSessionId && pf.isOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={30} minSize={20} collapsible collapsedSize={0}
                    onResize={(size) => { if (size.inPixels === 0 && focusedSessionId) setPfState((p) => ({ ...p, [focusedSessionId]: { ...(p[focusedSessionId]!), isOpen: false } })) }}
                    className="flex min-w-0 flex-col"
                  >
                    <PortForwardsPanel sessionId={focusedSessionId} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
            {isActive && focusedSessionId && (
              <TerminalSidebar
                sftpOpen={sftp.isOpen}
                pfOpen={pf.isOpen}
                loggingActive={activeLogs.has(focusedSessionId)}
                logPath={activeLogs.get(focusedSessionId)}
                onToggleSFTP={() => toggleSFTP(focusedSessionId)}
                onTogglePF={() => togglePortForwards(focusedSessionId)}
                onToggleLogging={() => toggleLogging(focusedSessionId)}
                onViewLogs={() => setLogViewerOpen(true)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Update `MainArea.tsx`**

Replace:
```typescript
import { sessionsAtom } from '../../store/atoms'
import { TerminalPane } from '../terminal/TerminalPane'
```

With:
```typescript
import { workspacesAtom } from '../../store/workspaces'
import { WorkspaceView } from '../terminal/WorkspaceView'
```

Replace `sessionsAtom` with `workspacesAtom` in the empty-state check:
```typescript
const workspaces = useAtomValue(workspacesAtom)
if (workspaces.length === 0) { ... }
```

Replace `<TerminalPane />` with `<WorkspaceView />`.

- [ ] **Step 5: Verify build and lint**

```bash
cd frontend && pnpm build && pnpm lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add \
  frontend/src/components/terminal/WorkspaceView.tsx \
  frontend/src/components/terminal/PaneTree.tsx \
  frontend/src/components/terminal/PaneHeader.tsx \
  frontend/src/components/layout/MainArea.tsx
git commit -m "feat(ui): WorkspaceView and PaneTree — recursive pane renderer

Replaces TerminalPane with WorkspaceView. PaneTree recursively renders
the workspace layout tree. PaneHeader shows host label and split/close
controls on hover. Split logic calls SplitSession backend."
```

---

## Task 8: Wire keyboard shortcuts for splits

**Files:**
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

The split buttons in `PaneHeader` are wired already via click. This task adds `Cmd+D` / `Cmd+Shift+D` keyboard shortcuts.

- [ ] **Step 1: Add keyboard handlers to `WorkspaceView.tsx`**

In `WorkspaceView`, extend the existing `handleKeyDown` to handle split shortcuts:

```typescript
const handleKeyDown = useCallback(
  (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen((o) => !o)
      return
    }
    // Split shortcuts: only when a workspace is active
    if (!activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'd') {
      e.preventDefault()
      // Trigger vertical split on the focused pane — dispatch a custom event
      // that PaneTree listens to, or call a ref'd handler.
      // Simplest: re-use handleSplit logic. Since PaneTree owns split logic,
      // lift handleSplit up to WorkspaceView and pass it down as a prop.
      splitFocusedPane(ws, 'vertical')
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault()
      splitFocusedPane(ws, 'horizontal')
    }
  },
  [activeWorkspaceId, workspaces]
)
```

Extract `handleSplit` from `PaneTree` into `WorkspaceView` and pass it down as a prop. Add this to the `PaneTreeProps` interface:

```typescript
interface PaneTreeProps {
  node: PaneNode
  workspace: Workspace
  isWorkspaceActive: boolean
  onSplit: (paneId: string, direction: 'horizontal' | 'vertical') => void
  onClose: (paneId: string) => void
}
```

Move the `handleSplit` and `handleClose` implementations from `PaneTree` to `WorkspaceView`. `WorkspaceView` passes them as `onSplit` and `onClose` to `<PaneTree>`. `PaneTree` threads them through to `PaneHeader` and the leaf's keyboard handler. The keyboard shortcut in `WorkspaceView` calls `onSplit(focusedPaneId, direction)` directly.

- [ ] **Step 2: Build and lint**

```bash
cd frontend && pnpm build && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/terminal/WorkspaceView.tsx frontend/src/components/terminal/PaneTree.tsx
git commit -m "feat(ui): keyboard shortcuts for split panes (⌘D / ⌘⇧D)"
```

---

## Task 9: Focus indicator and disconnected overlay polish

**Files:**
- Modify: `frontend/src/components/terminal/PaneTree.tsx`

Small polish items already roughed in during Task 7 but worth verifying explicitly.

- [ ] **Step 1: Verify focus ring renders correctly**

In `PaneTree`'s leaf render, the `boxShadow` uses `host?.color`. For hosts without a color, fall back to a neutral ring:

```typescript
style={
  isFocused
    ? { boxShadow: `inset 0 0 0 1px ${host?.color ?? 'hsl(var(--border))'}` }
    : undefined
}
```

- [ ] **Step 2: Wire reconnect button in `DisconnectedOverlay`**

Update `DisconnectedOverlay` to accept and call an `onReconnect` callback (for future use). For now it's display-only; the session status will update automatically if the parent reconnects.

- [ ] **Step 3: Build and test manually**

```bash
wails dev
```

Smoke test:
1. Connect to a host — single pane appears in tab
2. Click split-vertical button — second pane opens, same host
3. Click in each pane — focus ring moves
4. Close one pane — sibling fills the space
5. Close last pane — workspace (tab) closes

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/PaneTree.tsx
git commit -m "feat(ui): focus ring and disconnected overlay for split panes"
```

---

## Task 10: Run pre-PR checks

**Files:** none (verification only)

- [ ] **Step 1: Go tests**

```bash
go test ./...
```

Expected: all pass.

- [ ] **Step 2: Frontend build**

```bash
cd frontend && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
cd frontend && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Format check**

```bash
cd frontend && pnpm format:check
```

Expected: no errors. If errors: run `pnpm format` and commit the diff.

- [ ] **Step 5: Final smoke test with `wails dev`**

Run `wails dev` and verify:
1. All existing functionality works (connect, SFTP, port forwards, logging, tab close/reorder)
2. Vertical and horizontal splits work via buttons and keyboard shortcuts
3. SFTP panel header shows host label of the focused pane
4. Closing a pane in a split workspace promotes the sibling correctly
5. Parent session disconnect causes all sibling panes to show disconnected overlay
