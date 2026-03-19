import { useEffect, useState } from 'react'
import { TerminalIcon } from 'lucide-react'
import {
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from '../../../wailsjs/runtime/runtime'
import { cn } from '../../lib/utils'

export function TitleBar() {
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    Environment().then((env) => {
      setIsMac(env.platform === 'darwin')
    })
  }, [])

  return (
    <div
      className="bg-sidebar border-border flex h-9 shrink-0 items-center border-b select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <div className={cn('flex flex-1 items-center gap-2', isMac ? 'pl-[72px]' : 'pl-3')}>
        <TerminalIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-semibold tracking-tight">shsh</span>
      </div>

      {!isMac && (
        <div
          className="flex items-center"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={WindowMinimise}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-11 items-center justify-center transition-colors"
            aria-label="Minimise"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>
          <button
            onClick={WindowToggleMaximise}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-11 items-center justify-center transition-colors"
            aria-label="Maximise"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
          <button
            onClick={Quit}
            className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex h-9 w-11 items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
