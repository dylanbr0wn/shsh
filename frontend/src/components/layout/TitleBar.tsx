import { useEffect, useState } from 'react'
import { Minus, Square, X, Settings, PanelLeftClose, PanelLeftOpen, Plus, Zap } from 'lucide-react'
import { useAtom, useSetAtom } from 'jotai'
import {
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from '../../../wailsjs/runtime/runtime'
import { cn } from '../../lib/utils'
import {
  isSettingsOpenAtom,
  sidebarCollapsedAtom,
  isAddHostOpenAtom,
  isQuickConnectOpenAtom,
} from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function TitleBar() {
  const [isMac, setIsMac] = useState(false)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)

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

      {/* Left action buttons */}
      <div
        className={cn('flex items-center', !isMac && 'pl-1')}
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-9 w-9 rounded-none"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-9 w-9 rounded-none"
              onClick={() => setIsAddHostOpen(true)}
              aria-label="New host"
            >
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Host</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-9 w-9 rounded-none"
              onClick={() => setIsQuickConnectOpen(true)}
              aria-label="Quick connect"
            >
              <Zap className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Quick Connect</TooltipContent>
        </Tooltip>
      </div>

      {/* Drag region filler */}
      <div className="flex-1" />

      {/* Settings */}
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
