import { useEffect, useRef } from 'react'
import { Folder, File } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { isFileTransferDrag } from '../../lib/dragTypes'
import type { FileTransferDragData } from '../../lib/dragTypes'
import type { FSEntry } from '../../types'
import { cn } from '../../lib/utils'
import { formatSize, formatDate } from './fileUtils'

interface FileEntryRowProps {
  entry: FSEntry
  isSelected: boolean
  isDragTarget: boolean
  channelId: string
  onSetDragTarget: (path: string | null) => void
  onFileDrop: (source: FileTransferDragData, targetPath: string) => void
  onClick: () => void
  onDoubleClick: () => void
}

export function FileEntryRow({
  entry,
  isSelected,
  isDragTarget,
  channelId,
  onSetDragTarget,
  onFileDrop,
  onClick,
  onDoubleClick,
}: FileEntryRowProps) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cleanups: (() => void)[] = [
      draggable({
        element: el,
        getInitialData: (): FileTransferDragData => ({
          type: 'file-transfer',
          channelId,
          path: entry.path,
        }),
      }),
    ]
    if (entry.isDir) {
      cleanups.push(
        dropTargetForElements({
          element: el,
          canDrop: ({ source }) =>
            isFileTransferDrag(source.data) && source.data.path !== entry.path,
          onDragEnter: () => onSetDragTarget(entry.path),
          onDragLeave: () => onSetDragTarget(null),
          onDrop: ({ source }) => {
            onSetDragTarget(null)
            if (isFileTransferDrag(source.data)) {
              onFileDrop(source.data, entry.path)
            }
          },
        })
      )
    }
    return combine(...cleanups)
  }, [channelId, entry.path, entry.isDir, onSetDragTarget, onFileDrop])

  return (
    <button
      ref={ref}
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left transition-colors select-none',
        'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
        isSelected && 'bg-accent text-accent-foreground',
        isDragTarget && 'ring-primary bg-primary/10 ring-1 ring-inset'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
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
