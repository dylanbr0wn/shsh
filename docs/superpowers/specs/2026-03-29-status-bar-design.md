# Status Bar Design

## Problem

The debug panel has no visual affordance. It is toggled via `Cmd+J`, but the resize handle is hidden when the panel is closed, so users have no way to discover it without knowing the shortcut. Even hovering at the bottom pixels conflicts with OS window-resize handles.

## Solution

Add a persistent VS Code-style status bar at the bottom of the window. It serves two purposes: making the debug panel toggle visible and discoverable, and surfacing useful at-a-glance status information.

## Layout

The status bar is a fixed-height element at the very bottom of the app, outside the resizable panel layout:

```
div.flex.flex-col.h-screen
  TitleBar              (h-9, shrink-0)
  CommandPalette        (overlay)
  ResizablePanelGroup   (flex-1, min-h-0)
    Sidebar
    ResizableHandle
    MainArea + DebugPanel (vertical split)
  StatusBar             (h-6, shrink-0)  <-- NEW
```

The status bar never participates in resizing. It is always visible.

## Content

### Left zone — status information

Items are separated by a small gap (~12px). All text is `text-xs text-muted-foreground`.

1. **Session indicator** — a 7px colored dot + "N sessions" text.
   - Green (`bg-green-500`): all sessions connected.
   - Yellow (`bg-yellow-500`): at least one session is in a connecting state.
   - Hidden entirely when there are zero sessions (no workspaces open).
   - Derived from `workspacesAtom` by walking workspace layouts and counting leaves with `status === 'connected'` vs other statuses.

2. **Focused host label** — the `hostLabel` of the active workspace's focused pane, displayed in muted text. Truncated with ellipsis if it exceeds available space. Hidden when no workspace is active.
   - Derived from `activeWorkspaceIdAtom` + `workspacesAtom` + `focusedPaneId`.

### Right zone — actions and indicators

Items are separated by a small gap (~12px).

1. **Port forward count** — "N forwards" text. Only rendered when count > 0.
   - Derived from `portForwardsAtom` by counting the number of keys in the record (each key represents a connection with port forwards configured).

2. **Vault status** — a Lock icon (lucide `Lock` / `LockOpen`) + "Locked" / "Unlocked" text. Only rendered when `vaultEnabledAtom` is true.
   - Reads `vaultLockedAtom`.

3. **Debug toggle** — a clickable pill (inline button). Bar-chart icon (lucide `BarChart3`) + "Debug" label.
   - When debug panel is closed: default muted styling.
   - When debug panel is open: `bg-accent text-accent-foreground` to indicate active state.
   - Click handler: toggles `debugPanelOpenAtom`.
   - Tooltip: "Toggle debug panel (⌘J)".

## Component

**File:** `frontend/src/components/layout/StatusBar.tsx`

Single component, no sub-components needed. All data is derived from existing Jotai atoms with no new atoms or backend changes required.

### Data dependencies

| Atom | Used for |
|------|----------|
| `workspacesAtom` | Session count, session statuses, focused host label |
| `activeWorkspaceIdAtom` | Which workspace's focused pane to display |
| `portForwardsAtom` | Port forward count |
| `vaultEnabledAtom` | Whether to show vault indicator |
| `vaultLockedAtom` | Vault lock state |
| `debugPanelOpenAtom` | Debug toggle state (read + write) |

### Helper logic

A small utility function (inline or extracted) walks a `PaneNode` tree and collects all `PaneLeaf` nodes to derive session count and statuses. This pattern already exists elsewhere in the codebase (e.g., `TabBar` walks workspaces for counts).

## Styling

- Background: `bg-sidebar` (matches title bar).
- Top border: `border-t border-border`.
- Height: `h-6` (24px), `shrink-0`.
- Flex: `flex items-center justify-between px-2`.
- Text: `text-xs text-muted-foreground`.
- Debug toggle pill: `px-1.5 py-0.5 rounded-sm cursor-pointer` with conditional `bg-accent text-accent-foreground` when active.
- All interactive items have `Tooltip` wrappers.

## Integration in App.tsx

The `<StatusBar />` component is rendered as the last child inside the root flex column, after the `ResizablePanelGroup` and before the modal error boundaries. It sits outside the resizable layout entirely.

```tsx
<div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
  <VaultLockOverlay />
  <TitleBar />
  <CommandPalette />
  <ResizablePanelGroup ...>
    {/* sidebar, main, debug */}
  </ResizablePanelGroup>
  <StatusBar />           {/* NEW */}
  {/* modals below */}
</div>
```

## Keyboard shortcut

`Cmd+J` / `Ctrl+J` continues to work unchanged. The status bar debug toggle is a visual affordance for the same `debugPanelOpenAtom` toggle, not a replacement for the shortcut.

## Scope exclusions

- No error count badge or pulse animation on the debug toggle (considered in approach C, deferred).
- No hover-to-expand behavior on status bar items.
- No new backend APIs or atoms.
- No changes to the debug panel itself.
