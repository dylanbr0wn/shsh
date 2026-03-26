import { useCallback, useState } from 'react'
import type React from 'react'

interface UsePaneDragOptions {
  paneId: string
  workspaceId: string
  previewRef?: React.RefObject<HTMLDivElement | null>
}

export function usePaneDrag({ paneId, workspaceId, previewRef }: UsePaneDragOptions) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('application/x-shsh-pane', JSON.stringify({ paneId, workspaceId }))
      if (previewRef?.current) {
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
      setIsDragging(true)
    },
    [paneId, workspaceId, previewRef]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  return {
    isDragging,
    gripProps: {
      draggable: true as const,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    },
  }
}
