import { useSetAtom } from 'jotai'
import { useWailsEvent } from './useWailsEvent'
import { debugRingBuffer, debugVersionAtom } from '../store/debugStore'
import type { DebugLogEntry } from '../types/debug'

/**
 * Listens for debug:log-batch events from the Go backend
 * and pushes entries into the ring buffer.
 */
export function useDebugEvents() {
  const bumpVersion = useSetAtom(debugVersionAtom)

  // useWailsEvent passes (...args: unknown[]) — Wails sends the array as the first arg
  useWailsEvent('debug:log-batch', (...args: unknown[]) => {
    const entries = args[0] as DebugLogEntry[]
    if (Array.isArray(entries)) {
      debugRingBuffer.pushBatch(entries)
      bumpVersion((v) => v + 1)
    }
  })
}
