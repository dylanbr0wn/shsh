import { SlidersHorizontal, ArrowLeftRight, Circle, CircleStop } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { TerminalSettings } from './TerminalSettings'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { cn } from '../../lib/utils'

interface PaneToolbarProps {
  connectionId: string
  channelId: string
  hostId: string
  kind: 'terminal' | 'sftp' | 'local'
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
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
  // Local panes have no features
  if (kind === 'local') return null

  return (
    <div className="flex items-center gap-0.5">
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
            <ErrorBoundary fallback="inline" zone="port-forwards" onError={(e, i) => reportUIError(e, i, 'port-forwards')}>
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
              {loggingActive ? <CircleStop className="size-3" aria-hidden="true" /> : <Circle className="size-3" aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{loggingActive ? `Logging: ${logPath ?? 'unknown'}` : 'Start logging'}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
