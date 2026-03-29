package keybind

import (
	"fmt"
	goruntime "runtime"
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
			// Last part is the key — reject modifier names used as keys
			if validModifiers[part] {
				return ParsedShortcut{}, fmt.Errorf("key cannot be a modifier name %q in %q", part, shortcut)
			}
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

// FormatForDisplay converts a shortcut string to platform-appropriate display symbols.
// On macOS: CmdOrCtrl→⌘, Shift→⇧, Alt→⌥. On others: CmdOrCtrl→Ctrl+.
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
		return strings.Join(parts, "") + strings.ToUpper(p.Key)
	}
	return strings.Join(parts, "") + strings.ToUpper(p.Key)
}
