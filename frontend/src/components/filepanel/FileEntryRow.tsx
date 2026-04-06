import { Folder, File } from 'lucide-react'
import type { FSEntry } from '../../types'
import { cn } from '../../lib/utils'
import { formatSize, formatDate } from './fileUtils'

interface FileEntryRowProps {
  entry: FSEntry
  isSelected: boolean
  isDragTarget: boolean
  onClick: () => void
  onDoubleClick: () => void
  dragHandlers: {
    onDragStart: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDrop: React.DragEventHandler
    onDragEnd: React.DragEventHandler
  }
}

export function FileEntryRow({
  entry,
  isSelected,
  isDragTarget,
  onClick,
  onDoubleClick,
  dragHandlers,
}: FileEntryRowProps) {
  return (
    <button
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left transition-colors select-none',
        'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
        isSelected && 'bg-accent text-accent-foreground',
        isDragTarget && 'ring-primary bg-primary/10 ring-1 ring-inset'
      )}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...dragHandlers}
    >
      {entry.isDir ? (
        <Folder className="text-primary/70 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <File className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      <span className="text-muted-foreground hidden w-16 shrink-0 text-right text-xs tabular-nums @sm:block">
        {formatSize(entry.size, entry.isDir)}
      </span>
      <span className="text-muted-foreground hidden w-24 shrink-0 text-right text-xs tabular-nums @md:block">
        {formatDate(entry.modTime)}
      </span>
    </button>
  )
}
