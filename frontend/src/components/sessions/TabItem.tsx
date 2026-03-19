import { X } from 'lucide-react'
import type { Host, Session } from '../../types'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { cn } from '../../lib/utils'

const statusDotClass: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-muted-foreground',
  error: 'bg-destructive',
}

function formatDuration(connectedAt: string): string {
  const s = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

interface Props {
  session: Session
  host?: Host
  isActive: boolean
  isFirst: boolean
  isLast: boolean
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
}

export function TabItem({
  session,
  host,
  isActive,
  isFirst,
  isLast,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
}: Props) {
  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <div
              role="tab"
              tabIndex={0}
              className={cn(
                'focus-visible:ring-ring/50 flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 transition-colors select-none focus-visible:ring-2 focus-visible:outline-none',
                isActive ? 'bg-background border-primary' : 'hover:bg-muted/60 border-transparent'
              )}
              onClick={onActivate}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onActivate()
              }}
            >
              <div
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  statusDotClass[session.status] ?? 'bg-muted-foreground'
                )}
              />
              <span className="max-w-[120px] truncate text-xs font-medium">
                {session.hostLabel}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close tab"
                className="ml-0.5 size-4 shrink-0 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
          </TooltipTrigger>
        </ContextMenuTrigger>

        <TooltipContent side="bottom">
          <div className="flex flex-col gap-1.5">
            <p className="font-medium">
              {host ? `${host.hostname}:${host.port}` : session.hostLabel}
            </p>
            {host && (
              <>
                <Separator />
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  <span className="text-muted-foreground">User</span>
                  <span>{host.username}</span>
                  <span className="text-muted-foreground">Auth</span>
                  <span className="capitalize">{host.authMethod}</span>
                  {session.connectedAt && (
                    <>
                      <span className="text-muted-foreground">Connected</span>
                      <span>{formatDuration(session.connectedAt)}</span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      <ContextMenuContent>
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCloseOthers} disabled={isFirst && isLast}>
          Close Others
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseToLeft} disabled={isFirst}>
          Close to the Left
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseToRight} disabled={isLast}>
          Close to the Right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onCloseAll}>
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
