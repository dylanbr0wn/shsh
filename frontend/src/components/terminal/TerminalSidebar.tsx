import { Circle, CircleStop, ScrollText, ArrowLeftRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { TerminalSettings } from './TerminalSettings'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { cn } from '../../lib/utils'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'

interface TerminalSidebarProps {
  connectionId: string
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
  onViewLogs: () => void
}

export function TerminalSidebar({
  connectionId,
  loggingActive,
  logPath,
  onToggleLogging,
  onViewLogs,
}: TerminalSidebarProps) {
  return (
    <div className="border-border bg-muted/20 flex w-10 shrink-0 flex-col items-center gap-0.5 border-l pt-2">
      <TerminalSettings />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label="Port forwards"
              >
                <ArrowLeftRight aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Port forwards</TooltipContent>
        </Tooltip>
        <PopoverContent side="left" align="start" className="w-72 p-0">
          <ErrorBoundary
            fallback="inline"
            zone="port-forwards"
            onError={(e, i) => reportUIError(e, i, 'port-forwards')}
          >
            <PortForwardsPanel connectionId={connectionId} />
          </ErrorBoundary>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={onViewLogs}
            aria-label="View logs"
          >
            <ScrollText aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">View logs</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(loggingActive ? 'text-destructive' : 'text-muted-foreground')}
            onClick={onToggleLogging}
            aria-label={loggingActive ? 'Stop logging' : 'Start logging'}
            aria-pressed={loggingActive}
          >
            {loggingActive ? <CircleStop aria-hidden="true" /> : <Circle aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {loggingActive ? `Logging: ${logPath}` : 'Start logging'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
