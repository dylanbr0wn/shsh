# @wailsjs Path Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all relative `wailsjs` imports with an `@wailsjs` path alias so `tsc` works without `wails generate module`.

**Architecture:** Configure `@wailsjs` in three places (tsconfig for types, vite for builds, vitest for tests), add missing stubs, then mechanically rewrite all 54 imports across 38 files.

**Tech Stack:** TypeScript path aliases, Vite resolve aliases, Vitest resolve aliases

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `frontend/tsconfig.json` | Add `@wailsjs/*` path with fallback to stubs |
| Modify | `frontend/vite.config.ts` | Add `@wailsjs` alias → `./wailsjs` |
| Modify | `frontend/vitest.config.ts` | Replace 3 depth aliases with single `@wailsjs` alias |
| Modify | `frontend/src/test/setup.ts` | Update `vi.mock()` paths to `@wailsjs/...` |
| Create | `frontend/src/test/wailsjs-stubs/go/main/KeysFacade.ts` | Missing stub |
| Create | `frontend/src/test/wailsjs-stubs/go/models.ts` | Missing stub |
| Modify | `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts` | Add missing exports |
| Modify | `frontend/src/test/wailsjs-stubs/go/main/HostFacade.ts` | Add missing exports |
| Modify | `frontend/src/test/wailsjs-stubs/go/main/ToolsFacade.ts` | Add missing exports |
| Modify | `frontend/src/test/wailsjs-stubs/go/main/VaultFacade.ts` | Add missing exports |
| Modify | 38 source/test files | Rewrite relative imports to `@wailsjs/...` |

---

### Task 1: Add Missing Stubs and Complete Existing Stubs

**Files:**
- Create: `frontend/src/test/wailsjs-stubs/go/main/KeysFacade.ts`
- Create: `frontend/src/test/wailsjs-stubs/go/models.ts`
- Modify: `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts`
- Modify: `frontend/src/test/wailsjs-stubs/go/main/HostFacade.ts`
- Modify: `frontend/src/test/wailsjs-stubs/go/main/ToolsFacade.ts`
- Modify: `frontend/src/test/wailsjs-stubs/go/main/VaultFacade.ts`

- [ ] **Step 1: Create KeysFacade stub**

Create `frontend/src/test/wailsjs-stubs/go/main/KeysFacade.ts`:

```ts
// Stub — replaced by vi.mock in setup.ts at runtime.
export const BrowseKeyFile = (): Promise<string> => Promise.resolve('')
export const GenerateSSHKey = (): Promise<unknown> => Promise.resolve({})
export const DeployPublicKey = (): Promise<void> => Promise.resolve()
export const ReadPublicKeyText = (): Promise<string> => Promise.resolve('')
```

- [ ] **Step 2: Create models stub**

Create `frontend/src/test/wailsjs-stubs/go/models.ts`:

```ts
// Stub for Wails-generated Go model classes.
export const store = {
  CreateTemplateInput: {
    createFrom: (obj: Record<string, unknown>) => obj,
  },
}
```

- [ ] **Step 3: Add missing exports to SessionFacade stub**

Replace `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts` with:

```ts
// Stub — replaced by vi.mock in setup.ts at runtime.
export const CloseChannel = (_channelId: string): Promise<void> => Promise.resolve()
export const ConnectHost = (): Promise<void> => Promise.resolve()
export const WriteToChannel = (): Promise<void> => Promise.resolve()
export const ResizeChannel = (): Promise<void> => Promise.resolve()
export const ListPortForwards = (): Promise<unknown[]> => Promise.resolve([])
export const RemovePortForward = (): Promise<void> => Promise.resolve()
export const StartSessionLog = (): Promise<string> => Promise.resolve('')
export const StopSessionLog = (): Promise<void> => Promise.resolve()
export const ListSFTPDir = (): Promise<unknown[]> => Promise.resolve([])
export const DownloadFile = (): Promise<void> => Promise.resolve()
export const UploadFile = (): Promise<void> => Promise.resolve()
export const ConnectForSFTP = (): Promise<void> => Promise.resolve()
export const QuickConnect = (): Promise<void> => Promise.resolve()
export const AddPortForward = (): Promise<void> => Promise.resolve()
export const RespondHostKey = (): Promise<void> => Promise.resolve()
export const OpenTerminal = (): Promise<void> => Promise.resolve()
export const OpenSFTPChannel = (): Promise<void> => Promise.resolve()
export const OpenLocalFSChannel = (): Promise<void> => Promise.resolve()
export const SFTPListDir = (): Promise<unknown[]> => Promise.resolve([])
export const SFTPDownload = (): Promise<void> => Promise.resolve()
export const SFTPDownloadDir = (): Promise<void> => Promise.resolve()
export const SFTPUpload = (): Promise<void> => Promise.resolve()
export const SFTPUploadPath = (): Promise<void> => Promise.resolve()
export const SFTPMkdir = (): Promise<void> => Promise.resolve()
export const SFTPDelete = (): Promise<void> => Promise.resolve()
export const SFTPRename = (): Promise<void> => Promise.resolve()
export const TransferBetweenChannels = (): Promise<void> => Promise.resolve()
export const LocalListDir = (): Promise<unknown[]> => Promise.resolve([])
export const LocalMkdir = (): Promise<void> => Promise.resolve()
export const LocalDelete = (): Promise<void> => Promise.resolve()
export const LocalRename = (): Promise<void> => Promise.resolve()
```

- [ ] **Step 4: Add missing exports to HostFacade stub**

Replace `frontend/src/test/wailsjs-stubs/go/main/HostFacade.ts` with:

```ts
// Stub — replaced by vi.mock in setup.ts at runtime.
export const ListHosts = (): Promise<unknown[]> => Promise.resolve([])
export const ListGroups = (): Promise<unknown[]> => Promise.resolve([])
export const ListTerminalProfiles = (): Promise<unknown[]> => Promise.resolve([])
export const ListWorkspaceTemplates = (): Promise<unknown[]> => Promise.resolve([])
export const AddGroup = (): Promise<void> => Promise.resolve()
export const PingHosts = (): Promise<Record<string, unknown>> => Promise.resolve({})
export const DeleteHost = (): Promise<void> => Promise.resolve()
export const UpdateHost = (): Promise<void> => Promise.resolve()
export const AddHost = (): Promise<void> => Promise.resolve()
export const DeleteGroup = (): Promise<void> => Promise.resolve()
export const UpdateGroup = (): Promise<void> => Promise.resolve()
export const SaveWorkspaceTemplate = (): Promise<void> => Promise.resolve()
export const ListSSHConfigHosts = (): Promise<unknown[]> => Promise.resolve([])
export const ImportSSHConfigHosts = (): Promise<void> => Promise.resolve()
```

- [ ] **Step 5: Add missing exports to ToolsFacade stub**

Replace `frontend/src/test/wailsjs-stubs/go/main/ToolsFacade.ts` with:

```ts
// Stub — replaced by vi.mock in setup.ts at runtime.
export const OpenLogsDirectory = (): Promise<void> => Promise.resolve()
export const GetHomeDir = (): Promise<string> => Promise.resolve('')
export const ExportHosts = (): Promise<void> => Promise.resolve()
export const CheckPasswordManagers = (): Promise<unknown[]> => Promise.resolve([])
export const TestCredentialRef = (): Promise<unknown> => Promise.resolve({})
export const ParseImportFile = (): Promise<unknown> => Promise.resolve({})
export const CommitImport = (): Promise<void> => Promise.resolve()
export const ListSessionLogs = (): Promise<unknown[]> => Promise.resolve([])
export const ReadSessionLog = (): Promise<string> => Promise.resolve('')
export const DeleteSessionLog = (): Promise<void> => Promise.resolve()
```

- [ ] **Step 6: Add missing exports to VaultFacade stub**

Replace `frontend/src/test/wailsjs-stubs/go/main/VaultFacade.ts` with:

```ts
// Stub — replaced by vi.mock in setup.ts at runtime.
export const SetMasterPassword = (): Promise<void> => Promise.resolve()
export const UnlockVault = (): Promise<void> => Promise.resolve()
export const UnlockVaultBiometric = (): Promise<void> => Promise.resolve()
export const LockVault = (): Promise<void> => Promise.resolve()
export const IsBiometricAvailable = (): Promise<boolean> => Promise.resolve(false)
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/test/wailsjs-stubs/
git commit -m "chore(ui): add missing wailsjs stubs and complete existing ones"
```

---

### Task 2: Configure @wailsjs Path Alias

**Files:**
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/vitest.config.ts`

- [ ] **Step 1: Add @wailsjs path to tsconfig.json**

In `frontend/tsconfig.json`, add the `@wailsjs/*` entry to `compilerOptions.paths`:

```json
"paths": {
  "@/*": ["./src/*"],
  "@wailsjs/*": ["./wailsjs/*", "./src/test/wailsjs-stubs/*"]
}
```

The array order means TypeScript prefers real bindings when they exist, falls back to stubs when they don't.

- [ ] **Step 2: Add @wailsjs alias to vite.config.ts**

In `frontend/vite.config.ts`, add `@wailsjs` to the resolve aliases. The file should become:

```ts
import path from 'path'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wailsjs': path.resolve(__dirname, './wailsjs'),
    },
  },
})
```

- [ ] **Step 3: Replace depth aliases in vitest.config.ts**

Replace the three `../wailsjs`, `../../wailsjs`, `../../../wailsjs` aliases with one `@wailsjs` alias. The file should become:

```ts
import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wailsjs': path.resolve(__dirname, './src/test/wailsjs-stubs'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
```

- [ ] **Step 4: Verify config compiles**

```bash
cd frontend && pnpm test
```

Expected: Tests still pass (stubs resolve via new alias). If any test fails with "cannot find module", the alias is misconfigured.

- [ ] **Step 5: Commit**

```bash
git add frontend/tsconfig.json frontend/vite.config.ts frontend/vitest.config.ts
git commit -m "chore(ui): configure @wailsjs path alias in tsconfig, vite, and vitest"
```

---

### Task 3: Update setup.ts vi.mock Paths

**Files:**
- Modify: `frontend/src/test/setup.ts`

- [ ] **Step 1: Replace relative paths with @wailsjs aliases**

Replace all `vi.mock('../../wailsjs/...')` calls with `vi.mock('@wailsjs/...')`. The file should become:

```ts
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock the Wails runtime — every module that imports from wailsjs/runtime/runtime
// gets these stubs instead. EventsOn returns a cancel function.
vi.mock('@wailsjs/runtime/runtime', () => ({
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
vi.mock('@wailsjs/go/main/SessionFacade', () => ({
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
vi.mock('@wailsjs/go/main/HostFacade', () => ({
  ListHosts: vi.fn(() => Promise.resolve([])),
  ListGroups: vi.fn(() => Promise.resolve([])),
  ListTerminalProfiles: vi.fn(() => Promise.resolve([])),
  ListWorkspaceTemplates: vi.fn(() => Promise.resolve([])),
  AddGroup: vi.fn(() => Promise.resolve()),
  PingHosts: vi.fn(() => Promise.resolve({})),
}))

// Mock App facade
vi.mock('@wailsjs/go/main/App', () => ({
  GetConfig: vi.fn(() => Promise.resolve({})),
  SetDebugLevel: vi.fn(() => Promise.resolve()),
  UpdateConfig: vi.fn(() => Promise.resolve()),
}))

// Mock ToolsFacade
vi.mock('@wailsjs/go/main/ToolsFacade', () => ({
  OpenLogsDirectory: vi.fn(() => Promise.resolve()),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
```

- [ ] **Step 2: Run tests to verify mocks still work**

```bash
cd frontend && pnpm test
```

Expected: All 73 tests pass. The `vi.mock()` calls must match the import paths used in source files — since source files will be updated in Task 4 to use `@wailsjs/...`, and vitest resolves `@wailsjs` to the stubs directory, the mock paths must also use `@wailsjs/...`.

**Important:** If tests fail here, it's because the source files still use relative paths but the mocks now use `@wailsjs`. This is expected — the test files that import from `wailsjs` (workspaceActions.test.ts, useWailsEvent.test.tsx, useChannelEvents.test.tsx) will be updated in Task 4. If needed, temporarily keep the old mock paths and update them together with the imports in Task 4.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/setup.ts
git commit -m "chore(ui): update vi.mock paths to use @wailsjs alias"
```

---

### Task 4: Rewrite All Imports

**Files:**
- Modify: All 38 files listed below

This is a mechanical find-and-replace. Every relative import matching `from '...wailsjs/...'` becomes `from '@wailsjs/...'`.

- [ ] **Step 1: Rewrite imports in all source files**

For each file, replace all relative `wailsjs` imports with `@wailsjs`. The complete list of files and their exact replacements:

**Depth 1 (`../wailsjs` → `@wailsjs`):**

`frontend/src/App.tsx`:
```ts
// Before:
import { ... } from '../wailsjs/go/main/VaultFacade'
import { EventsOn } from '../wailsjs/runtime/runtime'
// After:
import { ... } from '@wailsjs/go/main/VaultFacade'
import { EventsOn } from '@wailsjs/runtime/runtime'
```

**Depth 2 (`../../wailsjs` → `@wailsjs`):**

- `frontend/src/store/useAppInit.ts`
- `frontend/src/store/useHostHealth.ts`
- `frontend/src/store/workspaceActions.ts`
- `frontend/src/store/workspaceActions.test.ts`
- `frontend/src/hooks/useWailsEvent.ts`
- `frontend/src/hooks/useWailsEvent.test.tsx`
- `frontend/src/hooks/useChannelEvents.test.tsx`
- `frontend/src/hooks/useTerminal.ts`
- `frontend/src/hooks/useSessionMenuEvents.ts`
- `frontend/src/components/CommandPalette.tsx`

**Depth 3 (`../../../wailsjs` → `@wailsjs`):**

- `frontend/src/components/debug/DebugPanel.tsx`
- `frontend/src/components/debug/DebugSettingsOverlay.tsx`
- `frontend/src/components/layout/TitleBar.tsx`
- `frontend/src/components/localfs/LocalFSPanel.tsx`
- `frontend/src/components/modals/AddHostModal.tsx`
- `frontend/src/components/modals/AddPortForwardModal.tsx`
- `frontend/src/components/modals/DeployKeyModal.tsx`
- `frontend/src/components/modals/EditGroupModal.tsx`
- `frontend/src/components/modals/EditHostModal.tsx`
- `frontend/src/components/modals/ExportHostsModal.tsx`
- `frontend/src/components/modals/GenerateKeyModal.tsx`
- `frontend/src/components/modals/HostKeyDialog.tsx`
- `frontend/src/components/modals/ImportHostsModal.tsx`
- `frontend/src/components/modals/LogViewerModal.tsx`
- `frontend/src/components/modals/QuickConnectModal.tsx`
- `frontend/src/components/modals/TerminalProfilesModal.tsx`
- `frontend/src/components/modals/VaultLockOverlay.tsx`
- `frontend/src/components/portforward/PortForwardsPanel.tsx`
- `frontend/src/components/sessions/TabBar.tsx`
- `frontend/src/components/settings/SecuritySettings.tsx`
- `frontend/src/components/sftp/SFTPPanel.tsx`
- `frontend/src/components/sidebar/HostGroupSection.tsx`
- `frontend/src/components/sidebar/HostList.tsx`
- `frontend/src/components/sidebar/SidebarFooter.tsx`
- `frontend/src/components/terminal/WorkspaceView.tsx`
- `frontend/src/components/welcome/WelcomeScreen.tsx`
- `frontend/src/components/workspace/SaveTemplateDialog.tsx`

The replacement pattern for each file:
- `from '../wailsjs/` → `from '@wailsjs/`
- `from '../../wailsjs/` → `from '@wailsjs/`
- `from '../../../wailsjs/` → `from '@wailsjs/`

No other changes to these files. Only the import `from` path changes.

- [ ] **Step 2: Run tests**

```bash
cd frontend && pnpm test
```

Expected: All 73 tests pass. If any test fails with module resolution errors, check that the import path was rewritten correctly and that the vitest alias resolves properly.

- [ ] **Step 3: Run lint and format**

```bash
cd frontend && pnpm lint && pnpm format:check
```

Expected: Clean. If format check fails, run `pnpm format` first.

- [ ] **Step 4: Verify no remaining relative wailsjs imports**

```bash
cd frontend && grep -r "from ['\"]\.\..*wailsjs" src/ && echo "FAIL: relative imports remain" || echo "OK: all imports rewritten"
```

Expected: `OK: all imports rewritten`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "refactor(ui): replace relative wailsjs imports with @wailsjs path alias"
```

---

### Task 5: Verify Full Build Pipeline

- [ ] **Step 1: Run tests**

```bash
cd frontend && pnpm test
```

Expected: All 73 tests pass.

- [ ] **Step 2: Run lint and format**

```bash
cd frontend && pnpm lint && pnpm format:check
```

Expected: Clean (pre-existing warnings only).

- [ ] **Step 3: Verify tsc resolves stubs without wailsjs directory**

Move the real `wailsjs/` directory aside (if it exists) and run tsc:

```bash
cd frontend
if [ -d wailsjs ]; then mv wailsjs wailsjs.bak; fi
npx tsc --noEmit
if [ -d wailsjs.bak ]; then mv wailsjs.bak wailsjs; fi
```

Expected: `tsc` passes with zero errors — TypeScript falls back to the stubs via the second entry in the `paths` array. This is the core verification that the alias works.

- [ ] **Step 4: Run Go checks (unchanged)**

```bash
go vet ./internal/...
go test ./internal/... -race -timeout 60s
```

Expected: All pass (Go code is untouched).
