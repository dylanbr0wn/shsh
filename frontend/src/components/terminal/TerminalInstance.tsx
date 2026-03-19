import '@xterm/xterm/css/xterm.css'
import { useRef } from 'react'
import type { RefObject } from 'react'
import type { SearchAddon } from '@xterm/addon-search'
import type { Session } from '../../types'
import { useTerminal } from '../../hooks/useTerminal'

interface Props {
  session: Session
  isActive: boolean
  searchAddonRef?: RefObject<SearchAddon | null>
}

export function TerminalInstance({ session, isActive, searchAddonRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(containerRef, session.id, isActive, searchAddonRef)

  return <div ref={containerRef} className="h-full w-full" />
}
