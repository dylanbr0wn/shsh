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
