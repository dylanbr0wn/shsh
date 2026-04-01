import { SlidersHorizontal, ArrowLeftRight, Circle, CircleStop } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface PaneToolbarProps {
  connectionId: string
  channelId: string
  kind: 'terminal' | 'sftp' | 'local'
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
}

export function PaneToolbar({
  connectionId: _connectionId,
  channelId: _channelId,
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Terminal settings"
            >
              <SlidersHorizontal className="size-3" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Terminal settings</TooltipContent>
        </Tooltip>
      )}
      {(kind === 'terminal' || kind === 'sftp') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Port forwards"
            >
              <ArrowLeftRight className="size-3" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Port forwards</TooltipContent>
        </Tooltip>
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
