# Split Panes Design

**Date:** 2026-03-23
**Status:** Approved
**Branch:** feat/split-panes

---

## Overview

Add horizontal/vertical terminal splits within a session, with independent scrollback per pane. This requires unifying the current "tab = one session" model into a "tab = workspace containing a pane layout tree" model. Each pane is an independent SSH session with its own PTY.

---

## Goals

- Horizontal and vertical splits within a workspace, recursively (binary tree layout)
- Each pane has an independent xterm.js instance with its own scrollback buffer
- Splits reuse the existing SSH client connection (new PTY, not a new TCP connection)
- SFTP, port forwarding, and logging remain session-scoped but operate at the workspace level with clear host attribution
- Clean foundation: eliminate the dual session/workspace mental model by replacing `sessionsAtom` with a derived view over workspace leaf nodes

---

## Non-Goals

- Persisting workspace layouts across app restarts (future work)
- Dragging panes to reorder the split tree
- More than binary splits (each split is always left/right or top/bottom)

---

## Data Model

### Frontend Types

```typescript
type PaneNode =
  | { type: 'leaf'; paneId: string; sessionId: string }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number          // 0–1, proportion given to left/top panel
      left: PaneNode
      right: PaneNode
    }

interface Workspace {
  id: string
  label: string              // derived from first pane's host label; user-renameable later
  layout: PaneNode
  focusedPaneId: string      // paneId of the currently focused pane
}

// Relationship between panes that share an SSH client
interface PaneParentship {
  childSessionId: string
  parentSessionId: string    // the session whose SSH client is shared
}
```

### Atoms

| Atom | Type | Replaces |
|---|---|---|
| `workspacesAtom` | `atom<Workspace[]>` | `sessionsAtom` (as top-level UI concept) |
| `activeWorkspaceIdAtom` | `atom<string \| null>` | `activeSessionIdAtom` |
| `paneParentshipAtom` | `atom<PaneParentship[]>` | new — tracks shared-client relationships |
| `sessionsAtom` (derived) | `atom<Session[]>` | replaces the writable atom — read-only, flattened from workspace leaves |

**Unchanged atoms** (all keyed by `sessionId`):
`sftpStateAtom`, `portForwardsAtom`, `searchAddonsAtom`, `sessionActivityAtom`, `activeLogsAtom`, `sessionProfileOverridesAtom`

---

## Architecture

### Component Tree

```
App
└── MainArea
    ├── TabBar              ← maps over workspacesAtom (was: sessionsAtom)
    └── WorkspaceView       ← renders active workspace (replaces TerminalPane)
        ├── PaneTree        ← recursive renderer for PaneNode tree
        │   ├── PaneLeaf    ← wraps TerminalInstance + PaneHeader
        │   └── PaneSplit   ← ResizablePanelGroup with two PaneTree children
        ├── TerminalSidebar ← unchanged; reads focusedPaneId to scope actions
        └── WorkspacePanel  ← full-height right panel for SFTP/PF (replaces per-session side panels)
```

### PaneLeaf

Each `PaneLeaf` renders:
- A `PaneHeader` (shown on hover): host label, split-vertical button, split-horizontal button, close button
- A `TerminalInstance` for the pane's `sessionId`
- A focus ring (thin border) when `paneId === workspace.focusedPaneId`
- A disconnected overlay with reconnect prompt when session status is `disconnected` or `error`

Clicking anywhere in a pane sets it as `focusedPaneId` on the workspace.

### WorkspacePanel (SFTP / Port Forwards)

A full-height panel on the right side of the workspace (same `ResizablePanelGroup` as today but at the workspace level). The panel header shows the host label and color accent of the focused pane's session:

```
┌──────────┬──────────┬──────────────────────┐
│ web-prod │ db-prod  │  SFTP  ● db-prod      │
│ [focus]  │          │  /home/user/          │
│          │          │  ...                  │
└──────────┴──────────┴──────────────────────┘
```

This makes it unambiguous which host is being browsed when multiple hosts are open in one workspace. The SFTP/PF state is still keyed by `sessionId` internally — the workspace panel just reads from the focused pane's session.

---

## Session Lifecycle

### Opening a host

1. Frontend calls `Connect` → receives `sessionId`
2. Creates `Workspace { id: uuid(), label: hostLabel, layout: { type: 'leaf', paneId: uuid(), sessionId }, focusedPaneId: paneId }`
3. Pushes to `workspacesAtom`, sets `activeWorkspaceIdAtom`

### Splitting a pane

1. User triggers split (button or keyboard shortcut) on focused pane
2. Host picker shown (defaults to same host as focused pane)
3. Frontend calls `SplitSession(existingSessionId, hostId)` → receives `{ sessionId: newId, parentSessionId: existingId }`
4. Adds `{ childSessionId: newId, parentSessionId: existingId }` to `paneParentshipAtom`
5. Replaces the focused leaf in the workspace tree with a `SplitNode`:
   ```
   before: leaf { paneId: A, sessionId: X }
   after:  split {
             direction, ratio: 0.5,
             left:  leaf { paneId: A, sessionId: X },
             right: leaf { paneId: B, sessionId: newId }
           }
   ```
6. Sets `focusedPaneId` to the new pane B

### Closing a pane

1. Leaf is removed from the workspace tree; its sibling is promoted to take its place:
   ```
   before: split { left: leaf A, right: leaf B }
   close B: leaf A
   ```
2. `Disconnect(sessionId)` is called for the closed pane's session
3. If the closed pane was the last leaf, the workspace is removed from `workspacesAtom`
4. If the removed workspace was active, focus moves to the previous workspace

### Session disconnect (remote)

When `session:status` emits `disconnected` or `error`:
1. Find the leaf in `workspacesAtom` by `sessionId`
2. The leaf stays in place; `PaneLeaf` shows a disconnected overlay with a reconnect button
3. Check `paneParentshipAtom` — if other panes share the same parent session, show a message: *"Connection lost — all panes on this host disconnected"*

### `useAppInit` changes

- Stop mutating `sessionsAtom` directly
- On `session:status` events, find the workspace containing the `sessionId` and update session status in place
- On app startup, restore sessions into workspace leaves (if session persistence is added later)

---

## Go Backend

### New method: `SplitSession`

```go
type SplitSessionResult struct {
    SessionID       string `json:"sessionId"`
    ParentSessionID string `json:"parentSessionId"`
}

func (a *App) SplitSession(existingSessionID string, hostID string) (SplitSessionResult, error)
```

Implementation:
1. Look up `existingSessionID` in the session manager to get its `*goph.Client`
2. Look up `hostID` in the store to get host config
3. Call `client.NewSession()` — opens a new PTY on the same SSH connection
4. Register as a new `sshSession` with a new UUID
5. Return `{ sessionId: newUUID, parentSessionId: existingSessionID }`

**Unchanged:** `Connect`, `Disconnect`, `Write`, `Resize`, SFTP, port forwarding, logging, event system.

### Shared client disconnect propagation

When the underlying SSH client closes (parent session disconnects), all child sessions using that client will also disconnect naturally — the `stdout.Read` on each will return an error, triggering the `session:status → disconnected` event chain. No special backend handling needed; the frontend handles it via `paneParentshipAtom`.

---

## UI / UX Details

### Split controls

Each `PaneHeader` (visible on hover) contains:
- **⊟** vertical split button (`Cmd+D`)
- **⊞** horizontal split button (`Cmd+Shift+D`)
- **✕** close pane button

The header also shows the host label and color accent of the pane's session, so it's always clear what each pane is connected to.

### Focus indicator

A 1px border using the host's color accent marks the focused pane. Clicking anywhere in a pane focuses it.

### Tab bar

Tab labels show the workspace label (derived from first pane's host label). A future enhancement could show small colored dots for each pane's host, but this is out of scope for this feature.

---

## Migration Path

Since the app is pre-release, this is a clean-slate refactor:

1. Replace `sessionsAtom` (writable) with `workspacesAtom` + derived `sessionsAtom`
2. Replace `activeSessionIdAtom` with `activeWorkspaceIdAtom`
3. Rewrite `useAppInit` to route session events through workspace state
4. Replace `TerminalPane` with `WorkspaceView` + `PaneTree`
5. Update `TabBar` to read from `workspacesAtom`
6. Add `SplitSession` to Go backend
7. Update `WorkspacePanel` (SFTP/PF) to show host attribution in header

---

## Open Questions

- Should the host picker on split default to the same host (one click to split) or always show the full picker? Recommendation: default to same host, with a "change host" option.
- Should workspace labels be user-editable in this iteration? Recommendation: not in this iteration — derive from first pane's host label.
