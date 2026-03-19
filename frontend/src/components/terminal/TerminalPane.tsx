import { useAtomValue, useAtom } from 'jotai'
import { useRef, useState, useEffect, useCallback } from 'react'
import { PanelRight } from 'lucide-react'
import type { SearchAddon } from '@xterm/addon-search'
import { sessionsAtom, activeSessionIdAtom, sftpStateAtom } from '../../store/atoms'
import { TerminalInstance } from './TerminalInstance'
import { TerminalSearch } from './TerminalSearch'
import { TerminalSettings } from './TerminalSettings'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { SFTPState } from '../../types'

const DEFAULT_SFTP_STATE: SFTPState = {
  isOpen: false,
  currentPath: '~',
  entries: [],
  isLoading: false,
  error: null,
}

export function TerminalPane() {
  const sessions = useAtomValue(sessionsAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [searchOpen, setSearchOpen] = useState(false)

  // One searchAddonRef per mounted session — keyed by sessionId
  const searchAddonRefs = useRef<Record<string, React.RefObject<SearchAddon | null>>>({})

  function getSearchRef(sessionId: string) {
    if (!searchAddonRefs.current[sessionId]) {
      searchAddonRefs.current[sessionId] = { current: null }
    }
    return searchAddonRefs.current[sessionId]
  }

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

  return (
    <div className="relative h-full w-full">
      {/* eslint-disable react-hooks/refs -- searchAddonRefs is a stable mutable map keyed by session, not used for rendering */}
      {sessions.map((session) => {
        const sftp = sftpState[session.id] ?? DEFAULT_SFTP_STATE
        const isActive = session.id === activeSessionId
        const searchRef = getSearchRef(session.id)

        return (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            {sftp.isOpen ? (
              <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
                <ResizablePanel defaultSize={60} minSize={30} className="flex min-w-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <TerminalInstance
                      session={session}
                      isActive={isActive}
                      searchAddonRef={searchRef}
                    />
                    {isActive && searchOpen && (
                      <TerminalSearch
                        searchAddonRef={searchRef}
                        onClose={() => setSearchOpen(false)}
                      />
                    )}
                    <div className="group pointer-events-none absolute inset-0">
                      <div className="pointer-events-auto absolute top-1 right-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <TerminalSettings />
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
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={40} minSize={20} className="flex min-w-0 flex-col">
                  <SFTPPanel sessionId={session.id} onClose={() => toggleSFTP(session.id)} />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div className="group relative flex min-w-0 flex-1 flex-col">
                <div className="relative min-h-0 flex-1">
                  <TerminalInstance
                    session={session}
                    isActive={isActive}
                    searchAddonRef={searchRef}
                  />
                  {isActive && searchOpen && (
                    <TerminalSearch
                      searchAddonRef={searchRef}
                      onClose={() => setSearchOpen(false)}
                    />
                  )}
                </div>
                <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <TerminalSettings />
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
            )}
          </div>
        )
      })}
      {/* eslint-enable react-hooks/refs */}

      {/* Global search overlay hint (no active sessions) */}
      {sessions.length === 0 && null}
    </div>
  )
}
