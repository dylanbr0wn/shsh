# Frontend Error Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add feature-level React error boundaries so a crash in one component (terminal, SFTP, modal, host item) doesn't take down the entire app, with all caught errors surfaced in the debug panel under a new "ui" category.

**Architecture:** A single reusable `<ErrorBoundary>` class component with three fallback variants (inline, panel, fullscreen) wraps components at three tiers: app-level safety net, zone isolation (sidebar/main/debug/titlebar), and feature-level (each terminal, SFTP pane, modal, host list item, tab bar, port forwards). A `useErrorHandler` hook lets functional components push async errors into the nearest boundary. All caught errors flow into the existing debug ring buffer as a new `"ui"` category.

**Tech Stack:** React 19, Jotai, shadcn/ui, Tailwind CSS, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-frontend-error-boundaries-design.md`

---

### Task 1: Add "ui" debug category to type system

**Files:**
- Modify: `frontend/src/types/debug.ts`

- [ ] **Step 1: Update `DebugCategory` type**

Add `'ui'` to the union type:

```typescript
export type DebugCategory = 'ssh' | 'sftp' | 'portfwd' | 'network' | 'app' | 'ui'
```

- [ ] **Step 2: Make `sessionId` and `sessionLabel` optional**

UI errors have no associated session. Change:

```typescript
export interface DebugLogEntry {
  timestamp: string
  category: DebugCategory
  level: DebugLevel
  sessionId?: string
  sessionLabel?: string
  message: string
  fields?: Record<string, string | number>
}
```

- [ ] **Step 3: Add color for `ui` category**

```typescript
export const CATEGORY_COLORS: Record<DebugCategory, string> = {
  ssh: '#58a6ff',
  sftp: '#3fb950',
  portfwd: '#d2a8ff',
  network: '#f0883e',
  app: '#8b949e',
  ui: '#f85149',
}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success (type change may cause errors in files that create `DebugLogEntry` — if so, fix them in this step by adding the optional fields where needed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/debug.ts
git commit -m "feat(ui): add 'ui' debug category, make session fields optional"
```

---

### Task 2: Update debug store and filter bar for "ui" category

**Files:**
- Modify: `frontend/src/store/debugStore.ts`
- Modify: `frontend/src/components/debug/DebugFilterBar.tsx`

- [ ] **Step 1: Add `'ui'` to default filter categories**

In `debugStore.ts`, update the default set:

```typescript
export const debugFilterCategoriesAtom = atom<Set<DebugCategory>>(
  new Set<DebugCategory>(['ssh', 'sftp', 'portfwd', 'network', 'app', 'ui'])
)
```

- [ ] **Step 2: Add UI pill to filter bar**

In `DebugFilterBar.tsx`, add to `ALL_CATEGORIES`:

```typescript
const ALL_CATEGORIES: { key: DebugCategory; label: string }[] = [
  { key: 'ssh', label: 'SSH' },
  { key: 'sftp', label: 'SFTP' },
  { key: 'portfwd', label: 'PortFwd' },
  { key: 'network', label: 'Network' },
  { key: 'app', label: 'App' },
  { key: 'ui', label: 'UI' },
]
```

- [ ] **Step 3: Guard session extraction for optional `sessionId`**

In `DebugFilterBar.tsx`, update the sessions memo to skip entries without `sessionId`:

```typescript
const sessions = useMemo(() => {
  const all = debugRingBuffer.getAll()
  const seen = new Map<string, string>()
  for (const e of all) {
    if (e.sessionId && !seen.has(e.sessionId)) {
      seen.set(e.sessionId, e.sessionLabel ?? e.sessionId)
    }
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }))
}, [])
```

Note: The existing code already checks `if (e.sessionId && ...)` so this should already be safe, but verify it handles `undefined` correctly now that the field is optional.

- [ ] **Step 4: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/debugStore.ts frontend/src/components/debug/DebugFilterBar.tsx
git commit -m "feat(ui): add UI category to debug filter bar and store"
```

---

### Task 3: Create `reportUIError` utility

**Files:**
- Create: `frontend/src/lib/reportUIError.ts`

- [ ] **Step 1: Create the utility**

```typescript
import type { ErrorInfo } from 'react'
import type { DebugLogEntry } from '../types/debug'
import { debugRingBuffer, debugVersionAtom } from '../store/debugStore'
import { getDefaultStore } from 'jotai'

const store = getDefaultStore()

export function reportUIError(
  error: Error,
  errorInfo: ErrorInfo,
  zone: string
): void {
  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    category: 'ui',
    level: 'error',
    message: `[${zone}] ${error.message}`,
    fields: {
      zone,
      ...(errorInfo.componentStack
        ? { componentStack: errorInfo.componentStack.slice(0, 500) }
        : {}),
    },
  }
  debugRingBuffer.push(entry)
  store.set(debugVersionAtom, (v) => v + 1)
}
```

Note: We use `getDefaultStore()` from Jotai to access the store outside of React context. This works because the app uses Jotai's default store (no custom `Provider`). Verify this by checking `frontend/src/main.tsx` — if there's a `<Provider store={...}>`, use that store instead.

- [ ] **Step 2: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/reportUIError.ts
git commit -m "feat(ui): add reportUIError utility for debug panel integration"
```

---

### Task 4: Create `<ErrorBoundary>` component

**Files:**
- Create: `frontend/src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Create the error boundary class component**

```tsx
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'

interface Props {
  fallback: 'inline' | 'panel' | 'fullscreen'
  zone: string
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetKeys?: unknown[]
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError || !this.props.resetKeys) return
    const changed = this.props.resetKeys.some(
      (key, i) => key !== prevProps.resetKeys?.[i]
    )
    if (changed) {
      this.setState({ hasError: false, error: null })
    }
  }

  private reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { fallback, zone } = this.props
    const message = this.state.error?.message ?? 'Unknown error'

    if (fallback === 'fullscreen') {
      return (
        <div className="bg-background text-foreground flex h-screen w-screen flex-col items-center justify-center gap-4">
          <AlertTriangle className="text-destructive size-10" />
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md text-center text-sm">
            {message}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.reset}>
              <RefreshCw className="mr-2 size-4" />
              Try Again
            </Button>
            <Button onClick={() => window.location.reload()}>
              Reload App
            </Button>
          </div>
        </div>
      )
    }

    if (fallback === 'panel') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
          <AlertTriangle className="text-destructive size-6" />
          <p className="text-muted-foreground text-center text-sm">
            Error in {zone}
          </p>
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RefreshCw className="mr-2 size-3.5" />
            Try Again
          </Button>
        </div>
      )
    }

    // inline
    return (
      <div className="text-destructive/80 flex items-center gap-2 px-3 py-1.5 text-xs">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="truncate">Error in {zone}</span>
        <button
          onClick={this.reset}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs underline"
        >
          Retry
        </button>
      </div>
    )
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ErrorBoundary.tsx
git commit -m "feat(ui): add reusable ErrorBoundary component with inline/panel/fullscreen variants"
```

---

### Task 5: Create `useErrorHandler` hook

**Files:**
- Create: `frontend/src/hooks/useErrorHandler.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useCallback } from 'react'

export function useErrorHandler(): (error: unknown) => void {
  const [, setError] = useState<Error>()

  return useCallback((error: unknown) => {
    setError(() => {
      throw error instanceof Error ? error : new Error(String(error))
    })
  }, [])
}
```

The trick: calling `setError` with a function that `throw`s makes React re-render the component, which hits the throw, which propagates up to the nearest error boundary.

Note: This hook is not wired into any component in this plan. It is created as infrastructure for future use — when developers encounter async errors that should kill a component (rather than just toast), they import this hook. It will not trigger unused-export lint warnings since it's a named export from a hooks file.

- [ ] **Step 2: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useErrorHandler.ts
git commit -m "feat(ui): add useErrorHandler hook for async error propagation"
```

---

### Task 6: Wire boundaries into App.tsx (Tier 1 + Tier 2 + modal Tier 3)

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add imports**

Add to the imports in `App.tsx`:

```typescript
import { ErrorBoundary } from './components/ErrorBoundary'
import { reportUIError } from './lib/reportUIError'
```

- [ ] **Step 2: Wrap entire app content with Tier 1 fullscreen boundary**

Wrap the outer `<div>` contents inside the `<TooltipProvider>`. Keep `<Toaster>` outside the boundary so toast notifications remain available during error recovery:

```tsx
<TooltipProvider delayDuration={400}>
  <ErrorBoundary fallback="fullscreen" zone="app" onError={(e, i) => reportUIError(e, i, 'app')}>
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      {/* ... existing content ... */}
    </div>
  </ErrorBoundary>
  <Toaster position="bottom-right" theme={resolvedTheme as 'light' | 'dark'} />
</TooltipProvider>
```

- [ ] **Step 3: Wrap TitleBar with Tier 2 inline boundary**

```tsx
<ErrorBoundary fallback="inline" zone="titlebar" onError={(e, i) => reportUIError(e, i, 'titlebar')}>
  <TitleBar />
</ErrorBoundary>
```

- [ ] **Step 4: Wrap Sidebar with Tier 2 panel boundary**

```tsx
<ResizablePanel ...>
  <ErrorBoundary fallback="panel" zone="sidebar" onError={(e, i) => reportUIError(e, i, 'sidebar')}>
    <Sidebar />
  </ErrorBoundary>
</ResizablePanel>
```

- [ ] **Step 5: Wrap MainArea with Tier 2 panel boundary**

```tsx
<ResizablePanel defaultSize="82%" className="flex min-h-0 flex-col overflow-hidden">
  <ResizablePanelGroup orientation="vertical" className="h-full">
    <ResizablePanel defaultSize="100%" minSize="30%" className="overflow-hidden">
      <ErrorBoundary fallback="panel" zone="main" onError={(e, i) => reportUIError(e, i, 'main')}>
        <MainArea />
      </ErrorBoundary>
    </ResizablePanel>
    {/* debug panel below */}
  </ResizablePanelGroup>
</ResizablePanel>
```

- [ ] **Step 6: Wrap DebugPanel with Tier 2 inline boundary**

```tsx
<ResizablePanel panelRef={debugRef} ...>
  <ErrorBoundary fallback="inline" zone="debug" onError={(e, i) => reportUIError(e, i, 'debug')}>
    <DebugPanel />
  </ErrorBoundary>
</ResizablePanel>
```

- [ ] **Step 7: Wrap each modal with Tier 3 inline boundary**

Wrap each of the 11 modals individually. Example for the first few:

```tsx
<ErrorBoundary fallback="inline" zone="modal-add-host" onError={(e, i) => reportUIError(e, i, 'modal-add-host')}>
  <AddHostModal />
</ErrorBoundary>
<ErrorBoundary fallback="inline" zone="modal-edit-host" onError={(e, i) => reportUIError(e, i, 'modal-edit-host')}>
  <EditHostModal />
</ErrorBoundary>
<ErrorBoundary fallback="inline" zone="modal-settings" onError={(e, i) => reportUIError(e, i, 'modal-settings')}>
  <SettingsModal />
</ErrorBoundary>
```

Apply the same pattern to all 11: HostKeyDialog, ImportSSHConfigModal, ExportHostsModal, QuickConnectModal, LogViewerModal, AddPortForwardModal, TerminalProfilesModal, DeployKeyModal.

- [ ] **Step 8: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): add error boundaries to App.tsx (Tier 1/2 + modals)"
```

---

### Task 7: Wire boundaries into PaneTree.tsx (Tier 3 — terminal/SFTP leaves)

**Files:**
- Modify: `frontend/src/components/terminal/PaneTree.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
```

- [ ] **Step 2: Wrap each leaf pane with a boundary**

In the leaf render section (around lines 100-107), wrap the SFTP and terminal branches. Use `resetKeys` with the `channelId` so the boundary resets if the pane is replaced:

```tsx
{leaf.kind === 'sftp' ? (
  <ErrorBoundary
    fallback="inline"
    zone={`sftp-${leaf.channelId}`}
    onError={(e, i) => reportUIError(e, i, `sftp-${leaf.channelId}`)}
    resetKeys={[leaf.channelId]}
  >
    <SFTPPanel channelId={leaf.channelId} connectionId={leaf.connectionId} />
  </ErrorBoundary>
) : (
  <ErrorBoundary
    fallback="inline"
    zone={`terminal-${leaf.channelId}`}
    onError={(e, i) => reportUIError(e, i, `terminal-${leaf.channelId}`)}
    resetKeys={[leaf.channelId]}
  >
    <InitialFitTrigger isActive={isActive} />
    <TerminalInstance channelId={leaf.channelId} hostId={leaf.hostId} isActive={isActive} />
  </ErrorBoundary>
)}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/PaneTree.tsx
git commit -m "feat(ui): add error boundaries to terminal/SFTP pane leaves"
```

---

### Task 8: Wire boundaries into MainArea.tsx (Tier 3 — TabBar)

**Files:**
- Modify: `frontend/src/components/layout/MainArea.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
```

- [ ] **Step 2: Wrap TabBar with boundary**

```tsx
return (
  <div className="flex h-full min-w-0 flex-col">
    <ErrorBoundary fallback="inline" zone="tabbar" onError={(e, i) => reportUIError(e, i, 'tabbar')}>
      <TabBar />
    </ErrorBoundary>
    <div className="relative min-h-0 flex-1">
      <WorkspaceView />
    </div>
  </div>
)
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/MainArea.tsx
git commit -m "feat(ui): add error boundary around TabBar in MainArea"
```

---

### Task 9: Wire boundaries into HostList.tsx and HostGroupSection.tsx (Tier 3 — host items)

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx`
- Modify: `frontend/src/components/sidebar/HostGroupSection.tsx`

- [ ] **Step 1: Add imports to HostList.tsx**

```typescript
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
```

- [ ] **Step 2: Wrap HostListItem in search results (HostList.tsx ~line 480)**

In the `filteredHosts.map()` block, wrap each `<HostListItem>`:

```tsx
filteredHosts.map((host) => {
  const group = host.groupId ? groups.find((g) => g.id === host.groupId) : undefined
  return (
    <div key={host.id} className="flex flex-col">
      {group && (
        <span className="text-muted-foreground/50 px-3 pt-0.5 text-[10px]">
          · {group.name}
        </span>
      )}
      <ErrorBoundary
        fallback="inline"
        zone={`host-${host.id}`}
        onError={(e, i) => reportUIError(e, i, `host-${host.id}`)}
        resetKeys={[host.id]}
      >
        <HostListItem ... />
      </ErrorBoundary>
    </div>
  )
})
```

- [ ] **Step 3: Wrap HostListItem in ungrouped section (HostList.tsx ~line 523)**

Same pattern for the `ungrouped.map()` block:

```tsx
{ungrouped.map((host) => (
  <ErrorBoundary
    key={host.id}
    fallback="inline"
    zone={`host-${host.id}`}
    onError={(e, i) => reportUIError(e, i, `host-${host.id}`)}
    resetKeys={[host.id]}
  >
    <HostListItem ... />
  </ErrorBoundary>
))}
```

Note: Move the `key` prop from `<HostListItem>` up to `<ErrorBoundary>` since it's now the outermost element in the map.

- [ ] **Step 4: Add imports to HostGroupSection.tsx**

```typescript
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
```

- [ ] **Step 5: Wrap HostListItem in HostGroupSection.tsx (~line 321-334)**

```tsx
{hosts.map((host) => (
  <ErrorBoundary
    key={host.id}
    fallback="inline"
    zone={`host-${host.id}`}
    onError={(e, i) => reportUIError(e, i, `host-${host.id}`)}
    resetKeys={[host.id]}
  >
    <HostListItem ... />
  </ErrorBoundary>
))}
```

Move the `key` from `<HostListItem>` to `<ErrorBoundary>`.

- [ ] **Step 6: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/sidebar/HostList.tsx frontend/src/components/sidebar/HostGroupSection.tsx
git commit -m "feat(ui): add error boundaries around HostListItem in sidebar"
```

---

### Task 10: Wire boundary into TerminalSidebar.tsx (Tier 3 — PortForwardsPanel)

**Files:**
- Modify: `frontend/src/components/terminal/TerminalSidebar.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
```

- [ ] **Step 2: Wrap PortForwardsPanel inside PopoverContent**

Replace line 44 (`<PortForwardsPanel connectionId={connectionId} />`):

```tsx
<PopoverContent side="left" align="start" className="w-72 p-0">
  <ErrorBoundary
    fallback="inline"
    zone="port-forwards"
    onError={(e, i) => reportUIError(e, i, 'port-forwards')}
  >
    <PortForwardsPanel connectionId={connectionId} />
  </ErrorBoundary>
</PopoverContent>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/TerminalSidebar.tsx
git commit -m "feat(ui): add error boundary around PortForwardsPanel"
```

---

### Task 11: Lint, format, and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run lint**

Run: `cd frontend && pnpm lint`
Expected: No errors. Fix any that appear.

- [ ] **Step 2: Run format check**

Run: `cd frontend && pnpm format:check`
If failures: `cd frontend && pnpm format`

- [ ] **Step 3: Run full build**

Run: `cd frontend && pnpm build`
Expected: Success

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A frontend/src
git commit -m "chore(ui): lint and format error boundary files"
```

---

### Task 12: Manual verification

- [ ] **Step 1: Start the app**

Run: `wails dev`

- [ ] **Step 2: Verify debug panel shows UI category pill**

Open debug panel (Cmd+J). Confirm the "UI" filter pill appears in the filter bar next to SSH, SFTP, PortFwd, Network, App.

- [ ] **Step 3: Test error boundary catch (optional developer verification)**

Temporarily add `throw new Error('boundary test')` as the first line inside the render body of `HostListItem`. Save and confirm:
- The individual host item shows the inline error fallback ("Error in host-{id}" with Retry link)
- Other host items render normally
- The debug panel shows a `ui` category entry with the zone label
- Clicking "Retry" re-renders the component (it will crash again since the throw is still there — remove it after testing)

- [ ] **Step 4: Remove test throw and confirm clean state**

Remove the temporary `throw` and verify the app renders normally.
