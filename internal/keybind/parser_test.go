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
