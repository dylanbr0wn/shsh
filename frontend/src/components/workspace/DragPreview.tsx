interface HostPreviewProps {
  label: string
  color?: string
}

export function HostDragPreview({ label, color }: HostPreviewProps) {
  return (
    <div
      className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
      style={{ position: 'fixed', left: -9999, top: -9999 }}
    >
      {color && (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {label}
    </div>
  )
}

interface PanePreviewProps {
  label: string
  kind: 'terminal' | 'sftp' | 'local'
  color?: string
}

export function PaneDragPreview({ label, kind, color }: PanePreviewProps) {
  const badge = kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'
  return (
    <div
      className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
      style={{
        position: 'fixed',
        left: -9999,
        top: -9999,
        borderBottom: `2px solid ${color ?? 'hsl(var(--border))'}`,
      }}
    >
      <span
        className="rounded px-1 text-[9px]"
        style={{
          backgroundColor: color ? `${color}20` : 'hsl(var(--muted))',
          color: color ?? 'hsl(var(--muted-foreground))',
        }}
      >
        {badge}
      </span>
      {label}
    </div>
  )
}
