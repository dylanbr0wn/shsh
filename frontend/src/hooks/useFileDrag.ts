import { useEffect, useRef, useState, useCallback } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { toast } from 'sonner'
import { isFileTransferDrag } from '../lib/dragTypes'
import type { FileTransferDragData } from '../lib/dragTypes'
import { TransferBetweenChannels } from '@wailsjs/go/main/SessionFacade'

export interface UseFileDragOptions {
  channelId: string
  currentPath: string
  listDir: (path: string) => Promise<void>
  renameFn: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  acceptOSDrops?: boolean
}

export function useFileDrag(options: UseFileDragOptions) {
  const { channelId, currentPath, listDir, renameFn, acceptOSDrops } = options
  const panelRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const isDragOverRef = useRef(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)

  const handleFileDrop = useCallback(
    async (source: FileTransferDragData, targetPath: string) => {
      const draggedName = source.path.split('/').pop() ?? source.path

      if (targetPath.startsWith(source.path + '/')) {
        toast.error('Cannot move a folder into itself.')
        return
      }

      try {
        if (source.channelId === channelId) {
          await renameFn(channelId, source.path, targetPath + '/' + draggedName)
        } else {
          await TransferBetweenChannels(
            source.channelId,
            source.path,
            channelId,
            targetPath + '/' + draggedName
          )
        }
        await listDir(currentPath)
      } catch (err) {
        toast.error(String(err))
      }
    },
    [channelId, currentPath, listDir, renameFn]
  )

  // Panel-level drop target
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const cleanups: (() => void)[] = [
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => isFileTransferDrag(source.data),
        onDragEnter: () => {
          isDragOverRef.current = true
          setIsDragOver(true)
        },
        onDragLeave: () => {
          isDragOverRef.current = false
          setIsDragOver(false)
        },
        onDrop: async ({ source }) => {
          isDragOverRef.current = false
          setIsDragOver(false)
          if (!isFileTransferDrag(source.data)) return
          await handleFileDrop(source.data, currentPath)
        },
      }),
    ]
    if (acceptOSDrops) {
      cleanups.push(
        dropTargetForExternal({
          element: el,
          onDragEnter: () => {
            isDragOverRef.current = true
            setIsDragOver(true)
          },
          onDragLeave: () => {
            isDragOverRef.current = false
            setIsDragOver(false)
          },
          onDrop: () => {
            // Actual OS file upload handled by Wails window:filedrop event.
            // Just reset visual state here.
            isDragOverRef.current = false
            setIsDragOver(false)
          },
        })
      )
    }
    return combine(...cleanups)
  }, [channelId, currentPath, handleFileDrop, acceptOSDrops])

  return {
    panelRef,
    isDragOver,
    isDragOverRef,
    dragTargetPath,
    setDragTargetPath,
    handleFileDrop,
  }
}
