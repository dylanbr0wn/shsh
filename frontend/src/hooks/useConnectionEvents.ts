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
