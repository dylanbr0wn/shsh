export const isMac = navigator.platform.toUpperCase().includes('MAC')
export const isWindows = navigator.platform.toUpperCase().includes('WIN')

/**
 * Converts a KeyboardEvent into the normalized CmdOrCtrl+... format
 * for matching against resolved bindings.
 */
export function eventToShortcut(e: KeyboardEvent): string {
  const hasCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
  if (!hasCmdOrCtrl && !e.altKey && !e.shiftKey) return ''

  const parts: string[] = []
  if (hasCmdOrCtrl) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Normalize the key: ignore standalone modifier keys
  const key = e.key
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return ''

  // Normalize single character keys to lowercase for matching
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key
  parts.push(normalizedKey)

  return parts.join('+')
}

/**
 * Normalizes the key part of a shortcut string to lowercase for consistent matching.
 */
export function normalizeShortcutForMatch(shortcut: string): string {
  if (!shortcut) return ''
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  if (key.length === 1) {
    parts[parts.length - 1] = key.toLowerCase()
  }
  return parts.join('+')
}

/**
 * Converts a CmdOrCtrl+Shift+K shortcut to platform-appropriate display string.
 * Mac: ⌘⇧K, Windows/Linux: Ctrl+Shift+K
 */
export function formatShortcutForDisplay(shortcut: string): string {
  if (!shortcut) return 'Unbound'
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (isMac) {
    const symbols: string[] = []
    for (const mod of modifiers) {
      switch (mod) {
        case 'CmdOrCtrl':
          symbols.push('⌘')
          break
        case 'Alt':
          symbols.push('⌥')
          break
        case 'Shift':
          symbols.push('⇧')
          break
      }
    }
    return symbols.join('') + key.toUpperCase()
  }

  const labels: string[] = []
  for (const mod of modifiers) {
    switch (mod) {
      case 'CmdOrCtrl':
        labels.push('Ctrl')
        break
      case 'Alt':
        labels.push('Alt')
        break
      case 'Shift':
        labels.push('Shift')
        break
    }
  }
  labels.push(key.toUpperCase())
  return labels.join('+')
}
