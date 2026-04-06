import { useRef } from 'react'
import { cn } from '../../lib/utils'
import { MoreHorizontal, SquareTerminal, TagIcon, FolderOpen } from 'lucide-react'
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../ui/item'
import { Spinner } from '../ui/spinner'
import { ButtonGroup } from '../ui/button-group'

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
  readOnly?: boolean
}

function latencyValue(latencyMs: number | undefined): { latency: string; color: string } {
  if (latencyMs === undefined) return { latency: '', color: '' }
  const latency = `${latencyMs}ms`
  if (latencyMs === -1) return { latency: 'off', color: 'text-red-400' }
  if (latencyMs < 50) return { latency, color: 'text-green-500' }
  if (latencyMs < 200) return { latency, color: 'text-amber-400' }
  if (latencyMs > 999) {
    return { latency: '1s+', color: 'text-red-400' }
  }
  return { latency, color: 'text-red-400' }
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
  readOnly,
}: Props) {
  const groups = useAtomValue(groupsAtom)
  const health = useAtomValue(hostHealthAtom)
  const { latency, color } = latencyValue(health[host.id])
  const previewRef = useRef<HTMLDivElement>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Item asChild size="xs" className="hover:bg-muted relative h-14.5">
          <div
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
            className={cn(isConnecting && 'animate-pulse')}
            tabIndex={0}
          >
            <ItemMedia className="h-full">
              <span
                className="h-full w-1 rounded-full"
                style={{ backgroundColor: host.color || 'var(--muted-foreground)' }}
              />
            </ItemMedia>
            {/* Center: host identity */}
            <ItemContent className="h-full">
              <ItemTitle style={{ color: host.color }}>
                <span>{host.label}</span>
                {host.tags && host.tags.length > 0 && (
                  <HoverCard openDelay={300} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <Badge
                        variant="ghost"
                        className="m-0 flex items-center gap-1 p-0 opacity-30 hover:opacity-100"
                      >
                        <TagIcon className="size-3" />
                        <span>{host.tags.length}</span>
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
              </ItemTitle>
              <ItemDescription className="h-5">
                <span className="flex w-full shrink-0 items-center gap-1">
                  <span>
                    {host.username}@{host.hostname}:{host.port}
                  </span>
                  <span className="shrink-0 text-xs">
                    {' '}
                    · {latency ? <span className={cn(color)}>{latency}</span> : '...'}
                  </span>
                </span>
              </ItemDescription>
            </ItemContent>

            {/* Right: action buttons */}
            <ItemActions>
              <ButtonGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost-muted" size="icon">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end" className="w-fit">
                    <DropdownMenuItem onClick={onConnect} disabled={isConnecting}>
                      {isConnecting ? 'Connecting…' : isConnected ? 'New tab' : 'Connect'}
                    </DropdownMenuItem>
                    {onOpenFiles && (
                      <DropdownMenuItem onClick={onOpenFiles}>Open Files</DropdownMenuItem>
                    )}
                    {!readOnly && onMoveToGroup && groups.length > 0 && (
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
                    {!readOnly && (
                      <>
                        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={onDeployKey}>
                          Deploy Public Key…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={onDelete}>
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
              <ButtonGroup>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={onConnect}
                      disabled={isConnecting}
                    >
                      {isConnecting ? <Spinner /> : <SquareTerminal />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isConnecting ? 'Connecting…' : 'New SSH Session'}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={onOpenFiles}
                      disabled={isConnecting}
                    >
                      {isConnecting ? <Spinner /> : <FolderOpen />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isConnecting ? 'Connecting…' : 'New SFTP Session'}
                  </TooltipContent>
                </Tooltip>
              </ButtonGroup>
            </ItemActions>
          </div>
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
        {onOpenFiles && <ContextMenuItem onClick={onOpenFiles}>Open Files</ContextMenuItem>}
        <ContextMenuSeparator />
        {!readOnly && onMoveToGroup && groups.length > 0 && (
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
        {!readOnly && (
          <>
            <ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>
            <ContextMenuItem onClick={onDeployKey}>Deploy Public Key…</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onDelete}>
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
