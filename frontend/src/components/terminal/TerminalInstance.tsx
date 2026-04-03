import '@xterm/xterm/css/xterm.css'
import { useRef } from 'react'
import { useTerminal } from '../../hooks/useTerminal'

interface Props {
  channelId: string
  hostId: string
  isActive: boolean
}

export function TerminalInstance({ channelId, hostId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(containerRef, channelId, hostId, isActive)

  return <div ref={containerRef} className="h-full w-full p-1" />
}
