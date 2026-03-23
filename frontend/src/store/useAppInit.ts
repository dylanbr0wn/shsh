import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { SessionStatus, Host, Group, TerminalProfile } from '../types'
import {
  ListHosts,
  ListGroups,
  ListTerminalProfiles,
  DisconnectSession,
  StartSessionLog,
  StopSessionLog,
  OpenLogsDirectory,
} from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import {
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  sessionsAtom,
  activeSessionIdAtom,
  connectingHostIdsAtom,
  pendingHostKeyAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isExportHostsOpenAtom,
  isSettingsOpenAtom,
  isQuickConnectOpenAtom,
  isTerminalProfilesOpenAtom,
  isLogViewerOpenAtom,
  isNewGroupOpenAtom,
  addPortForwardSessionIdAtom,
  activeLogsAtom,
  portForwardsAtom,
  type PendingHostKey,
} from './atoms'

// Pending sessions: sessionId → hostId, waiting for "connected" to open the session.
// This is a coordination mechanism between Go RPC return and async event, not UI state.
export const pendingConnects = new Map<string, { hostId: string; hostLabel: string }>()

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const setActiveSessionId = useSetAtom(activeSessionIdAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setPendingHostKey = useSetAtom(pendingHostKeyAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)
  const setIsExportHostsOpen = useSetAtom(isExportHostsOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsTerminalProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
  const setIsLogViewerOpen = useSetAtom(isLogViewerOpenAtom)
  const setIsNewGroupOpen = useSetAtom(isNewGroupOpenAtom)
  const setAddPortForwardSessionId = useSetAtom(addPortForwardSessionIdAtom)
  const setActiveLogs = useSetAtom(activeLogsAtom)
  const setPortForwards = useSetAtom(portForwardsAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessions = useAtomValue(sessionsAtom)
  const activeLogs = useAtomValue(activeLogsAtom)

  useEffect(() => {
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err) => toast.error('Failed to load hosts', { description: String(err) }))
    ListGroups()
      .then((groups) => setGroups(groups as unknown as Group[]))
      .catch((err) => toast.error('Failed to load groups', { description: String(err) }))
    ListTerminalProfiles()
      .then((profiles) => setTerminalProfiles(profiles as unknown as TerminalProfile[]))
      .catch((err) => toast.error('Failed to load terminal profiles', { description: String(err) }))
  }, [setHosts, setGroups, setTerminalProfiles])

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
    const c1 = EventsOn('menu:new-connection', () => setIsQuickConnectOpen(true))
    const c2 = EventsOn('menu:import-ssh-config', () => setIsImportSSHConfigOpen(true))
    const c3 = EventsOn('menu:settings', () => setIsSettingsOpen(true))
    const c4 = EventsOn('menu:add-host', () => setIsAddHostOpen(true))
    const c5 = EventsOn('menu:new-group', () => setIsNewGroupOpen(true))
    const c6 = EventsOn('menu:terminal-profiles', () => setIsTerminalProfilesOpen(true))
    const c7 = EventsOn('menu:export-hosts', () => setIsExportHostsOpen(true))
    return () => {
      c1()
      c2()
      c3()
      c4()
      c5()
      c6()
      c7()
    }
  }, [
    setIsAddHostOpen,
    setIsImportSSHConfigOpen,
    setIsExportHostsOpen,
    setIsSettingsOpen,
    setIsQuickConnectOpen,
    setIsTerminalProfilesOpen,
    setIsNewGroupOpen,
  ])

  useEffect(() => {
    function requireActiveSession(action: (sessionId: string) => void) {
      const connected = sessions.find((s) => s.id === activeSessionId && s.status === 'connected')
      if (!connected) {
        toast.error('No active session')
        return
      }
      action(connected.id)
    }

    const c1 = EventsOn('menu:session:disconnect', () => {
      requireActiveSession(async (id) => {
        try {
          await DisconnectSession(id)
        } catch (err) {
          toast.error('Failed to disconnect', { description: String(err) })
        }
      })
    })
    const c2 = EventsOn('menu:session:disconnect-all', async () => {
      const connected = sessions.filter((s) => s.status === 'connected')
      if (connected.length === 0) {
        toast.error('No active sessions')
        return
      }
      await Promise.allSettled(connected.map((s) => DisconnectSession(s.id)))
    })
    const c3 = EventsOn('menu:session:add-port-forward', () => {
      requireActiveSession((id) => setAddPortForwardSessionId(id))
    })
    const c4 = EventsOn('menu:session:start-log', () => {
      requireActiveSession(async (id) => {
        if (activeLogs.get(id)) {
          toast.error('Already logging this session')
          return
        }
        try {
          const path = await StartSessionLog(id)
          setActiveLogs((prev) => new Map(prev).set(id, path))
          toast.success('Session logging started')
        } catch (err) {
          toast.error('Failed to start logging', { description: String(err) })
        }
      })
    })
    const c5 = EventsOn('menu:session:stop-log', () => {
      requireActiveSession(async (id) => {
        if (!activeLogs.get(id)) {
          toast.error('Not currently logging this session')
          return
        }
        try {
          await StopSessionLog(id)
          setActiveLogs((prev) => {
            const next = new Map(prev)
            next.delete(id)
            return next
          })
          toast.success('Session logging stopped')
        } catch (err) {
          toast.error('Failed to stop logging', { description: String(err) })
        }
      })
    })
    const c6 = EventsOn('menu:session:view-logs', () => setIsLogViewerOpen(true))
    const c7 = EventsOn('menu:session:open-logs-folder', () => OpenLogsDirectory())
    return () => {
      c1()
      c2()
      c3()
      c4()
      c5()
      c6()
      c7()
    }
  }, [
    activeSessionId,
    sessions,
    activeLogs,
    setAddPortForwardSessionId,
    setActiveLogs,
    setIsLogViewerOpen,
  ])
}
