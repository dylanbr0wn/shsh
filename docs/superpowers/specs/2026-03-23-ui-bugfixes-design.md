# UI Bug Fixes Design

**Date:** 2026-03-23
**Branch:** bugfix/ui-issues

## Overview

Five visual bugs and one UX improvement across the shsh SSH client frontend. All changes are isolated to React/TypeScript frontend components — no Go backend changes required.

---

## Issue 1 — Ghost Hover Backgrounds Too Dark

**Problem:** `hover:bg-accent/50` on sidebar host list items renders too dark in dark mode. `--accent` is `oklch(0.2 0 0)` at 50% opacity over a `--sidebar` background of `oklch(0.13 0 0)` — the contrast is too high and items look selected when only hovered.

**Fix:** Replace `hover:bg-accent/50` with `hover:bg-sidebar-accent/30` in `HostListItem.tsx:88`. The sidebar-specific accent token is semantically correct here, and lower opacity keeps the hover subtle.

**File:** `frontend/src/components/sidebar/HostListItem.tsx`

---

## Issue 2 — Drag Thumb and Toggle Button Overlap

**Problem:** In `resizable.tsx`, the drag thumb div (z-10) and the sidebar toggle button (z-20) are both absolutely positioned and centered on the same 1px separator line — they visually overlap and compete for clicks.

**Fix:** Remove the toggle button from `ResizableHandle` entirely. The toggle moves to the title bar (see Issue 3). Remove the `onToggle` and `isCollapsed` props from `ResizableHandle`, the component internals, and the call site in `App.tsx`.

**Files:** `frontend/src/components/ui/resizable.tsx`, `frontend/src/App.tsx`

---

## Issue 3 — Sidebar Toggle Redesign (Title Bar)

**Problem:** The sidebar collapse toggle is a small circular button floating on the resize handle — awkward to hit, half off-screen when collapsed, and visually clashes with the drag thumb.

**Design:** Move the toggle to the title bar and replace the logo/name with actionable system buttons.

### Title Bar Layout

```
Mac:
[traffic-light 88px spacer][◀/▶ sidebar][+ New Host][⚡ Quick Connect] ── drag region ── [⚙ Settings]

Windows:
[◀/▶ sidebar][+ New Host][⚡ Quick Connect] ── drag region ── [⚙ Settings][─][□][✕]
```

- The sidebar toggle icon is `PanelLeftClose` when open, `PanelLeftOpen` when collapsed
- "New Host" opens the Add Host modal (fires `isAddHostOpenAtom`)
- "Quick Connect" opens the Quick Connect modal (fires `isQuickConnectOpenAtom`)
- Settings button stays in its current right-side position

### State Management

Sidebar collapsed state currently lives in `App.tsx` local state. Extract it to a `sidebarCollapsedAtom` in `store/atoms.ts` so `TitleBar` can read/write it directly without prop drilling. `App.tsx` reads the atom to drive `sidebarRef.current?.expand()` / `collapse()`.

### AppHeader Removal

`AppHeader` in the sidebar is a duplicate logo (`Terminal` icon + "shsh" text). It serves no purpose once the title bar is redesigned. Remove it and remove its usage from `HostList.tsx` or wherever it's rendered.

**Files:** `frontend/src/components/layout/TitleBar.tsx`, `frontend/src/components/ui/resizable.tsx`, `frontend/src/App.tsx`, `frontend/src/store/atoms.ts`, `frontend/src/components/sidebar/AppHeader.tsx`, `frontend/src/components/sidebar/HostList.tsx`

---

## Issue 4 — Tooltips Clipping Viewport Edge

**Problem:** `TooltipContent` uses Radix's default `collisionPadding={0}`, meaning the tooltip can render flush against the viewport edge and get occluded.

**Fix:** Set `collisionPadding={8}` on `TooltipContent` in `tooltip.tsx`. This applies globally to all tooltips with a single change, providing an 8px buffer from every viewport edge.

**File:** `frontend/src/components/ui/tooltip.tsx`

---

## Issue 5 — Add/Edit Host Modal Tab Layout

**Problem:** Both modals render 10+ fields in a single vertically scrolling list, making them feel long and hard to scan.

**Design:** Split into 3 tabs using shadcn `Tabs` at the top of the dialog body:

| Tab | Fields |
|-----|--------|
| **Connection** | Label, Hostname, Port, Username, Auth Method, auth-specific fields (password/credential source/key/agent) |
| **Organization** | Group, Color, Tags |
| **Advanced** | Terminal Profile, Jump Host |

### Validation Behaviour

- Validation runs on submit as today — no change to logic
- If a submit attempt fails with errors on a non-active tab, switch to the first tab containing an error
- Required fields (Label, Hostname, Username) are all in the Connection tab, so this case is straightforward

### Shared Implementation

Both `AddHostModal.tsx` and `EditHostModal.tsx` have near-identical field layouts. Extract a shared `HostFormFields` component that accepts the form state and callbacks, and renders the three tab groups. Both modals use this component.

**Files:** `frontend/src/components/modals/AddHostModal.tsx`, `frontend/src/components/modals/EditHostModal.tsx`, new `frontend/src/components/modals/HostFormTabs.tsx`

---

## Implementation Order

1. Issue 4 — tooltip fix (one line, isolated)
2. Issue 1 — hover fix (one line, isolated)
3. Issues 2 + 3 — resizable handle cleanup + title bar redesign (coupled, do together)
4. Issue 5 — host modal tabs (largest change, do last)
