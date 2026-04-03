import { useEffect, useState } from 'react'
import {
  Minus,
  Square,
  X,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  Search,
  Lock,
} from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Environment, WindowMinimise, WindowToggleMaximise, Quit } from '@wailsjs/runtime/runtime'
import { cn } from '../../lib/utils'
import {
  isSettingsOpenAtom,
  sidebarCollapsedAtom,
  isQuickConnectOpenAtom,
  isCommandPaletteOpenAtom,
} from '../../store/atoms'
import { vaultEnabledAtom } from '../../atoms/vault'
import { LockVault } from '@wailsjs/go/main/VaultFacade'
import { Button } from '../ui/button'
import { ButtonGroup } from '../ui/button-group'
import { ShortcutKbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function TitleBar() {
  const [isMac, setIsMac] = useState(false)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsCommandPaletteOpen = useSetAtom(isCommandPaletteOpenAtom)
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
          className="h-full w-[88px] shrink-0"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        />
      )}

      {/* Left: sidebar toggle */}
      <div
        className={cn('flex items-center')}
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
      </div>

      {/* Drag region filler */}
      <div className="flex-1" />

      {/* Center: search pill + quick connect */}
      <div
        className="flex items-center"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        <ButtonGroup>
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground w-60 gap-2 px-3"
            onClick={() => setIsCommandPaletteOpen(true)}
          >
            <Search className="size-3.5" />
            <span className="text-xs">Search</span>
            <ShortcutKbd shortcut="CmdOrCtrl+k" />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={() => setIsQuickConnectOpen(true)}
                aria-label="Quick connect"
              >
                <Zap className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Quick Connect</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </div>

      {/* Drag region filler */}
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
