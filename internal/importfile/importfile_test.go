// internal/importfile/importfile_test.go
package importfile

import "testing"

func TestDetectFormat_ShshJSON(t *testing.T) {
	content := []byte(`{"version":1,"exportedAt":"2026-01-01T00:00:00Z","hosts":[]}`)
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatShshJSON {
		t.Fatalf("got %q, want %q", f, FormatShshJSON)
	}
}

func TestDetectFormat_ShshCSV(t *testing.T) {
	content := []byte("label,hostname,port,username,auth_method,key_path,tags,group,color\n")
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatShshCSV {
		t.Fatalf("got %q, want %q", f, FormatShshCSV)
	}
}

func TestDetectFormat_TermiusCSV(t *testing.T) {
	content := []byte("Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,Password,SSH_KEY\n")
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatTermiusCSV {
		t.Fatalf("got %q, want %q", f, FormatTermiusCSV)
	}
}

func TestDetectFormat_Unknown(t *testing.T) {
	content := []byte("this is not a valid format")
	_, err := DetectFormat(content)
	if err == nil {
		t.Fatal("expected error for unknown format")
	}
}

func TestParseJSON_ValidEnvelope(t *testing.T) {
	content := []byte(`{
		"version": 1,
		"exportedAt": "2026-01-01T00:00:00Z",
		"hosts": [
			{
				"label": "prod-web",
				"hostname": "10.0.0.1",
				"port": 22,
				"username": "deploy",
				"authMethod": "key",
				"keyPath": "~/.ssh/id_ed25519",
				"tags": ["prod", "web"],
				"group": "Production",
				"color": "#ff0000"
			},
			{
				"label": "staging",
				"hostname": "10.0.1.1",
				"port": 2222,
				"username": "admin",
				"authMethod": "password"
			}
		]
	}`)

	candidates, err := ParseJSON(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candidates) != 2 {
		t.Fatalf("got %d candidates, want 2", len(candidates))
	}

	c := candidates[0]
	if c.Label != "prod-web" || c.Hostname != "10.0.0.1" || c.Port != 22 {
		t.Errorf("unexpected first candidate: %+v", c)
	}
	if c.AuthMethod != "key" || c.KeyPath != "~/.ssh/id_ed25519" {
		t.Errorf("unexpected auth: method=%s keyPath=%s", c.AuthMethod, c.KeyPath)
	}
	if c.GroupName != "Production" || c.Color != "#ff0000" {
		t.Errorf("unexpected group/color: group=%s color=%s", c.GroupName, c.Color)
	}
	if len(c.Tags) != 2 || c.Tags[0] != "prod" {
		t.Errorf("unexpected tags: %v", c.Tags)
	}

	c2 := candidates[1]
	if c2.Port != 2222 || c2.AuthMethod != "password" {
		t.Errorf("unexpected second candidate: %+v", c2)
	}
}

func TestParseJSON_EmptyHosts(t *testing.T) {
	content := []byte(`{"version":1,"exportedAt":"2026-01-01T00:00:00Z","hosts":[]}`)
	candidates, err := ParseJSON(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candidates) != 0 {
		t.Fatalf("got %d candidates, want 0", len(candidates))
	}
}

func TestParseJSON_MissingAuthMethodDefaultsToAgent(t *testing.T) {
	content := []byte(`{
		"version": 1,
		"exportedAt": "2026-01-01T00:00:00Z",
		"hosts": [{"label":"test","hostname":"h","port":22,"username":"u"}]
	}`)
	candidates, err := ParseJSON(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if candidates[0].AuthMethod != "agent" {
		t.Errorf("got authMethod %q, want %q", candidates[0].AuthMethod, "agent")
	}
}
