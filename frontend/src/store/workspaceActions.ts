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
export const patchLeavesByConnectionIdAtom = atom<
  null,
  [{ connectionId: string; patch: Partial<PaneLeaf> }],
  PaneLeaf[]
>(null, (get, set, { connectionId, patch }) => {
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
})

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
export const disconnectAllAtom = atom(null, async (get) => {
  const allLeaves = get(workspacesAtom).flatMap((w) => collectLeaves(w.layout))
  const connected = allLeaves.filter((l) => l.status === 'connected')
  if (connected.length === 0) {
    toast.error('No active sessions')
    return
  }
  const results = await Promise.allSettled(connected.map((l) => CloseChannel(l.channelId)))
  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    toast.error(`Failed to disconnect ${failures.length} session(s)`)
  }
})
