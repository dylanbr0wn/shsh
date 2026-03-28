import { useRef } from 'react'
import { cn } from '../../lib/utils'
import { Loader2, MoreHorizontal, Plug, SquareTerminal, TagIcon, FolderOpen } from 'lucide-react'
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '../ui/item'

interface Props {
  host: Host
  isConnected: boolean
  isConnecting: boolean
  onConnect: () => void
  onDelete: () => void
  onEdit: () => void
  onDeployKey: () => void
  onMoveToGroup?: (hostId: string, groupId: string | null) => void
  onOpenFiles?: () => void
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
  onDeployKey,
  onMoveToGroup,
  onOpenFiles,
}: Props) {
  const groups = useAtomValue(groupsAtom)
  const health = useAtomValue(hostHealthAtom)
  const { text, color } = latencyValue(health[host.id])
  const previewRef = useRef<HTMLDivElement>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Item asChild size="sm">
          <a
            role="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'copy'
              e.dataTransfer.setData('application/x-shsh-host', JSON.stringify({ hostId: host.id }))
              if (previewRef.current) {
                previewRef.current.style.left = '0px'
                previewRef.current.style.top = '0px'
                e.dataTransfer.setDragImage(previewRef.current, 0, 0)
                requestAnimationFrame(() => {
                  if (previewRef.current) {
                    previewRef.current.style.left = '-9999px'
                    previewRef.current.style.top = '-9999px'
                  }
                })
              }
            }}
            onDoubleClick={onConnect}
            className={cn(
              // 'group flex items-center gap-2 rounded-md px-3 py-2 transition-colors',
              isConnected
                ? 'bg-sidebar-accent hover:bg-sidebar-accent/80'
                : 'hover:bg-sidebar-accent/30',
              isConnecting && 'animate-pulse'
            )}
            // style={{
            //   borderLeft: `2.5px solid ${
            //     isConnected ? '#22c55e' :
            //     isConnecting ? '#fbbf24' :
            //     host.color ?? 'transparent'
            //   }`,
            //   paddingLeft: 9,
            // }}
            tabIndex={0}
          >
            {/* Center: host identity */}
            <ItemContent>
              <ItemTitle>{host.label}</ItemTitle>

              <ItemDescription>
                {host.username}@{host.hostname}:{host.port}
                {!isConnected && text && <span className={cn('ml-1', color)}> · {text}</span>}
                {host.tags && host.tags.length > 0 && (
                  <HoverCard openDelay={300} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <Badge variant="link" className="flex items-center gap-1">
                        <TagIcon className="size-3" />
                        <span>
                          {host.tags.length} {host.tags.length === 1 ? 'tag' : 'tags'}
                        </span>
                      </Badge>
                    </HoverCardTrigger>
                    <HoverCardContent side="bottom" align="start" className="w-auto p-2">
                      <div className="flex w-42 flex-wrap gap-1">
                        {host.tags.map((t) => (
                          <Tag key={t} label={t} />
                        ))}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}
              </ItemDescription>
            </ItemContent>

            {/* Right: action buttons */}
            <ItemActions>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isConnected ? 'secondary' : 'default'}
                    size="icon-sm"
                    className={cn(
                      'transition-opacity'
                      // !isConnected && !isConnecting && 'opacity-0 group-hover:opacity-100'
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
                    variant="outline"
                    size="icon-sm"
                    // className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" className="w-fit">
                  <DropdownMenuItem onClick={onConnect} disabled={isConnecting}>
                    {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
                  </DropdownMenuItem>
                  {onOpenFiles && (
                    <DropdownMenuItem onClick={onOpenFiles}>
                      <FolderOpen className="mr-2 size-4" />
                      Open Files
                    </DropdownMenuItem>
                  )}
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
                  <DropdownMenuItem onClick={onDeployKey}>Deploy Public Key…</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </a>
        </Item>
      </ContextMenuTrigger>
      {/* Custom drag preview — hidden off-screen until setDragImage captures it */}
      <div
        ref={previewRef}
        className="pointer-events-none fixed"
        style={{ left: '-9999px', top: '-9999px' }}
      >
        <div className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md">
          {host.color && (
            <span className="size-2 rounded-full" style={{ backgroundColor: host.color }} />
          )}
          {host.label}
        </div>
      </div>
      <ContextMenuContent>
        <ContextMenuItem onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
        </ContextMenuItem>
        {onOpenFiles && (
          <ContextMenuItem onClick={onOpenFiles}>
            <FolderOpen className="mr-2 size-4" />
            Open Files
          </ContextMenuItem>
        )}
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
        <ContextMenuItem onClick={onDeployKey}>Deploy Public Key…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
