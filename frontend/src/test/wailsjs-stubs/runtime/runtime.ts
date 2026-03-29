// Stub — replaced by vi.mock in setup.ts at runtime.
// Exists so Vitest can resolve wailsjs/runtime/runtime imports without wails generate.
export const EventsOn = (..._args: any[]): any => () => {}
export const EventsOff = (..._args: any[]): any => {}
export const EventsEmit = (..._args: any[]): any => {}
export const WindowSetDarkTheme = (..._args: any[]): any => {}
export const WindowSetLightTheme = (..._args: any[]): any => {}
export const WindowMinimise = (..._args: any[]): any => {}
export const WindowMaximise = (..._args: any[]): any => {}
export const WindowUnmaximise = (..._args: any[]): any => {}
export const WindowClose = (..._args: any[]): any => {}
export const WindowIsMaximised = (..._args: any[]): any => Promise.resolve(false)
export const WindowToggleMaximise = (..._args: any[]): any => {}
export const Environment = (..._args: any[]): any => ({})
export const Quit = (..._args: any[]): any => {}
