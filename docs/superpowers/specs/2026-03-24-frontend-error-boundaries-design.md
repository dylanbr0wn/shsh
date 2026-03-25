# Frontend Error Boundaries Design

## Problem

The React frontend has zero error boundaries. A render error in any component crashes the entire app — a broken SFTP file entry can kill active terminal sessions. The app needs feature-level error isolation so failures are contained and recoverable.

## Approach

**Approach B: Boundary hierarchy with shared error reporting.** A single reusable `<ErrorBoundary>` class component with fallback variants, paired with a `useErrorHandler()` hook for async errors, and all caught errors funneled into the debug panel via a new `"ui"` category.

## Components

### 1. `<ErrorBoundary>` — `components/ErrorBoundary.tsx`

A React class component (required for `componentDidCatch`).

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `fallback` | `"inline" \| "panel" \| "fullscreen"` | Fallback UI variant |
| `zone` | `string` | Label for error reporting (e.g. `"sftp"`, `"terminal"`, `"modal"`) |
| `onError` | `(error: Error, errorInfo: React.ErrorInfo) => void` | Callback wired to UI error reporting |
| `resetKeys` | `unknown[]` (optional) | When any value changes, auto-reset the boundary |
| `children` | `React.ReactNode` | Components to protect |

**Fallback variants:**

- **`"inline"`** — Compact single-line message replacing the component. "Try Again" button resets the boundary.
- **`"panel"`** — Centered message with icon, error summary, and "Try Again" button. For zone-sized areas (sidebar, main area).
- **`"fullscreen"`** — Last-resort crash screen covering the viewport. "Try Again" resets the boundary. "Reload App" calls `window.location.reload()`.

**Behavior:**

- `componentDidCatch(error, errorInfo)` calls `onError` prop
- `getDerivedStateFromError` sets `hasError: true`, renders fallback
- "Try Again" button clears `hasError`, re-renders children
- `componentDidUpdate` checks `resetKeys` against previous values — if any changed, clears `hasError` automatically. This ensures boundaries wrapping dynamic content (e.g., a pane that gets replaced) don't stay stuck in error state.

### 2. `useErrorHandler()` — `hooks/useErrorHandler.ts`

A hook for pushing async/event-handler errors into the nearest error boundary.

```tsx
const reportError = useErrorHandler()
// In an async handler:
try { await doThing() } catch (err) { reportError(err) }
```

**How it works:** Stores error in local state. On next render, `throw`s the stored error — React's boundary mechanism catches it. Same pattern as `react-error-boundary`.

**When to use vs. toast:**

- `reportError()` → Component is broken and can't continue (e.g., critical data load failed, render state is corrupted)
- `toast.error()` → Action failed but component is still functional (e.g., file upload failed, retry possible)

### 3. `reportUIError()` — `lib/reportUIError.ts`

Utility function that formats a caught error into a `DebugLogEntry` and pushes it into the debug ring buffer.

```ts
function reportUIError(error: Error, errorInfo: React.ErrorInfo, zone: string): void
```

- Creates a `DebugLogEntry` with `category: "ui"`, `level: "error"`
- Message includes the zone and error message
- `fields` includes `zone` and a truncated `componentStack` from `errorInfo`
- Pushes into `debugRingBuffer` and bumps `debugVersionAtom`

This is what gets passed as the `onError` prop to every `<ErrorBoundary>`.

## Boundary Placement

### Tier 1 — App-level safety net

| Location | Wraps | Fallback |
|----------|-------|----------|
| `App.tsx` root content | Entire app content | `"fullscreen"` |

### Tier 2 — Zone isolation

| Location | Wraps | Fallback |
|----------|-------|----------|
| `App.tsx` | `<TitleBar />` | `"inline"` |
| `App.tsx` | `<Sidebar />` | `"panel"` |
| `App.tsx` | `<MainArea />` | `"panel"` |
| `App.tsx` | `<DebugPanel />` | `"inline"` |

### Tier 3 — Feature-level isolation

| Location | Wraps | Fallback |
|----------|-------|----------|
| `PaneTree.tsx` | Each `<TerminalInstance />` leaf | `"inline"` |
| `PaneTree.tsx` | Each `<SFTPPanel />` leaf | `"inline"` |
| `App.tsx` | Each modal (all 11 in App.tsx) | `"inline"` |
| `MainArea.tsx` | `<TabBar />` separately from `<WorkspaceView />` | `"inline"` |
| `TerminalSidebar.tsx` | `<PortForwardsPanel />` inside `PopoverContent` | `"inline"` |
| `HostList.tsx` | Each `<HostListItem />` | `"inline"` |
| `HostGroupSection.tsx` | Each `<HostListItem />` | `"inline"` |

**Dynamic zone labels:** Boundaries in loops should include a discriminator in the `zone` prop for debuggability: e.g., `zone={\`terminal-\${leaf.channelId}\`}`, `zone={\`host-\${host.id}\`}`. This makes UI error entries in the debug panel distinguishable.

**Modals outside App.tsx:** `EditGroupModal` (in `HostGroupSection.tsx`) and `CloseConfirmDialog` (in TabBar) are covered by their respective Tier 2 zone boundaries (Sidebar and MainArea). No dedicated Tier 3 boundary needed.

**Portal behavior:** `PortForwardsPanel` renders inside a Radix `PopoverContent` which uses a React portal. Radix portals preserve the React component tree hierarchy, so the boundary wrapping content inside `PopoverContent` will catch errors correctly.

**Isolation guarantee:** A render error in one terminal pane, SFTP panel, modal, or host list item is contained. Sibling components and other zones continue working. The user can close the broken pane/modal and retry.

## Debug Panel Integration

### Type changes — `types/debug.ts`

- `DebugCategory` adds `"ui"`: `'ssh' | 'sftp' | 'portfwd' | 'network' | 'app' | 'ui'`
- `CATEGORY_COLORS` adds `ui` entry (e.g., `'#f85149'` — red, signals errors)
- `sessionId` and `sessionLabel` become optional fields on `DebugLogEntry` (UI errors have no session). Filter logic in `debugFilteredEntriesAtom` needs a guard: `if (sessionFilter && e.sessionId !== sessionFilter) return false` already handles undefined correctly since `undefined !== "some-id"`.

### Store changes — `store/debugStore.ts`

- `debugFilterCategoriesAtom` default set includes `'ui'`

### Filter bar changes — `components/debug/DebugFilterBar.tsx`

- `ALL_CATEGORIES` gets `{ key: 'ui', label: 'UI' }` entry
- New pill appears in filter bar alongside SSH, SFTP, PortFwd, Network, App
- Session dropdown extraction skips entries with no `sessionId`

### No structural changes

The virtualized list, filtering logic, settings overlay, and log row rendering all work as-is. UI error entries flow through the same pipeline as backend log entries.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/ErrorBoundary.tsx` | Reusable error boundary class component with `resetKeys` support |
| `frontend/src/hooks/useErrorHandler.ts` | Hook to push async errors into boundaries |
| `frontend/src/lib/reportUIError.ts` | Formats and pushes UI errors to debug ring buffer |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/types/debug.ts` | Add `"ui"` to `DebugCategory`, add color, make `sessionId`/`sessionLabel` optional |
| `frontend/src/store/debugStore.ts` | Add `"ui"` to default filter categories |
| `frontend/src/components/debug/DebugFilterBar.tsx` | Add UI category pill, guard session extraction for optional `sessionId` |
| `frontend/src/App.tsx` | Wrap TitleBar, zones, and modals with `<ErrorBoundary>` |
| `frontend/src/components/layout/MainArea.tsx` | Wrap `<TabBar />` separately with `<ErrorBoundary>` |
| `frontend/src/components/terminal/PaneTree.tsx` | Wrap terminal/SFTP leaves with `<ErrorBoundary>` |
| `frontend/src/components/sidebar/HostList.tsx` | Wrap `<HostListItem>` with `<ErrorBoundary>` |
| `frontend/src/components/sidebar/HostGroupSection.tsx` | Wrap `<HostListItem>` with `<ErrorBoundary>` |
| `frontend/src/components/terminal/TerminalSidebar.tsx` | Wrap `<PortForwardsPanel>` inside `PopoverContent` with `<ErrorBoundary>` |

## Testing

Error boundaries require actual React render errors to test. Strategy:

- **Manual verification:** Temporarily add `throw new Error('test')` inside a leaf component (e.g., `HostListItem` render body) and confirm the inline fallback renders while siblings remain functional.
- **`useErrorHandler` verification:** Call `reportError(new Error('test'))` from an async handler and confirm the boundary catches it.
- **Debug panel verification:** Trigger a boundary catch and confirm a `"ui"` category entry appears in the debug panel log with the correct zone label.
- **Reset verification:** Trigger an error in a dynamic boundary (e.g., a terminal pane), close the pane, open a new one, and confirm the boundary resets (no stale error state).
