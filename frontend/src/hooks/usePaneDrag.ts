import { useCallback, useState } from 'react'

interface UsePaneDragOptions {
  paneId: string
  workspaceId: string
}

export function usePaneDrag({ paneId, workspaceId }: UsePaneDragOptions) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(
        'application/x-shsh-pane',
        JSON.stringify({ paneId, workspaceId })
      )
      setIsDragging(true)
    },
    [paneId, workspaceId]
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
