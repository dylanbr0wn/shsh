# useAppInit Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 370-line `useAppInit` mega-hook into typed event dispatch, workspace action atoms, and domain-specific event hooks.

**Architecture:** Typed `WailsEventMap` registry provides compile-time event/payload safety. Write-only Jotai action atoms centralize workspace tree mutations (replacing scattered `setWorkspaces(prev => prev.map(...))` patterns). Four domain event hooks each handle a category of Wails events and dispatch through action atoms. `useAppInit` becomes a ~25-line orchestrator.

**Tech Stack:** React, Jotai (atoms + `jotai/utils`), Wails v2 runtime events, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/events/topics.ts` | Create | `WailsEventMap` interface mapping event topics to payload types |
| `frontend/src/hooks/useWailsEvent.ts` | Modify | Add typed overload accepting `WailsEventMap` keys |
| `frontend/src/store/workspaceActions.ts` | Create | Write-only Jotai action atoms for all workspace tree mutations |
| `frontend/src/hooks/useMenuEvents.ts` | Create | Handle 7 `menu:*` events + `connection:hostkey` |
| `frontend/src/hooks/useChannelEvents.ts` | Create | Handle `channel:status` event |
| `frontend/src/hooks/useConnectionEvents.ts` | Create | Handle `connection:status` event |
| `frontend/src/hooks/useSessionMenuEvents.ts` | Create | Handle 7 `menu:session:*` events |
| `frontend/src/store/useAppInit.ts` | Modify | Reduce to ~25-line orchestrator |
| `frontend/src/components/terminal/WorkspaceView.tsx` | Modify | Replace inline mutations with action atom dispatches |

---

### Task 1: Create typed event registry

**Files:**
- Create: `frontend/src/events/topics.ts`

- [ ] **Step 1: Create the WailsEventMap interface**

Create `frontend/src/events/topics.ts`:

```typescript
import type { SessionStatus } from '../types'
import type { PendingHostKey } from '../store/atoms'

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

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS (purely additive, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/events/topics.ts
git commit -m "refactor(ui): add typed WailsEventMap registry

Closes #44 phase 1 — compile-time event topic + payload safety."
```

---

### Task 2: Add typed overload to useWailsEvent

**Files:**
- Modify: `frontend/src/hooks/useWailsEvent.ts`

- [ ] **Step 1: Add typed overload**

Replace the entire contents of `frontend/src/hooks/useWailsEvent.ts` with:

```typescript
import { useEffect, useLayoutEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { WailsEventMap } from '../events/topics'

export function useWailsEvent<T extends keyof WailsEventMap>(
  event: T,
  callback: WailsEventMap[T] extends void ? () => void : (payload: WailsEventMap[T]) => void
): void
export function useWailsEvent(event: string, callback: (...args: unknown[]) => void): void
export function useWailsEvent(event: string, callback: (...args: unknown[]) => void) {
  const cbRef = useRef(callback)
  useLayoutEffect(() => {
    cbRef.current = callback
  })

  useEffect(() => {
    const cancel = EventsOn(event, (...args: unknown[]) => cbRef.current(...args))
    return () => cancel()
  }, [event])
}
```

The typed overload provides compile-time safety when called with a `WailsEventMap` key. The untyped overload remains for events not in the map (e.g. `debug:log-batch` used by `useDebugEvents`).

Note: Wails sends event data as positional args. For typed events, the payload arrives as `args[0]`. The hooks in later tasks will destructure `args[0]` from the callback. The typed overload's callback signature takes a single `payload` parameter — the hook implementations will receive this as `(...args) => cbRef.current(...args)` which passes `args[0]` as the first parameter to the callback.

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS — existing `useDebugEvents` uses the untyped overload, no changes needed there.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useWailsEvent.ts
git commit -m "refactor(ui): add typed overload to useWailsEvent

Accepts WailsEventMap keys for compile-time payload safety.
Untyped fallback preserved for events outside the map."
```

---

### Task 3: Create workspace action atoms

**Files:**
- Create: `frontend/src/store/workspaceActions.ts`

- [ ] **Step 1: Create the action atoms file**

Create `frontend/src/store/workspaceActions.ts`:

```typescript
import { atom } from 'jotai'
import type { PaneLeaf } from './workspaces'
import { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
import {
  updateLeafByChannelId,
  collectLeaves,
  splitLeaf,
  insertLeaf,
  removeLeaf,
  firstLeaf,
  moveLeaf,
  movePaneAcrossWorkspaces,
} from '../lib/paneTree'
import { CloseChannel } from '../../wailsjs/go/main/SessionFacade'
import { toast } from 'sonner'

/** Patch every leaf whose channelId matches, across all workspaces. */
export const patchLeafByChannelIdAtom = atom(
  null,
  (get, set, { channelId, patch }: { channelId: string; patch: Partial<PaneLeaf> }) => {
    set(
      workspacesAtom,
      get(workspacesAtom).map((w) => ({
        ...w,
        layout: updateLeafByChannelId(w.layout, channelId, patch),
      }))
    )
  }
)

/** Patch every leaf on a given connection (for connection-level status changes). */
export const patchLeavesByConnectionIdAtom = atom(
  null,
  (get, set, { connectionId, patch }: { connectionId: string; patch: Partial<PaneLeaf> }) => {
    const workspaces = get(workspacesAtom)
    const allLeaves = workspaces.flatMap((w) => collectLeaves(w.layout))
    const affected = allLeaves.filter((l) => l.connectionId === connectionId)
    if (affected.length === 0) return affected

    set(
      workspacesAtom,
      workspaces.map((w) => {
        let layout = w.layout
        for (const leaf of affected) {
          layout = updateLeafByChannelId(layout, leaf.channelId, patch)
        }
        return { ...w, layout }
      })
    )
    return affected
  }
)

/** Split a pane and insert a new leaf. */
export const splitPaneAtom = atom(
  null,
  (
    get,
    set,
    {
      workspaceId,
      paneId,
      direction,
      newLeaf,
      position,
    }: {
      workspaceId: string
      paneId: string
      direction: 'horizontal' | 'vertical'
      newLeaf: PaneLeaf
      position?: 'before' | 'after'
    }
  ) => {
    set(
      workspacesAtom,
      get(workspacesAtom).map((w) => {
        if (w.id !== workspaceId) return w
        const newLayout = position
          ? insertLeaf(w.layout, paneId, direction, newLeaf, position)
          : splitLeaf(w.layout, paneId, direction, newLeaf)
        return { ...w, layout: newLayout, focusedPaneId: newLeaf.paneId }
      })
    )
  }
)

/** Remove a pane. Removes the workspace if it was the last pane. */
export const closePaneAtom = atom(
  null,
  (get, set, { workspaceId, paneId }: { workspaceId: string; paneId: string }) => {
    const workspaces = get(workspacesAtom)
    const ws = workspaces.find((w) => w.id === workspaceId)
    if (!ws) return

    const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
    if (leaf) CloseChannel(leaf.channelId).catch(() => {})

    const newLayout = removeLeaf(ws.layout, paneId)
    if (newLayout === null) {
      set(
        workspacesAtom,
        workspaces.filter((w) => w.id !== workspaceId)
      )
      return
    }

    const newFocused = ws.focusedPaneId === paneId ? firstLeaf(newLayout).paneId : ws.focusedPaneId
    set(
      workspacesAtom,
      workspaces.map((w) =>
        w.id === workspaceId ? { ...w, layout: newLayout, focusedPaneId: newFocused } : w
      )
    )
  }
)

/** Move a pane within the same workspace or across workspaces. */
export const movePaneAtom = atom(
  null,
  (
    get,
    set,
    {
      sourcePaneId,
      sourceWorkspaceId,
      targetWorkspaceId,
      targetPaneId,
      direction,
      position,
    }: {
      sourcePaneId: string
      sourceWorkspaceId: string
      targetWorkspaceId: string
      targetPaneId: string
      direction: 'horizontal' | 'vertical'
      position: 'before' | 'after'
    }
  ) => {
    const workspaces = get(workspacesAtom)
    if (sourceWorkspaceId === targetWorkspaceId) {
      set(
        workspacesAtom,
        workspaces.map((w) => {
          if (w.id !== sourceWorkspaceId) return w
          const newLayout = moveLeaf(w.layout, sourcePaneId, targetPaneId, direction, position)
          if (!newLayout) return w
          return { ...w, layout: newLayout, focusedPaneId: sourcePaneId }
        })
      )
    } else {
      set(
        workspacesAtom,
        movePaneAcrossWorkspaces(
          workspaces,
          sourcePaneId,
          sourceWorkspaceId,
          targetWorkspaceId,
          targetPaneId,
          direction,
          position
        )
      )
    }
  }
)

/**
 * Find the focused connected leaf in the active workspace and call the action.
 * Toasts "No active session" if no connected leaf is focused.
 */
export const requireActiveLeafAtom = atom(
  null,
  (
    get,
    _set,
    { action }: { action: (leaf: PaneLeaf & { status: 'connected' }) => void | Promise<void> }
  ) => {
    const activeId = get(activeWorkspaceIdAtom)
    const ws = activeId ? get(workspacesAtom).find((w) => w.id === activeId) : undefined
    if (!ws || !ws.focusedPaneId) {
      toast.error('No active session')
      return
    }
    const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
    if (!leaf || leaf.status !== 'connected') {
      toast.error('No active session')
      return
    }
    action(leaf as PaneLeaf & { status: 'connected' })
  }
)

/**
 * Disconnect all connected leaves across all workspaces.
 * Toasts "No active sessions" if none are connected.
 */
export const disconnectAllAtom = atom(null, (get) => {
  const allLeaves = get(workspacesAtom).flatMap((w) => collectLeaves(w.layout))
  const connected = allLeaves.filter((l) => l.status === 'connected')
  if (connected.length === 0) {
    toast.error('No active sessions')
    return
  }
  Promise.allSettled(connected.map((l) => CloseChannel(l.channelId)))
})
```

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/workspaceActions.ts
git commit -m "refactor(ui): add workspace action atoms

Write-only Jotai atoms for patchLeaf, splitPane, closePane,
movePane, requireActiveLeaf, and disconnectAll."
```

---

### Task 4: Extract useMenuEvents hook

**Files:**
- Create: `frontend/src/hooks/useMenuEvents.ts`

- [ ] **Step 1: Create useMenuEvents**

Create `frontend/src/hooks/useMenuEvents.ts`:

```typescript
import { useSetAtom } from 'jotai'
import { useWailsEvent } from './useWailsEvent'
import {
  isQuickConnectOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
  isAddHostOpenAtom,
  isNewGroupOpenAtom,
  isTerminalProfilesOpenAtom,
  isExportHostsOpenAtom,
  pendingHostKeyAtom,
} from '../store/atoms'

export function useMenuEvents() {
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsNewGroupOpen = useSetAtom(isNewGroupOpenAtom)
  const setIsTerminalProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const setIsExportHostsOpen = useSetAtom(isExportHostsOpenAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)

  useWailsEvent('menu:new-connection', () => setIsQuickConnectOpen(true))
  useWailsEvent('menu:import-ssh-config', () => setIsImportSSHConfigOpen(true))
  useWailsEvent('menu:settings', () => setIsSettingsOpen(true))
  useWailsEvent('menu:add-host', () => setIsAddHostOpen(true))
  useWailsEvent('menu:new-group', () => setIsNewGroupOpen(true))
  useWailsEvent('menu:terminal-profiles', () => setIsTerminalProfilesOpen(true))
  useWailsEvent('menu:export-hosts', () => setIsExportHostsOpen(true))
  useWailsEvent('connection:hostkey', (event) => setPendingHostKey(event))
}
```

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useMenuEvents.ts
git commit -m "refactor(ui): extract useMenuEvents hook

Handles 7 menu:* dialog openers + connection:hostkey event."
```

---

### Task 5: Extract useChannelEvents hook

**Files:**
- Create: `frontend/src/hooks/useChannelEvents.ts`

- [ ] **Step 1: Create useChannelEvents**

Create `frontend/src/hooks/useChannelEvents.ts`:

```typescript
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useWailsEvent } from './useWailsEvent'
import { connectingHostIdsAtom, portForwardsAtom } from '../store/atoms'
import { patchLeafByChannelIdAtom } from '../store/workspaceActions'
import { workspacesAtom } from '../store/workspaces'
import { collectLeaves } from '../lib/paneTree'
import { useAtomCallback } from 'jotai/utils'
import { useCallback } from 'react'

export function useChannelEvents() {
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setPortForwards = useSetAtom(portForwardsAtom)
  const patchLeaf = useSetAtom(patchLeafByChannelIdAtom)

  const getWorkspaces = useAtomCallback(useCallback((get) => get(workspacesAtom), []))

  useWailsEvent('channel:status', (event) => {
    const { channelId, status } = event

    if (status === 'connecting') return

    if (status === 'connected') {
      const allLeaves = getWorkspaces().flatMap((w) => collectLeaves(w.layout))
      const leaf = allLeaves.find((l) => l.channelId === channelId)
      if (leaf) {
        setConnectingIds((prev) => {
          const next = new Set(prev)
          next.delete(leaf.hostId)
          return next
        })
      }
      patchLeaf({ channelId, patch: { status: 'connected', connectedAt: new Date().toISOString() } })
      return
    }

    if (status === 'error') {
      const allLeaves = getWorkspaces().flatMap((w) => collectLeaves(w.layout))
      const leaf = allLeaves.find((l) => l.channelId === channelId)
      if (leaf) {
        setConnectingIds((prev) => {
          const next = new Set(prev)
          next.delete(leaf.hostId)
          return next
        })
      }
      patchLeaf({ channelId, patch: { status: 'error' } })
      toast.error('SSH channel error', { description: event.error })
      return
    }

    if (status === 'disconnected') {
      patchLeaf({ channelId, patch: { status: 'disconnected' } })
      setPortForwards((prev) => {
        const next = { ...prev }
        delete next[channelId]
        return next
      })
    }
  })
}
```

Note: We use `useAtomCallback` here specifically because the `channel:status` handler needs to read the current workspaces to find the leaf's `hostId` for removing from `connectingHostIdsAtom`. The `patchLeafByChannelIdAtom` action atom handles the workspace mutation itself via `get`, but the `hostId` lookup is a read-only operation that doesn't fit into any action atom.

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useChannelEvents.ts
git commit -m "refactor(ui): extract useChannelEvents hook

Handles channel:status event using patchLeafByChannelIdAtom."
```

---

### Task 6: Extract useConnectionEvents hook

**Files:**
- Create: `frontend/src/hooks/useConnectionEvents.ts`

- [ ] **Step 1: Create useConnectionEvents**

Create `frontend/src/hooks/useConnectionEvents.ts`:

```typescript
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useWailsEvent } from './useWailsEvent'
import { portForwardsAtom } from '../store/atoms'
import { patchLeavesByConnectionIdAtom } from '../store/workspaceActions'

export function useConnectionEvents() {
  const setPortForwards = useSetAtom(portForwardsAtom)
  const patchLeaves = useSetAtom(patchLeavesByConnectionIdAtom)

  useWailsEvent('connection:status', (event) => {
    const { connectionId } = event

    if (event.status === 'reconnecting') {
      patchLeaves({ connectionId, patch: { status: 'reconnecting' } })
      return
    }

    if (event.status === 'connected') {
      patchLeaves({ connectionId, patch: { status: 'connected' } })
      return
    }

    if (event.status === 'failed') {
      patchLeaves({ connectionId, patch: { status: 'failed' } })
      toast.error('Reconnection failed', { description: event.error })
      return
    }

    if (event.status === 'disconnected') {
      const affected = patchLeaves({ connectionId, patch: { status: 'disconnected' } })
      if (affected) {
        setPortForwards((prev) => {
          const next = { ...prev }
          for (const leaf of affected) {
            delete next[leaf.channelId]
          }
          return next
        })
      }
    }
  })
}
```

Note: `patchLeavesByConnectionIdAtom` returns the `affected` leaves array so that this hook can clean up port forwards for the affected channelIds.

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useConnectionEvents.ts
git commit -m "refactor(ui): extract useConnectionEvents hook

Handles connection:status event using patchLeavesByConnectionIdAtom."
```

---

### Task 7: Extract useSessionMenuEvents hook

**Files:**
- Create: `frontend/src/hooks/useSessionMenuEvents.ts`

- [ ] **Step 1: Create useSessionMenuEvents**

Create `frontend/src/hooks/useSessionMenuEvents.ts`:

```typescript
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useWailsEvent } from './useWailsEvent'
import {
  addPortForwardConnectionIdAtom,
  activeLogsAtom,
  isLogViewerOpenAtom,
} from '../store/atoms'
import { requireActiveLeafAtom, disconnectAllAtom } from '../store/workspaceActions'
import { CloseChannel, StartSessionLog, StopSessionLog } from '../../wailsjs/go/main/SessionFacade'
import { OpenLogsDirectory } from '../../wailsjs/go/main/ToolsFacade'
import { useAtomCallback } from 'jotai/utils'
import { useCallback } from 'react'

export function useSessionMenuEvents() {
  const requireActiveLeaf = useSetAtom(requireActiveLeafAtom)
  const disconnectAll = useSetAtom(disconnectAllAtom)
  const setAddPortForwardConnectionId = useSetAtom(addPortForwardConnectionIdAtom)
  const setActiveLogs = useSetAtom(activeLogsAtom)
  const setIsLogViewerOpen = useSetAtom(isLogViewerOpenAtom)

  const getActiveLogs = useAtomCallback(useCallback((get) => get(activeLogsAtom), []))

  useWailsEvent('menu:session:disconnect', () => {
    requireActiveLeaf({
      action: async (leaf) => {
        try {
          await CloseChannel(leaf.channelId)
        } catch (err) {
          toast.error('Failed to disconnect', { description: String(err) })
        }
      },
    })
  })

  useWailsEvent('menu:session:disconnect-all', () => {
    disconnectAll()
  })

  useWailsEvent('menu:session:add-port-forward', () => {
    requireActiveLeaf({
      action: (leaf) => setAddPortForwardConnectionId(leaf.connectionId),
    })
  })

  useWailsEvent('menu:session:start-log', () => {
    requireActiveLeaf({
      action: async (leaf) => {
        if (getActiveLogs().get(leaf.channelId)) {
          toast.error('Already logging this session')
          return
        }
        try {
          const path = await StartSessionLog(leaf.channelId)
          setActiveLogs((prev) => new Map(prev).set(leaf.channelId, path))
          toast.success('Session logging started')
        } catch (err) {
          toast.error('Failed to start logging', { description: String(err) })
        }
      },
    })
  })

  useWailsEvent('menu:session:stop-log', () => {
    requireActiveLeaf({
      action: async (leaf) => {
        if (!getActiveLogs().get(leaf.channelId)) {
          toast.error('Not currently logging this session')
          return
        }
        try {
          await StopSessionLog(leaf.channelId)
          setActiveLogs((prev) => {
            const next = new Map(prev)
            next.delete(leaf.channelId)
            return next
          })
          toast.success('Session logging stopped')
        } catch (err) {
          toast.error('Failed to stop logging', { description: String(err) })
        }
      },
    })
  })

  useWailsEvent('menu:session:view-logs', () => setIsLogViewerOpen(true))
  useWailsEvent('menu:session:open-logs-folder', () => OpenLogsDirectory())
}
```

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSessionMenuEvents.ts
git commit -m "refactor(ui): extract useSessionMenuEvents hook

Handles 7 menu:session:* events using requireActiveLeafAtom
and disconnectAllAtom."
```

---

### Task 8: Rewrite useAppInit as thin orchestrator

**Files:**
- Modify: `frontend/src/store/useAppInit.ts`

- [ ] **Step 1: Replace useAppInit with orchestrator**

Replace the entire contents of `frontend/src/store/useAppInit.ts` with:

```typescript
import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { Host, Group, TerminalProfile } from '../types'
import { ListHosts, ListGroups, ListTerminalProfiles } from '../../wailsjs/go/main/HostFacade'
import { hostsAtom, groupsAtom, terminalProfilesAtom } from './atoms'
import { debugPanelOpenAtom } from './debugStore'
import { useDebugEvents } from '../hooks/useDebugEvents'
import { useChannelEvents } from '../hooks/useChannelEvents'
import { useConnectionEvents } from '../hooks/useConnectionEvents'
import { useMenuEvents } from '../hooks/useMenuEvents'
import { useSessionMenuEvents } from '../hooks/useSessionMenuEvents'

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)
  const setDebugPanelOpen = useSetAtom(debugPanelOpenAtom)

  useEffect(() => {
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err: unknown) => toast.error('Failed to load hosts', { description: String(err) }))
    ListGroups()
      .then((groups) => setGroups(groups as unknown as Group[]))
      .catch((err: unknown) => toast.error('Failed to load groups', { description: String(err) }))
    ListTerminalProfiles()
      .then((profiles: unknown) => setTerminalProfiles(profiles as unknown as TerminalProfile[]))
      .catch((err: unknown) =>
        toast.error('Failed to load terminal profiles', { description: String(err) })
      )
  }, [setHosts, setGroups, setTerminalProfiles])

  useDebugEvents()
  useChannelEvents()
  useConnectionEvents()
  useMenuEvents()
  useSessionMenuEvents()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setDebugPanelOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setDebugPanelOpen])
}
```

- [ ] **Step 2: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS — all event handling now delegated to extracted hooks.

- [ ] **Step 3: Run lint to verify**

Run: `cd frontend && pnpm lint`
Expected: PASS — no unused imports or variables.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/useAppInit.ts
git commit -m "refactor(ui): reduce useAppInit to thin orchestrator

370 lines → ~40 lines. All event subscriptions delegated to
domain hooks. Refs eliminated — action atoms read state via get()."
```

---

### Task 9: Simplify WorkspaceView with action atoms

**Files:**
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Replace handleSplit inline mutation with splitPaneAtom**

In `frontend/src/components/terminal/WorkspaceView.tsx`, replace the imports and add the action atom import. Change the import block at the top:

Replace:
```typescript
import { useAtomValue, useAtom } from 'jotai'
```
With:
```typescript
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
```

Add after the existing store imports:
```typescript
import { splitPaneAtom, closePaneAtom, movePaneAtom } from '../../store/workspaceActions'
```

Remove these imports that will no longer be used directly (they're now consumed inside action atoms):
```typescript
import {
  collectLeaves,
  splitLeaf,
  removeLeaf,
  firstLeaf,
  moveLeaf,
  insertLeaf,
  movePaneAcrossWorkspaces,
} from '../../lib/paneTree'
```

Replace with just what's still needed:
```typescript
import { collectLeaves, firstLeaf } from '../../lib/paneTree'
```

Note: `collectLeaves` is still used in `buildLiveTree` context and JSX for finding focused leaf. `firstLeaf` is still used in `openTemplate`.

- [ ] **Step 2: Add action atom hooks inside the component**

Inside `WorkspaceView()`, after the existing `useAtom`/`useAtomValue` calls, add:

```typescript
const splitPane = useSetAtom(splitPaneAtom)
const closePane = useSetAtom(closePaneAtom)
const movePane = useSetAtom(movePaneAtom)
```

Remove these lines that are no longer needed:
```typescript
const workspacesRef = useRef(workspaces)
workspacesRef.current = workspaces
const hostsRef = useRef(hosts)
hostsRef.current = hosts
```

- [ ] **Step 3: Replace handleSplit setWorkspaces call**

In `handleSplit`, replace the `setWorkspaces` call (lines 152-164):

```typescript
        setWorkspaces((prev) =>
          prev.map((w) => {
            if (w.id !== workspaceId) return w
            const newLayout = position
              ? insertLeaf(w.layout, paneId, direction, newLeaf, position)
              : splitLeaf(w.layout, paneId, direction, newLeaf)
            return {
              ...w,
              layout: newLayout,
              focusedPaneId: newLeaf.paneId,
            }
          })
        )
```

With:

```typescript
        splitPane({ workspaceId, paneId, direction, newLeaf, position })
```

Also in `handleSplit`, replace `workspacesRef.current` with `workspaces` (line 77) and `hostsRef.current` with `hosts` (lines 100, 119):

Replace `const ws = workspacesRef.current.find((w) => w.id === workspaceId)` with `const ws = workspaces.find((w) => w.id === workspaceId)`.

Replace `const host = hostsRef.current.find((h) => h.id === hostId)` (both occurrences) with `const host = hosts.find((h) => h.id === hostId)`.

Update the `useCallback` dependency array for `handleSplit` from `[setWorkspaces]` to `[workspaces, hosts, splitPane]`.

- [ ] **Step 4: Replace handleClose setWorkspaces call**

Replace the entire `handleClose` callback (lines 274-293):

```typescript
  const handleClose = useCallback(
    (workspaceId: string, paneId: string) => {
      setWorkspaces((prev) => {
        const ws = prev.find((w) => w.id === workspaceId)
        if (!ws) return prev
        const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
        if (leaf) CloseChannel(leaf.channelId).catch(() => {})
        const newLayout = removeLeaf(ws.layout, paneId)
        if (newLayout === null) {
          return prev.filter((w) => w.id !== workspaceId)
        }
        const newFocused =
          ws.focusedPaneId === paneId ? firstLeaf(newLayout).paneId : ws.focusedPaneId
        return prev.map((w) =>
          w.id === workspaceId ? { ...w, layout: newLayout, focusedPaneId: newFocused } : w
        )
      })
    },
    [setWorkspaces]
  )
```

With:

```typescript
  const handleClose = useCallback(
    (workspaceId: string, paneId: string) => {
      closePane({ workspaceId, paneId })
    },
    [closePane]
  )
```

- [ ] **Step 5: Replace handleMovePane setWorkspaces call**

Replace the entire `handleMovePane` callback (lines 295-327):

```typescript
  const handleMovePane = useCallback(
    (
      sourceWorkspaceId: string,
      sourcePaneId: string,
      targetWorkspaceId: string,
      targetPaneId: string,
      direction: 'horizontal' | 'vertical',
      position: 'before' | 'after'
    ) => {
      setWorkspaces((prev) => {
        // Same workspace move
        if (sourceWorkspaceId === targetWorkspaceId) {
          return prev.map((w) => {
            if (w.id !== sourceWorkspaceId) return w
            const newLayout = moveLeaf(w.layout, sourcePaneId, targetPaneId, direction, position)
            if (!newLayout) return w
            return { ...w, layout: newLayout, focusedPaneId: sourcePaneId }
          })
        }
        // Cross-workspace move
        return movePaneAcrossWorkspaces(
          prev,
          sourcePaneId,
          sourceWorkspaceId,
          targetWorkspaceId,
          targetPaneId,
          direction,
          position
        )
      })
    },
    [setWorkspaces]
  )
```

With:

```typescript
  const handleMovePane = useCallback(
    (
      sourceWorkspaceId: string,
      sourcePaneId: string,
      targetWorkspaceId: string,
      targetPaneId: string,
      direction: 'horizontal' | 'vertical',
      position: 'before' | 'after'
    ) => {
      movePane({
        sourcePaneId,
        sourceWorkspaceId,
        targetWorkspaceId,
        targetPaneId,
        direction,
        position,
      })
    },
    [movePane]
  )
```

- [ ] **Step 6: Clean up unused imports**

Remove `CloseChannel` from the `SessionFacade` import (it's now only used inside `closePaneAtom`). The remaining imports from `SessionFacade` should be:

```typescript
import {
  StartSessionLog,
  StopSessionLog,
  OpenTerminal,
  OpenSFTPChannel,
  OpenLocalFSChannel,
  ConnectHost,
} from '../../../wailsjs/go/main/SessionFacade'
```

Remove `useRef` from the React import since `workspacesRef` and `hostsRef` are gone:

```typescript
import { useState, useEffect, useCallback } from 'react'
```

Remove `PaneNode` from the type import if it's no longer used (check — it's used in `buildLiveTree` return type):

```typescript
import type { PaneLeaf, PaneNode } from '../../store/workspaces'
```

Keep `PaneNode` — it's still used by `buildLiveTree`.

Also remove `setWorkspaces` — change `const [workspaces, setWorkspaces] = useAtom(workspacesAtom)` to `const workspaces = useAtomValue(workspacesAtom)`. But `setWorkspaces` is still used in `openTemplate` (line 250). So keep it as `useAtom`.

- [ ] **Step 7: Run build to verify**

Run: `cd frontend && pnpm build`
Expected: PASS

- [ ] **Step 8: Run lint**

Run: `cd frontend && pnpm lint`
Expected: PASS — no unused imports.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "refactor(ui): simplify WorkspaceView with action atoms

Replace ~60 lines of inline setWorkspaces mutations with
splitPaneAtom, closePaneAtom, and movePaneAtom dispatches."
```

---

### Task 10: Final cleanup and verification

**Files:**
- All modified files

- [ ] **Step 1: Run full frontend checks**

```bash
cd frontend && pnpm build && pnpm lint && pnpm format:check
```

Expected: All PASS.

- [ ] **Step 2: Run Go checks**

```bash
go vet ./internal/...
go test ./internal/... -race -timeout 60s
```

Expected: All PASS (no Go changes, but verify nothing broke).

- [ ] **Step 3: Verify useAppInit line count**

Run: `wc -l frontend/src/store/useAppInit.ts`
Expected: ~45 lines (imports + function body).

- [ ] **Step 4: Verify no stale refs remain**

Run: `grep -r 'workspacesRef\|activeWorkspaceIdRef' frontend/src/store/useAppInit.ts`
Expected: No matches.

- [ ] **Step 5: Commit any format fixes**

If `pnpm format:check` fails, run `cd frontend && pnpm format` and commit:

```bash
git add -u frontend/src/
git commit -m "chore(ui): format after useAppInit decomposition"
```

- [ ] **Step 6: Final commit with issue reference**

If all previous commits are clean, no additional commit needed. Verify the branch is ready:

```bash
git log --oneline main..HEAD
```

Expected: Series of focused refactor commits for issue #44.
