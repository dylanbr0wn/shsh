import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import { useAtomCallback } from 'jotai/utils'
import { useState, useEffect, useCallback } from 'react'
import { useKeybindings } from '../../hooks/useKeybindings'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  activeLogsAtom,
  isLogViewerOpenAtom,
  hostsAtom,
  pendingTemplateAtom,
} from '../../store/atoms'
import { collectLeaves, firstLeaf } from '../../lib/paneTree'
import { splitPaneAtom, closePaneAtom, movePaneAtom } from '../../store/workspaceActions'
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
} from '../../../wailsjs/go/main/SessionFacade'
import { toast } from 'sonner'

export function WorkspaceView() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const hosts = useAtomValue(hostsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useAtom(pendingTemplateAtom)
  const splitPane = useSetAtom(splitPaneAtom)
  const closePane = useSetAtom(closePaneAtom)
  const movePane = useSetAtom(movePaneAtom)
  const getWorkspaces = useAtomCallback(useCallback((get) => get(workspacesAtom), []))
  const getHosts = useAtomCallback(useCallback((get) => get(hostsAtom), []))

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
      const ws = getWorkspaces().find((w) => w.id === workspaceId)
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
          const host = getHosts().find((h) => h.id === hostId)
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
          const host = getHosts().find((h) => h.id === hostId)
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

        splitPane({ workspaceId, paneId, direction, newLeaf, position })
      } catch (err) {
        toast.error('Split failed', { description: String(err) })
      }
    },
    [getWorkspaces, getHosts, splitPane]
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
      closePane({ workspaceId, paneId })
    },
    [closePane]
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
      movePane({
        sourcePaneId,
        sourceWorkspaceId,
        targetWorkspaceId,
        targetPaneId,
        direction,
        position,
      })
    },
    [movePane]
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

  useKeybindings({
    splitPane: (workspaceId, paneId, direction) => handleSplit(workspaceId, paneId, direction),
    setSearchOpen,
  })

  async function toggleLogging(channelId: string) {
    if (activeLogs.has(channelId)) {
      const logPath = activeLogs.get(channelId)!
      try {
        await StopSessionLog(channelId)
        setActiveLogs((prev) => {
          const next = new Map(prev)
          next.delete(channelId)
          return next
        })
        toast.success('Log saved', { description: logPath })
      } catch (e: unknown) {
        toast.error('Failed to stop logging', { description: String(e) })
      }
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
