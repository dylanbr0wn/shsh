import { atomWithStorage } from 'jotai/utils'

export type CursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalSettings {
  fontSize: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
}

export const terminalSettingsAtom = atomWithStorage<TerminalSettings>(
  'terminalSettings',
  DEFAULT_TERMINAL_SETTINGS
)
