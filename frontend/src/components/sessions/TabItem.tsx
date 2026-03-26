import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Host } from '../../types'
import type { PaneLeaf } from '../../store/workspaces'
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
  reconnecting: 'bg-amber-500 animate-pulse',
  failed: 'bg-muted-foreground',
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

interface TabSession {
  id: string
  hostId: string
  hostLabel: string
  status: string
  connectedAt?: string
}

interface ConnectionDot {
  color?: string
  status: string
}

interface Props {
  session: TabSession
  host?: Host
  isActive: boolean
  hasActivity: boolean
  isFirst: boolean
  isLast: boolean
  workspaceName?: string
  connectionDots: ConnectionDot[]
  leaves: PaneLeaf[]
  hostById: Record<string, Host>
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
  onRetry?: () => void
  onRename: (name: string) => void
  onSaveTemplate?: () => void
  onDragHover?: () => void
  onPaneDrop?: (sourcePaneId: string, sourceWorkspaceId: string) => void
}

const kindLabel: Record<string, string> = {
  terminal: 'Terminal',
  sftp: 'SFTP',
  local: 'Local',
}

function WorkspaceTooltip({
  workspaceName,
  leaves,
  hostById,
}: {
  workspaceName?: string
  leaves: PaneLeaf[]
  hostById: Record<string, Host>
}) {
  // Count panes by kind
  const paneCounts = leaves.reduce<Record<string, number>>((acc, leaf) => {
    const k = leaf.kind
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  // Unique remote connections (dedupe by connectionId, skip local)
  const connections = new Map<string, { host: Host; status: string; connectedAt?: string }>()
  for (const leaf of leaves) {
    if (leaf.kind === 'local' || connections.has(leaf.connectionId)) continue
    const h = hostById[leaf.hostId]
    if (h) {
      connections.set(leaf.connectionId, {
        host: h,
        status: leaf.status,
        connectedAt: 'connectedAt' in leaf ? leaf.connectedAt : undefined,
      })
    }
  }

  const panesSummary = Object.entries(paneCounts)
    .map(([kind, count]) => `${count} ${kindLabel[kind] ?? kind}`)
    .join(', ')

  return (
    <div className="flex flex-col gap-1.5">
      {workspaceName && <p className="font-medium">{workspaceName}</p>}
      <span className="text-muted-foreground text-xs">{panesSummary}</span>
      {connections.size > 0 && (
        <>
          <Separator />
          {Array.from(connections.values()).map(({ host, status, connectedAt }) => (
            <div key={host.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'size-1.5 rounded-full',
                    statusDotClass[status] ?? 'bg-muted-foreground'
                  )}
                  style={host.color ? { backgroundColor: host.color } : undefined}
                />
                <span className="font-medium">
                  {host.username}@{host.hostname}:{host.port}
                </span>
              </div>
              <div className="text-muted-foreground ml-3 flex gap-2 text-xs">
                <span className="capitalize">{host.authMethod}</span>
                {connectedAt && <span>{formatDuration(connectedAt)}</span>}
              </div>
            </div>
          ))}
        </>
      )}
      {connections.size === 0 && leaves.length === 1 && leaves[0].kind === 'local' && (
        <>
          <Separator />
          <span className="text-muted-foreground text-xs">Local filesystem</span>
        </>
      )}
    </div>
  )
}

export function TabItem({
  session,
  host,
  isActive,
  hasActivity,
  isFirst,
  isLast,
  workspaceName,
  connectionDots,
  leaves,
  hostById,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
  onRetry,
  onRename,
  onSaveTemplate,
  onDragHover,
  onPaneDrop,
}: Props) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus()
    }
  }, [isRenaming])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-pane')) return
    e.preventDefault()
    if (hoverTimerRef.current !== null) return
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      onDragHover?.()
    }, 300)
  }

  function handleDragLeave() {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-pane')) return
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-pane')) return
    e.preventDefault()
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-shsh-pane')) as {
        paneId: string
        workspaceId: string
      }
      onPaneDrop?.(data.paneId, data.workspaceId)
    } catch {
      /* ignore malformed data */
    }
  }

  function handleDoubleClick() {
    setRenameValue(workspaceName ?? session.hostLabel)
    setIsRenaming(true)
  }

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
                isActive
                  ? cn('bg-background', !host?.color && 'border-primary')
                  : 'hover:bg-muted/60 border-transparent'
              )}
              style={isActive && host?.color ? { borderBottomColor: host.color } : undefined}
              onClick={onActivate}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onActivate()
              }}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="relative flex shrink-0 items-center gap-0.5">
                {connectionDots.length > 0 ? (
                  connectionDots.map((dot, i) => (
                    <div
                      key={i}
                      className={cn(
                        'size-1.5 rounded-full',
                        !dot.color && (statusDotClass[dot.status] ?? 'bg-muted-foreground')
                      )}
                      style={dot.color ? { backgroundColor: dot.color } : undefined}
                    />
                  ))
                ) : (
                  <div
                    className={cn(
                      'size-2 rounded-full',
                      statusDotClass[session.status] ?? 'bg-muted-foreground'
                    )}
                  />
                )}
                {hasActivity && !isActive && (
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-orange-400" />
                )}
              </div>
              {isRenaming ? (
                <input
                  ref={inputRef}
                  className="border-primary w-[100px] border-b bg-transparent text-xs font-medium outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onRename(renameValue.trim())
                      setIsRenaming(false)
                    }
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  onBlur={() => {
                    if (renameValue.trim()) onRename(renameValue.trim())
                    setIsRenaming(false)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="max-w-[120px] truncate text-xs font-medium"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    handleDoubleClick()
                  }}
                >
                  {workspaceName ?? session.hostLabel}
                </span>
              )}
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
          <WorkspaceTooltip workspaceName={workspaceName} leaves={leaves} hostById={hostById} />
        </TooltipContent>
      </Tooltip>

      <ContextMenuContent>
        <ContextMenuItem onSelect={() => handleDoubleClick()}>Rename</ContextMenuItem>
        {onSaveTemplate && (
          <ContextMenuItem onSelect={onSaveTemplate}>Save as Template</ContextMenuItem>
        )}
        <ContextMenuSeparator />
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
        {(session.status === 'failed' || session.status === 'disconnected') && onRetry && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onRetry}>Retry Connection</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onCloseAll}>
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
