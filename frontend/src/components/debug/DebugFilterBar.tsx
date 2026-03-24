import { useState, useEffect } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Search, Settings, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import {
  debugFilterCategoriesAtom,
  debugFilterLevelAtom,
  debugFilterSearchAtom,
  debugFilterSessionAtom,
  debugRingBuffer,
  debugVersionAtom,
} from '../../store/debugStore'
import type { DebugCategory, DebugLevel } from '../../types/debug'
import { CATEGORY_COLORS } from '../../types/debug'
import { SetDebugLevel } from '../../../wailsjs/go/main/App'

const ALL_CATEGORIES: { key: DebugCategory; label: string }[] = [
  { key: 'ssh', label: 'SSH' },
  { key: 'sftp', label: 'SFTP' },
  { key: 'portfwd', label: 'PortFwd' },
  { key: 'network', label: 'Network' },
  { key: 'app', label: 'App' },
]

const ALL_LEVELS: { key: DebugLevel; label: string }[] = [
  { key: 'trace', label: 'Trace' },
  { key: 'debug', label: 'Debug' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn+' },
  { key: 'error', label: 'Error' },
]

const LEVEL_LABELS = ['TRC', 'DBG', 'INF', 'WRN', 'ERR']
const LEVELS: DebugLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

const POPOVER_CATEGORIES: { key: DebugCategory; label: string }[] = [
  { key: 'ssh', label: 'SSH' },
  { key: 'sftp', label: 'SFTP' },
  { key: 'portfwd', label: 'PortFwd' },
  { key: 'network', label: 'Network' },
  { key: 'app', label: 'App' },
]

interface Props {
  globalLevel: DebugLevel
  categoryLevels: Record<string, string>
}

export function DebugFilterBar({ globalLevel: initialGlobalLevel, categoryLevels: initialCategoryLevels }: Props) {
  const [categories, setCategories] = useAtom(debugFilterCategoriesAtom)
  const [level, setLevel] = useAtom(debugFilterLevelAtom)
  const [search, setSearch] = useAtom(debugFilterSearchAtom)
  const [sessionFilter, setSessionFilter] = useAtom(debugFilterSessionAtom)
  const bumpVersion = useSetAtom(debugVersionAtom)

  // Level controls popover state
  const [popoverGlobalLevel, setPopoverGlobalLevel] = useState<DebugLevel>(initialGlobalLevel)
  const [popoverCategoryLevels, setPopoverCategoryLevels] = useState<Record<string, DebugLevel>>(
    initialCategoryLevels as Record<string, DebugLevel>
  )

  useEffect(() => {
    setPopoverGlobalLevel(initialGlobalLevel)
    setPopoverCategoryLevels(initialCategoryLevels as Record<string, DebugLevel>)
  }, [initialGlobalLevel, initialCategoryLevels])

  const toggleCategory = (cat: DebugCategory) => {
    setCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleClear = () => {
    debugRingBuffer.clear()
    bumpVersion((v) => v + 1)
  }

  const handleGlobalLevelChange = (lvl: DebugLevel) => {
    setPopoverGlobalLevel(lvl)
    SetDebugLevel('', lvl)
  }

  const handleCategoryLevelChange = (cat: DebugCategory, lvl: DebugLevel) => {
    setPopoverCategoryLevels((prev) => ({ ...prev, [cat]: lvl }))
    SetDebugLevel(cat, lvl)
  }

  const handleResetLevels = () => {
    setPopoverCategoryLevels({})
    for (const { key } of POPOVER_CATEGORIES) {
      SetDebugLevel(key, '')
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Debug
      </span>

      {/* Session selector */}
      <select
        value={sessionFilter}
        onChange={(e) => setSessionFilter(e.target.value)}
        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
      >
        <option value="">All Sessions</option>
        {[...new Set(debugRingBuffer.getAll().map((e) => e.sessionId).filter(Boolean))].map((id) => {
          const label = debugRingBuffer.getAll().find((e) => e.sessionId === id)?.sessionLabel ?? id
          return <option key={id} value={id}>{label}</option>
        })}
      </select>

      {/* Category pills */}
      <div className="flex gap-1 ml-1">
        {ALL_CATEGORIES.map(({ key, label }) => {
          const active = categories.has(key)
          const color = CATEGORY_COLORS[key]
          return (
            <button
              key={key}
              onClick={() => toggleCategory(key)}
              className="rounded-full border px-2 py-px text-[10px] transition-opacity"
              style={{
                color: active ? color : undefined,
                borderColor: active ? `${color}55` : 'transparent',
                backgroundColor: active ? `${color}22` : undefined,
                opacity: active ? 1 : 0.4,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* Level display filter */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Level:</span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as DebugLevel)}
          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {ALL_LEVELS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-1.5 top-1 h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-28 rounded border border-border bg-muted pl-5 pr-1.5 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Gear icon with level controls popover */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            title="Per-category level controls"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3 font-mono text-xs">
          {/* Global level */}
          <div className="mb-2 border-b border-border pb-2">
            <div className="mb-1 font-semibold">Global Level</div>
            <div className="text-[10px] text-muted-foreground mb-1.5">
              Default for all categories
            </div>
            <div className="flex gap-px rounded bg-muted p-0.5">
              {LEVELS.map((lvl, i) => {
                const active = popoverGlobalLevel === lvl
                return (
                  <button
                    key={lvl}
                    onClick={() => handleGlobalLevelChange(lvl)}
                    className="rounded px-1.5 py-0.5 text-[10px] transition-colors"
                    style={{
                      backgroundColor: active ? 'hsl(var(--border))' : undefined,
                      color: active ? 'hsl(var(--foreground))' : undefined,
                    }}
                  >
                    {LEVEL_LABELS[i]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Category overrides */}
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Category Overrides
          </div>
          <div className="space-y-1.5">
            {POPOVER_CATEGORIES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[key] }}
                  />
                  <span>{label}</span>
                </div>
                <div className="flex gap-px rounded bg-muted p-0.5">
                  {LEVELS.map((lvl, i) => {
                    const active = popoverCategoryLevels[key] === lvl
                    const activeColor = CATEGORY_COLORS[key]
                    return (
                      <button
                        key={lvl}
                        onClick={() => handleCategoryLevelChange(key, lvl)}
                        className="rounded px-1.5 py-0.5 text-[10px] transition-colors"
                        style={{
                          backgroundColor: active ? `${activeColor}33` : undefined,
                          color: active ? activeColor : undefined,
                        }}
                      >
                        {LEVEL_LABELS[i]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <span className="text-[10px] text-muted-foreground">
              Unset inherits global
            </span>
            <button
              onClick={handleResetLevels}
              className="text-[10px] text-primary hover:underline"
            >
              Reset All
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear */}
      <button
        onClick={handleClear}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        title="Clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
