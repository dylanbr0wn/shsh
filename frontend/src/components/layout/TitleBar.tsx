import { useEffect, useState } from 'react'
import { TerminalIcon, Minus, Square, X, Settings } from 'lucide-react'
import { useSetAtom } from 'jotai'
import {
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from '../../../wailsjs/runtime/runtime'
import { cn } from '../../lib/utils'
import { isSettingsOpenAtom } from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function TitleBar() {
  const [isMac, setIsMac] = useState(false)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)

  useEffect(() => {
    Environment().then((env) => setIsMac(env.platform === 'darwin'))
  }, [])

  return (
    <div
      className="bg-sidebar border-border flex h-9 shrink-0 items-center border-b select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
      onDoubleClick={WindowToggleMaximise}
    >
      {isMac && (
        <div
          className="h-full w-[88px] shrink-0"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        />
      )}

      <div className={cn('flex flex-1 items-center gap-2', isMac ? '' : 'pl-3')}>
        <TerminalIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-semibold tracking-tight">shsh</span>
      </div>

      <div
        className="flex items-center"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-9 w-9 rounded-none"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings"
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Settings</TooltipContent>
        </Tooltip>
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
            <Minus className="size-3.5" />
          </button>
          <button
            onClick={WindowToggleMaximise}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-11 items-center justify-center transition-colors"
            aria-label="Maximise"
          >
            <Square className="size-3" />
          </button>
          <button
            onClick={Quit}
            className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex h-9 w-11 items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
