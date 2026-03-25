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

interface Props {
  hostLabel: string
  hostColor?: string
  hostId: string
  kind: 'terminal' | 'sftp' | 'local'
  onSplit: (
    direction: 'horizontal' | 'vertical',
    kind: 'terminal' | 'sftp' | 'local',
    hostId: string
  ) => void
  onClose: () => void
  canClose: boolean
  onToggle?: () => void // terminal<->SFTP toggle, undefined for local
}

export function PaneHeader({
  hostLabel,
  hostColor,
  hostId,
  kind,
  onSplit,
  onClose,
  canClose,
  onToggle,
}: Props) {
  return (
    <div
      className="bg-muted flex h-5 items-center gap-1 px-1.5"
      style={{ borderBottom: `2px solid ${hostColor ?? 'hsl(var(--border))'}` }}
    >
      <GripVertical className="text-muted-foreground size-3 shrink-0 cursor-grab" />
      <span
        className="truncate text-[11px] font-medium"
        style={hostColor ? { color: hostColor } : undefined}
      >
        {hostLabel}
      </span>
      <span
        className="shrink-0 rounded px-1 text-[9px]"
        style={{
          backgroundColor: hostColor ? `${hostColor}20` : 'hsl(var(--muted))',
          color: hostColor ?? 'hsl(var(--muted-foreground))',
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
    </div>
  )
}
