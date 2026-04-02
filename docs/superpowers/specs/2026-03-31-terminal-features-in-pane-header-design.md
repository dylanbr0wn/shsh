# Terminal Features in Pane Header

## Problem

Terminal-specific features (settings, port forwards, logging) currently live in a global right-side pillar (`TerminalSidebar`). These features are scoped to individual connections/channels, but their placement doesn't reflect that:

- **Ambiguous ownership** — with multiple panes, unclear which pane the pillar controls
- **Wasted space** — the pillar takes horizontal space even when not needed
- **Poor discoverability** — features feel disconnected from the pane they belong to

## Solution

Move terminal features into each pane's header bar as inline icons. Introduce a `PaneToolbar` component that manages feature icons, overflow behavior, and popover anchoring per-pane.

## Features Moving to Pane Header

| Feature            | Interaction       | Scope        | Terminal | SFTP | Local |
|--------------------|-------------------|--------------|----------|------|-------|
| Terminal settings  | Popover           | Channel      | Yes      | No   | No    |
| Port forwards      | Popover           | Connection   | Yes      | Yes  | No    |
| Logging toggle     | Inline toggle     | Channel      | Yes      | No   | No    |

**Not moving (separate concern):**
- Log viewer — cross-session, needs a global home. Placement TBD (title bar, sidebar footer, etc.). Tracked as a separate task.

## Component Architecture

### New: `PaneToolbar`

Renders feature action icons for a given pane. Sits inside `PaneHeader` between the type badge and the split/close buttons.

**Props:**
- `connectionId: string`
- `channelId: string`
- `kind: 'terminal' | 'sftp' | 'local'`
- `loggingActive: boolean`
- `onToggleLogging: () => void`

**Responsibilities:**
- Render the correct set of feature icons based on pane `kind`
- Manage overflow: collapse icons into a `...` dropdown menu when the pane is narrow
- Anchor popovers to the correct element (inline icon or `...` button)

### Modified: `PaneHeader`

Renders `PaneToolbar` as a child, passing through connection context. No other structural changes needed.

### Removed: `TerminalSidebar`

Deleted entirely. The rendering block in `WorkspaceView` (~lines 403-411) and the `w-10` right-side space allocation are removed.

## Overflow Behavior

`PaneToolbar` uses a `ResizeObserver` on its container to track available width.

- **Comfortable width:** All feature icons visible inline.
- **Narrow:** Icons collapse into a `...` overflow menu (shadcn `DropdownMenu`). Clicking a feature name in the menu opens its popover anchored to the `...` button. The logging toggle appears as a menu item with an inline indicator.

Threshold: ~32px per icon. If available width < (icon count * 32), switch to overflow mode.

## Logging Toggle Visual

- **Recording active:** Filled red dot icon
- **Recording inactive:** Empty circle outline icon
- Works the same in both inline and overflow modes — the red/outline dot serves as the indicator in both contexts.

## Popover Anchoring

- **Inline mode:** Popovers anchor to their respective icon.
- **Overflow mode:** Click `...` → dropdown opens → click feature → dropdown closes → popover opens anchored to `...` button.

Existing `TerminalSettings` and `PortForwardsPanel` components need no internal changes — they receive a different anchor element.

## State Management

No changes to existing atoms:

- `portForwardsAtom` — connection-scoped (unchanged)
- `activeLogsAtom` — channel-scoped (unchanged)
- `channelProfileOverridesAtom` — channel-scoped (unchanged)

Logging toggle state/callbacks get re-routed: `WorkspaceView` → `PaneHeader` → `PaneToolbar` (instead of `WorkspaceView` → `TerminalSidebar`).

## Open Items

- [ ] Log viewer global placement (title bar area, sidebar footer, or elsewhere) — separate task
