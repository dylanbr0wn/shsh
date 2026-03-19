import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { SessionStatus, Host } from '../types'
import { ListHosts } from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import {
  hostsAtom,
  sessionsAtom,
  activeSessionIdAtom,
  connectingHostIdsAtom,
  pendingHostKeyAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
  type PendingHostKey,
} from './atoms'

// Pending sessions: sessionId → hostId, waiting for "connected" to open the session.
// This is a coordination mechanism between Go RPC return and async event, not UI state.
export const pendingConnects = new Map<string, { hostId: string; hostLabel: string }>()

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const setActiveSessionId = useSetAtom(activeSessionIdAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)

  useEffect(() => {
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err) => toast.error('Failed to load hosts', { description: String(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Jotai setters are referentially stable
  }, [])

  useEffect(() => {
    const cancel = EventsOn(
      'session:status',
      (event: { sessionId: string; status: SessionStatus; error?: string }) => {
        const { sessionId, status } = event
        console.log(`Session ${sessionId} status: ${status}`)

        if (status === 'connecting') {
          return
        }

        if (status === 'connected') {
          const pending = pendingConnects.get(sessionId)
          if (pending) {
            pendingConnects.delete(sessionId)
            setConnectingIds((prev) => {
              const next = new Set(prev)
              next.delete(pending.hostId)
              return next
            })
            setSessions((prev) => [
              ...prev,
              {
                id: sessionId,
                hostId: pending.hostId,
                hostLabel: pending.hostLabel,
                status: 'connected',
                connectedAt: new Date().toISOString(),
              },
            ])
            setActiveSessionId(sessionId)
          }
          return
        }

        if (status === 'error') {
          const pending = pendingConnects.get(sessionId)
          if (pending) {
            pendingConnects.delete(sessionId)
            setConnectingIds((prev) => {
              const next = new Set(prev)
              next.delete(pending.hostId)
              return next
            })
          }
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, status: 'error' as SessionStatus } : s))
          )
          toast.error('SSH session error', { description: event.error })
          return
        }

        if (status === 'disconnected') {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, status: 'disconnected' as SessionStatus } : s
            )
          )
        }
      }
    )
    return () => cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Jotai setters are referentially stable
  }, [])

  useEffect(() => {
    const cancelHK = EventsOn('session:hostkey', (event: PendingHostKey) => {
      setPendingHostKey(event)
    })
    return () => cancelHK()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Jotai setters are referentially stable
  }, [])

  useEffect(() => {
    const c1 = EventsOn('menu:new-connection', () => setIsAddHostOpen(true))
    const c2 = EventsOn('menu:import-ssh-config', () => setIsImportSSHConfigOpen(true))
    const c3 = EventsOn('menu:settings', () => setIsSettingsOpen(true))
    return () => {
      c1()
      c2()
      c3()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Jotai setters are referentially stable
  }, [])
}
