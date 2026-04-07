import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Host } from '../../types'
import type { Workspace } from '../../store/workspaces'
import { collectLeaves } from '../../lib/paneTree'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { cn } from '../../lib/utils'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '../ui/item'

const statusDotClass: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  failed: 'bg-muted-foreground',
  disconnected: 'bg-muted-foreground',
  error: 'bg-destructive',
}

const kindLabel: Record<string, string> = {
  terminal: 'TERM',
  sftp: 'SFTP',
  local: 'LOCAL',
}

const kindToneClass: Partial<Record<string, string>> = {
  sftp: 'text-[hsl(35_80%_65%)]',
}

interface WorkspaceCardProps {
  workspace: Workspace
  isActive: boolean
  hasActivity: boolean
  isOnly: boolean
  hostById: Record<string, Host>
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onRename: (name: string) => void
  onSaveTemplate: () => void
  onPaneDrop?: (sourcePaneId: string, sourceWorkspaceId: string) => void
}

export function WorkspaceCard({
  workspace,
  isActive,
  hasActivity,
  isOnly,
  hostById,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onRename,
  onSaveTemplate,
  onPaneDrop,
}: WorkspaceCardProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const leaves = collectLeaves(workspace.layout)
  const displayName = workspace.name ?? workspace.label

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus()
  }, [isRenaming])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  function handleDoubleClick() {
    setRenameValue(displayName)
    setIsRenaming(true)
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/x-shsh-pane')) return
    e.preventDefault()
    if (hoverTimerRef.current !== null) return
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      onActivate()
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
      /* ignore */
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Item
          asChild
          size="xs"
          variant="outline"
          className={cn(
            'group',
            isActive && 'border-accent-foreground bg-accent',
            !isActive && 'hover:bg-muted/40'
          )}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={onActivate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onActivate()
              }
            }}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <ItemMedia>
              {hasActivity && !isActive && (
                <span className="absolute top-2 right-2 size-1.5 rounded-full bg-orange-400" />
              )}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                <div className="flex items-center gap-1.5">
                  {isRenaming ? (
                    <input
                      ref={inputRef}
                      className="border-primary min-w-0 flex-1 border-b bg-transparent text-xs font-bold outline-none"
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
                      className="min-w-0 flex-1 truncate text-xs font-bold"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        handleDoubleClick()
                      }}
                    >
                      {displayName}
                    </span>
                  )}
                </div>
              </ItemTitle>
              <div className="mt-1 flex flex-col gap-0.5">
                {leaves.map((leaf) => {
                  const host = hostById[leaf.hostId]
                  return (
                    <div
                      key={leaf.paneId}
                      className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px]"
                    >
                      <span
                        className={cn(
                          'size-1 rounded-full',
                          !host?.color && (statusDotClass[leaf.status] ?? 'bg-muted-foreground')
                        )}
                        style={host?.color ? { backgroundColor: host.color } : undefined}
                      />
                      <span className="min-w-0 flex-1 truncate">{leaf.hostLabel}</span>
                      <span
                        className={cn(
                          'shrink-0 text-[9px] tracking-wider uppercase opacity-60',
                          kindToneClass[leaf.kind]
                        )}
                      >
                        {kindLabel[leaf.kind] ?? leaf.kind}
                      </span>
                    </div>
                  )
                })}
              </div>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Close workspace"
                className="shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100!"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
              >
                <X className="size-3" />
              </Button>
            </ItemActions>
          </div>
        </Item>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={handleDoubleClick}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onSaveTemplate}>Save as Template</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers} disabled={isOnly}>
          Close Others
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onCloseAll}>
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
