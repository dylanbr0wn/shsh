import { FolderOpen, Network, Circle, CircleStop, ScrollText } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TerminalSettings } from './TerminalSettings'
import { cn } from '../../lib/utils'

interface TerminalSidebarProps {
  sftpOpen: boolean
  pfOpen: boolean
  loggingActive: boolean
  logPath?: string
  onToggleSFTP: () => void
  onTogglePF: () => void
  onToggleLogging: () => void
  onViewLogs: () => void
}

export function TerminalSidebar({
  sftpOpen,
  pfOpen,
  loggingActive,
  logPath,
  onToggleSFTP,
  onTogglePF,
  onToggleLogging,
  onViewLogs,
}: TerminalSidebarProps) {
  return (
    <div className="border-border bg-muted/20 flex w-10 shrink-0 flex-col items-center gap-0.5 border-l pt-2">
      <TerminalSettings />
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(pfOpen ? 'bg-accent text-foreground' : 'text-muted-foreground')}
            onClick={onTogglePF}
            aria-label="Port forwards"
            aria-pressed={pfOpen}
          >
            <Network aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Port forwards</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(sftpOpen ? 'bg-accent text-foreground' : 'text-muted-foreground')}
            onClick={onToggleSFTP}
            aria-label="File browser"
            aria-pressed={sftpOpen}
          >
            <FolderOpen aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Open file browser</TooltipContent>
      </Tooltip>
    </div>
  )
}
