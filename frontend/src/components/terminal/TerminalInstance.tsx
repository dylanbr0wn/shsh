import '@xterm/xterm/css/xterm.css'
import { useRef } from 'react'
import type { Session } from '../../types'
import { useTerminal } from '../../hooks/useTerminal'

interface Props {
  session: Session
  isActive: boolean
}

export function TerminalInstance({ session, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(containerRef, session.id, isActive)

  return <div ref={containerRef} className="h-full w-full" />
}
