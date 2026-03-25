import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Host, SessionStatus } from '../../types'
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

interface TabSession {
  id: string
  hostId: string
  hostLabel: string
  status: SessionStatus
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
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
  onRename: (name: string) => void
  onSaveTemplate?: () => void
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
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
  onRename,
  onSaveTemplate,
}: Props) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus()
    }
  }, [isRenaming])

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
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onCloseAll}>
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
