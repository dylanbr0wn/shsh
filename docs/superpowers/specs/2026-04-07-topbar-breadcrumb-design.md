# PaneTopBar Workspace Breadcrumb

## Problem

After the borderless strip refactor, the PaneTopBar left side is empty (only a sidebar toggle when collapsed). The right side has 4-5 icon buttons. The bar feels unbalanced and wastes space that could provide useful context.

## Design

Add an informational breadcrumb to the left side of PaneTopBar showing the active workspace name and focused pane's host:

```
  [workspace name]  ›  ● [focused host label]
```

### Elements

| Element | Style | Content |
|---------|-------|---------|
| Workspace name | `text-muted-foreground text-xs font-medium` | `workspace.name ?? workspace.label` |
| Separator | `ChevronRight` icon, `size-3 text-muted-foreground/40` | Static chevron |
| Status dot | `size-1.5 rounded-full` | Colored by `host.color`, gray fallback for local panes |
| Host label | `text-muted-foreground text-xs` | Focused pane's `hostLabel`, or "Local" for local panes |

### Behavior

- Always visible, even with a single workspace
- Updates reactively when `focusedPaneId` changes (clicking between panes)
- No pane kind badge — that info is already in PaneHeader inside each card
- When sidebar is collapsed, the breadcrumb shifts right to accommodate the sidebar toggle button
- The breadcrumb area is non-interactive (no click handlers) and allows window dragging through it

### Data Sources

All data comes from existing Jotai atoms — no new state needed:

- `workspacesAtom` + `activeWorkspaceIdAtom` → active workspace name and focusedPaneId
- `hostsAtom` → host color for the status dot
- Focused leaf derived by walking `workspace.layout` to find the leaf matching `focusedPaneId`

### Edge Cases

- **No workspaces**: breadcrumb hidden (empty state)
- **Local pane focused**: dot uses neutral `bg-muted-foreground/40`, label shows "Local"
- **Disconnected/error pane**: dot still uses host color (status is visible in PaneHeader)
- **Very long workspace name or host label**: truncate with `truncate` class, max-width constraint

### File Changes

- `frontend/src/components/layout/PaneTopBar.tsx` — add breadcrumb to left side, import workspace/host atoms
- Utility: use existing `collectLeaves` from `lib/paneTree` to find focused leaf
