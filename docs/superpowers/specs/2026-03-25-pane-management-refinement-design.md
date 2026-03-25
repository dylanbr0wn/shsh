# Pane Management Refinement

**Date:** 2026-03-25
**Branch:** `feat/ui-gripes`
**Scope:** Frontend-only — no Go backend changes

## Problem

The current pane management UX has several friction points:

1. **Splitting always creates a terminal** — no way to choose pane type or host when splitting
2. **Confusing button set** — the + button, split buttons, and folder button overlap in purpose without being clearly related
3. **No pane rearrangement** — once panes are placed, they can't be moved or reorganized
4. **Hidden drag affordances** — shift+drag for SFTP is undiscoverable; no drag previews
5. **No pane-to-pane or cross-workspace drag** — hosts can be dragged in but panes can't be moved

## Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Pane types on split | Any type (terminal/SFTP/local) on any host | Full flexibility; the chooser makes it discoverable |
| Split buttons | Keep, but open a type+host chooser | Preserves spatial intent (direction) while adding type choice |
| Pane dragging | Move semantics (not swap) | Simpler mental model; swap is rarely what you want |
| Cross-workspace drag | Hover tab 300ms to switch, then drop | Matches OS-level drag-over-tab conventions |
| Drop zones | Edge strip with glow + directional arrow | Subtle, doesn't obscure pane content |
| Host drop type chooser | Simple "Open as..." popover menu | Discoverable for new users |
| Power-user shortcuts | Shift+drag = SFTP; Cmd+D = terminal same host | Fast paths skip the chooser entirely |
| Pane header | Always-visible, host-color bottom border, buttons dim until hover | Provides drag handle and persistent context |
| Drag implementation | Native HTML5 DnD API | Already in use for host drags; no new dependencies |

## Design

### 1. Pane Header Refactor

Replace the current ghost-button overlay (`PaneHeader`) with an always-visible bar that sits in normal document flow above pane content.

**Layout (left to right):**
- **Drag grip** — `GripVertical` icon, `cursor: grab`. This is the drag handle for pane moves.
- **Host label** — always visible, truncated with `max-width`
- **Type badge** — small pill: "SSH", "SFTP", or "Local" with host-color tinted background
- **Action buttons** (right-aligned, `opacity-0.4` default, full on hover):
  - **Toggle button** — terminal panes show folder icon (open SFTP), SFTP panes show terminal icon (open terminal). Same host, splits horizontally. Quick-action shortcut. **Hidden on Local panes** (no SSH connection to toggle).
  - **Split Vertical** (`⌘D`) — opens PaneTypeChooser popover
  - **Split Horizontal** (`⌘⇧D`) — opens PaneTypeChooser popover
  - **Close** — disabled if last pane in workspace

**Styling:**
- Height: ~20px
- Background: `bg-muted` or equivalent dark surface
- Bottom border: `2px solid ${host.color}`
- In normal flow (not absolute positioned) — takes space from the pane content area

**xterm.js note:** Moving the header from `position: absolute` to normal flow shrinks the terminal container by ~20px. After this refactor, dispatch a `resize` event or call xterm's `fit()` to reflow the terminal viewport. The existing `InitialFitTrigger` pattern in `PaneTree.tsx` may need adjustment.

### 2. Unified Pane Creation Flow

All pane creation goes through one of two paths:

#### Path A: Split Buttons (direction known)

1. User clicks split V or split H in pane header
2. `PaneTypeChooser` popover appears anchored to the button:
   ```
   ┌─────────────────────────────┐
   │ Open as...                   │
   │ ▸_ Terminal               → │  (submenu: host list)
   │ 📁 SFTP                   → │  (submenu: host list)
   │ 💻 Local Files               │  (no submenu)
   └─────────────────────────────┘
   ```
3. Terminal and SFTP submenus show the host list with the **current pane's host pre-selected at top** (labeled "Current: hostname") for fast same-host splits
4. Selecting type+host creates the pane in the chosen direction

**Keyboard shortcuts preserved:** `Cmd+D` / `Cmd+Shift+D` skip the chooser and create a terminal on the same connection (existing fast path).

#### Path B: Drag and Drop (direction from drop zone)

1. User drags a host from sidebar onto a pane
2. Edge strip appears on nearest edge showing split direction
3. On drop, `PaneTypeChooser` popover appears at drop point
4. User picks Terminal/SFTP/Local
5. **Shift held during drag** → skips chooser, opens SFTP directly

#### What's Removed

- `AddPaneMenu` component (+ button) — functionality absorbed into split buttons + PaneTypeChooser
- "Open Files" button — replaced by the toggle button in pane header

### 3. Drag & Drop System

Three drag sources, one unified drop target system. All using native HTML5 DnD.

#### Drag Sources

**Host from sidebar** (existing, enhanced):
- MIME type: `application/x-shsh-host` (unchanged)
- Custom drag preview: pill badge with host color dot + label
- Behavior on drop: show PaneTypeChooser, or SFTP if Shift held

**Pane header grip** (new):
- MIME type: `application/x-shsh-pane` with `{ paneId, workspaceId }`
- Custom drag preview: miniature pane header (type badge + host label + color border, ~120x28px)
- Source pane dims to `opacity: 0.3` during drag
- Behavior on drop: move pane (remove from old position, insert at new)

**Tab hover for cross-workspace moves** (new):
- While dragging a pane, hovering over a workspace tab for 300ms switches the visible workspace
- User can then drop into the newly visible workspace using edge-strip zones
- Dropping directly on a tab (without waiting): pane moves into that workspace, splits right of root

#### Drop Target System

Applied to every leaf pane via the `useDropZone` hook.

**Edge detection** — 4 edge zones, no center zone. The active zone is determined by which edge the cursor is closest to (minimum distance from each edge wins):
- Nearest to top → split horizontal, new pane on top
- Nearest to bottom → split horizontal, new pane on bottom
- Nearest to left → split vertical, new pane on left
- Nearest to right → split vertical, new pane on right

This applies to both host drops and pane moves. There is no center/swap zone — all drops result in a split. This keeps the interaction consistent with the "move" decision (not swap).

**Visual feedback (edge strip):**
- 4px strip on the active edge with `box-shadow` glow
- Small directional arrow indicator near the strip
- Host-color tint for host drags, neutral accent for pane drags
- Appears/disappears instantly as cursor moves between zones

**Accepted MIME types:**
- `application/x-shsh-host` → host drop flow (chooser popover)
- `application/x-shsh-pane` → pane move flow (direct move)

### 4. Drag Previews

Custom drag images via `e.dataTransfer.setDragImage()` with offscreen-rendered elements.

**Host drag preview** — compact pill:
- Host color dot + host label
- Dark background, rounded corners, ~12px font

**Pane drag preview** — miniature pane header:
- Type badge + host label + host-color bottom border
- ~120x28px, semi-transparent background

**Implementation:** A shared `DragPreview` component renders preview elements offscreen (`position: fixed; left: -9999px`). Drag sources ref the appropriate element in `onDragStart`.

**WebKit caveat:** Wails on macOS uses WebKit, which has quirks with `setDragImage` on elements not in the viewport. The implementer should test early and may need to briefly make the element visible before calling `setDragImage` and hiding it after.

## Component & File Changes

### New Files

| File | Purpose |
|------|---------|
| `components/workspace/PaneTypeChooser.tsx` | Popover with Terminal/SFTP/Local options + host submenus. Shared by split buttons and drop handler. |
| `components/workspace/DropZoneOverlay.tsx` | Edge strip indicator rendered inside each pane during drag. Renders the glow strip + arrow based on active zone. |
| `components/workspace/DragPreview.tsx` | Offscreen-rendered drag images for hosts and panes. Exports ref-based API for `setDragImage`. |
| `hooks/usePaneDrag.ts` | Hook for pane drag source logic — `onDragStart`, preview setup, opacity dimming. Used by PaneHeader. |
| `hooks/useDropZone.ts` | Hook for drop target logic — edge detection, MIME type checking, zone state management. Used by PaneTree leaf containers. |

### Modified Files

| File | Changes |
|------|---------|
| `components/terminal/PaneHeader.tsx` | Full rewrite. Always-visible bar with drag grip, host-color border, type badge. Split buttons trigger PaneTypeChooser. Remove + button, add toggle button. |
| `components/terminal/PaneTree.tsx` | Integrate `useDropZone` hook + `DropZoneOverlay` in leaf container. Remove inline `onDragOver`/`onDrop`. Adjust padding for in-flow header. Update `onSplit` prop signature to `(paneId, direction, kind?, hostId?)` to support the chooser flow. |
| `components/terminal/WorkspaceView.tsx` | `handleSplit` gains optional `kind` + `hostId` params (default: terminal on same host for keyboard shortcut path). Add `handleMovePane` for pane drag moves — uses `moveLeaf` utility, handles focus fallback in source workspace via `firstLeaf`, removes source workspace if empty (matching `handleClose` behavior). Keyboard shortcuts keep fast path. |
| `components/sidebar/HostListItem.tsx` | Integrate `DragPreview` for custom drag image in `onDragStart`. |
| `components/sessions/TabBar.tsx` | Add drop handlers for cross-workspace pane moves. |
| `components/sessions/TabItem.tsx` | Add `onDragOver` with 300ms hover timer to switch workspace. Add `onDrop` for direct tab drops. |

### Removed Files

| File | Reason |
|------|--------|
| `components/workspace/AddPaneMenu.tsx` | Functionality absorbed into PaneTypeChooser via split buttons. |

### New paneTree Utilities

| Function | Signature | Purpose |
|----------|-----------|---------|
| `moveLeaf` | `(tree, paneId, targetPaneId, direction, position) → PaneNode` | Atomic remove + insert for pane moves. Composes `removeLeaf` + `insertLeaf`. |
| `insertLeaf` | `(tree, targetPaneId, direction, newLeaf, position: 'before' \| 'after') → PaneNode` | Generalized version of `splitLeaf` that supports inserting on either side (left/top vs right/bottom) based on which edge zone was targeted. `splitLeaf` is retained as a convenience wrapper that calls `insertLeaf(tree, targetPaneId, direction, newLeaf, 'after')` — existing callers (keyboard shortcuts) don't need to change. |

### Cross-Workspace Move Lifecycle

When a pane is moved between workspaces:
1. Remove leaf from source workspace tree via `removeLeaf`
2. If source workspace tree becomes empty (`removeLeaf` returns `null`), remove the workspace entirely (matching `handleClose` behavior)
3. If source workspace still has panes, update `focusedPaneId` via `firstLeaf` fallback
4. Insert leaf into target workspace tree via `insertLeaf`
5. Set `focusedPaneId` in target workspace to the moved pane
6. No channel lifecycle changes needed — the `channelId` and `connectionId` stay the same, only the tree position changes

### No Backend Changes

All Go methods remain unchanged: `ConnectHost`, `OpenTerminal`, `OpenSFTPChannel`, `OpenLocalFSChannel`, `CloseChannel`.

## Implementation Layers

These layers build on each other and are independently shippable:

1. **Pane Header Refactor** — new always-visible header, remove AddPaneMenu
2. **Unified Pane Creation Flow** — PaneTypeChooser component, split buttons use it, keyboard shortcuts preserved
3. **Drag & Drop System** — useDropZone hook, DropZoneOverlay, pane dragging, cross-workspace moves, tab hover switching
4. **Drag Previews** — DragPreview component, custom images for host and pane drags
