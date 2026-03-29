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
// Both sides are normalized before comparison to handle non-canonical modifier order.
func DetectConflict(bindings []ResolvedKeybinding, actionID, shortcut string) (string, bool) {
	if shortcut == "" {
		return "", false
	}
	normalized, err := Normalize(shortcut)
	if err != nil {
		normalized = shortcut
	}
	for _, b := range bindings {
		if b.ActionID == actionID {
			continue
		}
		existing, nerr := Normalize(b.Shortcut)
		if nerr != nil {
			existing = b.Shortcut
		}
		if existing == normalized {
			return b.ActionID, true
		}
	}
	return "", false
}
