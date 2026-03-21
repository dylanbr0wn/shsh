import { useAtomValue, useAtom } from 'jotai'
import { useState, useEffect, useCallback } from 'react'
import { PanelRight, Network } from 'lucide-react'
import { sessionsAtom, activeSessionIdAtom, sftpStateAtom, portForwardsAtom } from '../../store/atoms'
import { TerminalInstance } from './TerminalInstance'
import { TerminalSearch } from './TerminalSearch'
import { TerminalSettings } from './TerminalSettings'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { SFTPState, PortForwardPanelState } from '../../types'

const DEFAULT_SFTP_STATE: SFTPState = {
  isOpen: false,
  currentPath: '~',
  entries: [],
  isLoading: false,
  error: null,
}

const DEFAULT_PF_STATE: PortForwardPanelState = {
  isOpen: false,
  forwards: [],
  isAdding: false,
  error: null,
}

export function TerminalPane() {
  const sessions = useAtomValue(sessionsAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [pfState, setPfState] = useAtom(portForwardsAtom)
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
    setSftpState((prev) => {
      const cur = prev[sessionId] ?? DEFAULT_SFTP_STATE
      return { ...prev, [sessionId]: { ...cur, isOpen: !cur.isOpen } }
    })
  }

  function togglePortForwards(sessionId: string) {
    setPfState((prev) => {
      const cur = prev[sessionId] ?? DEFAULT_PF_STATE
      return { ...prev, [sessionId]: { ...cur, isOpen: !cur.isOpen } }
    })
  }

  return (
    <div className="relative h-full w-full">
      {sessions.map((session) => {
        const sftp = sftpState[session.id] ?? DEFAULT_SFTP_STATE
        const pf = pfState[session.id] ?? DEFAULT_PF_STATE
        const isActive = session.id === activeSessionId

        return (
          <div
            key={session.id}
            className="absolute inset-0"
            style={isActive
              ? { visibility: 'visible', pointerEvents: 'auto' }
              : { visibility: 'hidden', pointerEvents: 'none' }
            }
          >
            <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
              <ResizablePanel defaultSize={60} minSize={30} className="flex min-w-0 flex-col h-full overflow-hidden!">
                <div className="relative min-h-0 flex-1 py-3 pl-3 h-full">
                  <TerminalInstance session={session} isActive={isActive} />
                  {isActive && searchOpen && (
                    <TerminalSearch sessionId={session.id} onClose={() => setSearchOpen(false)} />
                  )}
                  <div className="group pointer-events-none absolute inset-0">
                    <div className="pointer-events-auto absolute top-1 right-1 z-10 flex gap-1 opacity-20 transition-opacity group-hover:opacity-100 has-data-[state=open]:opacity-100">
                      <TerminalSettings />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground size-6"
                            onClick={() => togglePortForwards(session.id)}
                          >
                            <Network />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Port forwards</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground size-6"
                            onClick={() => toggleSFTP(session.id)}
                          >
                            <PanelRight />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Open file browser</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </ResizablePanel>
              {pf.isOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={30} minSize={20} className="flex min-w-0 flex-col">
                    <PortForwardsPanel sessionId={session.id} onClose={() => togglePortForwards(session.id)} />
                  </ResizablePanel>
                </>
              )}
              {sftp.isOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={40} minSize={20} className="flex min-w-0 flex-col">
                    <SFTPPanel sessionId={session.id} onClose={() => toggleSFTP(session.id)} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        )
      })}

      {/* Global search overlay hint (no active sessions) */}
      {sessions.length === 0 && null}
    </div>
  )
}
