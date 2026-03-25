export type DebugCategory = 'ssh' | 'sftp' | 'portfwd' | 'network' | 'app' | 'ui'
export type DebugLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface DebugLogEntry {
  timestamp: string
  category: DebugCategory
  level: DebugLevel
  sessionId?: string
  sessionLabel?: string
  message: string
  fields?: Record<string, string | number>
}

export const LEVEL_PRIORITY: Record<DebugLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

export const CATEGORY_COLORS: Record<DebugCategory, string> = {
  ssh: '#58a6ff',
  sftp: '#3fb950',
  portfwd: '#d2a8ff',
  network: '#f0883e',
  app: '#8b949e',
  ui: '#f85149',
}
