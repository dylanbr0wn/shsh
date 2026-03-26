# Design: Decompose useAppInit into typed event dispatch + workspace action atoms

**Issue:** #44
**Date:** 2026-03-26

## Problem

`useAppInit` is a 370-line mega-hook that subscribes to 17+ Wails event types, mutates 20+ Jotai atoms, and repeats the same `setWorkspaces(prev => prev.map(w => ({ ...w, layout: updateLeafByChannelId(...) })))` pattern 8 times. `WorkspaceView.tsx` repeats similar workspace mutation boilerplate ~5 more times. Event topics are bare strings with no compile-time payload safety.

## Design

Three complementary changes: a typed event registry, write-only Jotai action atoms, and domain-specific event hooks.

### 1. Typed Event Registry

**File:** `frontend/src/events/topics.ts`

A `WailsEventMap` interface mapping every event topic string to its payload type:

```typescript
export interface WailsEventMap {
  'channel:status': {
    channelId: string
    connectionId: string
    kind: string
    status: SessionStatus
    error?: string
  }
  'connection:status': {
    connectionId: string
    status: 'reconnecting' | 'connected' | 'failed' | 'disconnected'
    attempt?: number
    maxRetries?: number
    error?: string
  }
  'connection:hostkey': PendingHostKey
  'menu:new-connection': void
  'menu:import-ssh-config': void
  'menu:settings': void
  'menu:add-host': void
  'menu:new-group': void
  'menu:terminal-profiles': void
  'menu:export-hosts': void
  'menu:session:disconnect': void
  'menu:session:disconnect-all': void
  'menu:session:add-port-forward': void
  'menu:session:start-log': void
  'menu:session:stop-log': void
  'menu:session:view-logs': void
  'menu:session:open-logs-folder': void
}
```

**File:** `frontend/src/hooks/useWailsEvent.ts`

Add a typed overload so that when called with a key of `WailsEventMap`, the callback payload is typed automatically. The existing untyped signature remains as a fallback.

### 2. Workspace Action Atoms

**File:** `frontend/src/store/workspaceActions.ts`

Write-only Jotai atoms that encapsulate all workspace tree mutations. Each atom's write function uses `(get, set, arg)` to read `workspacesAtom` (and other atoms as needed), compute new state, and `set(workspacesAtom, ...)`. No refs or `useAtomCallback` needed.

**Atoms:**

- **`patchLeafByChannelIdAtom`** `{ channelId: string; patch: Partial<PaneLeaf> }` — maps over all workspaces calling `updateLeafByChannelId`. Used by channel and connection event handlers.

- **`patchLeavesByConnectionIdAtom`** `{ connectionId: string; patch: Partial<PaneLeaf> }` — collects all leaves across workspaces, filters by `connectionId`, patches each via `updateLeafByChannelId`. Used by `connection:status` handler.

- **`splitPaneAtom`** `{ workspaceId, paneId, direction, newLeaf, position? }` — calls `splitLeaf` or `insertLeaf`, sets `focusedPaneId` to the new leaf. Used by WorkspaceView.

- **`closePaneAtom`** `{ workspaceId, paneId }` — calls `removeLeaf`, filters workspace if layout becomes empty, updates focus to `firstLeaf`. Calls `CloseChannel` on the removed leaf. Used by WorkspaceView.

- **`movePaneAtom`** `{ sourcePaneId, sourceWorkspaceId, targetWorkspaceId, targetPaneId, direction, position }` — delegates to `moveLeaf` (same workspace) or `movePaneAcrossWorkspaces` (cross-workspace). Used by WorkspaceView.

- **`requireActiveLeafAtom`** `{ action: (leaf: PaneLeaf) => void | Promise<void> }` — reads `activeWorkspaceIdAtom` and `workspacesAtom` via `get`, finds the focused connected leaf, calls `action(leaf)`. Toasts "No active session" on failure. Used by session menu event hooks.

All atoms are testable via `createStore()` with zero React rendering.

### 3. Domain Event Hooks

| Hook | File | Events | Atoms used |
|------|------|--------|------------|
| `useChannelEvents` | `frontend/src/hooks/useChannelEvents.ts` | `channel:status` | `patchLeafByChannelIdAtom`, `connectingHostIdsAtom`, `portForwardsAtom` |
| `useConnectionEvents` | `frontend/src/hooks/useConnectionEvents.ts` | `connection:status` | `patchLeavesByConnectionIdAtom`, `portForwardsAtom` |
| `useMenuEvents` | `frontend/src/hooks/useMenuEvents.ts` | 7 `menu:*` topics, `connection:hostkey` | dialog open atoms, `pendingHostKeyAtom` |
| `useSessionMenuEvents` | `frontend/src/hooks/useSessionMenuEvents.ts` | 7 `menu:session:*` topics | `requireActiveLeafAtom`, `activeLogsAtom`, `addPortForwardConnectionIdAtom`, `isLogViewerOpenAtom` |

Each hook calls typed `useWailsEvent` and dispatches workspace mutations via action atoms. No manual refs needed.

**useChannelEvents detail:**
- `connecting`: no-op (early return)
- `connected`: remove hostId from `connectingHostIdsAtom`, dispatch patch `{ status: 'connected', connectedAt }`
- `error`: remove hostId from `connectingHostIdsAtom`, dispatch patch `{ status: 'error' }`, toast error
- `disconnected`: dispatch patch `{ status: 'disconnected' }`, clean up `portForwardsAtom`

**useConnectionEvents detail:**
- `reconnecting`/`connected`/`failed`: dispatch `patchLeavesByConnectionIdAtom` with new status
- `failed`: also toast error
- `disconnected`: dispatch patch + clean up `portForwardsAtom` for all affected channelIds

**useMenuEvents detail:**
- Each `menu:*` event sets the corresponding dialog atom to `true`
- `connection:hostkey` sets `pendingHostKeyAtom`

**useSessionMenuEvents detail:**
- Each event dispatches through `requireActiveLeafAtom` with the appropriate action
- `disconnect`: dispatches through `requireActiveLeafAtom`, calls `CloseChannel(leaf.channelId)`
- `disconnect-all`: does NOT use `requireActiveLeafAtom` — instead reads `workspacesAtom` directly via a dedicated `disconnectAllAtom` write-only atom that collects all connected leaves and calls `CloseChannel` on each
- `add-port-forward`: sets `addPortForwardConnectionIdAtom`
- `start-log`/`stop-log`: calls Go backend, updates `activeLogsAtom`
- `view-logs`: sets `isLogViewerOpenAtom(true)`
- `open-logs-folder`: calls `OpenLogsDirectory()`

### 4. useAppInit becomes orchestrator

```typescript
export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)
  const setDebugPanelOpen = useSetAtom(debugPanelOpenAtom)

  useEffect(() => {
    ListHosts().then(setHosts).catch(e => toast.error(...))
    ListGroups().then(setGroups).catch(e => toast.error(...))
    ListTerminalProfiles().then(setTerminalProfiles).catch(e => toast.error(...))
  }, [])

  useDebugEvents()
  useChannelEvents()
  useConnectionEvents()
  useMenuEvents()
  useSessionMenuEvents()

  useEffect(() => { /* Ctrl+J debug panel toggle */ }, [])
}
```

- `workspacesRef`, `activeWorkspaceIdRef`, and their `useLayoutEffect` sync blocks are deleted entirely.
- ~370 lines reduced to ~25 lines.

### 5. WorkspaceView simplification

Replace inline `setWorkspaces` mutation blocks with action atom dispatches:

- `handleSplit` (~15 lines) → `set(splitPaneAtom, { workspaceId, paneId, direction, newLeaf, position })`
- `handleClose` (~20 lines) → `set(closePaneAtom, { workspaceId, paneId })`
- `handleMovePane` (~20 lines) → `set(movePaneAtom, { ... })`
- `openTemplate` stays as-is (appends a new workspace, doesn't fit the tree-mutation pattern)

Removes ~60 lines of duplicated boilerplate from WorkspaceView.

## Files created

| File | Purpose |
|------|---------|
| `frontend/src/events/topics.ts` | `WailsEventMap` typed event registry |
| `frontend/src/store/workspaceActions.ts` | Write-only action atoms for workspace mutations |
| `frontend/src/hooks/useChannelEvents.ts` | `channel:status` event handler |
| `frontend/src/hooks/useConnectionEvents.ts` | `connection:status` event handler |
| `frontend/src/hooks/useMenuEvents.ts` | `menu:*` + `connection:hostkey` event handlers |
| `frontend/src/hooks/useSessionMenuEvents.ts` | `menu:session:*` event handlers |

## Files modified

| File | Change |
|------|--------|
| `frontend/src/hooks/useWailsEvent.ts` | Add typed overload using `WailsEventMap` |
| `frontend/src/store/useAppInit.ts` | 370 lines to ~25-line orchestrator |
| `frontend/src/components/terminal/WorkspaceView.tsx` | Replace ~60 lines of mutation boilerplate with action atom dispatches |

## Files unchanged

- `frontend/src/lib/paneTree.ts` — pure functions, correct as-is
- `frontend/src/store/atoms.ts` — no new atoms needed here
- `frontend/src/App.tsx` — `useAppInit()` call unchanged

## Implementation order

1. **Workspace action atoms** — pure functions, zero risk, testable immediately
2. **Typed event registry + typed useWailsEvent** — purely additive, no behavior change
3. **WorkspaceView simplification** — swap inline mutations for action atom dispatches
4. **Extract event hooks** — one at a time: menu (simplest) → channel → connection → session menu
5. **Cleanup** — delete refs, dead imports, verify `useAppInit` is ~25 lines

Each phase: `pnpm build` to verify no regressions.
