import { useEffect, useRef, useState } from 'react'
import { GripVertical, SplitSquareVertical, SplitSquareHorizontal, X } from 'lucide-react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import { Button } from '../ui/button'
import { ButtonGroup } from '../ui/button-group'
import { PaneToolbar } from './PaneToolbar'
import { PaneTypeChooser } from './PaneTypeChooser'
import { shortcutParts } from '../../lib/keybind'
import type { PaneDragData } from '../../lib/dragTypes'
import type { SessionStatus } from '../../types'

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
  connectionId: string
  channelId: string
  status: SessionStatus
  isFocused: boolean
  loggingActive: boolean
  logPath?: string
  onSplit: (
    direction: 'horizontal' | 'vertical',
    kind: 'terminal' | 'sftp' | 'local',
    hostId: string
  ) => void
  onClose: () => void
  onToggle?: () => void // terminal<->SFTP toggle, undefined for local
  onToggleLogging: () => void
  onDragStateChange?: (isDragging: boolean) => void
}

export function PaneHeader({
  hostLabel,
  hostColor,
  hostId,
  kind,
  paneId,
  workspaceId,
  connectionId,
  channelId,
  loggingActive,
  logPath,
  onSplit,
  onClose,
  onToggleLogging,
  onDragStateChange,
}: Props) {
  const gripRef = useRef<HTMLSpanElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const typeStyle = typeColors[kind]

  useEffect(() => {
    const el = gripRef.current
    if (!el) return
    return draggable({
      element: el,
      getInitialData: (): PaneDragData => ({ type: 'pane', paneId, workspaceId }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render: ({ container }) => {
            const wrapper = document.createElement('div')
            wrapper.className =
              'bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md'
            wrapper.style.borderLeft = `2px solid ${hostColor ?? 'hsl(var(--border))'}`
            const badge = document.createElement('span')
            badge.className = 'rounded px-1 text-[9px] font-semibold tracking-wide uppercase'
            badge.style.backgroundColor = typeStyle.bg
            badge.style.color = typeStyle.text
            badge.textContent = kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'
            wrapper.appendChild(badge)
            wrapper.appendChild(document.createTextNode(hostLabel))
            container.appendChild(wrapper)
          },
        })
      },
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [paneId, workspaceId, hostColor, hostLabel, kind, typeStyle.bg, typeStyle.text])

  useEffect(() => {
    onDragStateChange?.(isDragging)
  }, [isDragging, onDragStateChange])

  return (
    <div className="bg-card flex h-8 items-center gap-1 border-b px-1.5">
      <span ref={gripRef} className="cursor-grab active:cursor-grabbing">
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
      <PaneToolbar
        connectionId={connectionId}
        channelId={channelId}
        hostId={hostId}
        kind={kind}
        loggingActive={loggingActive}
        logPath={logPath}
        onToggleLogging={onToggleLogging}
      />
      <div className="flex-1" />
      <ButtonGroup className="opacity-40 transition-opacity group-hover/pane:opacity-100">
        <PaneTypeChooser
          currentHostId={hostId}
          onSelectTerminal={(hId) => onSplit('vertical', 'terminal', hId)}
          onSelectSFTP={(hId) => onSplit('vertical', 'sftp', hId)}
          onSelectLocal={() => onSplit('vertical', 'local', 'local')}
        >
          <Button
            variant="outline"
            size="icon-xs"
            title={`Split vertically (${shortcutParts('CmdOrCtrl+d').join(' ')})`}
          >
            <SplitSquareVertical className="size-3" />
          </Button>
        </PaneTypeChooser>
        <PaneTypeChooser
          currentHostId={hostId}
          onSelectTerminal={(hId) => onSplit('horizontal', 'terminal', hId)}
          onSelectSFTP={(hId) => onSplit('horizontal', 'sftp', hId)}
          onSelectLocal={() => onSplit('horizontal', 'local', 'local')}
        >
          <Button
            variant="outline"
            size="icon-xs"
            title={`Split horizontally (${shortcutParts('CmdOrCtrl+Shift+d').join(' ')})`}
          >
            <SplitSquareHorizontal className="size-3" />
          </Button>
        </PaneTypeChooser>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="destructive" size="icon-xs" title="Close pane" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </ButtonGroup>
    </div>
  )
}
