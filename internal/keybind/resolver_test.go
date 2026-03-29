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
