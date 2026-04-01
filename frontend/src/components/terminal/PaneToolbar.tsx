import { useRef, useState, useEffect, useCallback } from 'react'
import { SlidersHorizontal, ArrowLeftRight, Circle, CircleStop, Ellipsis } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { TerminalSettings } from './TerminalSettings'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { cn } from '../../lib/utils'

// Approximate width per icon button: icon-xs (24px) + gap-0.5 (2px) ≈ 28px
const ICON_WIDTH = 28

interface PaneToolbarProps {
  connectionId: string
  channelId: string
  hostId: string
  kind: 'terminal' | 'sftp' | 'local'
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
}

function getFeatureCount(kind: 'terminal' | 'sftp' | 'local'): number {
  switch (kind) {
    case 'terminal':
      return 3
    case 'sftp':
      return 1
    case 'local':
      return 0
  }
}

export function PaneToolbar({
  connectionId,
  channelId,
  hostId,
  kind,
  loggingActive,
  logPath,
  onToggleLogging,
}: PaneToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [openPopover, setOpenPopover] = useState<'settings' | 'portforwards' | null>(null)

  const featureCount = getFeatureCount(kind)

  const checkOverflow = useCallback(
    (width: number) => {
      setOverflowing(width < featureCount * ICON_WIDTH)
    },
    [featureCount]
  )

  // Re-register observer when overflowing changes, since the ref moves to a different DOM node
  useEffect(() => {
    const el = containerRef.current
    if (!el || featureCount === 0) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        checkOverflow(entry.contentRect.width)
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [checkOverflow, featureCount, overflowing])

  // Local panes have no features
  if (kind === 'local') return null

  if (overflowing) {
    // Wrap both controlled Popovers around the overflow container so PopoverAnchor
    // can reference the visible button area for correct positioning.
    let overflowContent = (
      <div ref={containerRef} className="flex min-w-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="More options"
            >
              <Ellipsis className="size-3" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {kind === 'terminal' && (
              <DropdownMenuItem onSelect={() => setOpenPopover('settings')}>
                <SlidersHorizontal className="mr-2 size-3" /> Terminal settings
              </DropdownMenuItem>
            )}
            {(kind === 'terminal' || kind === 'sftp') && (
              <DropdownMenuItem onSelect={() => setOpenPopover('portforwards')}>
                <ArrowLeftRight className="mr-2 size-3" /> Port forwards
              </DropdownMenuItem>
            )}
            {kind === 'terminal' && (
              <DropdownMenuItem onSelect={onToggleLogging}>
                {loggingActive ? (
                  <CircleStop className="text-destructive mr-2 size-3" />
                ) : (
                  <Circle className="mr-2 size-3" />
                )}
                {loggingActive ? 'Stop logging' : 'Start logging'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )

    // Wrap with port forwards popover (anchored to the overflow container)
    if (kind === 'terminal' || kind === 'sftp') {
      overflowContent = (
        <Popover
          open={openPopover === 'portforwards'}
          onOpenChange={(open) => {
            if (!open) setOpenPopover(null)
          }}
        >
          <PopoverAnchor asChild>{overflowContent}</PopoverAnchor>
          <PopoverContent side="bottom" align="end" className="w-72 p-0">
            <ErrorBoundary
              fallback="inline"
              zone="port-forwards"
              onError={(e, i) => reportUIError(e, i, 'port-forwards')}
            >
              <PortForwardsPanel connectionId={connectionId} />
            </ErrorBoundary>
          </PopoverContent>
        </Popover>
      )
    }

    // Wrap with settings popover (anchored to the overflow container)
    if (kind === 'terminal') {
      overflowContent = (
        <Popover
          open={openPopover === 'settings'}
          onOpenChange={(open) => {
            if (!open) setOpenPopover(null)
          }}
        >
          <PopoverAnchor asChild>{overflowContent}</PopoverAnchor>
          <PopoverContent side="bottom" align="end" className="w-64 p-4">
            <TerminalSettings channelId={channelId} hostId={hostId} />
          </PopoverContent>
        </Popover>
      )
    }

    return overflowContent
  }

  return (
    <div ref={containerRef} className="flex items-center gap-0.5">
      {kind === 'terminal' && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Terminal settings"
                >
                  <SlidersHorizontal className="size-3" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Terminal settings</TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="end" className="w-64 p-4">
            <TerminalSettings channelId={channelId} hostId={hostId} />
          </PopoverContent>
        </Popover>
      )}
      {(kind === 'terminal' || kind === 'sftp') && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Port forwards"
                >
                  <ArrowLeftRight className="size-3" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Port forwards</TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="end" className="w-72 p-0">
            <ErrorBoundary
              fallback="inline"
              zone="port-forwards"
              onError={(e, i) => reportUIError(e, i, 'port-forwards')}
            >
              <PortForwardsPanel connectionId={connectionId} />
            </ErrorBoundary>
          </PopoverContent>
        </Popover>
      )}
      {kind === 'terminal' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(loggingActive ? 'text-destructive' : 'text-muted-foreground')}
              onClick={onToggleLogging}
              aria-label={loggingActive ? 'Stop logging' : 'Start logging'}
              aria-pressed={loggingActive}
            >
              {loggingActive ? (
                <CircleStop className="size-3" aria-hidden="true" />
              ) : (
                <Circle className="size-3" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {loggingActive ? `Logging: ${logPath ?? 'unknown'}` : 'Start logging'}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
