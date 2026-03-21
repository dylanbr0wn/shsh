import { cn } from '../../lib/utils'
import { ChevronRight, Loader2, MoreHorizontal, Pencil, Plug, SquareTerminal, Trash2 } from 'lucide-react'
import type { Group, Host } from '../../types'
import { useAtomValue } from 'jotai'
import { groupsAtom } from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface Props {
  host: Host
  isConnected: boolean
  isConnecting: boolean
  onConnect: () => void
  onDelete: () => void
  onEdit: () => void
  onMoveToGroup?: (hostId: string, groupId: string | null) => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function HostListItem({
  host,
  isConnected,
  isConnecting,
  onConnect,
  onDelete,
  onEdit,
  onMoveToGroup,
}: Props) {
  const groups = useAtomValue(groupsAtom)
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-3 py-2 transition-colors',
        isConnected ? 'bg-sidebar-accent hover:bg-sidebar-accent/80' : 'hover:bg-accent/50'
      )}
      style={host.color ? { borderLeft: `3px solid ${host.color}`, paddingLeft: 9 } : undefined}
    >
      <span
        className={cn(
          'mt-0.5 size-2 shrink-0 rounded-full',
          isConnecting && 'animate-pulse bg-amber-400',
          isConnected && !isConnecting && 'bg-green-500',
          !isConnected && !isConnecting && 'bg-muted-foreground/30'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{host.label}</div>
        <div className="text-muted-foreground truncate text-xs">
          {host.username}@{host.hostname}:{host.port}
          {host.lastConnectedAt && (
            <span className="text-muted-foreground/60 ml-1">
              · {relativeTime(host.lastConnectedAt)}
            </span>
          )}
        </div>
        {host.tags && host.tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {host.tags.map((t) => (
              <span
                key={t}
                className="bg-muted text-muted-foreground rounded px-1 py-0 text-[10px] leading-4"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isConnected ? 'secondary' : 'default'}
              size="icon"
              className={cn(
                'h-6 w-6 transition-opacity',
                !isConnected && !isConnecting && 'opacity-0 group-hover:opacity-100'
              )}
              onClick={onConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isConnected ? (
                <SquareTerminal className="size-3.5" />
              ) : (
                <Plug className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              Edit
            </DropdownMenuItem>
            {onMoveToGroup && groups.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ChevronRight className="size-3.5" />
                  Move to Group
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {host.groupId && (
                    <DropdownMenuItem onClick={() => onMoveToGroup(host.id, null)}>
                      No Group
                    </DropdownMenuItem>
                  )}
                  {groups
                    .filter((g: Group) => g.id !== host.groupId)
                    .map((g: Group) => (
                      <DropdownMenuItem key={g.id} onClick={() => onMoveToGroup(host.id, g.id)}>
                        {g.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
