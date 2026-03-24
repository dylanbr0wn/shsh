import { memo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip'
import type { DebugLogEntry } from '../../types/debug'
import { CATEGORY_COLORS } from '../../types/debug'

function formatCompactTime(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).charAt(0)
  return `${h}:${m}:${s}.${ms}`
}

const levelColors: Record<string, string> = {
  error: 'text-red-400 bg-red-500/10',
  warn: 'text-orange-400 bg-orange-500/5',
}

export const DebugLogRow = memo(function DebugLogRow({
  entry,
}: {
  entry: DebugLogEntry
}) {
  const levelStyle = levelColors[entry.level] ?? ''
  const catColor = CATEGORY_COLORS[entry.category]

  return (
    <div
      className={`flex gap-2 px-3 py-px font-mono text-xs leading-relaxed ${levelStyle}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-[72px] shrink-0 text-muted-foreground/50 cursor-default">
            {formatCompactTime(entry.timestamp)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-xs">
          {new Date(entry.timestamp).toISOString()}
        </TooltipContent>
      </Tooltip>
      <span
        className="min-w-[52px] shrink-0"
        style={{ color: catColor }}
      >
        {entry.category === 'portfwd' ? 'PortFwd' : entry.category.toUpperCase()}
      </span>
      <span className="min-w-[32px] shrink-0 text-muted-foreground">
        {entry.level.toUpperCase().slice(0, 3)}
      </span>
      <span className="min-w-[100px] shrink-0 text-muted-foreground/60 truncate">
        {entry.sessionLabel}
      </span>
      <span className="text-foreground truncate">{entry.message}</span>
    </div>
  )
})
