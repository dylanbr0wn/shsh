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
- Splitting to a different host than the current pane (same-host splits only in this iteration)

---

## Data Model

### Frontend Types

```typescript
type LeafNode = {
  type: 'leaf'
  paneId: string
  sessionId: string
  hostId: string
  hostLabel: string
  status: SessionStatus        // 'connecting' | 'connected' | 'disconnected' | 'error'
  connectedAt?: string
  // Set when this pane was created via SplitSession; points to the sessionId
  // whose SSH client is shared. Used to detect sibling panes that will also
  // disconnect when the underlying SSH client closes.
  parentSessionId?: string
}

type PaneNode =
  | LeafNode
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      // 0–1, proportion given to the left/top panel.
      // Initialised at 0.5. Updated via ResizablePanelGroup's onLayout callback
      // when the user drags the handle. Not persisted to disk (non-goal).
      ratio: number
      left: PaneNode
      right: PaneNode
    }

interface Workspace {
  id: string
  label: string              // derived from first pane's host label
  layout: PaneNode
  // paneId of the currently focused pane.
  // INVARIANT: must never be null on a rendered workspace.
  // Transitions to null only as part of a workspace-removal atom write,
  // which also removes the workspace from workspacesAtom in the same call.
  focusedPaneId: string | null
}
```

`paneParentshipAtom` is **not needed** — the `parentSessionId` field on `LeafNode` carries this information directly. To find all sibling panes that share a client, traverse `workspacesAtom` and collect leaves where `leaf.sessionId === parentSessionId || leaf.parentSessionId === parentSessionId`.

### Derived `sessionsAtom`

`sessionsAtom` becomes a **read-only derived atom** that flattens all leaf nodes from all workspaces into a `Session[]`, preserving the same `Session` shape (`id`, `hostId`, `hostLabel`, `status`, `connectedAt`) for all existing consumers:

```typescript
const sessionsAtom = atom<Session[]>((get) =>
  get(workspacesAtom).flatMap(w => collectLeaves(w.layout).map(leafToSession))
)

function collectLeaves(node: PaneNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.left), ...collectLeaves(node.right)]
}
```

### Atoms

| Atom | Type | Replaces |
|---|---|---|
| `workspacesAtom` | `atom<Workspace[]>` | `sessionsAtom` (as top-level UI concept) |
| `activeWorkspaceIdAtom` | `atom<string \| null>` | `activeSessionIdAtom` |
| `sessionsAtom` (derived) | `readonly atom<Session[]>` | replaces the writable atom |

**Removed:** `activeSessionIdAtom`, writable `sessionsAtom`

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
        └── WorkspacePanel  ← full-height right panel for SFTP/PF
```

### `isActive` semantics for `useTerminal` in split panes

`useTerminal` accepts `isActive` for three purposes: (a) suppressing the activity badge, (b) calling `term.focus()`, (c) triggering fit+resize on activation.

Under the new model, all panes in the active workspace are visible simultaneously. The new definition is:

```
isActive = activeWorkspaceId === workspace.id && paneId === workspace.focusedPaneId
```

Implications:
- **Activity badge (a):** Visible but non-focused panes in the active workspace must NOT trigger `sessionActivityAtom` — the user can see their output. `isActive = false` for non-focused panes is correct for this purpose.
- **Focus (b):** Only the focused pane receives `term.focus()`. Correct.
- **Fit on activation (c):** The `requestAnimationFrame` fit path in `useTerminal` is gated on `isActive`, so a newly added (non-focused) pane will not get an initial fit call. To handle this, `PaneSplit` must call `fitAddon.fit()` on all its children after mount (via a ref or a one-shot `useLayoutEffect` in `PaneLeaf`). Ongoing resizes are already handled by the existing `ResizeObserver` in `useTerminal` — no change needed there.
- **Panes in non-active workspaces** behave exactly as today.

### `TabBar` changes

`TabBar` currently calls `useAtom(sessionsAtom)` (read + write) and directly removes sessions via `setSessions(prev => prev.filter(...))` in its close/disconnect handlers. Since `sessionsAtom` is now read-only, `TabBar`'s close and disconnect logic must be rewritten to mutate `workspacesAtom` and call `Disconnect()` directly. This is a **required part of migration step 5**, not just a read-path change.

### WorkspacePanel (SFTP / Port Forwards)

A full-height panel on the right side of the workspace. The panel header shows the focused pane's host label and color accent:

```
┌──────────┬──────────┬──────────────────────┐
│ web-prod │ db-prod  │  SFTP  ● db-prod      │
│ [focus]  │          │  /home/user/          │
│          │          │  ...                  │
└──────────┴──────────┴──────────────────────┘
```

**Panel behaviour when focus switches:**
- The panel stays open; it does **not** close automatically when focus moves to a different pane
- The header updates to show the new focused pane's host label and color
- The content switches to the new focused pane's session state ("follow focus")

This provides clear attribution of which session is being browsed when multiple hosts are open in one workspace.

---

## Session Lifecycle

### Opening a host (all call sites)

The following components call `Connect` (or `BulkConnectGroup`) and today write to `pendingConnects`. All must be updated:

- `HostList.tsx` — single host connect
- `HostGroupSection.tsx` — single host connect + bulk connect via `BulkConnectGroup`
- `WelcomeScreen.tsx` — quick connect path
- `QuickConnectModal.tsx` — quick connect modal

For each `Connect` call, the updated flow is:
1. Call `Connect` → receives `sessionId`
2. **Immediately** create `LeafNode { paneId: uuid(), sessionId, hostId, hostLabel, status: 'connecting' }` using host data already available at the call site (no pendingConnects needed — the call site already has `hostId` and `hostLabel`)
3. Create `Workspace { id: uuid(), label: hostLabel, layout: leafNode, focusedPaneId: paneId }`
4. Push to `workspacesAtom`, set `activeWorkspaceIdAtom`

For `BulkConnectGroup` (returns `[]{ SessionID, HostID }`):
1. Call `BulkConnectGroup` → receives array of `{ sessionId, hostId }` pairs
2. For each pair, look up `hostLabel` from the already-loaded hosts list
3. Create one `Workspace` per pair with a single leaf, using the same LeafNode creation pattern
4. Push all workspaces to `workspacesAtom` in a single atom write; set `activeWorkspaceIdAtom` to the first

### Splitting a pane

Splits are **same-host only** in this iteration. The split UI does not show a host picker — it defaults to the same host as the focused pane. A "new tab to same host" button is a potential future addition.

1. User triggers split (button or `Cmd+D` / `Cmd+Shift+D`) on focused pane
2. Frontend calls `SplitSession(existingSessionId)` → receives `{ sessionId: newId, parentSessionId: existingId }`
3. Creates new `LeafNode { paneId: uuid(), sessionId: newId, hostId, hostLabel, status: 'connecting', parentSessionId: existingId }` (hostId/hostLabel copied from existing leaf)
4. Replaces the focused leaf in the workspace tree with a `SplitNode` (ratio: 0.5) in a **single atomic `workspacesAtom` write** that also sets `focusedPaneId` to the new pane:
   ```
   before: leaf { paneId: A, sessionId: X }
   after:  split {
             direction, ratio: 0.5,
             left:  leaf { paneId: A, sessionId: X },
             right: leaf { paneId: B, sessionId: newId, parentSessionId: X }
           }
   focusedPaneId = B
   ```
5. `session:status connected` will arrive and update the leaf's `status` via `useAppInit`

### Closing a pane

All mutations in step 1 must happen in a **single `workspacesAtom` write** — no intermediate renders with a dangling `focusedPaneId`.

1. In a single atom write:
   - Remove the leaf from the workspace tree; promote the sibling
   - If the closed pane was focused, set `focusedPaneId` to the promoted sibling's paneId (or nearest leaf if tree is deeper)
   - If this was the last leaf: remove the workspace from `workspacesAtom` entirely and set `focusedPaneId` to `null` only as part of the workspace removal — it will never be rendered
   - If the removed workspace was active: also update `activeWorkspaceIdAtom` to the previous workspace in the same write
2. Call `Disconnect(sessionId)` after the atom write

### Session disconnect (remote)

When `session:status` emits `disconnected` or `error`:
1. Find the matching leaf in `workspacesAtom` by `sessionId` and update its `status`
2. `PaneLeaf` reacts to `status` and shows a disconnected overlay with a reconnect button
3. Find sibling panes: traverse all workspace leaves and collect those where `leaf.sessionId === disconnectedSessionId || leaf.parentSessionId === disconnectedSessionId`. If any siblings exist, also update their status and show a message: *"Connection lost — all panes on this host disconnected"*

### `useAppInit` changes

`pendingConnects` is removed entirely. Host metadata is now written into `LeafNode` at the call site before the event arrives.

On `session:status` events:
- Find the workspace leaf by `sessionId` in `workspacesAtom`
- Update `status` (and `connectedAt` if connected) in place

All direct `sessionsAtom` mutations are removed. The derived `sessionsAtom` reflects changes automatically.

---

## Go Backend

### New method: `SplitSession`

Since splits are same-host only, `SplitSession` always reuses the existing SSH client:

```go
type SplitSessionResult struct {
    SessionID       string `json:"sessionId"`
    ParentSessionID string `json:"parentSessionId"`
}

func (a *App) SplitSession(existingSessionID string) (SplitSessionResult, error)
```

Implementation:
1. Look up `existingSessionID` in the session manager to get the `*sshSession`
2. Obtain the target client: use `sess.client.Client` (the inner `*ssh.Client`) — not the outer `*goph.Client`. This correctly handles jump-host sessions where `sess.client.Client` is the already-tunnelled connection to the target host.
3. Call `targetClient.NewSession()` — opens a new SSH channel (PTY) on the existing connection. No re-authentication or host key verification needed; the transport is already established.
4. Set up stdin/stdout pipes, request PTY (`xterm-256color`, 24×80), start shell — same sequence as the `Connect` path
5. Register as a new `sshSession` entry in the manager with a new UUID
6. Emit `session:status connecting` then `session:status connected` for the new session
7. Return `{ sessionId: newUUID, parentSessionId: existingSessionID }`

**Unchanged:** `Connect`, `Disconnect`, `Write`, `Resize`, SFTP, port forwarding, logging, event system.

### Shared client disconnect propagation

When the parent session's SSH client closes, all child sessions using that transport disconnect naturally — their `stdout.Read` returns an error, triggering `session:status → disconnected`. The frontend detects siblings via `parentSessionId` on `LeafNode`.

---

## UI / UX Details

### Split controls

Each `PaneHeader` (visible on hover) contains:
- **⊟** split vertically (`Cmd+D`)
- **⊞** split horizontally (`Cmd+Shift+D`)
- **✕** close pane

The header shows the host label and color accent of the pane's session.

### Focus indicator

A 1px border using the host's color accent marks the focused pane. Clicking anywhere in a pane focuses it.

### Initial fit for new split panes

When a `PaneLeaf` is newly mounted as part of a split, it triggers a one-shot `useLayoutEffect` to call `fitAddon.fit()` and `ResizeSession()`. This handles the initial sizing for panes that are not the focused pane (and therefore don't receive the `isActive`-gated fit call in `useTerminal`).

### Tab bar

Tab labels show the workspace label (derived from first pane's host label). `TabBar`'s close and disconnect logic is rewritten against `workspacesAtom` (see Architecture section).

---

## Migration Path

**Steps 1–3 must land in a single commit.** After step 1 alone the app will not compile (consumers of `sessionsAtom` write path break). After step 2 it compiles but `TabBar` and `TerminalPane` still use `activeSessionIdAtom`. Only after step 3 is the app fully functional again and testable. This is intentional — the three steps are tightly coupled and attempting to ship them separately will produce broken intermediates.

Steps 4–8 are independent increments that each leave the app in a working state.

1. **[atomic with 2–3]** Add `workspacesAtom`, `activeWorkspaceIdAtom`; convert `sessionsAtom` to derived atom; update `LeafNode` type with status/parentSessionId fields; add `collectLeaves` helper
2. **[atomic with 1, 3]** Rewrite `useAppInit`: remove `pendingConnects`, route `session:status` events into workspace leaf nodes
3. **[atomic with 1–2]** Update all consumers of removed atoms:
   - `activeSessionIdAtom` readers: `TerminalPane.tsx`, `useTerminal.ts`, `TerminalSearch.tsx`, `TerminalSidebar.tsx`
   - `sessionsAtom` writers: `TabBar.tsx` (close/disconnect logic → rewrite against `workspacesAtom`), `useAppInit.ts` (already handled in step 2)
   - `sessionsAtom` readers that need no logic change (derived atom shape is identical): `useTerminal.ts`, `TerminalSettings.tsx`
   - Connect call sites: `HostList.tsx`, `HostGroupSection.tsx`, `WelcomeScreen.tsx`, `QuickConnectModal.tsx` — remove `pendingConnects` writes, add workspace creation
4. Replace `TerminalPane` with `WorkspaceView` + `PaneTree` (single-pane workspaces only — no split UI yet)
5. Update `TabBar` to map over `workspacesAtom`; rewrite close/disconnect handlers
6. Add `SplitSession` to Go backend; run `wails build` to regenerate bindings
7. Wire split controls in `PaneHeader` (buttons + keyboard shortcuts); implement split/close tree mutations in `workspacesAtom`
8. Update `WorkspacePanel` (SFTP/PF) to workspace-level with follow-focus behaviour and host attribution header

---

## Open Questions

- Should workspace labels be user-editable in this iteration? Recommendation: no — derive from first pane's host label.
