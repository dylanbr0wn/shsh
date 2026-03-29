# Keybinding Customization Design

**Issue:** #38 — feat: keybinding customization
**Date:** 2026-03-28

## Overview

Remappable keyboard shortcuts for the shsh SSH client. All shortcuts are customizable with protected warnings on dangerous rebinds (e.g., quit). Keybinding defaults and resolution live in the Go backend; the frontend queries resolved bindings and handles key events.

## Data Model

### Action Definition (Go-side defaults)

Each bindable action is defined in Go with:

```go
type Keybinding struct {
    ActionID  string // e.g. "command_palette"
    Label     string // e.g. "Toggle Command Palette"
    Category  string // e.g. "General", "Terminal"
    Default   string // e.g. "CmdOrCtrl+K"
    Protected bool   // warn before rebinding
}
```

### Key Format

Shortcut strings use `CmdOrCtrl+Shift+Alt+<Key>` format:
- `CmdOrCtrl` resolves to Meta on macOS, Ctrl on Windows/Linux
- Modifiers: `CmdOrCtrl`, `Shift`, `Alt`
- Modifiers appear in consistent order: `CmdOrCtrl+Alt+Shift+<Key>`
- Key names match `KeyboardEvent.key` values (uppercase single chars, named keys like `Enter`, `Escape`, `F1`)

### Config Storage

Only user overrides are stored in `~/.config/shsh/config.json`:

```json
{
  "keybindings": {
    "command_palette": "CmdOrCtrl+Shift+P",
    "split_vertical": "CmdOrCtrl+\\"
  }
}
```

An absent key means "use default." An empty `keybindings` object (or absent section) means all defaults.

### Resolution

`GetKeybindings()` merges the hardcoded defaults map with config overrides. For each action: if an override exists, use it; otherwise use the default. Returns the full list with a `Modified bool` field so the UI can show reset icons.

```go
type ResolvedKeybinding struct {
    ActionID  string
    Label     string
    Category  string
    Shortcut  string // resolved (override or default)
    Default   string
    Protected bool
    Modified  bool   // true if user has overridden
}
```

## Default Keybindings

| Action ID | Label | Category | Default | Protected |
|---|---|---|---|---|
| `command_palette` | Toggle Command Palette | General | `CmdOrCtrl+K` | no |
| `quick_connect` | Quick Connect | General | `CmdOrCtrl+Shift+K` | no |
| `add_host` | Add Host | General | `CmdOrCtrl+N` | no |
| `import_ssh_config` | Import SSH Config | General | `CmdOrCtrl+I` | no |
| `settings` | Settings | General | `CmdOrCtrl+,` | no |
| `debug_panel` | Toggle Debug Panel | General | `CmdOrCtrl+J` | no |
| `terminal_search` | Search Terminal | Terminal | `CmdOrCtrl+F` | no |
| `split_vertical` | Split Pane Vertical | Terminal | `CmdOrCtrl+D` | no |
| `split_horizontal` | Split Pane Horizontal | Terminal | `CmdOrCtrl+Shift+D` | no |

## Go Backend

### New Package: `internal/keybind`

**`defaults.go`** — hardcoded `map[string]Keybinding` containing all actions and their defaults (the table above).

**`resolver.go`** — `Resolve(defaults map[string]Keybinding, overrides map[string]string) []ResolvedKeybinding` merges overrides onto defaults, sets `Modified` flag, returns sorted by category then label.

**`parser.go`** — `Parse(shortcut string) (ParsedShortcut, error)` validates format, normalizes modifier order. `Format(ParsedShortcut) string` converts back. `DetectConflict(bindings []ResolvedKeybinding, actionID, shortcut string) (conflictActionID string, found bool)` checks for duplicate shortcuts.

### Config Changes

Add to config struct in `internal/config/config.go`:

```go
type Config struct {
    // ... existing fields ...
    Keybindings map[string]string `json:"keybindings,omitempty"`
}
```

### App Methods (exposed to frontend via Wails)

| Method | Signature | Description |
|---|---|---|
| `GetKeybindings` | `() []ResolvedKeybinding` | Returns full resolved list |
| `UpdateKeybinding` | `(actionID, shortcut string) error` | Validates, detects conflicts, saves override |
| `ResetKeybinding` | `(actionID string) error` | Removes single override from config |
| `ResetAllKeybindings` | `() error` | Clears all overrides from config |

`UpdateKeybinding` returns an error if the shortcut format is invalid. Conflict detection is informational — the frontend handles the confirm/cancel UX before calling `UpdateKeybinding`. The method itself does not block on conflicts; it trusts the frontend already resolved them (the frontend calls `GetKeybindings` to check conflicts before calling update).

When a conflict is confirmed by the user, the frontend must make two calls: first `ResetKeybinding(conflictingActionID)` to unbind the conflicting action (restoring its default), then `UpdateKeybinding(targetActionID, shortcut)` to set the new binding. If the conflicting action's default also conflicts, it is left unbound (override set to empty string `""` which means "no shortcut").

### Menu Integration

Native Wails menu items (`main.go`) are constructed with **no real accelerators** on rebindable actions. Instead, the shortcut is displayed as text in the menu label (e.g., `"Quick Connect\t\u2318\u21E7K"`). Labels are updated at runtime via Wails `menu.SetLabel()` after a binding change.

`Cmd+Q` (Quit) keeps its native accelerator — it is not part of the rebindable system.

## Frontend

### Action Registry — `src/lib/actions.ts`

A flat map of action IDs to handler functions:

```ts
type ActionHandler = () => void

const actionRegistry: Record<string, ActionHandler> = {
  command_palette: () => store.set(isCommandPaletteOpenAtom, (v) => !v),
  quick_connect: () => store.set(isQuickConnectOpenAtom, (v) => !v),
  add_host: () => store.set(isAddHostOpenAtom, true),
  import_ssh_config: () => store.set(isImportSSHConfigOpenAtom, true),
  settings: () => store.set(isSettingsOpenAtom, true),
  debug_panel: () => store.set(isDebugPanelOpenAtom, (v) => !v),
  terminal_search: () => store.set(isTerminalSearchOpenAtom, (v) => !v),
  split_vertical: () => splitPane("vertical"),
  split_horizontal: () => splitPane("horizontal"),
}
```

### Key Matching — `src/lib/keybind.ts`

Converts `KeyboardEvent` to the normalized `CmdOrCtrl+...` string format:

- Detects platform (macOS vs others)
- Maps `e.metaKey` (Mac) or `e.ctrlKey` (others) to `CmdOrCtrl`
- Builds string in canonical modifier order: `CmdOrCtrl+Alt+Shift+<Key>`
- Returns the normalized string for direct comparison against resolved bindings

Also exports `formatForDisplay(shortcut: string, platform: string): string` to render shortcuts with platform-appropriate symbols (e.g., `CmdOrCtrl+Shift+K` → `⌘⇧K` on Mac, `Ctrl+Shift+K` on Windows).

### Central Hook — `src/hooks/useKeybindings.ts`

Replaces all existing scattered `window.addEventListener('keydown')` calls in `useAppInit.ts` and `WorkspaceView.tsx`.

On mount:
1. Calls `GetKeybindings()` from Go backend
2. Builds lookup map: `normalized shortcut string → action ID`
3. Registers single global `keydown` listener
4. On keypress: normalize event → look up in map → execute action handler from registry

Exports a `refreshKeybindings()` function that re-fetches from Go and rebuilds the map (called after settings changes).

### State — `src/store/atoms.ts`

```ts
export const keybindingsAtom = atom<ResolvedKeybinding[]>([])
```

Populated on app init, updated after any settings change.

### Settings UI — New Section in `SettingsModal.tsx`

**"Keyboard Shortcuts" section** added to the existing Settings modal.

**Layout:** Grouped by category with section headers ("General", "Terminal"). Each row has:
- Action label (left)
- Shortcut pill (right) — displays current binding with platform symbols
- Reset icon (right of pill, only visible on modified bindings)

**Search bar** at the top filters across all categories by action label or current shortcut.

**Recording mode** (activated by clicking a shortcut pill):
- Pill changes to pulsing "Press shortcut..." state
- Captures next key combo and displays it in the pill
- **Escape** cancels without changing
- Clicking outside cancels
- On conflict: inline warning "Already bound to [Action]. Reassign?" with confirm/cancel buttons
- On protected action: additional warning "This is a protected shortcut. Are you sure?" with confirm/cancel

**Reset controls:**
- Per-binding: small reset icon (↺) next to any modified shortcut pill, resets that single binding
- Global: "Reset All to Defaults" button at bottom of section

## Removed Code

The following existing keyboard handling code will be replaced by the central `useKeybindings` hook:

- `useAppInit.ts` lines 52-87 (global keydown listener)
- `WorkspaceView.tsx` lines 334-362 (workspace keydown listener)

`TerminalSearch.tsx` Enter/Shift+Enter/Escape handling stays as-is — those are local to the search input, not global shortcuts.

## Testing

### Go unit tests (`internal/keybind/`)
- `resolver_test.go` — merging defaults with overrides, Modified flag, empty overrides
- `parser_test.go` — valid/invalid shortcut formats, normalization, canonical ordering
- `parser_test.go` — conflict detection (same shortcut, no conflict, self-conflict ignored)

### Frontend
- Action registry: verify all action IDs map to handlers
- Key matching: verify `KeyboardEvent` → normalized string conversion across platforms
- Settings UI: recording mode flow, conflict warning, reset behavior
