import { useEffect, useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from '../ui/dialog'
import { Skeleton } from '../ui/skeleton'
import { SFTPPreviewFile } from '@wailsjs/go/main/SessionFacade'
import { useHighlighter } from '../../hooks/useHighlighter'

interface Props {
  channelId: string
  filePath: string
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function hasHighReplacementRatio(text: string): boolean {
  if (text.length === 0) return false
  let count = 0
  for (const ch of text) {
    if (ch === '\uFFFD') count++
  }
  return count / text.length > 0.1
}

export function FilePreviewModal({ channelId, filePath, onClose }: Props) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | {
        status: 'ready'
        name: string
        size: number
        mimeType: string
        content: string
        html?: string
      }
  >({ status: 'loading' })

  const { highlight, isLoading: isHighlighting } = useHighlighter()
  const didLoad = useRef(false)

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true

    async function load() {
      try {
        const preview = await SFTPPreviewFile(channelId, filePath)
        const isImage = preview.mimeType.startsWith('image/')
        const raw = isImage ? '' : atob(preview.content)

        if (!isImage && hasHighReplacementRatio(raw)) {
          setState({ status: 'error', message: 'This file appears to be binary.' })
          return
        }

        if (!isImage && raw.length === 0) {
          setState({
            status: 'ready',
            name: preview.name,
            size: preview.size,
            mimeType: preview.mimeType,
            content: preview.content,
          })
          return
        }

        if (isImage) {
          setState({
            status: 'ready',
            name: preview.name,
            size: preview.size,
            mimeType: preview.mimeType,
            content: preview.content,
          })
          return
        }

        // Text file — highlight
        const html = await highlight(raw, filePath)
        setState({
          status: 'ready',
          name: preview.name,
          size: preview.size,
          mimeType: preview.mimeType,
          content: preview.content,
          html,
        })
      } catch (err) {
        setState({ status: 'error', message: String(err) })
      }
    }

    load()
  }, [channelId, filePath, highlight])

  const isImage = state.status === 'ready' && state.mimeType.startsWith('image/')
  const isEmpty = state.status === 'ready' && !isImage && state.size === 0

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {state.status === 'ready' ? state.name : filePath.split('/').pop()}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'ready' ? formatSize(state.size) : 'Loading...'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {(state.status === 'loading' || isHighlighting) && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="text-destructive py-8 text-center text-sm">{state.message}</div>
          )}

          {isEmpty && (
            <div className="text-muted-foreground py-8 text-center text-sm">File is empty</div>
          )}

          {state.status === 'ready' && isImage && (
            <div className="flex items-center justify-center py-4">
              <img
                src={`data:${state.mimeType};base64,${state.content}`}
                alt={state.name}
                className="max-h-[65vh] max-w-full rounded object-contain"
              />
            </div>
          )}

          {state.status === 'ready' && !isImage && !isEmpty && state.html && (
            <div
              className="overflow-x-auto rounded text-sm [&>pre]:p-4"
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
