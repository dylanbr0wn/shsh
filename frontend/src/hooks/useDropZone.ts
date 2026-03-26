import { useState, useCallback, useRef } from 'react'

export type DropEdge = 'top' | 'bottom' | 'left' | 'right'
export type DropMime = 'application/x-shsh-host' | 'application/x-shsh-pane'

interface DropZoneState {
  /** Which edge is active, or null if not hovering */
  edge: DropEdge | null
  /** Which MIME type is being dragged */
  mime: DropMime | null
}

interface UseDropZoneOptions {
  onDrop: (
    edge: DropEdge,
    mime: DropMime,
    data: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number
  ) => void
}

function detectMime(types: readonly string[]): DropMime | null {
  if (types.includes('application/x-shsh-pane')) return 'application/x-shsh-pane'
  if (types.includes('application/x-shsh-host')) return 'application/x-shsh-host'
  return null
}

function nearestEdge(rect: DOMRect, clientX: number, clientY: number): DropEdge {
  const top = clientY - rect.top
  const bottom = rect.bottom - clientY
  const left = clientX - rect.left
  const right = rect.right - clientX
  const min = Math.min(top, bottom, left, right)
  if (min === top) return 'top'
  if (min === bottom) return 'bottom'
  if (min === left) return 'left'
  return 'right'
}

export function useDropZone({ onDrop }: UseDropZoneOptions) {
  const [state, setState] = useState<DropZoneState>({ edge: null, mime: null })
  const dragCountRef = useRef(0)

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const mime = detectMime(e.dataTransfer.types)
    if (!mime) return
    e.preventDefault()
    e.dataTransfer.dropEffect = mime === 'application/x-shsh-host' ? 'copy' : 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = nearestEdge(rect, e.clientX, e.clientY)
    setState((prev) => {
      if (prev.edge === edge && prev.mime === mime) return prev
      return { edge, mime }
    })
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const mime = detectMime(e.dataTransfer.types)
    if (!mime) return
    e.preventDefault()
    dragCountRef.current++
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setState({ edge: null, mime: null })
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      dragCountRef.current = 0
      const mime = detectMime(e.dataTransfer.types)
      if (!mime) {
        setState({ edge: null, mime: null })
        return
      }
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const edge = nearestEdge(rect, e.clientX, e.clientY)
      const data = e.dataTransfer.getData(mime)
      setState({ edge: null, mime: null })
      onDrop(edge, mime, data, e.shiftKey, e.clientX, e.clientY)
    },
    [onDrop]
  )

  return {
    state,
    handlers: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
}
