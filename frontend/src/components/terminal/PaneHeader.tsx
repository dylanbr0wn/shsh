import { SplitSquareVertical, SplitSquareHorizontal, X, Terminal, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'

interface Props {
  hostLabel: string
  hostColor?: string
  kind: 'terminal' | 'sftp' | 'local'
  connectionId: string
  onSplitVertical: () => void
  onSplitHorizontal: () => void
  onClose: () => void
  canClose: boolean
  onOpenFiles?: () => void
}

export function PaneHeader({
  hostLabel,
  hostColor,
  kind,
  onSplitVertical,
  onSplitHorizontal,
  onClose,
  canClose,
  onOpenFiles,
}: Props) {
  return (
    <div className="absolute top-0 right-0 z-10 flex h-7 items-center gap-1 px-2 opacity-0 transition-opacity group-hover/pane:opacity-100">
      <span
        className="text-muted-foreground flex max-w-[160px] items-center gap-1 truncate font-mono text-[10px]"
        style={hostColor ? { color: hostColor } : undefined}
      >
        {kind === 'sftp' ? (
          <FolderOpen className="size-3 shrink-0" />
        ) : (
          <Terminal className="size-3 shrink-0" />
        )}
        {hostLabel}
      </span>
      <div className="flex items-center gap-0.5">
        {onOpenFiles && (
          <Button variant="ghost" size="icon-xs" title="Open files" onClick={onOpenFiles}>
            <FolderOpen className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          title="Split vertically (⌘D)"
          onClick={onSplitVertical}
        >
          <SplitSquareVertical className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Split horizontally (⌘⇧D)"
          onClick={onSplitHorizontal}
        >
          <SplitSquareHorizontal className="size-3" />
        </Button>
        {canClose && (
          <Button variant="ghost" size="icon-xs" title="Close pane" onClick={onClose}>
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
