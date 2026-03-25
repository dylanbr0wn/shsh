import { X } from 'lucide-react'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
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

const LEVELS: DebugLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
const LEVEL_LABELS: Record<DebugLevel, string> = {
  trace: 'TRC',
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
}

interface Props {
  globalLevel: DebugLevel
  categoryLevels: Record<string, string>
  onGlobalLevelChange: (level: DebugLevel) => void
  onCategoryLevelsChange: (levels: Record<string, string>) => void
  onClose: () => void
}

export function DebugSettingsOverlay({
  globalLevel,
  categoryLevels,
  onGlobalLevelChange,
  onCategoryLevelsChange,
  onClose,
}: Props) {
  const handleGlobalLevelChange = (value: string) => {
    if (value) {
      const lvl = value as DebugLevel
      onGlobalLevelChange(lvl)
      SetDebugLevel('', lvl)
    } else {
      // Clicked active value — reset to default 'info'
      onGlobalLevelChange('info')
      SetDebugLevel('', 'info')
    }
  }

  const handleCategoryLevelChange = (cat: DebugCategory, value: string) => {
    if (value) {
      const lvl = value as DebugLevel
      const next = { ...categoryLevels, [cat]: lvl }
      onCategoryLevelsChange(next)
      SetDebugLevel(cat, lvl)
    } else {
      // Clicked active value — clear override (inherit global)
      const next = { ...categoryLevels }
      delete next[cat]
      onCategoryLevelsChange(next)
      SetDebugLevel(cat, '')
    }
  }

  const handleResetAll = () => {
    onCategoryLevelsChange({})
    for (const { key } of ALL_CATEGORIES) {
      SetDebugLevel(key, '')
    }
  }

  return (
    <div className="bg-background/95 absolute inset-0 z-10 overflow-auto backdrop-blur-sm">
      <div className="flex h-full flex-col p-4 font-mono text-xs">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Debug Level Settings</span>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X />
          </Button>
        </div>

        {/* Content — two-column layout */}
        <div className="flex flex-1 gap-6">
          {/* Left: Global level */}
          <div className="min-w-48">
            <div className="mb-1 font-semibold">Global Level</div>
            <div className="text-muted-foreground mb-2 text-[10px]">
              Default for all categories
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={globalLevel}
              onValueChange={handleGlobalLevelChange}
            >
              {LEVELS.map((lvl) => (
                <ToggleGroupItem key={lvl} value={lvl} className="px-2.5 text-[10px]">
                  {LEVEL_LABELS[lvl]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <Separator orientation="vertical" className="h-auto" />

          {/* Right: Category overrides */}
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                Category Overrides
              </span>
              <button
                onClick={handleResetAll}
                className="text-primary text-[10px] hover:underline"
              >
                Reset All
              </button>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {ALL_CATEGORIES.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="flex w-20 items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[key] }}
                    />
                    <span>{label}</span>
                    {categoryLevels[key] && (
                      <span className="text-muted-foreground text-[9px]">*</span>
                    )}
                  </div>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={categoryLevels[key] ?? ''}
                    onValueChange={(v) => handleCategoryLevelChange(key, v)}
                  >
                    {LEVELS.map((lvl) => (
                      <ToggleGroupItem key={lvl} value={lvl} className="px-2.5 text-[10px]">
                        {LEVEL_LABELS[lvl]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              ))}
            </div>
            <div className="text-muted-foreground mt-2 text-[10px]">
              Unset categories inherit global level
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
