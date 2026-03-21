import { cn } from '../../lib/utils'
import { Loader2, MoreHorizontal, Plug, SquareTerminal, TagIcon } from 'lucide-react'
import type { Group, Host } from '../../types'
import { useAtomValue } from 'jotai'
import { groupsAtom, hostHealthAtom } from '../../store/atoms'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tag } from '../ui/tag'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu'

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

function latencyValue(latencyMs: number | undefined): { text: string; color: string } {
  if (latencyMs === undefined) return { text: '', color: '' }
  const text = `${latencyMs}ms`
  if (latencyMs === -1) return { text: 'off', color: 'text-red-400' }
  if (latencyMs < 50) return { text, color: 'text-green-500' }
  if (latencyMs < 200) return { text, color: 'text-amber-400' }
  if (latencyMs > 999) {
    return { text: '1s+', color: 'text-red-400' }
  }
  return { text, color: 'text-red-400' }
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
  const health = useAtomValue(hostHealthAtom)
  const {text, color} = latencyValue(health[host.id])
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          onDoubleClick={onConnect}
          className={cn(
            'group flex items-center gap-2 rounded-md px-3 py-2 transition-colors',
            isConnected ? 'bg-sidebar-accent hover:bg-sidebar-accent/80' : 'hover:bg-accent/50'
          )}
          style={host.color ? { borderLeft: `3px solid ${host.color}`, paddingLeft: 9 } : undefined}
          tabIndex={0}
        >
          {/* Left: status dot + latency */}
          <div className="flex shrink-0 flex-col items-center gap-1 w-10">
            <span
              className={cn(
                'size-2 rounded-full',
                isConnecting && 'animate-pulse bg-amber-400',
                isConnected && !isConnecting && 'bg-green-500',
                !isConnected && !isConnecting && 'bg-muted-foreground/30'
              )}
            />
            {!isConnected && (
              <span
                className={cn(
                  'text-[10px] leading-none',
                  color
                )}
              >
                {text}
              </span>
            )}
          </div>

          {/* Center: host identity */}
          <div className="min-w-0 flex-1 flex-col flex gap-1">
            <div className="flex items-center gap-3">
              <div className="truncate text-sm font-medium">{host.label}</div>
              {/* {host.lastConnectedAt && (
                <span className="text-muted-foreground/60 text-[10px] leading-none">
                  Last session {relativeTime(host.lastConnectedAt)}
                </span>
              )} */}
            </div>

            <div className="text-muted-foreground truncate text-xs">
              {host.username}@{host.hostname}:{host.port}
            </div>
            {host.tags && host.tags.length > 0 && (
              <HoverCard openDelay={300} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <Badge variant="link" className='flex items-center gap-1'>
                    <TagIcon className="size-3" />
                  <span>{host.tags.length} {host.tags.length === 1 ? 'tag' : 'tags'}</span>
                  </Badge>
                </HoverCardTrigger>
                <HoverCardContent side="bottom" align="start" className="w-auto p-2">
                  <div className="flex flex-wrap gap-1 w-42">
                    {host.tags.map((t) => (
                      <Tag key={t} label={t} />
                    ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>

          {/* Right: last connected + action buttons */}
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            {/* {host.lastConnectedAt && (
              <span className="text-muted-foreground/60 text-[10px] leading-none">
                {relativeTime(host.lastConnectedAt)}
              </span>
            )} */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isConnected ? 'secondary' : 'default'}
                    size="icon-sm"
                    className={cn(
                      'transition-opacity',
                      !isConnected && !isConnecting && 'opacity-0 group-hover:opacity-100'
                    )}
                    onClick={onConnect}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <Loader2 className="animate-spin" />
                    ) : isConnected ? (
                      <SquareTerminal />
                    ) : (
                      <Plug />
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
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" className="w-fit">
                  <DropdownMenuItem onClick={onConnect} disabled={isConnecting}>
                    {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
                  </DropdownMenuItem>
                  {onMoveToGroup && groups.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Move to Group</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {host.groupId && (
                            <DropdownMenuItem onClick={() => onMoveToGroup(host.id, null)}>
                              No Group
                            </DropdownMenuItem>
                          )}
                          {groups
                            .filter((g: Group) => g.id !== host.groupId)
                            .map((g: Group) => (
                              <DropdownMenuItem
                                key={g.id}
                                onClick={() => onMoveToGroup(host.id, g.id)}
                              >
                                {g.name}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  )}
                  <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onMoveToGroup && groups.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to Group</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {host.groupId && (
                <ContextMenuItem onClick={() => onMoveToGroup(host.id, null)}>
                  No Group
                </ContextMenuItem>
              )}
              {groups
                .filter((g: Group) => g.id !== host.groupId)
                .map((g: Group) => (
                  <ContextMenuItem key={g.id} onClick={() => onMoveToGroup(host.id, g.id)}>
                    {g.name}
                  </ContextMenuItem>
                ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
