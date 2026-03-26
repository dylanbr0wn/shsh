import { useAtomValue, useAtom } from 'jotai'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeLogsAtom,
  isLogViewerOpenAtom,
  hostsAtom,
  pendingTemplateAtom,
} from '../../store/atoms'
import {
  collectLeaves,
  splitLeaf,
  removeLeaf,
  firstLeaf,
  moveLeaf,
  insertLeaf,
  movePaneAcrossWorkspaces,
} from '../../lib/paneTree'
import type { PaneLeaf, PaneNode } from '../../store/workspaces'
import type { TemplateNode, WorkspaceTemplate } from '../../types'
import type { DropEdge, DropMime } from '../../hooks/useDropZone'
import { PaneTree } from './PaneTree'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Terminal, FolderOpen, HardDrive } from 'lucide-react'
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
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const hostsRef = useRef(hosts)
  hostsRef.current = hosts

  const [pendingHostDrop, setPendingHostDrop] = useState<{
    workspaceId: string
    paneId: string
    hostId: string
    direction: 'horizontal' | 'vertical'
    position: 'before' | 'after'
    x: number
    y: number
  } | null>(null)

  const handleSplit = useCallback(
    async (
      workspaceId: string,
      paneId: string,
      direction: 'horizontal' | 'vertical',
      kind?: PaneLeaf['kind'],
      hostId?: string,
      position?: 'before' | 'after'
    ) => {
      const ws = workspacesRef.current.find((w) => w.id === workspaceId)
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
          const host = hostsRef.current.find((h) => h.id === hostId)
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
          const host = hostsRef.current.find((h) => h.id === hostId)
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
            const newLayout = position
              ? insertLeaf(w.layout, paneId, direction, newLeaf, position)
              : splitLeaf(w.layout, paneId, direction, newLeaf)
            return {
              ...w,
              layout: newLayout,
              focusedPaneId: newLeaf.paneId,
            }
          })
        )
      } catch (err) {
        toast.error('Split failed', { description: String(err) })
      }
    },
    [setWorkspaces]
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

  const handleMovePane = useCallback(
    (
      sourceWorkspaceId: string,
      sourcePaneId: string,
      targetWorkspaceId: string,
      targetPaneId: string,
      direction: 'horizontal' | 'vertical',
      position: 'before' | 'after'
    ) => {
      setWorkspaces((prev) => {
        // Same workspace move
        if (sourceWorkspaceId === targetWorkspaceId) {
          return prev.map((w) => {
            if (w.id !== sourceWorkspaceId) return w
            const newLayout = moveLeaf(w.layout, sourcePaneId, targetPaneId, direction, position)
            if (!newLayout) return w
            return { ...w, layout: newLayout, focusedPaneId: sourcePaneId }
          })
        }
        // Cross-workspace move
        return movePaneAcrossWorkspaces(
          prev,
          sourcePaneId,
          sourceWorkspaceId,
          targetWorkspaceId,
          targetPaneId,
          direction,
          position
        )
      })
    },
    [setWorkspaces]
  )

  const handleDrop = useCallback(
    (
      workspaceId: string,
      paneId: string,
      edge: DropEdge,
      mime: DropMime,
      data: string,
      shiftKey: boolean,
      clientX: number,
      clientY: number
    ) => {
      const edgeToSplit: Record<
        DropEdge,
        { direction: 'horizontal' | 'vertical'; position: 'before' | 'after' }
      > = {
        top: { direction: 'vertical', position: 'before' },
        bottom: { direction: 'vertical', position: 'after' },
        left: { direction: 'horizontal', position: 'before' },
        right: { direction: 'horizontal', position: 'after' },
      }
      const { direction, position } = edgeToSplit[edge]

      if (mime === 'application/x-shsh-host') {
        const { hostId } = JSON.parse(data) as { hostId: string }
        if (shiftKey) {
          // Shift+drag fast path: directly open SFTP
          handleSplit(workspaceId, paneId, direction, 'sftp', hostId, position)
        } else {
          // Show type chooser popover
          setPendingHostDrop({
            workspaceId,
            paneId,
            hostId,
            direction,
            position,
            x: clientX,
            y: clientY,
          })
        }
      } else if (mime === 'application/x-shsh-pane') {
        const { paneId: sourcePaneId, workspaceId: sourceWorkspaceId } = JSON.parse(data) as {
          paneId: string
          workspaceId: string
        }
        handleMovePane(sourceWorkspaceId, sourcePaneId, workspaceId, paneId, direction, position)
      }
    },
    [handleSplit, handleMovePane]
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
      const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceId)
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
    [activeWorkspaceId, handleSplit]
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
                onDrop={(paneId, edge, mime, data, shiftKey, clientX, clientY) =>
                  handleDrop(workspace.id, paneId, edge, mime, data, shiftKey, clientX, clientY)
                }
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
      {pendingHostDrop && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div
            className="pointer-events-auto absolute"
            style={{ left: pendingHostDrop.x, top: pendingHostDrop.y }}
          >
            <DropdownMenu
              open={true}
              onOpenChange={(open) => {
                if (!open) setPendingHostDrop(null)
              }}
            >
              <DropdownMenuTrigger asChild>
                <button className="sr-only">Choose pane type</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    handleSplit(
                      pendingHostDrop.workspaceId,
                      pendingHostDrop.paneId,
                      pendingHostDrop.direction,
                      'terminal',
                      pendingHostDrop.hostId,
                      pendingHostDrop.position
                    )
                    setPendingHostDrop(null)
                  }}
                >
                  <Terminal className="mr-2 size-4" />
                  Terminal
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    handleSplit(
                      pendingHostDrop.workspaceId,
                      pendingHostDrop.paneId,
                      pendingHostDrop.direction,
                      'sftp',
                      pendingHostDrop.hostId,
                      pendingHostDrop.position
                    )
                    setPendingHostDrop(null)
                  }}
                >
                  <FolderOpen className="mr-2 size-4" />
                  SFTP
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    handleSplit(
                      pendingHostDrop.workspaceId,
                      pendingHostDrop.paneId,
                      pendingHostDrop.direction,
                      'local',
                      undefined,
                      pendingHostDrop.position
                    )
                    setPendingHostDrop(null)
                  }}
                >
                  <HardDrive className="mr-2 size-4" />
                  Local Files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  )
}
