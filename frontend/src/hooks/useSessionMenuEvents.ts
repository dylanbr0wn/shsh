import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useWailsEvent } from './useWailsEvent'
import { addPortForwardConnectionIdAtom, activeLogsAtom, isLogViewerOpenAtom } from '../store/atoms'
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
