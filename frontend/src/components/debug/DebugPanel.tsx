import { useRef, useEffect, useState, useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debugFilteredEntriesAtom, debugPanelOpenAtom } from '../../store/debugStore'
import { DebugFilterBar } from './DebugFilterBar'
import { DebugSettingsOverlay } from './DebugSettingsOverlay'
import { DebugLogRow } from './DebugLogRow'
import type { DebugLevel } from '../../types/debug'
import { GetConfig } from '../../../wailsjs/go/main/App'

export function DebugPanel() {
  const entries = useAtomValue(debugFilteredEntriesAtom)
  const setDebugPanelOpen = useSetAtom(debugPanelOpenAtom)
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [globalLevel, setGlobalLevel] = useState<DebugLevel>('info')
  const [categoryLevels, setCategoryLevels] = useState<Record<string, string>>({})

  useEffect(() => {
    GetConfig().then((cfg) => {
      if (cfg.debug?.default_level) {
        setGlobalLevel(cfg.debug.default_level as DebugLevel)
      }
      if (cfg.debug?.category_levels) {
        setCategoryLevels(cfg.debug.category_levels)
      }
    })
  }, [])

  const handleGlobalLevelChange = useCallback((lvl: DebugLevel) => {
    setGlobalLevel(lvl)
  }, [])

  const handleCategoryLevelsChange = useCallback((levels: Record<string, string>) => {
    setCategoryLevels(levels)
  }, [])

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20,
  })

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
    }
  }, [entries.length, autoScroll, virtualizer])

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = () => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div className="bg-background relative flex h-full flex-col">
      <DebugFilterBar
        onSettingsToggle={() => setSettingsOpen((v) => !v)}
        settingsOpen={settingsOpen}
        onClose={() => setDebugPanelOpen(false)}
      />
      {settingsOpen && (
        <DebugSettingsOverlay
          globalLevel={globalLevel}
          categoryLevels={categoryLevels}
          onGlobalLevelChange={handleGlobalLevelChange}
          onCategoryLevelsChange={handleCategoryLevelsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <DebugLogRow entry={entry} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
