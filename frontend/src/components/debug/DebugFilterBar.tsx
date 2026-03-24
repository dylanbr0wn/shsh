import { useMemo } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Search, Settings, X } from 'lucide-react'
import { Button } from '../ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
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
import { Field, FieldLabel } from '../ui/field'

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

interface Props {
  onSettingsToggle: () => void
  settingsOpen: boolean
}

export function DebugFilterBar({ onSettingsToggle, settingsOpen }: Props) {
  const [categories, setCategories] = useAtom(debugFilterCategoriesAtom)
  const [level, setLevel] = useAtom(debugFilterLevelAtom)
  const [search, setSearch] = useAtom(debugFilterSearchAtom)
  const [sessionFilter, setSessionFilter] = useAtom(debugFilterSessionAtom)
  const bumpVersion = useSetAtom(debugVersionAtom)

  const sessions = useMemo(() => {
    const all = debugRingBuffer.getAll()
    const seen = new Map<string, string>()
    for (const e of all) {
      if (e.sessionId && !seen.has(e.sessionId)) {
        seen.set(e.sessionId, e.sessionLabel ?? e.sessionId)
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }))
  }, [])

  const toggleCategory = (cat: DebugCategory) => {
    setCategories((prev: Set<DebugCategory>) => {
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

  return (
    <div className="border-border bg-background flex items-center gap-2 border-b px-3 py-1.5">
      <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
        Debug
      </span>

      {/* Session selector */}
      <Select
        value={sessionFilter || 'all'}
        onValueChange={(v) => setSessionFilter(v === 'all' ? '' : v)}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All Sessions</SelectItem>
            {sessions.map(({ id, label }) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Category pills */}
      <div className="ml-1 flex gap-1">
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
      <Field orientation="horizontal" className="min-w-0 w-32 shrink-0 grow-0">
        <FieldLabel>Level:</FieldLabel>
        <Select value={level} onValueChange={(v) => setLevel(v as DebugLevel)}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ALL_LEVELS.map(({ key, label }) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {/* Search */}
      <InputGroup className="h-7 w-48">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Filter..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>

      {/* Settings toggle */}
      <Button
        variant={settingsOpen ? 'secondary' : 'ghost'}
        size="icon-xs"
        title="Per-category level controls"
        onClick={onSettingsToggle}
      >
        <Settings />
      </Button>

      {/* Clear */}
      <Button variant="ghost" size="icon-xs" title="Clear" onClick={handleClear}>
        <X />
      </Button>
    </div>
  )
}
