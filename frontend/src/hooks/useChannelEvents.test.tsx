import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { EventsOn } from '@wailsjs/runtime/runtime'
import { toast } from 'sonner'
import { useChannelEvents } from './useChannelEvents'
import { connectingHostIdsAtom, portForwardsAtom } from '../store/atoms'
import { workspacesAtom } from '../store/workspaces'
import type { PaneLeaf, Workspace } from '../store/workspaces'

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
    status: 'connecting',
    ...overrides,
  } as PaneLeaf
}

function workspace(id: string, layout: PaneLeaf): Workspace {
  return {
    id,
    label: `Workspace ${id}`,
    layout,
    focusedPaneId: layout.paneId,
  }
}

// ---------------------------------------------------------------------------
// Jotai Provider wrapper with atom hydration
// ---------------------------------------------------------------------------

function HydrateAtoms({
  atoms,
  children,
}: {
  atoms: Array<[unknown, unknown]>
  children: React.ReactNode
}) {
  useHydrateAtoms(atoms as Parameters<typeof useHydrateAtoms>[0])
  return <>{children}</>
}

function createWrapper(
  workspaces: Workspace[],
  connectingHostIds: Set<string> = new Set(),
  portForwards: Record<string, unknown> = {}
) {
  const store = createStore()
  return {
    store,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        Provider,
        { store },
        React.createElement(
          HydrateAtoms,
          {
            atoms: [
              [workspacesAtom, workspaces],
              [connectingHostIdsAtom, connectingHostIds],
              [portForwardsAtom, portForwards],
            ],
          },
          children
        )
      ),
  }
}

// ---------------------------------------------------------------------------
// Event handler capture
// ---------------------------------------------------------------------------

let channelStatusHandler: (payload: unknown) => void = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(EventsOn).mockImplementation((_event, handler) => {
    channelStatusHandler = handler
    return vi.fn()
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChannelEvents', () => {
  describe("status: 'connecting'", () => {
    it('ignores the event — connectingHostIds is not modified', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const initialConnecting = new Set(['host-a'])
      const { store, wrapper } = createWrapper([ws], initialConnecting)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'connecting',
        })
      })

      expect(store.get(connectingHostIdsAtom)).toEqual(new Set(['host-a']))
    })

    it('ignores the event — workspaces leaf status is not modified', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { store, wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'connecting',
        })
      })

      const resultLeaf = store.get(workspacesAtom)[0].layout as PaneLeaf
      expect(resultLeaf.status).toBe('connecting')
    })
  })

  describe("status: 'connected'", () => {
    it('removes hostId from connectingHostIds', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const initialConnecting = new Set(['host-a', 'host-b'])
      const { store, wrapper } = createWrapper([ws], initialConnecting)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'connected',
        })
      })

      const connecting = store.get(connectingHostIdsAtom)
      expect(connecting.has('host-a')).toBe(false)
      expect(connecting.has('host-b')).toBe(true)
    })

    it('patches leaf status to connected and sets connectedAt', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { store, wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'connected',
        })
      })

      const resultLeaf = store.get(workspacesAtom)[0].layout as PaneLeaf
      expect(resultLeaf.status).toBe('connected')
      expect((resultLeaf as { connectedAt?: string }).connectedAt).toBeTruthy()
      expect(typeof (resultLeaf as { connectedAt?: string }).connectedAt).toBe('string')
    })

    it('does not call toast.error', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'connected',
        })
      })

      expect(toast.error).not.toHaveBeenCalled()
    })

    it('does not modify connectingHostIds when leaf is not found', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const initialConnecting = new Set(['host-x'])
      const { store, wrapper } = createWrapper([ws], initialConnecting)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-unknown',
          connectionId: 'conn-x',
          kind: 'terminal',
          status: 'connected',
        })
      })

      expect(store.get(connectingHostIdsAtom)).toEqual(new Set(['host-x']))
    })
  })

  describe("status: 'error'", () => {
    it('patches leaf status to error', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { store, wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'error',
          error: 'connection refused',
        })
      })

      const resultLeaf = store.get(workspacesAtom)[0].layout as PaneLeaf
      expect(resultLeaf.status).toBe('error')
    })

    it('calls toast.error with SSH channel error message and description', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'error',
          error: 'connection refused',
        })
      })

      expect(toast.error).toHaveBeenCalledWith('SSH channel error', {
        description: 'connection refused',
      })
    })

    it('removes hostId from connectingHostIds on error', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const initialConnecting = new Set(['host-a'])
      const { store, wrapper } = createWrapper([ws], initialConnecting)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'error',
          error: 'timeout',
        })
      })

      expect(store.get(connectingHostIdsAtom).has('host-a')).toBe(false)
    })

    it('calls toast.error with undefined description when error field is absent', () => {
      const la = leaf('a')
      const ws = workspace('ws1', la)
      const { wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'error',
        })
      })

      expect(toast.error).toHaveBeenCalledWith('SSH channel error', { description: undefined })
    })
  })

  describe("status: 'disconnected'", () => {
    it('patches leaf status to disconnected', () => {
      const la = leaf('a', { status: 'connected' })
      const ws = workspace('ws1', la)
      const { store, wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'disconnected',
        })
      })

      const resultLeaf = store.get(workspacesAtom)[0].layout as PaneLeaf
      expect(resultLeaf.status).toBe('disconnected')
    })

    it('removes the channelId entry from portForwards', () => {
      const la = leaf('a', { status: 'connected' })
      const ws = workspace('ws1', la)
      const initialPortForwards = { 'ch-a': { forwards: [] }, 'ch-b': { forwards: [] } }
      const { store, wrapper } = createWrapper([ws], new Set(), initialPortForwards)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'disconnected',
        })
      })

      const portForwards = store.get(portForwardsAtom)
      expect(portForwards).not.toHaveProperty('ch-a')
      expect(portForwards).toHaveProperty('ch-b')
    })

    it('does not modify connectingHostIds on disconnect', () => {
      const la = leaf('a', { status: 'connected' })
      const ws = workspace('ws1', la)
      const initialConnecting = new Set(['host-a'])
      const { store, wrapper } = createWrapper([ws], initialConnecting)

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'disconnected',
        })
      })

      expect(store.get(connectingHostIdsAtom)).toEqual(new Set(['host-a']))
    })

    it('does not call toast.error on disconnect', () => {
      const la = leaf('a', { status: 'connected' })
      const ws = workspace('ws1', la)
      const { wrapper } = createWrapper([ws])

      renderHook(() => useChannelEvents(), { wrapper })

      act(() => {
        channelStatusHandler({
          channelId: 'ch-a',
          connectionId: 'conn-a',
          kind: 'terminal',
          status: 'disconnected',
        })
      })

      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
