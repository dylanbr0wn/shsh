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

export const draculaTheme: ITheme = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selectionBackground: 'rgba(68,71,90,0.9)',
  selectionForeground: '#f8f8f2',
  selectionInactiveBackground: 'rgba(68,71,90,0.5)',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
}

export const solarizedDarkTheme: ITheme = {
  background: '#002b36',
  foreground: '#839496',
  cursor: '#839496',
  cursorAccent: '#002b36',
  selectionBackground: 'rgba(7,54,66,0.9)',
  selectionForeground: '#839496',
  selectionInactiveBackground: 'rgba(7,54,66,0.5)',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#002b36',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
}

export const gruvboxTheme: ITheme = {
  background: '#282828',
  foreground: '#ebdbb2',
  cursor: '#ebdbb2',
  cursorAccent: '#282828',
  selectionBackground: 'rgba(60,56,54,0.9)',
  selectionForeground: '#ebdbb2',
  selectionInactiveBackground: 'rgba(60,56,54,0.5)',
  black: '#282828',
  red: '#cc241d',
  green: '#98971a',
  yellow: '#d79921',
  blue: '#458588',
  magenta: '#b16286',
  cyan: '#689d6a',
  white: '#a89984',
  brightBlack: '#928374',
  brightRed: '#fb4934',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#83a598',
  brightMagenta: '#d3869b',
  brightCyan: '#8ec07c',
  brightWhite: '#ebdbb2',
}

export const NAMED_THEMES: Record<string, ITheme> = {
  dark: darkTheme,
  light: lightTheme,
  dracula: draculaTheme,
  'solarized-dark': solarizedDarkTheme,
  gruvbox: gruvboxTheme,
}

export const COLOR_THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (follow system)' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'gruvbox', label: 'Gruvbox' },
]

export function resolveTheme(colorTheme: string, systemTheme: string): ITheme {
  if (!colorTheme || colorTheme === 'auto') {
    return systemTheme === 'dark' ? darkTheme : lightTheme
  }
  return NAMED_THEMES[colorTheme] ?? (systemTheme === 'dark' ? darkTheme : lightTheme)
}
