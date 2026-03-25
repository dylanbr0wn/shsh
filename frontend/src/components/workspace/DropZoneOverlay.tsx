import type { DropEdge } from '../../hooks/useDropZone'

interface Props {
  edge: DropEdge
  color?: string // host color tint, or undefined for neutral
}

const edgeStyles: Record<DropEdge, React.CSSProperties> = {
  top: { top: 0, left: 0, right: 0, height: 4 },
  bottom: { bottom: 0, left: 0, right: 0, height: 4 },
  left: { top: 0, left: 0, bottom: 0, width: 4 },
  right: { top: 0, right: 0, bottom: 0, width: 4 },
}

const arrowChar: Record<DropEdge, string> = {
  top: '↑',
  bottom: '↓',
  left: '←',
  right: '→',
}

const arrowPosition: Record<DropEdge, React.CSSProperties> = {
  top: { top: 12, left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: 12, left: '50%', transform: 'translateX(-50%)' },
  left: { left: 12, top: '50%', transform: 'translateY(-50%)' },
  right: { right: 12, top: '50%', transform: 'translateY(-50%)' },
}

export function DropZoneOverlay({ edge, color }: Props) {
  const accentColor = color ?? 'hsl(var(--primary))'
  return (
    <>
      {/* Glowing edge strip */}
      <div
        className="pointer-events-none absolute z-20"
        style={{
          ...edgeStyles[edge],
          backgroundColor: accentColor,
          boxShadow: `0 0 12px ${accentColor}80`,
        }}
      />
      {/* Arrow indicator */}
      <div
        className="pointer-events-none absolute z-20 rounded bg-black/50 px-1.5 py-0.5 text-xs"
        style={{
          ...arrowPosition[edge],
          color: accentColor,
        }}
      >
        {arrowChar[edge]}
      </div>
    </>
  )
}
