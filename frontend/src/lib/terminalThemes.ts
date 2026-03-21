import type { ITheme } from '@xterm/xterm'

export const darkTheme: ITheme = {
  background: '#00000000',
  foreground: '#c0c0c0',
  cursor: '#8b7cf8',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(139,124,248,0.25)',
  selectionForeground: undefined,
  selectionInactiveBackground: 'rgba(139,124,248,0.12)',
  // Normal (0-7)
  black: '#1a1a1a',
  red: '#e05555',
  green: '#4ec76a',
  yellow: '#d4a017',
  blue: '#8b7cf8',
  magenta: '#b06aee',
  cyan: '#4ecdc4',
  white: '#c0c0c0',
  // Bright (8-15)
  brightBlack: '#3c3c3c',
  brightRed: '#f07070',
  brightGreen: '#70e08a',
  brightYellow: '#f0c040',
  brightBlue: '#a89cf8',
  brightMagenta: '#d080f8',
  brightCyan: '#6eeae0',
  brightWhite: '#d8d8d8',
}

export const lightTheme: ITheme = {
  background: '#FFFFFF00',
  foreground: '#1a1a1a',
  cursor: '#5b4dd4',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(91,77,212,0.2)',
  selectionForeground: undefined,
  selectionInactiveBackground: 'rgba(91,77,212,0.1)',
  // Normal (0-7)
  black: '#1a1a1a',
  red: '#c62828',
  green: '#2e7d32',
  yellow: '#f57f17',
  blue: '#5b4dd4',
  magenta: '#7b1fa2',
  cyan: '#00838f',
  white: '#e8e8e8',
  // Bright (8-15)
  brightBlack: '#555555',
  brightRed: '#ef5350',
  brightGreen: '#43a047',
  brightYellow: '#ffb300',
  brightBlue: '#1e88e5',
  brightMagenta: '#ab47bc',
  brightCyan: '#00acc1',
  brightWhite: '#f5f5f5',
}
