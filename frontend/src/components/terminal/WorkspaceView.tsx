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
import { collectLeaves } from '../../lib/paneTree'
import { PaneTree } from './PaneTree'
import { TerminalSearch } from './TerminalSearch'
import { TerminalSidebar } from './TerminalSidebar'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { StartSessionLog, StopSessionLog } from '../../../wailsjs/go/main/App'
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
  const workspaces = useAtomValue(workspacesAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [pfState, setPfState] = useAtom(portForwardsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)

  // Cmd+F / Ctrl+F to open search
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen((open) => !open)
    }
  }, [])

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
                <div className="relative h-full min-h-0 flex-1 py-3 pl-3">
                  <PaneTree
                    node={workspace.layout}
                    workspace={workspace}
                    isWorkspaceActive={isWorkspaceActive}
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
                    <ResizableHandle withHandle />
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
