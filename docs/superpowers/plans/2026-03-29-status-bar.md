# Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent VS Code-style status bar at the bottom of the window with session info, port forward count, vault status, and a debug panel toggle.

**Architecture:** Single new `StatusBar` component rendered as a fixed-height sibling below the main `ResizablePanelGroup` in `App.tsx`. All data is derived from existing Jotai atoms — no backend changes or new atoms needed.

**Tech Stack:** React, Jotai, Tailwind CSS, lucide-react, shadcn Tooltip

**Spec:** `docs/superpowers/specs/2026-03-29-status-bar-design.md`

---

### Task 1: Create the StatusBar component with debug toggle

**Files:**
- Create: `frontend/src/components/layout/StatusBar.tsx`

This task builds the component shell with just the debug toggle — the most important piece and the original motivation. Other status items are added in subsequent tasks.

- [ ] **Step 1: Create the StatusBar component with debug toggle only**

```tsx
import { useAtom } from 'jotai'
import { BarChart3 } from 'lucide-react'
import { debugPanelOpenAtom } from '../../store/debugStore'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function StatusBar() {
  const [debugPanelOpen, setDebugPanelOpen] = useAtom(debugPanelOpenAtom)

  return (
    <div className="bg-sidebar border-border flex h-6 shrink-0 items-center justify-between border-t px-2 text-xs">
      {/* Left zone — status info (added in later tasks) */}
      <div className="flex items-center gap-3" />

      {/* Right zone — actions & indicators */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setDebugPanelOpen((prev) => !prev)}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors',
                debugPanelOpen
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <BarChart3 className="size-3" />
              <span>Debug</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle debug panel (⌘J)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Integrate into App.tsx**

In `frontend/src/App.tsx`, add the import at the top with the other layout imports:

```tsx
import { StatusBar } from './components/layout/StatusBar'
```

Render `<StatusBar />` after the closing `</ResizablePanelGroup>` tag (line 164) and before the modal `<ErrorBoundary>` blocks. Wrap it in an ErrorBoundary:

```tsx
          </ResizablePanelGroup>
          <ErrorBoundary
            fallback="inline"
            zone="statusbar"
            onError={(e, i) => reportUIError(e, i, 'statusbar')}
          >
            <StatusBar />
          </ErrorBoundary>
```

- [ ] **Step 3: Verify in dev**

Run: `cd frontend && pnpm build`
Expected: Clean build with no type errors.

Manually verify with `wails dev` that:
1. A thin bar appears at the bottom of the window.
2. Clicking "Debug" toggles the debug panel open/closed.
3. The pill highlights when the debug panel is open.
4. `Cmd+J` still works and the pill state stays in sync.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx frontend/src/App.tsx
git commit -m "feat(ui): add status bar with debug panel toggle

Closes the discoverability gap — users can now see and click
the debug toggle instead of needing to know Cmd+J."
```

---

### Task 2: Add session indicator to the left zone

**Files:**
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Add session count and status dot**

Add these imports to `StatusBar.tsx`:

```tsx
import { useAtomValue } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/atoms'
import { collectLeaves } from '../../lib/paneTree'
import type { PaneLeaf } from '../../store/workspaces'
```

Change `useAtom` import to also include `useAtomValue` (or just use `useAtomValue` for read-only atoms). Add this logic inside the component before the return:

```tsx
  const workspaces = useAtomValue(workspacesAtom)

  // Collect all leaves across all workspaces
  const allLeaves: PaneLeaf[] = workspaces.flatMap((ws) => collectLeaves(ws.layout))
  const sessionCount = allLeaves.filter((l) => l.kind !== 'local').length
  const allConnected = sessionCount > 0 && allLeaves
    .filter((l) => l.kind !== 'local')
    .every((l) => l.status === 'connected')
  const anyConnecting = allLeaves
    .filter((l) => l.kind !== 'local')
    .some((l) => l.status === 'connecting' || l.status === 'reconnecting')
```

Replace the empty left zone div with:

```tsx
      {/* Left zone — status info */}
      <div className="text-muted-foreground flex items-center gap-3">
        {sessionCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full',
                    anyConnecting ? 'bg-yellow-500' : allConnected ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                <span>{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {sessionCount} active {sessionCount === 1 ? 'session' : 'sessions'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
```

- [ ] **Step 2: Verify in dev**

Run: `cd frontend && pnpm build`
Expected: Clean build.

Manually verify:
1. With no sessions open: no dot or count shown on the left.
2. Connect to a host: green dot + "1 session" appears.
3. While connecting: yellow dot visible briefly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx
git commit -m "feat(ui): add session count indicator to status bar"
```

---

### Task 3: Add focused host label

**Files:**
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Show the focused host label**

Add this logic after the session count derivation, inside the component:

```tsx
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)

  const focusedHostLabel = (() => {
    if (!activeWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return null
    const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
    return leaf?.hostLabel ?? null
  })()
```

Add this element inside the left zone div, after the session indicator's closing `)}`:

```tsx
        {focusedHostLabel && (
          <span className="max-w-[200px] truncate opacity-60">{focusedHostLabel}</span>
        )}
```

- [ ] **Step 2: Verify in dev**

Run: `cd frontend && pnpm build`
Expected: Clean build.

Manually verify: connect to a host, confirm the host label appears next to the session count. Switch between workspaces — label updates.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx
git commit -m "feat(ui): show focused host label in status bar"
```

---

### Task 4: Add port forward count

**Files:**
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Show port forward count when > 0**

Add the import for `portForwardsAtom` (add to existing import from `../../store/atoms`):

```tsx
import { workspacesAtom, activeWorkspaceIdAtom, portForwardsAtom } from '../../store/atoms'
```

Add this inside the component:

```tsx
  const portForwards = useAtomValue(portForwardsAtom)
  const forwardCount = Object.values(portForwards).reduce(
    (sum, pf) => sum + pf.forwards.length,
    0
  )
```

Add this element inside the right zone div, before the debug toggle `<Tooltip>`:

```tsx
        {forwardCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground flex items-center gap-1">
                <span>{forwardCount} {forwardCount === 1 ? 'forward' : 'forwards'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {forwardCount} active port {forwardCount === 1 ? 'forward' : 'forwards'}
            </TooltipContent>
          </Tooltip>
        )}
```

- [ ] **Step 2: Verify in dev**

Run: `cd frontend && pnpm build`
Expected: Clean build.

Manually verify: with no forwards, nothing shows. Add a port forward — "1 forward" appears.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx
git commit -m "feat(ui): show port forward count in status bar"
```

---

### Task 5: Add vault status indicator

**Files:**
- Modify: `frontend/src/components/layout/StatusBar.tsx`

- [ ] **Step 1: Show vault lock status when vault is enabled**

Add the vault atoms import:

```tsx
import { vaultEnabledAtom, vaultLockedAtom } from '../../atoms/vault'
```

Add the `Lock` and `LockOpen` icons to the lucide import:

```tsx
import { BarChart3, Lock, LockOpen } from 'lucide-react'
```

Add inside the component:

```tsx
  const vaultEnabled = useAtomValue(vaultEnabledAtom)
  const vaultLocked = useAtomValue(vaultLockedAtom)
```

Add inside the right zone div, after the port forward count and before the debug toggle:

```tsx
        {vaultEnabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground flex items-center gap-1">
                {vaultLocked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                <span>{vaultLocked ? 'Locked' : 'Unlocked'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Vault {vaultLocked ? 'locked' : 'unlocked'}
            </TooltipContent>
          </Tooltip>
        )}
```

- [ ] **Step 2: Verify in dev**

Run: `cd frontend && pnpm build`
Expected: Clean build.

Manually verify: if vault is not enabled, no indicator. If enabled, shows lock state.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/StatusBar.tsx
git commit -m "feat(ui): show vault lock status in status bar"
```

---

### Task 6: Lint and format check

**Files:**
- Possibly modify: `frontend/src/components/layout/StatusBar.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: Run lint and format checks**

Run: `cd frontend && pnpm lint && pnpm format:check`

Fix any issues reported. Common things to expect:
- Prettier formatting differences (run `pnpm format` to auto-fix if `format:check` fails)

- [ ] **Step 2: Run full frontend build**

Run: `cd frontend && pnpm build`
Expected: Clean build, no warnings.

- [ ] **Step 3: Commit any fixes**

```bash
git add -u frontend/src/
git commit -m "chore(ui): fix lint and format in status bar"
```

Skip this commit if no changes were needed.
