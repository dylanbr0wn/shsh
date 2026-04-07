import { Zap, Search, PanelLeftOpen, Settings, Lock, Minus, Square, X } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { CSSProperties } from 'react'
import { WindowMinimise, WindowToggleMaximise, Quit } from '@wailsjs/runtime/runtime'
import {
  isQuickConnectOpenAtom,
  isCommandPaletteOpenAtom,
  isSettingsOpenAtom,
  sidebarCollapsedAtom,
  isMacAtom,
} from '../../store/atoms'
import { vaultEnabledAtom } from '../../atoms/vault'
import { LockVault } from '@wailsjs/go/main/VaultFacade'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ShortcutKbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function PaneTopBar() {
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsCommandPaletteOpen = useSetAtom(isCommandPaletteOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const isMac = useAtomValue(isMacAtom)
  const vaultEnabled = useAtomValue(vaultEnabledAtom)

  return (
    <div
      className="bg-background relative flex h-9 shrink-0 items-center px-2"
      style={{ '--wails-draggable': 'drag' } as CSSProperties}
      onDoubleClick={WindowToggleMaximise}
    >
      {/* Left: sidebar expand (when collapsed) */}
      <div
        className={cn('absolute flex items-center', isMac ? 'left-[5.5rem]' : 'left-1')}
        style={{ '--wails-draggable': 'no-drag' } as CSSProperties}
      >
        {sidebarCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-8 w-8"
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

      {/* Right: search + quick connect + lock + settings + window controls */}
      <div
        className="absolute right-0 flex items-center"
        style={{ '--wails-draggable': 'no-drag' } as CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-9 w-9 rounded-none"
              onClick={() => setIsCommandPaletteOpen(true)}
              aria-label="Search"
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Search <ShortcutKbd shortcut="CmdOrCtrl+k" />
          </TooltipContent>
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

        {!isMac && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
