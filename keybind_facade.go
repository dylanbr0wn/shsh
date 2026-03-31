package main

import (
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/keybind"
)

// KeybindFacade exposes keybinding operations to the frontend via Wails.
type KeybindFacade struct {
	deps      *deps.Deps
	onChanged func()
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
	def, ok := defaults[actionID]
	if !ok {
		return fmt.Errorf("unknown action: %q", actionID)
	}
	if def.Protected {
		return fmt.Errorf("action %q is protected and cannot be rebound", actionID)
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
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}

	if f.onChanged != nil {
		f.onChanged()
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
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}

	if f.onChanged != nil {
		f.onChanged()
	}
	return nil
}

// ResetAllKeybindings clears all keybinding overrides, restoring all defaults.
func (f *KeybindFacade) ResetAllKeybindings() error {
	f.deps.Cfg.Keybindings = nil

	if f.deps.CfgPath != "" {
		if err := f.deps.Cfg.Save(f.deps.CfgPath); err != nil {
			return err
		}
	}

	if f.onChanged != nil {
		f.onChanged()
	}
	return nil
}
