import type { ITheme } from '@xterm/xterm'

export const darkTheme: ITheme = {
  background: 'transparent',
  foreground: '#e0e0e0',
  cursor: '#80cbc4',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(128,203,196,0.25)',
  selectionForeground: undefined,
  selectionInactiveBackground: 'rgba(128,203,196,0.12)',
  // Normal (0-7)
  black: '#1a1a1a',
  red: '#f28b82',
  green: '#81c995',
  yellow: '#fdd663',
  blue: '#8ab4f8',
  magenta: '#c58af9',
  cyan: '#80cbc4',
  white: '#e0e0e0',
  // Bright (8-15)
  brightBlack: '#3c3c3c',
  brightRed: '#ff8a80',
  brightGreen: '#a8dab5',
  brightYellow: '#ffe57f',
  brightBlue: '#82b1ff',
  brightMagenta: '#ea80fc',
  brightCyan: '#a7ffeb',
  brightWhite: '#ffffff',
}

export const lightTheme: ITheme = {
  background: 'transparent',
  foreground: '#1a1a1a',
  cursor: '#0070b8',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0,112,184,0.2)',
  selectionForeground: undefined,
  selectionInactiveBackground: 'rgba(0,112,184,0.1)',
  // Normal (0-7)
  black: '#1a1a1a',
  red: '#c62828',
  green: '#2e7d32',
  yellow: '#f57f17',
  blue: '#0070b8',
  magenta: '#7b1fa2',
  cyan: '#00838f',
  white: '#e0e0e0',
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
