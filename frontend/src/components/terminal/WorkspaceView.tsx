import { useAtomValue, useAtom } from 'jotai'
import { useState, useEffect, useCallback } from 'react'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeLogsAtom,
  isLogViewerOpenAtom,
  hostsAtom,
  pendingTemplateAtom,
} from '../../store/atoms'
import { collectLeaves, splitLeaf, removeLeaf, firstLeaf } from '../../lib/paneTree'
import type { PaneLeaf, PaneNode } from '../../store/workspaces'
import type { TemplateNode, WorkspaceTemplate } from '../../types'
import { PaneTree } from './PaneTree'
import { TerminalSearch } from './TerminalSearch'
import { TerminalSidebar } from './TerminalSidebar'
import {
  StartSessionLog,
  StopSessionLog,
  OpenTerminal,
  OpenSFTPChannel,
  OpenLocalFSChannel,
  ConnectHost,
  CloseChannel,
} from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'

export function WorkspaceView() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const hosts = useAtomValue(hostsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useAtom(pendingTemplateAtom)

  const handleSplit = useCallback(
    async (
      workspaceId: string,
      paneId: string,
      direction: 'horizontal' | 'vertical',
      kind?: PaneLeaf['kind'],
      hostId?: string
    ) => {
      const ws = workspaces.find((w) => w.id === workspaceId)
      if (!ws) return
      const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
      if (!leaf) return

      try {
        let newLeaf: PaneLeaf

        if (kind === 'local') {
          // Local filesystem pane
          const channelId = await OpenLocalFSChannel()
          newLeaf = {
            type: 'leaf',
            kind: 'local',
            paneId: crypto.randomUUID(),
            connectionId: 'local',
            channelId,
            hostId: 'local',
            hostLabel: 'Local',
            status: 'connected',
          }
        } else if (kind === 'terminal' && hostId) {
          // Terminal pane on a specific host
          const host = hosts.find((h) => h.id === hostId)
          if (!host) {
            toast.error('Host not found')
            return
          }
          const result = await ConnectHost(hostId)
          newLeaf = {
            type: 'leaf',
            kind: 'terminal',
            paneId: crypto.randomUUID(),
            connectionId: result.connectionId,
            channelId: result.channelId,
            hostId,
            hostLabel: host.label,
            status: 'connected',
            connectedAt: new Date().toISOString(),
          }
        } else if (kind === 'sftp' && hostId) {
          // SFTP pane on a specific host
          const host = hosts.find((h) => h.id === hostId)
          if (!host) {
            toast.error('Host not found')
            return
          }
          const result = await ConnectHost(hostId)
          const channelId = await OpenSFTPChannel(result.connectionId)
          newLeaf = {
            type: 'leaf',
            kind: 'sftp',
            paneId: crypto.randomUUID(),
            connectionId: result.connectionId,
            channelId,
            hostId,
            hostLabel: host.label,
            status: 'connected',
          }
        } else {
          // Default: split same connection with a new terminal (keyboard shortcut path)
          const channelId = await OpenTerminal(leaf.connectionId)
          newLeaf = {
            type: 'leaf',
            kind: 'terminal',
            paneId: crypto.randomUUID(),
            connectionId: leaf.connectionId,
            channelId,
            hostId: leaf.hostId,
            hostLabel: leaf.hostLabel,
            status: 'connected',
            connectedAt: new Date().toISOString(),
          }
        }

        setWorkspaces((prev) =>
          prev.map((w) => {
            if (w.id !== workspaceId) return w
            return {
              ...w,
              layout: splitLeaf(w.layout, paneId, direction, newLeaf),
              focusedPaneId: newLeaf.paneId,
            }
          })
        )
      } catch (err) {
        toast.error('Split failed', { description: String(err) })
      }
    },
    [workspaces, hosts, setWorkspaces]
  )

  async function buildLiveTree(node: TemplateNode): Promise<PaneNode> {
    if ('direction' in node) {
      const [left, right] = await Promise.all([buildLiveTree(node.left), buildLiveTree(node.right)])
      return { type: 'split', direction: node.direction, ratio: node.ratio, left, right }
    }

    const paneId = crypto.randomUUID()

    if (node.kind === 'local') {
      const channelId = await OpenLocalFSChannel()
      return {
        type: 'leaf',
        kind: 'local',
        paneId,
        connectionId: 'local',
        channelId,
        hostId: 'local',
        hostLabel: 'Local',
        status: 'connected',
      } as PaneLeaf
    }

    const host = hosts.find((h) => h.id === node.hostId)
    const hostLabel = host?.label ?? 'Unknown'

    try {
      const result = await ConnectHost(node.hostId)

      if (node.kind === 'sftp') {
        const channelId = await OpenSFTPChannel(result.connectionId)
        return {
          type: 'leaf',
          kind: 'sftp',
          paneId,
          connectionId: result.connectionId,
          channelId,
          hostId: node.hostId,
          hostLabel,
          status: 'connected',
        } as PaneLeaf
      }

      return {
        type: 'leaf',
        kind: 'terminal',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId: node.hostId,
        hostLabel,
        status: 'connected',
        connectedAt: new Date().toISOString(),
      } as PaneLeaf
    } catch {
      return {
        type: 'leaf',
        kind: 'terminal',
        paneId,
        connectionId: '',
        channelId: '',
        hostId: node.hostId,
        hostLabel,
        status: 'error',
      } as PaneLeaf
    }
  }

  async function openTemplate(template: WorkspaceTemplate) {
    try {
      // layout may arrive as a number[] (JSON bytes) from Wails — decode it
      const layoutRaw =
        typeof template.layout === 'string'
          ? template.layout
          : new TextDecoder().decode(new Uint8Array(template.layout as unknown as number[]))
      const templateNode = JSON.parse(layoutRaw) as TemplateNode
      const liveTree = await buildLiveTree(templateNode)
      const newWorkspaceId = crypto.randomUUID()
      const leaf = firstLeaf(liveTree)
      setWorkspaces((prev) => [
        ...prev,
        {
          id: newWorkspaceId,
          label: template.name,
          name: template.name,
          savedTemplateId: template.id,
          layout: liveTree,
          focusedPaneId: leaf.paneId,
        },
      ])
      setActiveWorkspaceId(newWorkspaceId)
    } catch (err) {
      toast.error('Failed to open template', { description: String(err) })
    }
  }

  useEffect(() => {
    if (!pendingTemplate) return
    setPendingTemplate(null)
    openTemplate(pendingTemplate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTemplate])

  const handleClose = useCallback(
    (workspaceId: string, paneId: string) => {
      setWorkspaces((prev) => {
        const ws = prev.find((w) => w.id === workspaceId)
        if (!ws) return prev
        const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
        if (leaf) CloseChannel(leaf.channelId).catch(() => {})
        const newLayout = removeLeaf(ws.layout, paneId)
        if (newLayout === null) {
          return prev.filter((w) => w.id !== workspaceId)
        }
        const newFocused =
          ws.focusedPaneId === paneId ? firstLeaf(newLayout).paneId : ws.focusedPaneId
        return prev.map((w) =>
          w.id === workspaceId ? { ...w, layout: newLayout, focusedPaneId: newFocused } : w
        )
      })
    },
    [setWorkspaces]
  )

  // Cmd+F / Ctrl+F to open search
  // Cmd+D / Ctrl+D to split vertically, Cmd+Shift+D / Ctrl+Shift+D to split horizontally
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen((open) => !open)
        return
      }
      if (!activeWorkspaceId) return
      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      if (!ws || !ws.focusedPaneId) return

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'd') {
        e.preventDefault()
        handleSplit(activeWorkspaceId, ws.focusedPaneId, 'vertical')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        handleSplit(activeWorkspaceId, ws.focusedPaneId, 'horizontal')
      }
    },
    [activeWorkspaceId, workspaces, handleSplit]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  async function toggleLogging(channelId: string) {
    if (activeLogs.has(channelId)) {
      const logPath = activeLogs.get(channelId)!
      await StopSessionLog(channelId)
      setActiveLogs((prev) => {
        const next = new Map(prev)
        next.delete(channelId)
        return next
      })
      toast.success('Log saved', { description: logPath })
    } else {
      try {
        const logPath = await StartSessionLog(channelId)
        setActiveLogs((prev) => new Map(prev).set(channelId, logPath))
        toast.info('Logging started', { description: logPath })
      } catch (e: unknown) {
        toast.error('Failed to start logging', { description: String(e) })
      }
    }
  }

  return (
    <div className="relative h-full w-full">
      {workspaces.map((workspace) => {
        const isWorkspaceActive = workspace.id === activeWorkspaceId

        // Determine the focused channel for sidebar scoping
        const focusedLeaf = workspace.focusedPaneId
          ? collectLeaves(workspace.layout).find((l) => l.paneId === workspace.focusedPaneId)
          : null
        const focusedChannelId = focusedLeaf?.channelId ?? null

        return (
          <div
            key={workspace.id}
            className="absolute inset-0 flex"
            style={
              isWorkspaceActive
                ? { visibility: 'visible', pointerEvents: 'auto' }
                : { visibility: 'hidden', pointerEvents: 'none' }
            }
          >
            <div className="relative h-full min-h-0 min-w-0 flex-1">
              <PaneTree
                node={workspace.layout}
                workspace={workspace}
                isWorkspaceActive={isWorkspaceActive}
                onSplit={(paneId, direction, kind, hostId) =>
                  handleSplit(workspace.id, paneId, direction, kind, hostId)
                }
                onClose={(paneId) => handleClose(workspace.id, paneId)}
              />
              {isWorkspaceActive && searchOpen && focusedChannelId && (
                <TerminalSearch channelId={focusedChannelId} onClose={() => setSearchOpen(false)} />
              )}
            </div>
            {isWorkspaceActive && focusedChannelId && focusedLeaf && (
              <TerminalSidebar
                connectionId={focusedLeaf.connectionId}
                loggingActive={activeLogs.has(focusedChannelId)}
                logPath={activeLogs.get(focusedChannelId)}
                onToggleLogging={() => toggleLogging(focusedChannelId)}
                onViewLogs={() => setLogViewerOpen(true)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
