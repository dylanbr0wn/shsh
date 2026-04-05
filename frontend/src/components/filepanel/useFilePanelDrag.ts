import { useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import type { FSEntry } from '../../types'
import { TransferBetweenChannels } from '@wailsjs/go/main/SessionFacade'

export interface FilePanelDragOptions {
  channelId: string
  currentPath: string
  listDir: (path: string) => Promise<void>
  renameFn: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  acceptMimeTypes: string[]
  acceptOSDrops?: boolean
}

export function useFilePanelDrag(options: FilePanelDragOptions) {
  const { channelId, currentPath, listDir, renameFn, acceptMimeTypes, acceptOSDrops } = options
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const draggedEntryRef = useRef<FSEntry | null>(null)
  const dragCounterRef = useRef(0)
  const isDragOverRef = useRef(false)

  const hasAcceptedType = useCallback(
    (types: DOMStringList | readonly string[]) => {
      return acceptMimeTypes.some((mime) =>
        types instanceof DOMStringList
          ? types.contains(mime)
          : (types as readonly string[]).includes(mime)
      )
    },
    [acceptMimeTypes]
  )

  const panelDragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (hasAcceptedType(e.dataTransfer.types)) {
        e.preventDefault()
        dragCounterRef.current++
        if (dragCounterRef.current === 1) {
          if (acceptOSDrops) isDragOverRef.current = true
          setIsDragOver(true)
        }
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasAcceptedType(e.dataTransfer.types)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
      }
    },
    onDragLeave: () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) {
        if (acceptOSDrops) isDragOverRef.current = false
        setIsDragOver(false)
      }
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault()
      dragCounterRef.current = 0
      if (acceptOSDrops) isDragOverRef.current = false
      setIsDragOver(false)

      const raw = e.dataTransfer.getData('application/x-shsh-transfer')
      if (raw) {
        const payload: { channelId: string; path: string } = JSON.parse(raw)
        const draggedName = payload.path.split('/').pop() ?? payload.path
        draggedEntryRef.current = null

        try {
          if (payload.channelId === channelId) {
            await renameFn(channelId, payload.path, currentPath + '/' + draggedName)
          } else {
            await TransferBetweenChannels(
              payload.channelId,
              payload.path,
              channelId,
              currentPath + '/' + draggedName
            )
          }
          await listDir(currentPath)
        } catch (err) {
          toast.error(String(err))
        }
      }
    },
  }

  function makeRowDragHandlers(entry: FSEntry) {
    return {
      onDragStart: (e: React.DragEvent) => {
        draggedEntryRef.current = entry
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/x-shsh-transfer',
          JSON.stringify({ channelId, path: entry.path })
        )
      },
      onDragOver: (e: React.DragEvent) => {
        if (entry.isDir && e.dataTransfer.types.includes('application/x-shsh-transfer')) {
          if (draggedEntryRef.current?.path === entry.path) return
          e.preventDefault()
          e.stopPropagation()
          setDragTargetPath(entry.path)
        }
      },
      onDragLeave: () => setDragTargetPath(null),
      onDrop: async (e: React.DragEvent) => {
        if (!entry.isDir) return
        e.preventDefault()
        e.stopPropagation()
        setDragTargetPath(null)

        const raw = e.dataTransfer.getData('application/x-shsh-transfer')
        if (!raw) return
        const payload: { channelId: string; path: string } = JSON.parse(raw)
        const draggedName = payload.path.split('/').pop() ?? payload.path

        draggedEntryRef.current = null

        if (payload.path === entry.path) return
        if (entry.path.startsWith(payload.path + '/')) {
          toast.error('Cannot move a folder into itself.')
          return
        }

        try {
          if (payload.channelId === channelId) {
            await renameFn(channelId, payload.path, entry.path + '/' + draggedName)
          } else {
            await TransferBetweenChannels(
              payload.channelId,
              payload.path,
              channelId,
              entry.path + '/' + draggedName
            )
          }
          await listDir(currentPath)
        } catch (err) {
          toast.error(String(err))
        }
      },
      onDragEnd: () => {
        draggedEntryRef.current = null
        setDragTargetPath(null)
      },
    }
  }

  return {
    isDragOver,
    isDragOverRef,
    dragTargetPath,
    setDragTargetPath,
    draggedEntryRef,
    panelDragHandlers,
    makeRowDragHandlers,
  }
}
