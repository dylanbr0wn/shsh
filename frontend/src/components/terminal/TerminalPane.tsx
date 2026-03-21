import React from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { useState, useEffect, useCallback } from 'react'
import { sessionsAtom, activeSessionIdAtom, sftpStateAtom, portForwardsAtom, activeLogsAtom, isLogViewerOpenAtom } from '../../store/atoms'
import { TerminalInstance } from './TerminalInstance'
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
  render: () => React.ReactNode
}

export function TerminalPane() {
  const sessions = useAtomValue(sessionsAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [pfState, setPfState] = useAtom(portForwardsAtom)
  const [activeLogs, setActiveLogs] = useAtom(activeLogsAtom)
  const [, setLogViewerOpen] = useAtom(isLogViewerOpenAtom)
  const [searchOpen, setSearchOpen] = useState(false)

  // Ctrl+F to open search
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
      const cur = prev[sessionId] ?? { isOpen: false, currentPath: '~', entries: [], isLoading: false, error: null }
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
      {sessions.map((session) => {
        const sftp = sftpState[session.id] ?? { isOpen: false }
        const pf = pfState[session.id] ?? { isOpen: false }
        const isActive = session.id === activeSessionId

        const panels: PanelDescriptor[] = [
          {
            id: 'pf',
            isOpen: pf.isOpen,
            defaultSize: 30,
            minSize: 20,
            render: () => <PortForwardsPanel sessionId={session.id} />,
          },
          {
            id: 'sftp',
            isOpen: sftp.isOpen,
            defaultSize: 40,
            minSize: 20,
            render: () => <SFTPPanel sessionId={session.id} />,
          },
        ]

        return (
          <div
            key={session.id}
            className="absolute inset-0 flex"
            style={isActive
              ? { visibility: 'visible', pointerEvents: 'auto' }
              : { visibility: 'hidden', pointerEvents: 'none' }
            }
          >
            <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0 flex-1">
              <ResizablePanel defaultSize={60} minSize={30} className="flex min-w-0 flex-col h-full overflow-hidden!">
                <div className="relative min-h-0 flex-1 py-3 pl-3 h-full">
                  <TerminalInstance session={session} isActive={isActive} />
                  {isActive && searchOpen && (
                    <TerminalSearch sessionId={session.id} onClose={() => setSearchOpen(false)} />
                  )}
                </div>
              </ResizablePanel>
              {panels.filter(p => p.isOpen).map(p => (
                <React.Fragment key={p.id}>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={p.defaultSize} minSize={p.minSize} className="flex min-w-0 flex-col">
                    {p.render()}
                  </ResizablePanel>
                </React.Fragment>
              ))}
            </ResizablePanelGroup>
            {isActive && (
              <TerminalSidebar
                sftpOpen={sftp.isOpen}
                pfOpen={pf.isOpen}
                loggingActive={activeLogs.has(session.id)}
                logPath={activeLogs.get(session.id)}
                onToggleSFTP={() => toggleSFTP(session.id)}
                onTogglePF={() => togglePortForwards(session.id)}
                onToggleLogging={() => toggleLogging(session.id)}
                onViewLogs={() => setLogViewerOpen(true)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
