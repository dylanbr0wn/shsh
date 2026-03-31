# Update Menu Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native menu labels update immediately after keybinding changes, without requiring an app restart.

**Architecture:** Add an `onChanged` callback to `KeybindFacade` that rebuilds the full menu via `buildMenu` and replaces it with `runtime.MenuSetApplicationMenu`. The callback is wired in `App.startup()`.

**Tech Stack:** Go, Wails v2 runtime API

---

### Task 1: Add onChanged callback to KeybindFacade

**Files:**
- Modify: `keybind_facade.go:11-13` (struct definition)
- Modify: `keybind_facade.go:26-53` (UpdateKeybinding)
- Modify: `keybind_facade.go:57-71` (ResetKeybinding)
- Modify: `keybind_facade.go:74-81` (ResetAllKeybindings)

- [ ] **Step 1: Add `onChanged` field to the struct**

In `keybind_facade.go`, update the struct:

```go
// KeybindFacade exposes keybinding operations to the frontend via Wails.
type KeybindFacade struct {
	deps      *deps.Deps
	onChanged func()
}
```

- [ ] **Step 2: Call `onChanged` at the end of `UpdateKeybinding` on success**

After the successful return path in `UpdateKeybinding`, add the callback invocation. The method should end with:

```go
	if f.deps.CfgPath != "" {
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}
	if f.onChanged != nil {
		f.onChanged()
	}
	return nil
```

- [ ] **Step 3: Call `onChanged` at the end of `ResetKeybinding` on success**

Same pattern. The method should end with:

```go
	if f.deps.CfgPath != "" {
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}
	if f.onChanged != nil {
		f.onChanged()
	}
	return nil
```

- [ ] **Step 4: Call `onChanged` at the end of `ResetAllKeybindings` on success**

Same pattern. The method should end with:

```go
	if f.deps.CfgPath != "" {
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}
	if f.onChanged != nil {
		f.onChanged()
	}
	return nil
```

- [ ] **Step 5: Verify Go builds**

Run: `go build ./...`
Expected: builds successfully. Existing tests still pass because `onChanged` is nil (nil function is never called).

- [ ] **Step 6: Run existing tests**

Run: `go test ./internal/... -race -timeout 60s`
Expected: all pass, no changes needed.

- [ ] **Step 7: Commit**

```bash
git add keybind_facade.go
git commit -m "feat(keybindings): add onChanged callback to KeybindFacade

Fires after successful keybinding update/reset to allow menu refresh.

Closes #61"
```

---

### Task 2: Wire the callback in App.startup

**Files:**
- Modify: `app.go:57-117` (startup method)

- [ ] **Step 1: Add the callback wiring at the end of `startup()`**

At the end of `app.go` `startup()` (after the `OnFileDrop` block, before the closing `}`), add:

```go
	a.keybinds.onChanged = func() {
		newMenu := buildMenu(a)
		wailsruntime.MenuSetApplicationMenu(ctx, newMenu)
	}
```

Note: `wailsruntime` is already imported as an alias for `github.com/wailsapp/wails/v2/pkg/runtime` in `app.go`.

- [ ] **Step 2: Verify Go builds**

Run: `go build ./...`
Expected: builds successfully.

- [ ] **Step 3: Run all checks**

Run the full pre-PR checklist:

```bash
go vet ./internal/...
go test ./internal/... -race -timeout 60s
cd frontend && pnpm build && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app.go
git commit -m "feat(ui): wire menu rebuild on keybinding change

After a keybinding update/reset, rebuilds the native menu so labels
reflect the new shortcuts immediately.

Closes #61"
```
