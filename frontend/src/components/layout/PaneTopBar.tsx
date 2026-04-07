import { Zap, Search, PanelLeftOpen } from 'lucide-react'
import { useAtom, useSetAtom } from 'jotai'
import { useEffect, useState, type CSSProperties } from 'react'
import { Environment } from '@wailsjs/runtime/runtime'
import {
  isQuickConnectOpenAtom,
  isCommandPaletteOpenAtom,
  sidebarCollapsedAtom,
} from '../../store/atoms'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ButtonGroup } from '../ui/button-group'
import { ShortcutKbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function PaneTopBar() {
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
  const setIsCommandPaletteOpen = useSetAtom(isCommandPaletteOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    Environment().then((env: unknown) =>
      setIsMac((env as { platform: string }).platform === 'darwin')
    )
  }, [])

  return (
    <div
      className="border-border bg-background relative flex h-9 shrink-0 items-center justify-center border-b px-2"
      style={{ '--wails-draggable': 'drag' } as CSSProperties}
    >
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
      <div style={{ '--wails-draggable': 'no-drag' } as CSSProperties}>
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
    </div>
  )
}
