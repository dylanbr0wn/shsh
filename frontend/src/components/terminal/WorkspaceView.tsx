import React from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { useState, useEffect, useCallback } from 'react'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  sftpStateAtom,
  portForwardsAtom,
  activeLogsAtom,
  isLogViewerOpenAtom,
} from '../../store/atoms'
import { collectLeaves, splitLeaf, removeLeaf, firstLeaf } from '../../lib/paneTree'
import type { LeafNode } from '../../store/workspaces'
import { PaneTree } from './PaneTree'
import { TerminalSearch } from './TerminalSearch'
import { TerminalSidebar } from './TerminalSidebar'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import {
  StartSessionLog,
  StopSessionLog,
  SplitSession,
  DisconnectSession,
} from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'

interface PanelDescriptor {
  id: string
  isOpen: boolean
  defaultSize: number
  minSize: number
  onDragClose: () => void
  render: () => React.ReactNode
}

export function WorkspaceView() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [pfState, setPfState] = useAtom(portForwardsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)

  const handleSplit = useCallback(
    async (workspaceId: string, paneId: string, direction: 'horizontal' | 'vertical') => {
      const ws = workspaces.find((w) => w.id === workspaceId)
      if (!ws) return
      const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
      if (!leaf) return
      try {
        const result = await SplitSession(leaf.sessionId)
        const newPaneId = crypto.randomUUID()
        const newLeaf: LeafNode = {
          type: 'leaf',
          paneId: newPaneId,
          sessionId: result.sessionId,
          hostId: leaf.hostId,
          hostLabel: leaf.hostLabel,
          status: 'connecting',
        }
        setWorkspaces((prev) =>
          prev.map((w) => {
            if (w.id !== workspaceId) return w
            return {
              ...w,
              layout: splitLeaf(w.layout, paneId, direction, newLeaf),
              focusedPaneId: newPaneId,
            }
          })
        )
      } catch (err) {
        toast.error('Split failed', { description: String(err) })
      }
    },
    [workspaces, setWorkspaces]
  )

  const handleClose = useCallback(
    (workspaceId: string, paneId: string) => {
      setWorkspaces((prev) => {
        const ws = prev.find((w) => w.id === workspaceId)
        if (!ws) return prev
        const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
        if (leaf) DisconnectSession(leaf.sessionId).catch(() => {})
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

  function toggleSFTP(sessionId: string) {
    const willOpen = !(sftpState[sessionId]?.isOpen ?? false)
    if (willOpen) {
      setPfState((prev) => {
        const pf = prev[sessionId]
        if (!pf?.isOpen) return prev
        return { ...prev, [sessionId]: { ...pf, isOpen: false } }
      })
    }
    setSftpState((prev) => {
      const cur = prev[sessionId] ?? {
        isOpen: false,
        currentPath: '~',
        entries: [],
        isLoading: false,
        error: null,
      }
      return { ...prev, [sessionId]: { ...cur, isOpen: willOpen } }
    })
  }

  function togglePortForwards(sessionId: string) {
    const willOpen = !(pfState[sessionId]?.isOpen ?? false)
    if (willOpen) {
      setSftpState((prev) => {
        const sftp = prev[sessionId]
        if (!sftp?.isOpen) return prev
        return { ...prev, [sessionId]: { ...sftp, isOpen: false } }
      })
    }
    setPfState((prev) => {
      const cur = prev[sessionId] ?? { isOpen: false, forwards: [] }
      return { ...prev, [sessionId]: { ...cur, isOpen: willOpen } }
    })
  }

  async function toggleLogging(sessionId: string) {
    if (activeLogs.has(sessionId)) {
      const logPath = activeLogs.get(sessionId)!
      await StopSessionLog(sessionId)
      setActiveLogs((prev) => {
        const next = new Map(prev)
        next.delete(sessionId)
        return next
      })
      toast.success('Log saved', { description: logPath })
    } else {
      try {
        const logPath = await StartSessionLog(sessionId)
        setActiveLogs((prev) => new Map(prev).set(sessionId, logPath))
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

        // Determine the focused session for sidebar/panel scoping
        const focusedLeaf = workspace.focusedPaneId
          ? collectLeaves(workspace.layout).find((l) => l.paneId === workspace.focusedPaneId)
          : null
        const focusedSessionId = focusedLeaf?.sessionId ?? null

        const sftp = focusedSessionId
          ? (sftpState[focusedSessionId] ?? { isOpen: false })
          : { isOpen: false }
        const pf = focusedSessionId
          ? (pfState[focusedSessionId] ?? { isOpen: false })
          : { isOpen: false }

        const panels: PanelDescriptor[] = focusedSessionId
          ? [
              {
                id: 'pf',
                isOpen: pf.isOpen,
                defaultSize: 30,
                minSize: 20,
                onDragClose: () =>
                  setPfState((prev) => ({
                    ...prev,
                    [focusedSessionId]: {
                      ...(prev[focusedSessionId] ?? { isOpen: false, forwards: [] }),
                      isOpen: false,
                    },
                  })),
                render: () => <PortForwardsPanel sessionId={focusedSessionId} />,
              },
              {
                id: 'sftp',
                isOpen: sftp.isOpen,
                defaultSize: 40,
                minSize: 20,
                onDragClose: () =>
                  setSftpState((prev) => ({
                    ...prev,
                    [focusedSessionId]: {
                      ...(prev[focusedSessionId] ?? {
                        isOpen: false,
                        currentPath: '~',
                        entries: [],
                        isLoading: false,
                        error: null,
                      }),
                      isOpen: false,
                    },
                  })),
                render: () => <SFTPPanel sessionId={focusedSessionId} />,
              },
            ]
          : []

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
            <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0 flex-1">
              <ResizablePanel
                defaultSize={60}
                minSize={30}
                className="flex h-full min-w-0 flex-col overflow-hidden!"
              >
                <div className="relative h-full min-h-0 flex-1">
                  <PaneTree
                    node={workspace.layout}
                    workspace={workspace}
                    isWorkspaceActive={isWorkspaceActive}
                    onSplit={(paneId, direction) => handleSplit(workspace.id, paneId, direction)}
                    onClose={(paneId) => handleClose(workspace.id, paneId)}
                  />
                  {isWorkspaceActive && searchOpen && focusedSessionId && (
                    <TerminalSearch
                      sessionId={focusedSessionId}
                      onClose={() => setSearchOpen(false)}
                    />
                  )}
                </div>
              </ResizablePanel>
              {panels
                .filter((p) => p.isOpen)
                .map((p) => (
                  <React.Fragment key={p.id}>
                    <ResizableHandle />
                    <ResizablePanel
                      defaultSize={p.defaultSize}
                      minSize={p.minSize}
                      collapsible
                      collapsedSize={0}
                      onResize={(size) => {
                        if (size.inPixels === 0) p.onDragClose()
                      }}
                      className="flex min-w-0 flex-col"
                    >
                      {p.render()}
                    </ResizablePanel>
                  </React.Fragment>
                ))}
            </ResizablePanelGroup>
            {isWorkspaceActive && focusedSessionId && (
              <TerminalSidebar
                sftpOpen={sftp.isOpen}
                pfOpen={pf.isOpen}
                loggingActive={activeLogs.has(focusedSessionId)}
                logPath={activeLogs.get(focusedSessionId)}
                onToggleSFTP={() => toggleSFTP(focusedSessionId)}
                onTogglePF={() => togglePortForwards(focusedSessionId)}
                onToggleLogging={() => toggleLogging(focusedSessionId)}
                onViewLogs={() => setLogViewerOpen(true)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
