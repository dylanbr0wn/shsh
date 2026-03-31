# Terminal Features in Pane Header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move terminal-scoped features (settings, port forwards, logging toggle) from the global `TerminalSidebar` pillar into per-pane header icons via a new `PaneToolbar` component with overflow support.

**Architecture:** A new `PaneToolbar` component renders feature action icons inside `PaneHeader`, positioned between the type badge and the split/close buttons. It uses `ResizeObserver` to detect when the pane is too narrow and collapses icons into an overflow `DropdownMenu`. The existing `TerminalSidebar` is deleted.

**Tech Stack:** React, Jotai, shadcn (Popover, DropdownMenu, Tooltip), lucide-react, ResizeObserver

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/components/terminal/PaneToolbar.tsx` | Feature icons, overflow logic, popover anchoring |
| Create | `frontend/src/components/terminal/PaneToolbar.test.tsx` | Unit tests for overflow behavior and feature visibility |
| Modify | `frontend/src/components/terminal/PaneHeader.tsx` | Render `PaneToolbar`, pass connection context |
| Modify | `frontend/src/components/terminal/PaneTree.tsx` | Pass `connectionId`, `channelId`, logging state to `PaneHeader` |
| Modify | `frontend/src/components/terminal/WorkspaceView.tsx` | Remove `TerminalSidebar`, thread logging state through `PaneTree` |
| Modify | `frontend/src/components/terminal/TerminalSettings.tsx` | Accept optional `channelId`/`hostId` props instead of reading global atoms |
| Delete | `frontend/src/components/terminal/TerminalSidebar.tsx` | No longer needed |

---

### Task 1: Create PaneToolbar with static feature icons

**Files:**
- Create: `frontend/src/components/terminal/PaneToolbar.tsx`

- [ ] **Step 1: Create the PaneToolbar component with feature icons**

```tsx
// frontend/src/components/terminal/PaneToolbar.tsx
import { SlidersHorizontal, ArrowLeftRight, Circle, CircleStop } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface PaneToolbarProps {
  connectionId: string
  channelId: string
  kind: 'terminal' | 'sftp' | 'local'
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
}

export function PaneToolbar({
  connectionId,
  channelId,
  kind,
  loggingActive,
  logPath,
  onToggleLogging,
}: PaneToolbarProps) {
  // Local panes have no features
  if (kind === 'local') return null

  return (
    <div className="flex items-center gap-0.5">
      {kind === 'terminal' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Terminal settings"
            >
              <SlidersHorizontal className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Terminal settings</TooltipContent>
        </Tooltip>
      )}
      {(kind === 'terminal' || kind === 'sftp') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Port forwards"
            >
              <ArrowLeftRight className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Port forwards</TooltipContent>
        </Tooltip>
      )}
      {kind === 'terminal' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(loggingActive ? 'text-destructive' : 'text-muted-foreground')}
              onClick={onToggleLogging}
              aria-label={loggingActive ? 'Stop logging' : 'Start logging'}
              aria-pressed={loggingActive}
            >
              {loggingActive ? <CircleStop className="size-3" /> : <Circle className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{loggingActive ? `Logging: ${logPath}` : 'Start logging'}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds (component is created but not yet rendered anywhere)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/terminal/PaneToolbar.tsx
git commit -m "feat(ui): create PaneToolbar component with static feature icons"
```

---

### Task 2: Wire PaneToolbar into PaneHeader

**Files:**
- Modify: `frontend/src/components/terminal/PaneHeader.tsx:23-41,100-161`

- [ ] **Step 1: Add toolbar props to PaneHeader's Props interface**

Add the following props to the `Props` interface in `PaneHeader.tsx`:

```tsx
// Add to the existing Props interface:
  connectionId: string
  channelId: string
  loggingActive: boolean
  logPath?: string
  onToggleLogging: () => void
```

Add the corresponding destructured parameters to the component function signature.

- [ ] **Step 2: Render PaneToolbar in the header between the type badge and the flex spacer**

Import `PaneToolbar` and render it after the type badge `<span>` and before the `<div className="flex-1" />` spacer:

```tsx
import { PaneToolbar } from './PaneToolbar'

// Inside the return, after the type badge <span> and before <div className="flex-1" />:
<PaneToolbar
  connectionId={connectionId}
  channelId={channelId}
  kind={kind}
  loggingActive={loggingActive}
  logPath={logPath}
  onToggleLogging={onToggleLogging}
/>
```

- [ ] **Step 3: Verify the frontend still builds (will have type errors in PaneTree — that's expected)**

Run: `cd frontend && pnpm build`
Expected: Type errors in `PaneTree.tsx` because the new required props aren't passed yet. This is expected — Task 3 fixes it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/PaneHeader.tsx
git commit -m "feat(ui): render PaneToolbar inside PaneHeader"
```

---

### Task 3: Thread logging state from WorkspaceView through PaneTree to PaneHeader

**Files:**
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx:365-414`
- Modify: `frontend/src/components/terminal/PaneTree.tsx:19-39,94-114,169-193`

- [ ] **Step 1: Add logging callbacks to PaneTree props**

In `PaneTree.tsx`, extend `PaneTreeProps` and `PaneLeafViewProps` to accept logging state:

```tsx
// Add to PaneTreeProps:
  activeLogs: Map<string, string>
  onToggleLogging: (channelId: string) => void

// Add to PaneLeafViewProps (same):
  activeLogs: Map<string, string>
  onToggleLogging: (channelId: string) => void
```

Pass these props through all recursive `PaneTree` calls and into `PaneLeafView`.

- [ ] **Step 2: Pass the new props from PaneLeafView into PaneHeader**

In `PaneLeafView`, add the new props to the `<PaneHeader>` JSX:

```tsx
<PaneHeader
  // ... existing props ...
  connectionId={leaf.connectionId}
  channelId={leaf.channelId}
  loggingActive={activeLogs.has(leaf.channelId)}
  logPath={activeLogs.get(leaf.channelId)}
  onToggleLogging={() => onToggleLogging(leaf.channelId)}
/>
```

- [ ] **Step 3: Pass activeLogs and onToggleLogging from WorkspaceView into PaneTree**

In `WorkspaceView.tsx`, update the `<PaneTree>` JSX to include the new props:

```tsx
<PaneTree
  // ... existing props ...
  activeLogs={activeLogs}
  onToggleLogging={(channelId) => toggleLogging(channelId)}
/>
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/terminal/PaneTree.tsx frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): thread logging state from WorkspaceView through PaneTree to PaneHeader"
```

---

### Task 4: Wire up terminal settings and port forwards popovers in PaneToolbar

**Files:**
- Modify: `frontend/src/components/terminal/PaneToolbar.tsx`
- Modify: `frontend/src/components/terminal/TerminalSettings.tsx:44-68`

- [ ] **Step 1: Refactor TerminalSettings to accept channelId and hostId as props**

Currently `TerminalSettings` reads `focusedChannelIdAtom` and derives the host from workspace state internally. Refactor it to accept optional `channelId` and `hostId` props, falling back to the atom-based approach when not provided (so nothing breaks if called from elsewhere):

```tsx
// Add optional props to TerminalSettings:
interface TerminalSettingsProps {
  channelId?: string
  hostId?: string
}

export function TerminalSettings({ channelId: propChannelId, hostId: propHostId }: TerminalSettingsProps) {
  const atomChannelId = useAtomValue(focusedChannelIdAtom)
  // ... existing atom-based host resolution ...

  // Prefer props over atoms
  const activeChannelId = propChannelId ?? atomChannelId
  // When hostId prop is provided, use it to resolve host directly
  const host = propHostId
    ? hosts.find((h) => h.id === propHostId)
    : hosts.find((h) => h.id === focusedLeaf?.hostId)
  // ... rest stays the same, but uses activeChannelId from above ...
}
```

- [ ] **Step 2: Wrap the settings and port forwards buttons in PaneToolbar with Popover components**

Update `PaneToolbar.tsx` to import and render the actual popovers:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { TerminalSettings } from './TerminalSettings'
import { PortForwardsPanel } from '../portforward/PortForwardsPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'

// Replace the terminal settings Tooltip-only button with:
{kind === 'terminal' && (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Terminal settings"
          >
            <SlidersHorizontal className="size-3" />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Terminal settings</TooltipContent>
    </Tooltip>
    <PopoverContent side="bottom" align="end" className="w-64 p-4">
      <TerminalSettings channelId={channelId} hostId={hostId} />
    </PopoverContent>
  </Popover>
)}

// Replace the port forwards Tooltip-only button with:
{(kind === 'terminal' || kind === 'sftp') && (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Port forwards"
          >
            <ArrowLeftRight className="size-3" />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Port forwards</TooltipContent>
    </Tooltip>
    <PopoverContent side="bottom" align="end" className="w-72 p-0">
      <ErrorBoundary
        fallback="inline"
        zone="port-forwards"
        onError={(e, i) => reportUIError(e, i, 'port-forwards')}
      >
        <PortForwardsPanel connectionId={connectionId} />
      </ErrorBoundary>
    </PopoverContent>
  </Popover>
)}
```

- [ ] **Step 3: Add hostId prop to PaneToolbar and thread it through**

Add `hostId: string` to `PaneToolbarProps`. Thread it from `PaneHeader` (which already has `hostId`) down into `PaneToolbar`. Pass it to `TerminalSettings`:

```tsx
// PaneToolbarProps:
  hostId: string

// PaneHeader passes it:
<PaneToolbar hostId={hostId} ... />
```

- [ ] **Step 4: Refactor TerminalSettings to not render its own trigger button**

The `TerminalSettings` component currently wraps itself in a `<Popover>` with its own trigger button. Since `PaneToolbar` now provides the trigger and popover wrapper, refactor `TerminalSettings` to export only the **popover content** (the settings form). Remove the outer `<Popover>`, `<PopoverTrigger>`, `<Tooltip>`, and `<PopoverContent>` wrapper from `TerminalSettings`, leaving just the inner `<div className="flex flex-col gap-4">` content.

- [ ] **Step 5: Verify the frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/terminal/PaneToolbar.tsx frontend/src/components/terminal/TerminalSettings.tsx
git commit -m "feat(ui): wire terminal settings and port forwards popovers into PaneToolbar"
```

---

### Task 5: Add overflow behavior with ResizeObserver

**Files:**
- Modify: `frontend/src/components/terminal/PaneToolbar.tsx`

- [ ] **Step 1: Add ResizeObserver-based overflow detection**

Add a `useOverflow` mechanism to `PaneToolbar`. The component measures its container and switches between inline icons and an overflow dropdown:

```tsx
import { useRef, useState, useEffect } from 'react'
import { Ellipsis } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

// Inside PaneToolbar, before the return:
const containerRef = useRef<HTMLDivElement>(null)
const [overflowing, setOverflowing] = useState(false)

// Build the list of features for this pane kind
const features: Array<{
  id: string
  label: string
  icon: React.ReactNode
  // If undefined, the feature is a popover (handled separately)
  // If defined, it's a direct action
  action?: () => void
}> = []

if (kind === 'terminal') {
  features.push({ id: 'settings', label: 'Terminal settings', icon: <SlidersHorizontal className="size-3" /> })
}
if (kind === 'terminal' || kind === 'sftp') {
  features.push({ id: 'portforwards', label: 'Port forwards', icon: <ArrowLeftRight className="size-3" /> })
}
if (kind === 'terminal') {
  features.push({
    id: 'logging',
    label: loggingActive ? `Logging: ${logPath}` : 'Start logging',
    icon: loggingActive ? <CircleStop className="size-3" /> : <Circle className="size-3" />,
    action: onToggleLogging,
  })
}

const ICON_WIDTH = 28 // px per icon button (size-icon-xs + gap)

useEffect(() => {
  const el = containerRef.current
  if (!el) return
  const observer = new ResizeObserver(([entry]) => {
    const available = entry.contentRect.width
    const needed = features.length * ICON_WIDTH
    setOverflowing(available < needed)
  })
  observer.observe(el)
  return () => observer.disconnect()
}, [features.length])
```

- [ ] **Step 2: Render inline icons when not overflowing, overflow menu when overflowing**

Restructure the return to conditionally render:

```tsx
return (
  <div ref={containerRef} className="flex min-w-0 items-center gap-0.5">
    {overflowing ? (
      <OverflowMenu features={features} /* pass popover state/handlers */ />
    ) : (
      <>{/* existing inline icon JSX from Task 4 */}</>
    )}
  </div>
)
```

The `OverflowMenu` renders a `DropdownMenu` with `Ellipsis` as the trigger. Each feature becomes a `DropdownMenuItem`. For popover features (settings, port forwards), clicking the menu item opens a `Popover` anchored to the overflow button. For action features (logging toggle), clicking triggers the action directly.

For the logging toggle in the overflow menu, render the recording indicator:

```tsx
<DropdownMenuItem onClick={onToggleLogging}>
  {loggingActive ? (
    <CircleStop className="mr-2 size-3 text-destructive" />
  ) : (
    <Circle className="mr-2 size-3" />
  )}
  {loggingActive ? 'Stop logging' : 'Start logging'}
</DropdownMenuItem>
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/terminal/PaneToolbar.tsx
git commit -m "feat(ui): add overflow menu with ResizeObserver to PaneToolbar"
```

---

### Task 6: Remove TerminalSidebar and clean up

**Files:**
- Delete: `frontend/src/components/terminal/TerminalSidebar.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx:28,403-411`

- [ ] **Step 1: Remove TerminalSidebar import and rendering from WorkspaceView**

In `WorkspaceView.tsx`:
- Remove the import: `import { TerminalSidebar } from './TerminalSidebar'`
- Remove the JSX block at lines ~403-411:
  ```tsx
  {isWorkspaceActive && focusedChannelId && focusedLeaf && (
    <TerminalSidebar
      connectionId={focusedLeaf.connectionId}
      loggingActive={activeLogs.has(focusedChannelId)}
      logPath={activeLogs.get(focusedChannelId)}
      onToggleLogging={() => toggleLogging(focusedChannelId)}
      onViewLogs={() => setLogViewerOpen(true)}
    />
  )}
  ```
- Remove the `isLogViewerOpenAtom` import and `setLogViewerOpen` usage if the log viewer open button is no longer triggered from here (the `onViewLogs` callback is only used by `TerminalSidebar`). Keep the atom import if it's used elsewhere in this file.
- Clean up any now-unused imports (`focusedChannelId`, `focusedLeaf` derivation) — but check first: `focusedChannelId` is also used for `TerminalSearch`, so keep that.

- [ ] **Step 2: Delete TerminalSidebar.tsx**

```bash
rm frontend/src/components/terminal/TerminalSidebar.tsx
```

- [ ] **Step 3: Grep for any remaining references to TerminalSidebar**

Run: `grep -r "TerminalSidebar" frontend/src/`
Expected: No results.

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Run frontend lint**

Run: `cd frontend && pnpm lint`
Expected: No new lint errors.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "refactor(ui): remove TerminalSidebar in favor of PaneToolbar"
```

---

### Task 7: Write tests for PaneToolbar

**Files:**
- Create: `frontend/src/components/terminal/PaneToolbar.test.tsx`

- [ ] **Step 1: Write tests for feature visibility by pane kind**

```tsx
// frontend/src/components/terminal/PaneToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaneToolbar } from './PaneToolbar'

// Wrap in TooltipProvider if needed by the tooltip components
import { TooltipProvider } from '../ui/tooltip'

function renderToolbar(props: Partial<React.ComponentProps<typeof PaneToolbar>> = {}) {
  const defaults: React.ComponentProps<typeof PaneToolbar> = {
    connectionId: 'conn-1',
    channelId: 'chan-1',
    hostId: 'host-1',
    kind: 'terminal',
    loggingActive: false,
    onToggleLogging: vi.fn(),
  }
  return render(
    <TooltipProvider>
      <PaneToolbar {...defaults} {...props} />
    </TooltipProvider>
  )
}

describe('PaneToolbar', () => {
  it('renders all features for terminal panes', () => {
    renderToolbar({ kind: 'terminal' })
    expect(screen.getByLabelText('Terminal settings')).toBeInTheDocument()
    expect(screen.getByLabelText('Port forwards')).toBeInTheDocument()
    expect(screen.getByLabelText('Start logging')).toBeInTheDocument()
  })

  it('renders only port forwards for SFTP panes', () => {
    renderToolbar({ kind: 'sftp' })
    expect(screen.queryByLabelText('Terminal settings')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Port forwards')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start logging')).not.toBeInTheDocument()
  })

  it('renders nothing for local panes', () => {
    const { container } = renderToolbar({ kind: 'local' })
    expect(container.firstChild).toBeNull()
  })

  it('shows stop logging label when logging is active', () => {
    renderToolbar({ kind: 'terminal', loggingActive: true, logPath: '/tmp/log.txt' })
    expect(screen.getByLabelText('Stop logging')).toBeInTheDocument()
  })

  it('calls onToggleLogging when logging button is clicked', async () => {
    const onToggle = vi.fn()
    renderToolbar({ kind: 'terminal', onToggleLogging: onToggle })
    const btn = screen.getByLabelText('Start logging')
    btn.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `cd frontend && pnpm vitest run src/components/terminal/PaneToolbar.test.tsx`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/terminal/PaneToolbar.test.tsx
git commit -m "test(ui): add PaneToolbar unit tests for feature visibility and logging toggle"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run Go tests**

Run: `go test ./internal/... -race -timeout 60s`
Expected: All pass (no Go changes in this feature).

- [ ] **Step 2: Run full frontend build**

Run: `cd frontend && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Run frontend lint and format check**

Run: `cd frontend && pnpm lint && pnpm format:check`
Expected: No errors. If format issues, run `pnpm format` and commit the fix.

- [ ] **Step 4: Run all frontend tests**

Run: `cd frontend && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 5: Manual smoke test**

Run: `wails dev`
Verify:
- Open a terminal connection — feature icons appear in the pane header
- Terminal settings popover opens from the header icon
- Port forwards popover opens from the header icon
- Logging toggle works (circle icon turns red when active)
- Split the pane — each pane has its own toolbar
- Narrow a pane — icons collapse into `...` overflow menu
- Click overflow menu items — popovers and actions still work
- SFTP pane shows only port forwards icon
- Local pane shows no feature icons
- The right-side pillar is gone
