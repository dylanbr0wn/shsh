import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { FSEntry } from '../../types'
import type { FileTransferDragData } from '../../lib/dragTypes'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '../ui/context-menu'
import { FileEntryRow } from './FileEntryRow'

interface FileListProps {
  entries: FSEntry[]
  isLoading: boolean
  error: string | null
  selected: string | null
  channelId: string
  dragTargetPath: string | null
  onSetDragTarget: (path: string | null) => void
  onFileDrop: (source: FileTransferDragData, targetPath: string) => void
  onSelect: (path: string) => void
  onDoubleClick: (entry: FSEntry) => void
  contextMenuContent: (entry: FSEntry) => ReactNode
}

export function FileList({
  entries,
  isLoading,
  error,
  selected,
  channelId,
  dragTargetPath,
  onSetDragTarget,
  onFileDrop,
  onSelect,
  onDoubleClick,
  contextMenuContent,
}: FileListProps) {
  return (
    <ScrollArea className="@container min-h-0 w-full flex-1">
      {isLoading && (
        <div className="flex flex-col gap-1 p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 flex-1 rounded" />
              <Skeleton className="h-3 w-16 rounded" />
            </div>
          ))}
        </div>
      )}
      {error && !isLoading && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {!isLoading && !error && entries.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-xs">
          <Folder className="size-6 opacity-25" />
          <span>Empty directory</span>
        </div>
      )}
      {!isLoading && !error && (
        <>
          {entries.map((entry) => (
            <ContextMenu key={entry.path}>
              <ContextMenuTrigger asChild>
                <FileEntryRow
                  entry={entry}
                  isSelected={selected === entry.path}
                  isDragTarget={dragTargetPath === entry.path}
                  channelId={channelId}
                  onSetDragTarget={onSetDragTarget}
                  onFileDrop={onFileDrop}
                  onClick={() => onSelect(entry.path)}
                  onDoubleClick={() => onDoubleClick(entry)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>{contextMenuContent(entry)}</ContextMenuContent>
            </ContextMenu>
          ))}
        </>
      )}
    </ScrollArea>
  )
}
