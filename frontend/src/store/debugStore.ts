import { atom } from 'jotai'
import type { DebugLogEntry, DebugCategory, DebugLevel } from '../types/debug'
import { LEVEL_PRIORITY } from '../types/debug'

// --- Ring Buffer ---

class RingBuffer {
  private buffer: DebugLogEntry[]
  private capacity: number
  private head = 0
  private count = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  push(entry: DebugLogEntry) {
    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  pushBatch(entries: DebugLogEntry[]) {
    for (const entry of entries) {
      this.push(entry)
    }
  }

  getAll(): DebugLogEntry[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count)
    }
    // Wrap around: entries from head to end, then 0 to head
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  clear() {
    this.head = 0
    this.count = 0
  }

  get size() {
    return this.count
  }
}

// Singleton ring buffer (mutable, not in React state)
export const debugRingBuffer = new RingBuffer(10000)

// --- Atoms ---

// Incremented when the ring buffer changes, triggers re-renders
export const debugVersionAtom = atom(0)

// Panel open/closed state
export const debugPanelOpenAtom = atom(false)

// Display filters (client-side only)
export const debugFilterCategoriesAtom = atom<Set<DebugCategory>>(
  new Set<DebugCategory>(['ssh', 'sftp', 'portfwd', 'network', 'app'])
)
export const debugFilterLevelAtom = atom<DebugLevel>('trace')
export const debugFilterSessionAtom = atom<string>('') // empty = all
export const debugFilterSearchAtom = atom<string>('')

// Derived: filtered entries from the ring buffer
export const debugFilteredEntriesAtom = atom((get) => {
  get(debugVersionAtom) // subscribe to changes
  const entries = debugRingBuffer.getAll()
  const categories = get(debugFilterCategoriesAtom)
  const minLevel = get(debugFilterLevelAtom)
  const sessionFilter = get(debugFilterSessionAtom)
  const search = get(debugFilterSearchAtom).toLowerCase()

  return entries.filter((e) => {
    if (!categories.has(e.category)) return false
    if (LEVEL_PRIORITY[e.level] < LEVEL_PRIORITY[minLevel]) return false
    if (sessionFilter && e.sessionId !== sessionFilter) return false
    if (search && !e.message.toLowerCase().includes(search)) return false
    return true
  })
})
