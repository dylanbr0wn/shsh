import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { SessionStatus, Host, Group, TerminalProfile } from '../types'
import {
  ListHosts,
  ListGroups,
  ListTerminalProfiles,
  CloseChannel,
  StartSessionLog,
  StopSessionLog,
  OpenLogsDirectory,
} from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import {
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
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
  addPortForwardConnectionIdAtom,
  activeLogsAtom,
  portForwardsAtom,
  type PendingHostKey,
} from './atoms'
import { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
import { updateLeafByChannelId, collectLeaves } from '../lib/paneTree'

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
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
  const setAddPortForwardConnectionId = useSetAtom(addPortForwardConnectionIdAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const setPortForwards = useSetAtom(portForwardsAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)

  const workspacesRef = useRef(workspaces)
  useLayoutEffect(() => {
    workspacesRef.current = workspaces
  }, [workspaces])

  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  useLayoutEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

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
      'channel:status',
      (event: {
        channelId: string
        connectionId: string
        kind: string
        status: SessionStatus
        error?: string
      }) => {
        const { channelId, status } = event

        if (status === 'connecting') return

        if (status === 'connected') {
          const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
          const leaf = allLeaves.find((l) => l.channelId === channelId)
          if (leaf) {
            setConnectingIds((prev) => {
              const next = new Set(prev)
              next.delete(leaf.hostId)
              return next
            })
          }
          setWorkspaces((prev) =>
            prev.map((w) => ({
              ...w,
              layout: updateLeafByChannelId(w.layout, channelId, {
                status: 'connected',
                connectedAt: new Date().toISOString(),
              }),
            }))
          )
          return
        }

        if (status === 'error') {
          const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
          const leaf = allLeaves.find((l) => l.channelId === channelId)
          if (leaf) {
            setConnectingIds((prev) => {
              const next = new Set(prev)
              next.delete(leaf.hostId)
              return next
            })
          }
          setWorkspaces((prev) =>
            prev.map((w) => ({
              ...w,
              layout: updateLeafByChannelId(w.layout, channelId, { status: 'error' }),
            }))
          )
          toast.error('SSH channel error', { description: event.error })
          return
        }

        if (status === 'disconnected') {
          setWorkspaces((prev) =>
            prev.map((w) => ({
              ...w,
              layout: updateLeafByChannelId(w.layout, channelId, { status: 'disconnected' }),
            }))
          )
          setPortForwards((prev) => {
            const next = { ...prev }
            delete next[channelId]
            return next
          })
        }
      }
    )
    return () => cancel()
  }, [setConnectingIds, setWorkspaces, setPortForwards])

  // When a connection drops, mark all channels on that connection as disconnected.
  useEffect(() => {
    const cancel = EventsOn(
      'connection:status',
      (event: { connectionId: string; status: string }) => {
        if (event.status !== 'disconnected') return
        const { connectionId } = event
        const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
        const affected = allLeaves.filter((l) => l.connectionId === connectionId)
        if (affected.length === 0) return

        setWorkspaces((prev) =>
          prev.map((w) => {
            let layout = w.layout
            for (const leaf of affected) {
              layout = updateLeafByChannelId(layout, leaf.channelId, { status: 'disconnected' })
            }
            return { ...w, layout }
          })
        )

        // Clean up port forwards for all affected channels
        setPortForwards((prev) => {
          const next = { ...prev }
          for (const leaf of affected) {
            delete next[leaf.channelId]
          }
          return next
        })
      }
    )
    return () => cancel()
  }, [setWorkspaces, setPortForwards])

  useEffect(() => {
    const cancelHK = EventsOn('connection:hostkey', (event: PendingHostKey) => {
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
    function requireActiveLeaf(
      action: (leaf: { channelId: string; connectionId: string }) => void
    ) {
      const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceIdRef.current)
      if (!ws || !ws.focusedPaneId) {
        toast.error('No active session')
        return
      }
      const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
      if (!leaf || leaf.status !== 'connected') {
        toast.error('No active session')
        return
      }
      action(leaf)
    }

    const c1 = EventsOn('menu:session:disconnect', () => {
      requireActiveLeaf(async (leaf) => {
        try {
          await CloseChannel(leaf.channelId)
        } catch (err) {
          toast.error('Failed to disconnect', { description: String(err) })
        }
      })
    })
    const c2 = EventsOn('menu:session:disconnect-all', async () => {
      const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
      const connected = allLeaves.filter((l) => l.status === 'connected')
      if (connected.length === 0) {
        toast.error('No active sessions')
        return
      }
      await Promise.allSettled(connected.map((l) => CloseChannel(l.channelId)))
    })
    const c3 = EventsOn('menu:session:add-port-forward', () => {
      requireActiveLeaf((leaf) => setAddPortForwardConnectionId(leaf.connectionId))
    })
    const c4 = EventsOn('menu:session:start-log', () => {
      requireActiveLeaf(async (leaf) => {
        if (activeLogs.get(leaf.channelId)) {
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
      })
    })
    const c5 = EventsOn('menu:session:stop-log', () => {
      requireActiveLeaf(async (leaf) => {
        if (!activeLogs.get(leaf.channelId)) {
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
  }, [activeLogs, setAddPortForwardConnectionId, setActiveLogs, setIsLogViewerOpen])
}
