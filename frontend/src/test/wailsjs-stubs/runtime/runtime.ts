// Stub — replaced by vi.mock in setup.ts at runtime.
// Exists so Vitest can resolve wailsjs/runtime/runtime imports without wails generate.
export const EventsOn = (..._args: unknown[]): (() => void) => () => {}
export const EventsOff = (..._args: unknown[]): void => {}
export const EventsEmit = (..._args: unknown[]): void => {}
export const WindowSetDarkTheme = (): void => {}
export const WindowSetLightTheme = (): void => {}
export const WindowMinimise = (): void => {}
export const WindowMaximise = (): void => {}
export const WindowUnmaximise = (): void => {}
export const WindowClose = (): void => {}
export const WindowIsMaximised = (): Promise<boolean> => Promise.resolve(false)
export const WindowToggleMaximise = (): void => {}
