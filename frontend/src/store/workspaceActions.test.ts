import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import type { PaneLeaf, SplitNode, PaneNode, Workspace } from './workspaces'
import { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
import {
  patchLeafByChannelIdAtom,
  patchLeavesByConnectionIdAtom,
  splitPaneAtom,
  closePaneAtom,
  movePaneAtom,
  requireActiveLeafAtom,
  disconnectAllAtom,
} from './workspaceActions'
import { CloseChannel } from '../../wailsjs/go/main/SessionFacade'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function leaf(id: string, overrides?: Partial<PaneLeaf>): PaneLeaf {
  return {
    type: 'leaf',
    kind: 'terminal',
    paneId: `pane-${id}`,
    connectionId: `conn-${id}`,
    channelId: `ch-${id}`,
    hostId: `host-${id}`,
    hostLabel: `Host ${id}`,
    status: 'connected',
    ...overrides,
  } as PaneLeaf
}

function split(
  left: PaneNode,
  right: PaneNode,
  direction: 'horizontal' | 'vertical' = 'horizontal'
): SplitNode {
  return { type: 'split', direction, ratio: 0.5, left, right }
}

function workspace(id: string, layout: PaneNode, focusedPaneId?: string | null): Workspace {
  return {
    id,
    label: `Workspace ${id}`,
    layout,
    focusedPaneId:
      focusedPaneId !== undefined ? focusedPaneId : layout.type === 'leaf' ? layout.paneId : null,
  }
}

function setupStore(workspaces: Workspace[], activeId?: string | null) {
  const store = createStore()
  store.set(workspacesAtom, workspaces)
  store.set(activeWorkspaceIdAtom, activeId ?? null)
  return store
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// patchLeafByChannelIdAtom
// ---------------------------------------------------------------------------

describe('patchLeafByChannelIdAtom', () => {
  it('patches matching leaf across multiple workspaces', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws1 = workspace('ws1', la)
    const ws2 = workspace('ws2', lb)
    const store = setupStore([ws1, ws2])

    store.set(patchLeafByChannelIdAtom, { channelId: 'ch-a', patch: { status: 'disconnected' } })

    const result = store.get(workspacesAtom)
    const ws1Layout = result.find((w) => w.id === 'ws1')!.layout as PaneLeaf
    const ws2Layout = result.find((w) => w.id === 'ws2')!.layout as PaneLeaf
    expect(ws1Layout.status).toBe('disconnected')
    expect(ws2Layout.status).toBe('connected')
  })

  it('non-matching channelId leaves state unchanged', () => {
    const la = leaf('a')
    const ws1 = workspace('ws1', la)
    const store = setupStore([ws1])
    const before = store.get(workspacesAtom)

    store.set(patchLeafByChannelIdAtom, {
      channelId: 'ch-nonexistent',
      patch: { status: 'disconnected' },
    })

    const after = store.get(workspacesAtom)
    // Layout references should be the same objects since nothing matched
    expect((after[0].layout as PaneLeaf).status).toBe('connected')
    expect(after[0].layout).toBe(before[0].layout)
  })
})

// ---------------------------------------------------------------------------
// patchLeavesByConnectionIdAtom
// ---------------------------------------------------------------------------

describe('patchLeavesByConnectionIdAtom', () => {
  it('patches all leaves sharing a connectionId and returns affected list', () => {
    const la1 = leaf('a1', { connectionId: 'shared-conn' })
    const la2 = leaf('a2', { connectionId: 'shared-conn' })
    const lb = leaf('b')
    const ws1 = workspace('ws1', split(la1, lb))
    const ws2 = workspace('ws2', la2)
    const store = setupStore([ws1, ws2])

    const affected = store.set(patchLeavesByConnectionIdAtom, {
      connectionId: 'shared-conn',
      patch: { status: 'disconnected' },
    })

    expect(affected).toHaveLength(2)
    expect(affected.map((l) => l.channelId).sort()).toEqual(['ch-a1', 'ch-a2'].sort())

    const workspaces = store.get(workspacesAtom)
    // Both la1 and la2 should be patched
    const ws1Leaves = workspaces.find((w) => w.id === 'ws1')!
    const ws2Leaves = workspaces.find((w) => w.id === 'ws2')!
    // la1 should be patched
    const la1InLayout = (ws1Leaves.layout as SplitNode).left as PaneLeaf
    expect(la1InLayout.status).toBe('disconnected')
    // lb should be unchanged
    const lbInLayout = (ws1Leaves.layout as SplitNode).right as PaneLeaf
    expect(lbInLayout.status).toBe('connected')
    // la2 should be patched
    expect((ws2Leaves.layout as PaneLeaf).status).toBe('disconnected')
  })

  it('returns empty array when no matches', () => {
    const la = leaf('a')
    const store = setupStore([workspace('ws1', la)])

    const affected = store.set(patchLeavesByConnectionIdAtom, {
      connectionId: 'no-such-conn',
      patch: { status: 'disconnected' },
    })

    expect(affected).toEqual([])
    // State should be unchanged
    expect((store.get(workspacesAtom)[0].layout as PaneLeaf).status).toBe('connected')
  })
})

// ---------------------------------------------------------------------------
// splitPaneAtom
// ---------------------------------------------------------------------------

describe('splitPaneAtom', () => {
  it('default (no position) — uses splitLeaf, new leaf on right, focus updates to new leaf', () => {
    const la = leaf('a')
    const newL = leaf('new')
    const ws = workspace('ws1', la, 'pane-a')
    const store = setupStore([ws])

    store.set(splitPaneAtom, {
      workspaceId: 'ws1',
      paneId: 'pane-a',
      direction: 'horizontal',
      newLeaf: newL,
    })

    const result = store.get(workspacesAtom)[0]
    expect(result.focusedPaneId).toBe('pane-new')
    expect(result.layout).toEqual(split(la, newL, 'horizontal'))
  })

  it("with position='before' — uses insertLeaf, new leaf on left", () => {
    const la = leaf('a')
    const newL = leaf('new')
    const ws = workspace('ws1', la, 'pane-a')
    const store = setupStore([ws])

    store.set(splitPaneAtom, {
      workspaceId: 'ws1',
      paneId: 'pane-a',
      direction: 'horizontal',
      newLeaf: newL,
      position: 'before',
    })

    const result = store.get(workspacesAtom)[0]
    expect(result.focusedPaneId).toBe('pane-new')
    expect(result.layout).toEqual(split(newL, la, 'horizontal'))
  })

  it('only affects the matching workspace', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const newL = leaf('new')
    const ws1 = workspace('ws1', la)
    const ws2 = workspace('ws2', lb)
    const store = setupStore([ws1, ws2])

    store.set(splitPaneAtom, {
      workspaceId: 'ws1',
      paneId: 'pane-a',
      direction: 'horizontal',
      newLeaf: newL,
    })

    const workspaces = store.get(workspacesAtom)
    expect(workspaces.find((w) => w.id === 'ws2')!.layout).toBe(lb)
  })
})

// ---------------------------------------------------------------------------
// closePaneAtom
// ---------------------------------------------------------------------------

describe('closePaneAtom', () => {
  it('removes pane and calls CloseChannel with leaf channelId', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws = workspace('ws1', split(la, lb), 'pane-b')
    const store = setupStore([ws])

    store.set(closePaneAtom, { workspaceId: 'ws1', paneId: 'pane-a' })

    expect(CloseChannel).toHaveBeenCalledWith('ch-a')
    const result = store.get(workspacesAtom)[0].layout as PaneLeaf
    expect(result.paneId).toBe('pane-b')
  })

  it('removes workspace when last pane closed', () => {
    const la = leaf('a')
    const ws = workspace('ws1', la)
    const store = setupStore([ws])

    store.set(closePaneAtom, { workspaceId: 'ws1', paneId: 'pane-a' })

    expect(store.get(workspacesAtom)).toHaveLength(0)
  })

  it('updates focus to firstLeaf when focused pane closed', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    // ws focused on 'a', close 'a'
    const ws = workspace('ws1', split(la, split(lb, lc)), 'pane-a')
    const store = setupStore([ws])

    store.set(closePaneAtom, { workspaceId: 'ws1', paneId: 'pane-a' })

    const result = store.get(workspacesAtom)[0]
    // firstLeaf of remaining tree (lb | lc) should be lb
    expect(result.focusedPaneId).toBe('pane-b')
  })

  it('does not change focus when non-focused pane closed', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws = workspace('ws1', split(la, lb), 'pane-b')
    const store = setupStore([ws])

    store.set(closePaneAtom, { workspaceId: 'ws1', paneId: 'pane-a' })

    const result = store.get(workspacesAtom)[0]
    expect(result.focusedPaneId).toBe('pane-b')
  })
})

// ---------------------------------------------------------------------------
// movePaneAtom
// ---------------------------------------------------------------------------

describe('movePaneAtom', () => {
  it('intra-workspace move (same workspaceId)', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ws = workspace('ws1', split(la, split(lb, lc)), 'pane-a')
    const store = setupStore([ws])

    store.set(movePaneAtom, {
      sourcePaneId: 'pane-c',
      sourceWorkspaceId: 'ws1',
      targetWorkspaceId: 'ws1',
      targetPaneId: 'pane-a',
      direction: 'horizontal',
      position: 'before',
    })

    const result = store.get(workspacesAtom)[0]
    expect(result.focusedPaneId).toBe('pane-c')
    const leaves = [] as PaneLeaf[]
    const collect = (n: PaneNode): void => {
      if (n.type === 'leaf') {
        leaves.push(n)
        return
      }
      collect(n.left)
      collect(n.right)
    }
    collect(result.layout)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-c', 'pane-a', 'pane-b'])
  })

  it('cross-workspace move (different workspaceIds)', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ws1 = workspace('ws1', split(la, lb), 'pane-a')
    const ws2 = workspace('ws2', lc, 'pane-c')
    const store = setupStore([ws1, ws2])

    store.set(movePaneAtom, {
      sourcePaneId: 'pane-a',
      sourceWorkspaceId: 'ws1',
      targetWorkspaceId: 'ws2',
      targetPaneId: 'pane-c',
      direction: 'horizontal',
      position: 'after',
    })

    const workspaces = store.get(workspacesAtom)
    const sourceWs = workspaces.find((w) => w.id === 'ws1')!
    const targetWs = workspaces.find((w) => w.id === 'ws2')!

    expect((sourceWs.layout as PaneLeaf).paneId).toBe('pane-b')
    const targetLeaves: PaneLeaf[] = []
    const collect = (n: PaneNode): void => {
      if (n.type === 'leaf') {
        targetLeaves.push(n)
        return
      }
      collect(n.left)
      collect(n.right)
    }
    collect(targetWs.layout)
    expect(targetLeaves.map((l) => l.paneId)).toEqual(['pane-c', 'pane-a'])
    expect(targetWs.focusedPaneId).toBe('pane-a')
  })
})

// ---------------------------------------------------------------------------
// requireActiveLeafAtom
// ---------------------------------------------------------------------------

describe('requireActiveLeafAtom', () => {
  it('calls action with the connected focused leaf', () => {
    const la = leaf('a', { status: 'connected' })
    const ws = workspace('ws1', la, 'pane-a')
    const store = setupStore([ws], 'ws1')

    const action = vi.fn()
    store.set(requireActiveLeafAtom, { action })

    expect(action).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ paneId: 'pane-a', status: 'connected' })
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts error when no active workspace', () => {
    const la = leaf('a')
    const ws = workspace('ws1', la, 'pane-a')
    const store = setupStore([ws], null)

    const action = vi.fn()
    store.set(requireActiveLeafAtom, { action })

    expect(action).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active session')
  })

  it('toasts error when active workspace has no focusedPaneId', () => {
    const la = leaf('a')
    const ws = workspace('ws1', la, null)
    const store = setupStore([ws], 'ws1')

    const action = vi.fn()
    store.set(requireActiveLeafAtom, { action })

    expect(action).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active session')
  })

  it('toasts error when focused leaf is not connected', () => {
    const la = leaf('a', { status: 'disconnected' })
    const ws = workspace('ws1', la, 'pane-a')
    const store = setupStore([ws], 'ws1')

    const action = vi.fn()
    store.set(requireActiveLeafAtom, { action })

    expect(action).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active session')
  })
})

// ---------------------------------------------------------------------------
// disconnectAllAtom
// ---------------------------------------------------------------------------

describe('disconnectAllAtom', () => {
  it('calls CloseChannel for each connected leaf', async () => {
    const la = leaf('a', { status: 'connected' })
    const lb = leaf('b', { status: 'connected' })
    const ws = workspace('ws1', split(la, lb))
    const store = setupStore([ws])

    await store.set(disconnectAllAtom)

    expect(CloseChannel).toHaveBeenCalledTimes(2)
    expect(CloseChannel).toHaveBeenCalledWith('ch-a')
    expect(CloseChannel).toHaveBeenCalledWith('ch-b')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not call CloseChannel for disconnected leaves', async () => {
    const la = leaf('a', { status: 'connected' })
    const lb = leaf('b', { status: 'disconnected' })
    const ws = workspace('ws1', split(la, lb))
    const store = setupStore([ws])

    await store.set(disconnectAllAtom)

    expect(CloseChannel).toHaveBeenCalledTimes(1)
    expect(CloseChannel).toHaveBeenCalledWith('ch-a')
  })

  it('toasts error when no connected sessions', async () => {
    const la = leaf('a', { status: 'disconnected' })
    const ws = workspace('ws1', la)
    const store = setupStore([ws])

    await store.set(disconnectAllAtom)

    expect(CloseChannel).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active sessions')
  })

  it('toasts failure count on partial errors', async () => {
    const la = leaf('a', { status: 'connected' })
    const lb = leaf('b', { status: 'connected' })
    const ws = workspace('ws1', split(la, lb))
    const store = setupStore([ws])

    vi.mocked(CloseChannel)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('failed'))

    await store.set(disconnectAllAtom)

    expect(toast.error).toHaveBeenCalledWith('Failed to disconnect 1 session(s)')
  })
})
