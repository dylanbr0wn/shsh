import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { SessionStatus, Host, Group } from '../types'
import { ListHosts, ListGroups } from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import {
  hostsAtom,
  groupsAtom,
  sessionsAtom,
  activeSessionIdAtom,
  connectingHostIdsAtom,
  pendingHostKeyAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
  portForwardsAtom,
  type PendingHostKey,
} from './atoms'

// Pending sessions: sessionId → hostId, waiting for "connected" to open the session.
// This is a coordination mechanism between Go RPC return and async event, not UI state.
export const pendingConnects = new Map<string, { hostId: string; hostLabel: string }>()

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const setActiveSessionId = useSetAtom(activeSessionIdAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setPortForwards = useSetAtom(portForwardsAtom)

  useEffect(() => {
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err) => toast.error('Failed to load hosts', { description: String(err) }))
    ListGroups()
      .then((groups) => setGroups(groups as unknown as Group[]))
      .catch((err) => toast.error('Failed to load groups', { description: String(err) }))
  }, [setHosts, setGroups])

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
          setPortForwards((prev) => {
            const next = { ...prev }
            delete next[sessionId]
            return next
          })
        }
      }
    )
    return () => cancel()
  }, [setActiveSessionId, setConnectingIds, setSessions, setPortForwards])

  useEffect(() => {
    const cancelHK = EventsOn('session:hostkey', (event: PendingHostKey) => {
      setPendingHostKey(event)
    })
    return () => cancelHK()
  }, [setPendingHostKey])

  useEffect(() => {
    const c1 = EventsOn('menu:new-connection', () => setIsAddHostOpen(true))
    const c2 = EventsOn('menu:import-ssh-config', () => setIsImportSSHConfigOpen(true))
    const c3 = EventsOn('menu:settings', () => setIsSettingsOpen(true))
    return () => {
      c1()
      c2()
      c3()
    }
  }, [setIsAddHostOpen, setIsImportSSHConfigOpen, setIsSettingsOpen])
}
