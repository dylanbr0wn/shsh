import { useEffect, useState } from 'react'
import {
  Minus,
  Square,
  X,
  Settings,
  PanelLeftOpen,
  Lock,
} from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Environment, WindowMinimise, WindowToggleMaximise, Quit } from '@wailsjs/runtime/runtime'
import { cn } from '../../lib/utils'
import {
  isSettingsOpenAtom,
  sidebarCollapsedAtom,
} from '../../store/atoms'
import { vaultEnabledAtom } from '../../atoms/vault'
import { LockVault } from '@wailsjs/go/main/VaultFacade'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function TitleBar() {
  const [isMac, setIsMac] = useState(false)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const vaultEnabled = useAtomValue(vaultEnabledAtom)

  useEffect(() => {
    Environment().then((env: unknown) =>
      setIsMac((env as { platform: string }).platform === 'darwin')
    )
  }, [])

  return (
    <div
      className="bg-sidebar border-border flex h-9 shrink-0 items-center border-b select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
      onDoubleClick={WindowToggleMaximise}
    >
      {isMac && (
        <div
          className="h-full w-22 shrink-0"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        />
      )}

      {/* Left: sidebar toggle (only when collapsed) */}
      <div
        className={cn('flex items-center')}
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        {sidebarCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Show sidebar"
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Show sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Drag region filler */}
      <div className="flex-1" />
      <div className="flex-1" />

      {/* Right: lock + settings */}
      <div
        className="flex items-center"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        {vaultEnabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => LockVault()}
                aria-label="Lock vault"
              >
                <Lock className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Lock vault</TooltipContent>
          </Tooltip>
        )}
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
