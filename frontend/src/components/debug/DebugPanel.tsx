import { useRef, useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debugFilteredEntriesAtom, debugPanelOpenAtom } from '../../store/debugStore'
import { DebugFilterBar } from './DebugFilterBar'
import { DebugLogRow } from './DebugLogRow'
import type { DebugLevel } from '../../types/debug'

export function DebugPanel() {
  const [panelOpen] = useAtom(debugPanelOpenAtom)
  const entries = useAtomValue(debugFilteredEntriesAtom)
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // TODO: load from config via GetConfig RPC in a future iteration
  const [globalLevel] = useState<DebugLevel>('info')
  const [categoryLevels] = useState<Record<string, string>>({})

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

  if (!panelOpen) return null

  return (
    <div className="bg-background flex h-full flex-col">
      <DebugFilterBar globalLevel={globalLevel} categoryLevels={categoryLevels} />
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
