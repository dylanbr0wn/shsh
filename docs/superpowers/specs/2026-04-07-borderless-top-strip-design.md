# Borderless Top Strip

## Context

The current `PaneTopBar` reads as a distinct toolbar — 36px tall with a full-width bottom border, a 240px search pill in the center, and icon buttons on the right. As the UI moves toward a card-based pane layout (terminals as elevated cards on a background surface), the top bar feels heavy and structural. This change strips away the "bar" visual so the strip blends into the background, acting as padding with a few tucked-in controls rather than a toolbar.

## Design

### What changes

1. **Remove the bottom border** — drop `border-b` from the strip container. Background stays `bg-background` (same as the surface behind pane cards).

2. **Replace the search pill with an icon button** — the current 240px `w-60` outline button with text + `ShortcutKbd` becomes a single `size="icon"` ghost button matching the other icons. The `Cmd+K` shortcut continues to work; the command palette is unchanged.

3. **Remove the `ButtonGroup` wrapper** — search and quick connect are no longer visually grouped. They become individual ghost icon buttons in the right-side cluster alongside vault lock and settings.

### What stays the same

- Strip height: `h-9` (36px)
- Wails drag area: `--wails-draggable: drag` on the container, `no-drag` on button zones
- **Left side (when sidebar collapsed):** sidebar expand button (`PanelLeftOpen` icon), positioned with the existing Mac traffic-light offset logic
- **Right side button order:** Search, Quick Connect, Vault Lock (conditional), Settings
- **Windows controls:** minimize, maximize, close buttons remain at far right on non-Mac
- All buttons remain `variant="ghost"` with `text-muted-foreground` styling
- All existing Jotai atom toggles and keyboard shortcuts are unchanged

### Button layout (right side)

```
[🔍 Search] [⚡ Quick Connect] [🔒 Lock Vault*] [⚙ Settings]  [— □ ✕ (Windows)]

* only shown when vault is enabled
```

All icon buttons: `size="icon"`, `variant="ghost"`, `h-9 w-9 rounded-none` (matching current settings/lock style). Tooltips preserved.

## Files to modify

- `frontend/src/components/layout/PaneTopBar.tsx` — remove `border-b`, replace search pill with icon button, remove `ButtonGroup`

## Verification

1. `pnpm dev` — visual check: strip should blend seamlessly with background, no visible border
2. Buttons should be visible, hoverable, and trigger the correct modals
3. `Cmd+K` still opens command palette
4. Sidebar collapse/expand button appears correctly on the left when sidebar is collapsed
5. On Windows: window controls still render at far right
6. Drag-to-move window still works across the strip
