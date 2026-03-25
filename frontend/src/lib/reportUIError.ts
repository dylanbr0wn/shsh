import type { ErrorInfo } from 'react'
import type { DebugLogEntry } from '../types/debug'
import { debugRingBuffer, debugVersionAtom } from '../store/debugStore'
import { getDefaultStore } from 'jotai'

const store = getDefaultStore()

export function reportUIError(error: Error, errorInfo: ErrorInfo, zone: string): void {
  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    category: 'ui',
    level: 'error',
    message: `[${zone}] ${error.message}`,
    fields: {
      zone,
      ...(errorInfo.componentStack
        ? { componentStack: errorInfo.componentStack.slice(0, 500) }
        : {}),
    },
  }
  debugRingBuffer.push(entry)
  store.set(debugVersionAtom, (v) => v + 1)
}
