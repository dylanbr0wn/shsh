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
