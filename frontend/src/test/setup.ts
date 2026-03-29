import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock the Wails runtime — every module that imports from wailsjs/runtime/runtime
// gets these stubs instead. EventsOn returns a cancel function.
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
  EventsOff: vi.fn(),
  EventsEmit: vi.fn(),
  WindowSetDarkTheme: vi.fn(),
  WindowSetLightTheme: vi.fn(),
  WindowMinimise: vi.fn(),
  WindowMaximise: vi.fn(),
  WindowUnmaximise: vi.fn(),
  WindowClose: vi.fn(),
  WindowIsMaximised: vi.fn(() => Promise.resolve(false)),
  WindowToggleMaximise: vi.fn(),
}))

// Mock SessionFacade — the most commonly imported Go facade
vi.mock('../../wailsjs/go/main/SessionFacade', () => ({
  CloseChannel: vi.fn(() => Promise.resolve()),
  ConnectHost: vi.fn(() => Promise.resolve()),
  WriteToChannel: vi.fn(() => Promise.resolve()),
  ResizeChannel: vi.fn(() => Promise.resolve()),
  ListPortForwards: vi.fn(() => Promise.resolve([])),
  RemovePortForward: vi.fn(() => Promise.resolve()),
  StartSessionLog: vi.fn(() => Promise.resolve('')),
  StopSessionLog: vi.fn(() => Promise.resolve()),
  ListSFTPDir: vi.fn(() => Promise.resolve([])),
  DownloadFile: vi.fn(() => Promise.resolve()),
  UploadFile: vi.fn(() => Promise.resolve()),
}))

// Mock HostFacade
vi.mock('../../wailsjs/go/main/HostFacade', () => ({
  ListHosts: vi.fn(() => Promise.resolve([])),
  ListGroups: vi.fn(() => Promise.resolve([])),
  ListTerminalProfiles: vi.fn(() => Promise.resolve([])),
  ListWorkspaceTemplates: vi.fn(() => Promise.resolve([])),
  AddGroup: vi.fn(() => Promise.resolve()),
  PingHosts: vi.fn(() => Promise.resolve({})),
}))

// Mock App facade
vi.mock('../../wailsjs/go/main/App', () => ({
  GetConfig: vi.fn(() => Promise.resolve({})),
  SetDebugLevel: vi.fn(() => Promise.resolve()),
  UpdateConfig: vi.fn(() => Promise.resolve()),
}))

// Mock ToolsFacade
vi.mock('../../wailsjs/go/main/ToolsFacade', () => ({
  OpenLogsDirectory: vi.fn(() => Promise.resolve()),
}))
