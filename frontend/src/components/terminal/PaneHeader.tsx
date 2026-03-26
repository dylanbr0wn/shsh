import { useEffect, useRef } from 'react'
import {
  GripVertical,
  SplitSquareVertical,
  SplitSquareHorizontal,
  X,
  Terminal,
  FolderOpen,
} from 'lucide-react'
import { Button } from '../ui/button'
import { PaneTypeChooser } from '../workspace/PaneTypeChooser'
import { usePaneDrag } from '../../hooks/usePaneDrag'

const typeColors = {
  terminal: { bg: 'hsl(200 80% 30% / 0.15)', text: 'hsl(200 80% 65%)' },
  sftp: { bg: 'hsl(35 80% 35% / 0.15)', text: 'hsl(35 80% 65%)' },
  local: { bg: 'hsl(140 60% 30% / 0.15)', text: 'hsl(140 60% 60%)' },
} as const

interface Props {
  hostLabel: string
  hostColor?: string
  hostId: string
  kind: 'terminal' | 'sftp' | 'local'
  paneId: string
  workspaceId: string
  onSplit: (
    direction: 'horizontal' | 'vertical',
    kind: 'terminal' | 'sftp' | 'local',
    hostId: string
  ) => void
  onClose: () => void
  canClose: boolean
  onToggle?: () => void // terminal<->SFTP toggle, undefined for local
  onDragStateChange?: (isDragging: boolean) => void
}

export function PaneHeader({
  hostLabel,
  hostColor,
  hostId,
  kind,
  paneId,
  workspaceId,
  onSplit,
  onClose,
  canClose,
  onToggle,
  onDragStateChange,
}: Props) {
  const previewRef = useRef<HTMLDivElement>(null)
  const { isDragging, gripProps } = usePaneDrag({ paneId, workspaceId, previewRef })

  useEffect(() => {
    onDragStateChange?.(isDragging)
  }, [isDragging, onDragStateChange])

  const typeStyle = typeColors[kind]

  return (
    <div
      className="bg-muted border-border flex h-5 items-center gap-1 border-b px-1.5"
      style={hostColor ? { borderBottomColor: hostColor } : undefined}
    >
      <span {...gripProps} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="text-muted-foreground size-3 shrink-0" />
      </span>
      <span
        className="truncate text-[11px] font-medium"
        style={hostColor ? { color: hostColor } : undefined}
      >
        {hostLabel}
      </span>
      <span
        className="shrink-0 rounded px-1 text-[9px] font-semibold tracking-wide uppercase"
        style={{
          backgroundColor: typeStyle.bg,
          color: typeStyle.text,
        }}
      >
        {kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'}
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 opacity-40 transition-opacity group-hover/pane:opacity-100">
        {onToggle && (
          <Button
            variant="ghost"
            size="icon-xs"
            title={kind === 'terminal' ? 'Open SFTP' : 'Open Terminal'}
            onClick={onToggle}
          >
            {kind === 'terminal' ? (
              <FolderOpen className="size-3" />
            ) : (
              <Terminal className="size-3" />
            )}
          </Button>
        )}
        <PaneTypeChooser
          currentHostId={hostId}
          onSelectTerminal={(hId) => onSplit('vertical', 'terminal', hId)}
          onSelectSFTP={(hId) => onSplit('vertical', 'sftp', hId)}
          onSelectLocal={() => onSplit('vertical', 'local', 'local')}
        >
          <Button variant="ghost" size="icon-xs" title="Split vertically (⌘D)">
            <SplitSquareVertical className="size-3" />
          </Button>
        </PaneTypeChooser>
        <PaneTypeChooser
          currentHostId={hostId}
          onSelectTerminal={(hId) => onSplit('horizontal', 'terminal', hId)}
          onSelectSFTP={(hId) => onSplit('horizontal', 'sftp', hId)}
          onSelectLocal={() => onSplit('horizontal', 'local', 'local')}
        >
          <Button variant="ghost" size="icon-xs" title="Split horizontally (⌘⇧D)">
            <SplitSquareHorizontal className="size-3" />
          </Button>
        </PaneTypeChooser>
        {canClose && (
          <Button variant="ghost" size="icon-xs" title="Close pane" onClick={onClose}>
            <X className="size-3" />
          </Button>
        )}
      </div>
      {/* Custom drag preview — hidden off-screen until setDragImage captures it */}
      <div
        ref={previewRef}
        className="pointer-events-none fixed"
        style={{ left: '-9999px', top: '-9999px' }}
      >
        <div
          className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
          style={{ borderBottom: `2px solid ${hostColor ?? 'hsl(var(--border))'}` }}
        >
          <span
            className="rounded px-1 text-[9px] font-semibold tracking-wide uppercase"
            style={{
              backgroundColor: typeStyle.bg,
              color: typeStyle.text,
            }}
          >
            {kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'}
          </span>
          {hostLabel}
        </div>
      </div>
    </div>
  )
}
