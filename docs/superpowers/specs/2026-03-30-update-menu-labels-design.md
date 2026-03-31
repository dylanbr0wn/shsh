# Update Native Menu Labels After Keybinding Change

**Issue:** [#61](https://github.com/dylanbr0wn/shsh/issues/61)
**Date:** 2026-03-30

## Problem

`buildMenu` in `main.go` is called once at startup with a snapshot of resolved keybindings. After `UpdateKeybinding` saves a new shortcut, native menu items continue displaying the old shortcut label until the app is restarted.

## Approach

Rebuild the entire menu after any keybinding mutation. `buildMenu` already constructs the menu correctly from the current resolved bindings, so calling it again and replacing the application menu is sufficient.

Wails v2 provides `runtime.MenuSetApplicationMenu(ctx, menu)` which replaces the native menu at runtime.

## Design

### Callback on KeybindFacade

Add an unexported `onChanged func()` field to `KeybindFacade`. After a successful save in `UpdateKeybinding`, `ResetKeybinding`, or `ResetAllKeybindings`, call `onChanged()` if non-nil.

```go
type KeybindFacade struct {
	deps      *deps.Deps
	onChanged func()
}
```

### Wiring in App startup

In `App.startup()`, set the callback to rebuild and replace the menu:

```go
app.keybinds.onChanged = func() {
	newMenu := buildMenu(app)
	runtime.MenuSetApplicationMenu(app.deps.Ctx, newMenu)
}
```

### Files changed

| File | Change |
|------|--------|
| `keybind_facade.go` | Add `onChanged` field; call it on success in all three mutation methods |
| `app.go` | Set `app.keybinds.onChanged` in `startup()` |

### What doesn't change

- `buildMenu` signature and logic (unchanged)
- `main.go` wails.Run options (unchanged)
- Frontend code (unchanged)
- Wails binding API signatures (unchanged)

## Testing

- **Existing tests:** Keybinding save/reset logic is already covered by unit tests. The `onChanged` callback is nil in tests, so no change needed.
- **Manual verification:** Change a keybinding in Settings, confirm the native menu label updates immediately without restart.

## Acceptance criteria

After changing a keybinding in Settings, the corresponding native menu item label reflects the new shortcut without requiring an app restart.
