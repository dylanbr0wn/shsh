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
| `children` | `React.ReactNode` | Components to protect |

**Fallback variants:**

- **`"inline"`** — Compact single-line message replacing the component. "Try Again" button resets the boundary.
- **`"panel"`** — Centered message with icon, error summary, and "Try Again" button. For zone-sized areas (sidebar, main area).
- **`"fullscreen"`** — Last-resort crash screen covering the viewport. "Try Again" resets the boundary. "Reload App" calls `window.location.reload()`.

**Behavior:**

- `componentDidCatch(error, errorInfo)` calls `onError` prop
- `getDerivedStateFromError` sets `hasError: true`, renders fallback
- "Try Again" button clears `hasError`, re-renders children

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
| `App.tsx` | `<Sidebar />` | `"panel"` |
| `App.tsx` | `<MainArea />` | `"panel"` |
| `App.tsx` | `<DebugPanel />` | `"inline"` |

### Tier 3 — Feature-level isolation

| Location | Wraps | Fallback |
|----------|-------|----------|
| `PaneTree.tsx` | Each `<TerminalInstance />` leaf | `"inline"` |
| `PaneTree.tsx` | Each `<SFTPPanel />` leaf | `"inline"` |
| `App.tsx` | Each modal (all 11) | `"inline"` |
| `TerminalSidebar.tsx` | `<PortForwardsPanel />` | `"inline"` |
| `Sidebar.tsx` | Each `<HostListItem />` | `"inline"` |

**Isolation guarantee:** A render error in one terminal pane, SFTP panel, modal, or host list item is contained. Sibling components and other zones continue working. The user can close the broken pane/modal and retry.

## Debug Panel Integration

### Type changes — `types/debug.ts`

- `DebugCategory` adds `"ui"`: `'ssh' | 'sftp' | 'portfwd' | 'network' | 'app' | 'ui'`
- `CATEGORY_COLORS` adds `ui` entry (e.g., `'#f85149'` — red, signals errors)

### Store changes — `store/debugStore.ts`

- `debugFilterCategoriesAtom` default set includes `'ui'`

### Filter bar changes — `components/debug/DebugFilterBar.tsx`

- `ALL_CATEGORIES` gets `{ key: 'ui', label: 'UI' }` entry
- New pill appears in filter bar alongside SSH, SFTP, PortFwd, Network, App

### No structural changes

The virtualized list, filtering logic, settings overlay, and log row rendering all work as-is. UI error entries flow through the same pipeline as backend log entries.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/ErrorBoundary.tsx` | Reusable error boundary class component |
| `frontend/src/hooks/useErrorHandler.ts` | Hook to push async errors into boundaries |
| `frontend/src/lib/reportUIError.ts` | Formats and pushes UI errors to debug ring buffer |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/types/debug.ts` | Add `"ui"` to `DebugCategory`, add color |
| `frontend/src/store/debugStore.ts` | Add `"ui"` to default filter categories |
| `frontend/src/components/debug/DebugFilterBar.tsx` | Add UI category pill |
| `frontend/src/App.tsx` | Wrap zones and modals with `<ErrorBoundary>` |
| `frontend/src/components/terminal/PaneTree.tsx` | Wrap terminal/SFTP leaves with `<ErrorBoundary>` |
| `frontend/src/components/layout/Sidebar.tsx` | Wrap `<HostListItem>` with `<ErrorBoundary>` |
| `frontend/src/components/terminal/TerminalSidebar.tsx` | Wrap `<PortForwardsPanel>` with `<ErrorBoundary>` |
