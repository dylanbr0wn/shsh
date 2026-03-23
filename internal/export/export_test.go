package export

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/store"
)

func strPtr(s string) *string { return &s }

var testGroups = []store.Group{
	{ID: "g1", Name: "Production"},
	{ID: "g2", Name: "Staging"},
}

var testHosts = []store.Host{
	{
		ID:         "h1",
		Label:      "web-prod",
		Hostname:   "10.0.0.1",
		Port:       22,
		Username:   "ubuntu",
		AuthMethod: store.AuthKey,
		KeyPath:    strPtr("~/.ssh/id_ed25519"),
		GroupID:    strPtr("g1"),
		Tags:       []string{"production", "web"},
	},
	{
		ID:         "h2",
		Label:      "db-prod",
		Hostname:   "10.0.0.2",
		Port:       5432,
		Username:   "admin",
		AuthMethod: store.AuthAgent,
		GroupID:    strPtr("g1"),
	},
	{
		ID:         "h3",
		Label:      "dev box",
		Hostname:   "dev.example.com",
		Port:       22,
		Username:   "dylan",
		AuthMethod: store.AuthPassword,
	},
	{
		ID:         "h4",
		Label:      "staging",
		Hostname:   "stage.example.com",
		Port:       22,
		Username:   "deploy",
		AuthMethod: store.AuthAgent,
		GroupID:    strPtr("g2"),
	},
}

func TestBuildRecords(t *testing.T) {
	records := BuildRecords(testHosts, testGroups)
	if len(records) != 4 {
		t.Fatalf("expected 4 records, got %d", len(records))
	}
	if records[0].GroupName != "Production" {
		t.Errorf("expected group Production, got %q", records[0].GroupName)
	}
	if records[2].GroupName != "" {
		t.Errorf("expected empty group for ungrouped host, got %q", records[2].GroupName)
	}
	if records[0].KeyPath != "~/.ssh/id_ed25519" {
		t.Errorf("expected key path, got %q", records[0].KeyPath)
	}
}

func TestSSHConfig(t *testing.T) {
	records := BuildRecords(testHosts, testGroups)
	out, err := SSHConfig(records)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)

	// Port 22 should be omitted
	if strings.Contains(s, "Port 22") {
		t.Error("Port 22 should be omitted from SSH config output")
	}
	// Non-default port should be present
	if !strings.Contains(s, "Port 5432") {
		t.Error("expected Port 5432 in output")
	}
	// IdentityFile only for key auth
	if !strings.Contains(s, "IdentityFile ~/.ssh/id_ed25519") {
		t.Error("expected IdentityFile for key-auth host")
	}
	// Group headers
	if !strings.Contains(s, "# Group: Production") {
		t.Error("expected Group: Production comment header")
	}
	if !strings.Contains(s, "# Ungrouped") {
		t.Error("expected Ungrouped comment header")
	}
	// Alias sanitisation: space → dash
	if !strings.Contains(s, "Host dev-box") {
		t.Errorf("expected alias 'dev-box' (space→dash), got:\n%s", s)
	}
}

func TestSSHConfigDuplicateAliases(t *testing.T) {
	hosts := []store.Host{
		{ID: "a", Label: "myhost", Hostname: "10.0.0.1", Port: 22, Username: "user", AuthMethod: store.AuthAgent},
		{ID: "b", Label: "myhost", Hostname: "10.0.0.2", Port: 22, Username: "user", AuthMethod: store.AuthAgent},
	}
	records := BuildRecords(hosts, nil)
	out, err := SSHConfig(records)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.Contains(s, "Host myhost-10.0.0.1") {
		t.Errorf("expected disambiguated alias, got:\n%s", s)
	}
	if !strings.Contains(s, "Host myhost-10.0.0.2") {
		t.Errorf("expected disambiguated alias, got:\n%s", s)
	}
}

func TestJSON(t *testing.T) {
	records := BuildRecords(testHosts, testGroups)
	out, err := JSON(records)
	if err != nil {
		t.Fatal(err)
	}

	var env map[string]any
	if err := json.Unmarshal(out, &env); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if env["version"].(float64) != 1 {
		t.Error("expected version 1")
	}
	if _, ok := env["exportedAt"]; !ok {
		t.Error("expected exportedAt field")
	}
	hosts := env["hosts"].([]any)
	if len(hosts) != 4 {
		t.Errorf("expected 4 hosts, got %d", len(hosts))
	}
	// Ensure no password fields leak through
	for _, h := range hosts {
		hm := h.(map[string]any)
		if _, ok := hm["password"]; ok {
			t.Error("password field must not appear in JSON export")
		}
	}
}

func TestCSV(t *testing.T) {
	records := BuildRecords(testHosts, testGroups)
	out, err := CSV(records)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	lines := strings.Split(strings.TrimSpace(s), "\n")
	// header + 4 data rows
	if len(lines) != 5 {
		t.Errorf("expected 5 lines (header + 4 rows), got %d:\n%s", len(lines), s)
	}
	if !strings.HasPrefix(lines[0], "label,") {
		t.Errorf("expected CSV header row, got: %s", lines[0])
	}
	// Tags should be pipe-separated
	if !strings.Contains(s, "production|web") {
		t.Errorf("expected pipe-separated tags in CSV, got:\n%s", s)
	}
}
