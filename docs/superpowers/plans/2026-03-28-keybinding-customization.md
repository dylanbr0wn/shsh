# Keybinding Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remappable keyboard shortcuts saved to app config, with a settings UI for rebinding.

**Architecture:** Go backend (`internal/keybind`) owns default bindings and resolution logic. Config stores only user overrides. Frontend queries resolved bindings from Go, registers a single global keydown listener, and provides a settings UI for rebinding. Native menu accelerators are removed; menu labels show the current binding text instead.

**Tech Stack:** Go (backend logic, config), React/TypeScript (frontend keybinding hook, settings UI), Jotai (state), shadcn/ui (settings components), Wails v2 (RPC bridge)

---

### Task 1: Go Keybinding Types and Defaults

**Files:**
- Create: `internal/keybind/keybind.go`

- [ ] **Step 1: Create the keybind package with types and defaults**

```go
package keybind

// Keybinding defines a single bindable action with its default shortcut.
type Keybinding struct {
	ActionID  string
	Label     string
	Category  string
	Default   string
	Protected bool
}

// ResolvedKeybinding is the merged result of a default + optional user override.
type ResolvedKeybinding struct {
	ActionID  string `json:"action_id"`
	Label     string `json:"label"`
	Category  string `json:"category"`
	Shortcut  string `json:"shortcut"`
	Default   string `json:"default"`
	Protected bool   `json:"protected"`
	Modified  bool   `json:"modified"`
}

// Defaults returns the hardcoded map of all bindable actions.
func Defaults() map[string]Keybinding {
	return map[string]Keybinding{
		"command_palette":  {ActionID: "command_palette", Label: "Toggle Command Palette", Category: "General", Default: "CmdOrCtrl+K", Protected: false},
		"quick_connect":    {ActionID: "quick_connect", Label: "Quick Connect", Category: "General", Default: "CmdOrCtrl+Shift+K", Protected: false},
		"add_host":         {ActionID: "add_host", Label: "Add Host", Category: "General", Default: "CmdOrCtrl+N", Protected: false},
		"import_ssh_config": {ActionID: "import_ssh_config", Label: "Import SSH Config", Category: "General", Default: "CmdOrCtrl+I", Protected: false},
		"settings":         {ActionID: "settings", Label: "Settings", Category: "General", Default: "CmdOrCtrl+,", Protected: false},
		"debug_panel":      {ActionID: "debug_panel", Label: "Toggle Debug Panel", Category: "General", Default: "CmdOrCtrl+J", Protected: false},
		"terminal_search":  {ActionID: "terminal_search", Label: "Search Terminal", Category: "Terminal", Default: "CmdOrCtrl+F", Protected: false},
		"split_vertical":   {ActionID: "split_vertical", Label: "Split Pane Vertical", Category: "Terminal", Default: "CmdOrCtrl+D", Protected: false},
		"split_horizontal": {ActionID: "split_horizontal", Label: "Split Pane Horizontal", Category: "Terminal", Default: "CmdOrCtrl+Shift+D", Protected: false},
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go build ./internal/keybind/...`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add internal/keybind/keybind.go
git commit -m "feat(keygen): add keybind package with types and defaults"
```

---

### Task 2: Shortcut Parser and Validator

**Files:**
- Create: `internal/keybind/parser.go`
- Create: `internal/keybind/parser_test.go`

- [ ] **Step 1: Write failing tests for the parser**

```go
package keybind

import "testing"

func TestParse_ValidShortcuts(t *testing.T) {
	cases := []struct {
		input string
		want  string // normalized output
	}{
		{"CmdOrCtrl+K", "CmdOrCtrl+K"},
		{"CmdOrCtrl+Shift+K", "CmdOrCtrl+Shift+K"},
		{"CmdOrCtrl+Alt+Shift+F1", "CmdOrCtrl+Alt+Shift+F1"},
		{"Alt+Shift+CmdOrCtrl+D", "CmdOrCtrl+Alt+Shift+D"}, // reorders modifiers
		{"CmdOrCtrl+,", "CmdOrCtrl+,"},
		{"CmdOrCtrl+\\", "CmdOrCtrl+\\"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			parsed, err := Parse(tc.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			got := Format(parsed)
			if got != tc.want {
				t.Errorf("Parse(%q) → Format = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestParse_InvalidShortcuts(t *testing.T) {
	cases := []string{
		"",
		"K",              // no modifier
		"CmdOrCtrl+",     // no key
		"CmdOrCtrl",      // no key
		"Ctrl+K",         // must use CmdOrCtrl, not Ctrl
		"Meta+K",         // must use CmdOrCtrl, not Meta
		"CmdOrCtrl+CmdOrCtrl+K", // duplicate modifier
	}
	for _, tc := range cases {
		t.Run(tc, func(t *testing.T) {
			_, err := Parse(tc)
			if err == nil {
				t.Errorf("Parse(%q) expected error, got nil", tc)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	got, err := Normalize("Alt+CmdOrCtrl+Shift+D")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "CmdOrCtrl+Alt+Shift+D" {
		t.Errorf("got %q, want %q", got, "CmdOrCtrl+Alt+Shift+D")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/keybind/... -run TestParse -v`
Expected: FAIL — `Parse` and `Format` and `Normalize` not defined

- [ ] **Step 3: Implement the parser**

```go
package keybind

import (
	"fmt"
	"strings"
)

// ParsedShortcut represents a validated, normalized keyboard shortcut.
type ParsedShortcut struct {
	CmdOrCtrl bool
	Alt       bool
	Shift     bool
	Key       string // the non-modifier key, e.g. "K", "F1", ","
}

var validModifiers = map[string]bool{
	"CmdOrCtrl": true,
	"Alt":       true,
	"Shift":     true,
}

// Parse validates and parses a shortcut string like "CmdOrCtrl+Shift+K".
func Parse(shortcut string) (ParsedShortcut, error) {
	if shortcut == "" {
		return ParsedShortcut{}, fmt.Errorf("empty shortcut")
	}

	parts := strings.Split(shortcut, "+")
	if len(parts) < 2 {
		return ParsedShortcut{}, fmt.Errorf("shortcut must have at least one modifier and a key: %q", shortcut)
	}

	var p ParsedShortcut
	seenModifiers := map[string]bool{}

	for i, part := range parts {
		if validModifiers[part] {
			if seenModifiers[part] {
				return ParsedShortcut{}, fmt.Errorf("duplicate modifier %q in %q", part, shortcut)
			}
			seenModifiers[part] = true
			switch part {
			case "CmdOrCtrl":
				p.CmdOrCtrl = true
			case "Alt":
				p.Alt = true
			case "Shift":
				p.Shift = true
			}
		} else if i == len(parts)-1 {
			// Last part is the key
			p.Key = part
		} else {
			return ParsedShortcut{}, fmt.Errorf("invalid modifier %q in %q (use CmdOrCtrl, Alt, Shift)", part, shortcut)
		}
	}

	if p.Key == "" {
		return ParsedShortcut{}, fmt.Errorf("shortcut has no key: %q", shortcut)
	}
	if !p.CmdOrCtrl && !p.Alt && !p.Shift {
		return ParsedShortcut{}, fmt.Errorf("shortcut must have at least one modifier: %q", shortcut)
	}

	return p, nil
}

// Format converts a ParsedShortcut back to its canonical string form.
// Modifier order is always: CmdOrCtrl+Alt+Shift+Key
func Format(p ParsedShortcut) string {
	var parts []string
	if p.CmdOrCtrl {
		parts = append(parts, "CmdOrCtrl")
	}
	if p.Alt {
		parts = append(parts, "Alt")
	}
	if p.Shift {
		parts = append(parts, "Shift")
	}
	parts = append(parts, p.Key)
	return strings.Join(parts, "+")
}

// Normalize parses and re-formats a shortcut string to canonical form.
func Normalize(shortcut string) (string, error) {
	p, err := Parse(shortcut)
	if err != nil {
		return "", err
	}
	return Format(p), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/keybind/... -run TestParse -v && go test ./internal/keybind/... -run TestNormalize -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/keybind/parser.go internal/keybind/parser_test.go
git commit -m "feat(keygen): add shortcut parser with validation and normalization"
```

---

### Task 3: Resolver — Merge Defaults with Overrides

**Files:**
- Create: `internal/keybind/resolver.go`
- Create: `internal/keybind/resolver_test.go`

- [ ] **Step 1: Write failing tests for the resolver**

```go
package keybind

import "testing"

func TestResolve_NoOverrides(t *testing.T) {
	defaults := Defaults()
	resolved := Resolve(defaults, nil)
	if len(resolved) != len(defaults) {
		t.Fatalf("got %d bindings, want %d", len(resolved), len(defaults))
	}
	for _, r := range resolved {
		if r.Modified {
			t.Errorf("binding %q should not be modified", r.ActionID)
		}
		if r.Shortcut != r.Default {
			t.Errorf("binding %q: shortcut %q != default %q", r.ActionID, r.Shortcut, r.Default)
		}
	}
}

func TestResolve_WithOverride(t *testing.T) {
	defaults := Defaults()
	overrides := map[string]string{
		"command_palette": "CmdOrCtrl+Shift+P",
	}
	resolved := Resolve(defaults, overrides)
	var found bool
	for _, r := range resolved {
		if r.ActionID == "command_palette" {
			found = true
			if r.Shortcut != "CmdOrCtrl+Shift+P" {
				t.Errorf("expected override shortcut, got %q", r.Shortcut)
			}
			if !r.Modified {
				t.Error("expected Modified=true for overridden binding")
			}
			if r.Default != "CmdOrCtrl+K" {
				t.Errorf("expected default preserved, got %q", r.Default)
			}
		}
	}
	if !found {
		t.Error("command_palette not found in resolved bindings")
	}
}

func TestResolve_EmptyStringOverrideMeansUnbound(t *testing.T) {
	defaults := Defaults()
	overrides := map[string]string{
		"debug_panel": "",
	}
	resolved := Resolve(defaults, overrides)
	for _, r := range resolved {
		if r.ActionID == "debug_panel" {
			if r.Shortcut != "" {
				t.Errorf("expected empty shortcut for unbound action, got %q", r.Shortcut)
			}
			if !r.Modified {
				t.Error("expected Modified=true for unbound override")
			}
			return
		}
	}
	t.Error("debug_panel not found")
}

func TestResolve_SortedByCategoryThenLabel(t *testing.T) {
	defaults := Defaults()
	resolved := Resolve(defaults, nil)
	for i := 1; i < len(resolved); i++ {
		prev, curr := resolved[i-1], resolved[i]
		if prev.Category > curr.Category {
			t.Errorf("not sorted by category: %q (%s) before %q (%s)", prev.ActionID, prev.Category, curr.ActionID, curr.Category)
		}
		if prev.Category == curr.Category && prev.Label > curr.Label {
			t.Errorf("not sorted by label within category: %q before %q", prev.Label, curr.Label)
		}
	}
}

func TestDetectConflict_Found(t *testing.T) {
	defaults := Defaults()
	resolved := Resolve(defaults, nil)
	// CmdOrCtrl+K is command_palette's default
	conflictID, found := DetectConflict(resolved, "split_vertical", "CmdOrCtrl+K")
	if !found {
		t.Fatal("expected conflict")
	}
	if conflictID != "command_palette" {
		t.Errorf("expected conflict with command_palette, got %q", conflictID)
	}
}

func TestDetectConflict_SelfIsNotConflict(t *testing.T) {
	defaults := Defaults()
	resolved := Resolve(defaults, nil)
	_, found := DetectConflict(resolved, "command_palette", "CmdOrCtrl+K")
	if found {
		t.Error("self should not be a conflict")
	}
}

func TestDetectConflict_NoConflict(t *testing.T) {
	defaults := Defaults()
	resolved := Resolve(defaults, nil)
	_, found := DetectConflict(resolved, "command_palette", "CmdOrCtrl+Shift+P")
	if found {
		t.Error("expected no conflict")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/keybind/... -run "TestResolve|TestDetectConflict" -v`
Expected: FAIL — `Resolve` and `DetectConflict` not defined

- [ ] **Step 3: Implement the resolver**

```go
package keybind

import "sort"

// Resolve merges default keybindings with user overrides.
// Returns a sorted list of ResolvedKeybinding (by Category, then Label).
// An override of "" means the action is intentionally unbound.
func Resolve(defaults map[string]Keybinding, overrides map[string]string) []ResolvedKeybinding {
	result := make([]ResolvedKeybinding, 0, len(defaults))

	for _, kb := range defaults {
		r := ResolvedKeybinding{
			ActionID:  kb.ActionID,
			Label:     kb.Label,
			Category:  kb.Category,
			Shortcut:  kb.Default,
			Default:   kb.Default,
			Protected: kb.Protected,
			Modified:  false,
		}
		if override, ok := overrides[kb.ActionID]; ok {
			r.Shortcut = override
			r.Modified = true
		}
		result = append(result, r)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Category != result[j].Category {
			return result[i].Category < result[j].Category
		}
		return result[i].Label < result[j].Label
	})

	return result
}

// DetectConflict checks whether assigning shortcut to actionID would conflict
// with an existing binding. Returns the conflicting action ID if found.
// Self-assignment (same actionID) is not a conflict.
func DetectConflict(bindings []ResolvedKeybinding, actionID, shortcut string) (string, bool) {
	if shortcut == "" {
		return "", false
	}
	for _, b := range bindings {
		if b.ActionID == actionID {
			continue
		}
		if b.Shortcut == shortcut {
			return b.ActionID, true
		}
	}
	return "", false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/keybind/... -run "TestResolve|TestDetectConflict" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/keybind/resolver.go internal/keybind/resolver_test.go
git commit -m "feat(keygen): add resolver to merge defaults with overrides and detect conflicts"
```

---

### Task 4: Add Keybindings to Config Struct

**Files:**
- Modify: `internal/config/config.go:11-17`

- [ ] **Step 1: Add Keybindings field to Config struct**

In `internal/config/config.go`, add the `Keybindings` field to the `Config` struct:

```go
type Config struct {
	SSH         SSHConfig         `json:"ssh"`
	SFTP        SFTPConfig        `json:"sftp"`
	Window      WindowConfig      `json:"window"`
	Log         LogConfig         `json:"log"`
	Debug       DebugConfig       `json:"debug"`
	Keybindings map[string]string `json:"keybindings,omitempty"`
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/config/... -v`
Expected: PASS (omitempty means existing configs without this field still load fine)

- [ ] **Step 3: Verify full project compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go build ./...`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add internal/config/config.go
git commit -m "feat(config): add keybindings override map to config struct"
```

---

### Task 5: App Methods for Keybinding CRUD

**Files:**
- Create: `keybind_facade.go`

- [ ] **Step 1: Write the KeybindFacade with all four methods**

```go
package main

import (
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/keybind"
)

// KeybindFacade exposes keybinding operations to the frontend via Wails.
type KeybindFacade struct {
	deps *deps.Deps
}

// NewKeybindFacade creates a new KeybindFacade.
func NewKeybindFacade(d *deps.Deps) *KeybindFacade {
	return &KeybindFacade{deps: d}
}

// GetKeybindings returns the full resolved list of keybindings (defaults + overrides).
func (f *KeybindFacade) GetKeybindings() []keybind.ResolvedKeybinding {
	return keybind.Resolve(keybind.Defaults(), f.deps.Cfg.Keybindings)
}

// UpdateKeybinding validates and saves a keybinding override for the given action.
func (f *KeybindFacade) UpdateKeybinding(actionID, shortcut string) error {
	defaults := keybind.Defaults()
	if _, ok := defaults[actionID]; !ok {
		return fmt.Errorf("unknown action: %q", actionID)
	}

	// Allow empty string to unbind
	if shortcut != "" {
		normalized, err := keybind.Normalize(shortcut)
		if err != nil {
			return fmt.Errorf("invalid shortcut: %w", err)
		}
		shortcut = normalized
	}

	if f.deps.Cfg.Keybindings == nil {
		f.deps.Cfg.Keybindings = make(map[string]string)
	}
	f.deps.Cfg.Keybindings[actionID] = shortcut

	if f.deps.CfgPath != "" {
		return f.deps.Cfg.Save(f.deps.CfgPath)
	}
	return nil
}

// ResetKeybinding removes a single keybinding override, restoring the default.
func (f *KeybindFacade) ResetKeybinding(actionID string) error {
	defaults := keybind.Defaults()
	if _, ok := defaults[actionID]; !ok {
		return fmt.Errorf("unknown action: %q", actionID)
	}

	if f.deps.Cfg.Keybindings != nil {
		delete(f.deps.Cfg.Keybindings, actionID)
	}

	if f.deps.CfgPath != "" {
		return f.deps.Cfg.Save(f.deps.CfgPath)
	}
	return nil
}

// ResetAllKeybindings clears all keybinding overrides, restoring all defaults.
func (f *KeybindFacade) ResetAllKeybindings() error {
	f.deps.Cfg.Keybindings = nil

	if f.deps.CfgPath != "" {
		return f.deps.Cfg.Save(f.deps.CfgPath)
	}
	return nil
}
```

- [ ] **Step 2: Register the facade in App and Wails bindings**

In `app.go`, add the `keybinds` field to the `App` struct and wire it up:

Add field to struct (after `tools *ToolsFacade`):
```go
keybinds *KeybindFacade
```

In `NewApp`, add (after `tools:` line):
```go
keybinds: NewKeybindFacade(d),
```

In `main.go`, add to the `Bind` slice (after `app.tools`):
```go
app.keybinds,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go build ./...`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add keybind_facade.go app.go main.go
git commit -m "feat(keygen): add KeybindFacade with CRUD methods exposed to frontend"
```

---

### Task 6: Remove Native Menu Accelerators

**Files:**
- Modify: `main.go:25-95`

- [ ] **Step 1: Update buildMenu to use label-only shortcuts**

Replace the menu construction to remove real accelerators from rebindable items. Keep `Cmd+Q` for quit. Show shortcut text in the label instead.

The `buildMenu` function needs to accept resolved keybindings and format shortcut labels. Add a helper at the top of the function:

```go
func buildMenu(app *App) *menu.Menu {
	resolved := keybind.Resolve(keybind.Defaults(), app.deps.Cfg.Keybindings)

	// Build a lookup: actionID → display shortcut string
	shortcutLabel := func(actionID string) string {
		for _, r := range resolved {
			if r.ActionID == actionID {
				if r.Shortcut == "" {
					return ""
				}
				return "\t" + keybind.FormatForDisplay(r.Shortcut)
			}
		}
		return ""
	}

	m := menu.NewMenu()
	if goruntime.GOOS == "darwin" {
		m.Append(menu.AppMenu())
	}

	file := m.AddSubmenu("File")
	file.AddText("Quick Connect..."+shortcutLabel("quick_connect"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:new-connection")
	})
	file.AddText("Add Saved Host..."+shortcutLabel("add_host"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:add-host")
	})
	file.AddText("Import SSH Config...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:import-ssh-config")
	})
	file.AddText("Export Hosts...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:export-hosts")
	})
	file.AddSeparator()
	file.AddText("New Group...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:new-group")
	})
	file.AddText("Terminal Profiles...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:terminal-profiles")
	})
	file.AddSeparator()
	file.AddText("Settings..."+shortcutLabel("settings"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:settings")
	})
	file.AddSeparator()
	file.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.deps.Ctx)
	})

	// Session and Help menus remain unchanged (no accelerators to remove)
```

The rest of the session/help menus stay identical to current code.

**Note on runtime menu label updates:** Wails v2 supports `menuItem.SetLabel()` at runtime, but the menu items need to be stored as references. For the initial implementation, menu labels are set at startup from resolved bindings. A future enhancement could store menu item references and update labels when bindings change via a Wails event, but this is not required for v1 — the labels will be correct after an app restart.

- [ ] **Step 2: Add FormatForDisplay to the parser**

In `internal/keybind/parser.go`, add:

```go
// FormatForDisplay converts a shortcut string to platform-appropriate display symbols.
// On macOS: CmdOrCtrl→⌘, Shift→⇧, Alt→⌥. On others: CmdOrCtrl→Ctrl.
// This is used for menu labels and other display contexts on the Go side.
func FormatForDisplay(shortcut string) string {
	if shortcut == "" {
		return ""
	}
	p, err := Parse(shortcut)
	if err != nil {
		return shortcut
	}

	isMac := goruntime.GOOS == "darwin"
	var parts []string
	if p.CmdOrCtrl {
		if isMac {
			parts = append(parts, "⌘")
		} else {
			parts = append(parts, "Ctrl+")
		}
	}
	if p.Alt {
		if isMac {
			parts = append(parts, "⌥")
		} else {
			parts = append(parts, "Alt+")
		}
	}
	if p.Shift {
		if isMac {
			parts = append(parts, "⇧")
		} else {
			parts = append(parts, "Shift+")
		}
	}

	if isMac {
		// Mac style: ⌘⇧K (no separators between symbols)
		return strings.Join(parts, "") + strings.ToUpper(p.Key)
	}
	// Windows/Linux style: Ctrl+Shift+K
	return strings.Join(parts, "") + strings.ToUpper(p.Key)
}
```

Add `goruntime "runtime"` to the imports in `parser.go`.

- [ ] **Step 3: Add the keybind import to main.go**

Add `"github.com/dylanbr0wn/shsh/internal/keybind"` to the imports in `main.go`.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go build ./...`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add main.go internal/keybind/parser.go
git commit -m "feat(ui): replace native menu accelerators with label-only shortcut display"
```

---

### Task 7: Frontend Key Matching Utility

**Files:**
- Create: `frontend/src/lib/keybind.ts`

- [ ] **Step 1: Create the key matching and display utility**

```ts
const isMac = navigator.platform.toUpperCase().includes('MAC')

/**
 * Converts a KeyboardEvent into the normalized CmdOrCtrl+... format
 * for matching against resolved bindings.
 */
export function eventToShortcut(e: KeyboardEvent): string {
  const hasCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
  if (!hasCmdOrCtrl && !e.altKey && !e.shiftKey) return ''

  const parts: string[] = []
  if (hasCmdOrCtrl) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Normalize the key: ignore standalone modifier keys
  const key = e.key
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return ''

  // Normalize single character keys to lowercase for matching
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key
  parts.push(normalizedKey)

  return parts.join('+')
}

/**
 * Normalizes the key part of a shortcut string to lowercase for consistent matching.
 * Binding strings from Go use uppercase in FormatForDisplay but the canonical
 * format uses lowercase single chars (e.g., "CmdOrCtrl+k" not "CmdOrCtrl+K").
 */
export function normalizeShortcutForMatch(shortcut: string): string {
  if (!shortcut) return ''
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  if (key.length === 1) {
    parts[parts.length - 1] = key.toLowerCase()
  }
  return parts.join('+')
}

/**
 * Converts a CmdOrCtrl+Shift+K shortcut to platform-appropriate display string.
 * Mac: ⌘⇧K, Windows/Linux: Ctrl+Shift+K
 */
export function formatShortcutForDisplay(shortcut: string): string {
  if (!shortcut) return 'Unbound'
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (isMac) {
    const symbols: string[] = []
    for (const mod of modifiers) {
      switch (mod) {
        case 'CmdOrCtrl': symbols.push('⌘'); break
        case 'Alt': symbols.push('⌥'); break
        case 'Shift': symbols.push('⇧'); break
      }
    }
    return symbols.join('') + key.toUpperCase()
  }

  const labels: string[] = []
  for (const mod of modifiers) {
    switch (mod) {
      case 'CmdOrCtrl': labels.push('Ctrl'); break
      case 'Alt': labels.push('Alt'); break
      case 'Shift': labels.push('Shift'); break
    }
  }
  labels.push(key.toUpperCase())
  return labels.join('+')
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/keybind.ts
git commit -m "feat(ui): add frontend key matching and shortcut display utilities"
```

---

### Task 8: Frontend Action Registry and Keybinding Hook

**Files:**
- Create: `frontend/src/lib/actions.ts`
- Create: `frontend/src/hooks/useKeybindings.ts`
- Modify: `frontend/src/store/atoms.ts` (add keybindingsAtom)
- Modify: `frontend/src/store/useAppInit.ts:52-87` (remove old keydown handler)

- [ ] **Step 1: Add keybindingsAtom to atoms.ts**

At the end of `frontend/src/store/atoms.ts`, add:

```ts
// Resolved keybindings from the Go backend
export interface ResolvedKeybinding {
  action_id: string
  label: string
  category: string
  shortcut: string
  default: string
  protected: boolean
  modified: boolean
}
export const keybindingsAtom = atom<ResolvedKeybinding[]>([])
```

- [ ] **Step 2: Create the action registry**

```ts
// frontend/src/lib/actions.ts
import { getDefaultStore } from 'jotai'
import {
  isCommandPaletteOpenAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
} from '../store/atoms'
import { debugPanelOpenAtom } from '../store/debugStore'

const store = getDefaultStore()

export type ActionHandler = (context: ActionContext) => void

export interface ActionContext {
  // Workspace-specific context passed from the keybinding hook
  activeWorkspaceId: string | null
  focusedPaneId: string | null
  splitPane?: (workspaceId: string, paneId: string, direction: 'vertical' | 'horizontal') => void
  setSearchOpen?: (fn: (open: boolean) => boolean) => void
}

const globalActions: Record<string, ActionHandler> = {
  command_palette: () => store.set(isCommandPaletteOpenAtom, (v) => !v),
  quick_connect: () => store.set(isQuickConnectOpenAtom, (v) => !v),
  add_host: () => store.set(isAddHostOpenAtom, (v) => !v),
  import_ssh_config: () => store.set(isImportSSHConfigOpenAtom, (v) => !v),
  settings: () => store.set(isSettingsOpenAtom, (v) => !v),
  debug_panel: () => store.set(debugPanelOpenAtom, (v) => !v),
}

const workspaceActions: Record<string, ActionHandler> = {
  terminal_search: (ctx) => {
    ctx.setSearchOpen?.((open) => !open)
  },
  split_vertical: (ctx) => {
    if (ctx.activeWorkspaceId && ctx.focusedPaneId && ctx.splitPane) {
      ctx.splitPane(ctx.activeWorkspaceId, ctx.focusedPaneId, 'vertical')
    }
  },
  split_horizontal: (ctx) => {
    if (ctx.activeWorkspaceId && ctx.focusedPaneId && ctx.splitPane) {
      ctx.splitPane(ctx.activeWorkspaceId, ctx.focusedPaneId, 'horizontal')
    }
  },
}

export function getActionHandler(actionID: string): ActionHandler | undefined {
  return globalActions[actionID] ?? workspaceActions[actionID]
}

export function isWorkspaceAction(actionID: string): boolean {
  return actionID in workspaceActions
}
```

- [ ] **Step 3: Create the useKeybindings hook**

```ts
// frontend/src/hooks/useKeybindings.ts
import { useEffect, useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { keybindingsAtom, activeWorkspaceIdAtom, workspacesAtom } from '../store/atoms'
import { GetKeybindings } from '../../wailsjs/go/main/KeybindFacade'
import { eventToShortcut, normalizeShortcutForMatch } from '../lib/keybind'
import { getActionHandler, type ActionContext } from '../lib/actions'

export function useKeybindings(context: Omit<ActionContext, 'activeWorkspaceId' | 'focusedPaneId'>) {
  const [keybindings, setKeybindings] = useAtom(keybindingsAtom)
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const contextRef = useRef(context)
  contextRef.current = context

  // Build lookup map: normalized shortcut → actionID
  const lookupRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const map = new Map<string, string>()
    for (const kb of keybindings) {
      if (kb.shortcut) {
        map.set(normalizeShortcutForMatch(kb.shortcut), kb.action_id)
      }
    }
    lookupRef.current = map
  }, [keybindings])

  // Fetch keybindings on mount
  useEffect(() => {
    GetKeybindings().then((bindings) => {
      setKeybindings(bindings ?? [])
    })
  }, [setKeybindings])

  // Global keydown handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const shortcut = eventToShortcut(e)
      if (!shortcut) return

      const actionID = lookupRef.current.get(shortcut)
      if (!actionID) return

      const handler = getActionHandler(actionID)
      if (!handler) return

      e.preventDefault()

      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      handler({
        activeWorkspaceId,
        focusedPaneId: ws?.focusedPaneId ?? null,
        ...contextRef.current,
      })
    },
    [activeWorkspaceId, workspaces]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Expose refresh for use after settings changes
  const refreshKeybindings = useCallback(() => {
    GetKeybindings().then((bindings) => {
      setKeybindings(bindings ?? [])
    })
  }, [setKeybindings])

  return { refreshKeybindings }
}
```

- [ ] **Step 4: Remove old keydown handler from useAppInit.ts**

In `frontend/src/store/useAppInit.ts`, remove lines 52-86 (the entire `useEffect` block with the `keydown` handler) and remove the now-unused atom imports: `isQuickConnectOpenAtom`, `isCommandPaletteOpenAtom`, `isAddHostOpenAtom`, `isImportSSHConfigOpenAtom` from the imports, and `debugPanelOpenAtom` from the import. Also remove the corresponding `useSetAtom` calls for those atoms.

The cleaned-up file should look like:

```ts
import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { Host, Group, TerminalProfile } from '../types'
import { ListHosts, ListGroups, ListTerminalProfiles } from '../../wailsjs/go/main/HostFacade'
import {
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
} from './atoms'
import { useDebugEvents } from '../hooks/useDebugEvents'
import { useChannelEvents } from '../hooks/useChannelEvents'
import { useConnectionEvents } from '../hooks/useConnectionEvents'
import { useMenuEvents } from '../hooks/useMenuEvents'
import { useSessionMenuEvents } from '../hooks/useSessionMenuEvents'

export function useAppInit() {
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setTerminalProfiles = useSetAtom(terminalProfilesAtom)

  useEffect(() => {
    ListHosts()
      .then((hosts) => setHosts(hosts as unknown as Host[]))
      .catch((err: unknown) => toast.error('Failed to load hosts', { description: String(err) }))
    ListGroups()
      .then((groups) => setGroups(groups as unknown as Group[]))
      .catch((err: unknown) => toast.error('Failed to load groups', { description: String(err) }))
    ListTerminalProfiles()
      .then((profiles: unknown) => setTerminalProfiles(profiles as unknown as TerminalProfile[]))
      .catch((err: unknown) =>
        toast.error('Failed to load terminal profiles', { description: String(err) })
      )
  }, [setHosts, setGroups, setTerminalProfiles])

  useDebugEvents()
  useChannelEvents()
  useConnectionEvents()
  useMenuEvents()
  useSessionMenuEvents()
}
```

- [ ] **Step 5: Remove old keydown handler from WorkspaceView.tsx**

In `frontend/src/components/terminal/WorkspaceView.tsx`, remove the `handleKeyDown` callback (lines 336-357) and the `useEffect` that registers it (lines 359-362). The terminal search toggle and pane splitting are now handled by the central keybinding system.

- [ ] **Step 6: Wire useKeybindings into the app**

The `useKeybindings` hook needs to be called from a component that has access to workspace context. The best place is the component that renders workspaces. Find where `WorkspaceView` is rendered and add the hook there, passing `splitPane` and `setSearchOpen` through the context.

In the parent component that renders `WorkspaceView` (likely `App.tsx`), add:

```ts
import { useKeybindings } from './hooks/useKeybindings'

// Inside the component, after workspace state is available:
const { refreshKeybindings } = useKeybindings({
  splitPane: handleSplit,
  setSearchOpen: setSearchOpen,
})
```

In `App.tsx`, the `WorkspaceView` component already receives `handleSplit` and `setSearchOpen` as props (or accesses them via hooks). The `useKeybindings` hook should be called in `App.tsx` alongside `useAppInit()`. For the workspace-specific actions (`split_vertical`, `split_horizontal`, `terminal_search`), the context needs `splitPane` and `setSearchOpen` from the workspace rendering layer. If these are only available inside `WorkspaceView`, lift them into a shared ref or pass the `refreshKeybindings` callback down and call `useKeybindings` inside `WorkspaceView` instead. The key constraint: there must be exactly one global `keydown` listener, not multiple.

- [ ] **Step 7: Regenerate Wails bindings**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && wails generate module`
Expected: TypeScript bindings regenerated in `frontend/wailsjs/go/main/KeybindFacade.ts`

- [ ] **Step 8: Verify frontend builds**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm build`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/actions.ts frontend/src/hooks/useKeybindings.ts frontend/src/store/atoms.ts frontend/src/store/useAppInit.ts frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): replace scattered keydown handlers with central keybinding system"
```

---

### Task 9: Keybinding Settings UI

**Files:**
- Create: `frontend/src/components/settings/KeybindingsSettings.tsx`
- Modify: `frontend/src/components/modals/SettingsModal.tsx`

- [ ] **Step 1: Create the KeybindingsSettings component**

```tsx
// frontend/src/components/settings/KeybindingsSettings.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { keybindingsAtom, type ResolvedKeybinding } from '../../store/atoms'
import { UpdateKeybinding, ResetKeybinding, ResetAllKeybindings, GetKeybindings } from '../../../wailsjs/go/main/KeybindFacade'
import { eventToShortcut, formatShortcutForDisplay } from '../../lib/keybind'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { FieldSet, FieldLegend, FieldGroup } from '../ui/field'
import { getDefaultStore } from 'jotai'

const store = getDefaultStore()

export function KeybindingsSettings() {
  const keybindings = useAtomValue(keybindingsAtom)
  const [search, setSearch] = useState('')
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null)
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ResolvedKeybinding | null>(null)
  const recordingRef = useRef<string | null>(null)

  // Keep ref in sync for the keydown handler
  recordingRef.current = recordingActionId

  const refreshBindings = useCallback(async () => {
    const bindings = await GetKeybindings()
    store.set(keybindingsAtom, bindings ?? [])
  }, [])

  // Recording keydown handler
  useEffect(() => {
    if (!recordingActionId) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingActionId(null)
        setPendingShortcut(null)
        setConflict(null)
        return
      }

      const shortcut = eventToShortcut(e)
      if (!shortcut) return

      // Check for conflicts
      const conflicting = keybindings.find(
        (kb) => kb.shortcut === shortcut && kb.action_id !== recordingRef.current
      )

      if (conflicting) {
        setPendingShortcut(shortcut)
        setConflict(conflicting)
      } else {
        // No conflict — save directly
        applyBinding(recordingRef.current!, shortcut)
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recordingActionId, keybindings])

  async function applyBinding(actionId: string, shortcut: string) {
    try {
      await UpdateKeybinding(actionId, shortcut)
      await refreshBindings()
    } finally {
      setRecordingActionId(null)
      setPendingShortcut(null)
      setConflict(null)
    }
  }

  async function confirmConflictReassign() {
    if (!conflict || !pendingShortcut || !recordingActionId) return

    const isProtected = keybindings.find((kb) => kb.action_id === conflict.action_id)?.protected
    // Unbind the conflicting action (set to empty = unbound)
    await UpdateKeybinding(conflict.action_id, '')
    // Set the new binding
    await applyBinding(recordingActionId, pendingShortcut)
  }

  async function handleReset(actionId: string) {
    await ResetKeybinding(actionId)
    await refreshBindings()
  }

  async function handleResetAll() {
    await ResetAllKeybindings()
    await refreshBindings()
  }

  // Group by category
  const filtered = keybindings.filter((kb) => {
    if (!search) return true
    const q = search.toLowerCase()
    return kb.label.toLowerCase().includes(q) || kb.shortcut.toLowerCase().includes(q)
  })

  const grouped = filtered.reduce<Record<string, ResolvedKeybinding[]>>((acc, kb) => {
    if (!acc[kb.category]) acc[kb.category] = []
    acc[kb.category].push(kb)
    return acc
  }, {})

  const sortedCategories = Object.keys(grouped).sort()

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search shortcuts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {sortedCategories.map((category) => (
        <FieldSet key={category}>
          <FieldLegend>{category}</FieldLegend>
          <FieldGroup>
            {grouped[category].map((kb) => (
              <div
                key={kb.action_id}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-sm">{kb.label}</span>
                <div className="flex items-center gap-2">
                  {recordingActionId === kb.action_id ? (
                    conflict ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-destructive">
                          Already bound to {conflict.label}.
                          {conflict.protected && ' (Protected!)'}
                          {' '}Reassign?
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={confirmConflictReassign}
                        >
                          Yes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => {
                            setRecordingActionId(null)
                            setPendingShortcut(null)
                            setConflict(null)
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="animate-pulse rounded border border-primary px-2 py-0.5 text-xs text-primary">
                        Press shortcut...
                      </span>
                    )
                  ) : (
                    <button
                      className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      onClick={() => {
                        setRecordingActionId(kb.action_id)
                        setPendingShortcut(null)
                        setConflict(null)
                      }}
                    >
                      {formatShortcutForDisplay(kb.shortcut)}
                    </button>
                  )}
                  {kb.modified && recordingActionId !== kb.action_id && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => handleReset(kb.action_id)}
                      title="Reset to default"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            ))}
          </FieldGroup>
        </FieldSet>
      ))}

      {keybindings.some((kb) => kb.modified) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleResetAll}>
            Reset All to Defaults
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add KeybindingsSettings to SettingsModal**

In `frontend/src/components/modals/SettingsModal.tsx`, add the new section after the existing "Sessions" section.

Add import:
```ts
import { KeybindingsSettings } from '../settings/KeybindingsSettings'
```

After the closing `</FieldSet>` of the Sessions section (before `</DialogContent>`), add:

```tsx
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Keyboard Shortcuts</FieldLegend>
          <KeybindingsSettings />
        </FieldSet>
```

Also widen the dialog to accommodate the keybinding list — change `sm:max-w-md` to `sm:max-w-lg`:

```tsx
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/KeybindingsSettings.tsx frontend/src/components/modals/SettingsModal.tsx
git commit -m "feat(ui): add keyboard shortcuts section to settings modal with recording, conflicts, and reset"
```

---

### Task 10: Integration Verification and Cleanup

**Files:**
- Various (no new files)

- [ ] **Step 1: Run all Go tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go test ./internal/... -race -timeout 60s`
Expected: PASS

- [ ] **Step 2: Run Go vet**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go vet ./internal/...`
Expected: No issues

- [ ] **Step 3: Run frontend lint**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm lint`
Expected: No errors (fix any that appear)

- [ ] **Step 4: Run frontend format check**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm format:check`
Expected: No formatting issues (run `pnpm format` to fix if needed)

- [ ] **Step 5: Run frontend build**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise/frontend && pnpm build`
Expected: No type errors, build succeeds

- [ ] **Step 6: Verify go.mod is clean**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && go mod tidy && git diff --exit-code go.mod go.sum`
Expected: No changes

- [ ] **Step 7: Manual smoke test**

Run: `cd /Users/dylan/.superset/worktrees/shsh/honorable-tortoise && wails dev`

Verify:
1. App starts without errors
2. Cmd+K opens command palette
3. Settings → Keyboard Shortcuts section appears
4. Clicking a shortcut pill enters recording mode
5. Pressing a new combo updates the binding
6. The new binding works immediately (no restart)
7. Conflict warning appears when binding an already-used shortcut
8. Reset icon appears on modified bindings and works
9. "Reset All to Defaults" restores everything
10. Menu labels show correct shortcut text

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(keygen): integration fixes from smoke testing"
```
