# Export/Import Hosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Import SSH Config modal into a general Import Hosts modal supporting file-based import (shsh JSON, shsh CSV, Termius CSV) with editable preview and duplicate detection.

**Architecture:** New `internal/importfile/` Go package handles format detection and parsing. Two new `ToolsFacade` methods (`ParseImportFile`, `CommitImport`) expose parsing and persistence to the frontend. The existing `ImportSSHConfigModal` component is renamed and extended with a source toggle and editable preview table.

**Tech Stack:** Go (backend parsing, Wails runtime dialogs), React/TypeScript (modal UI), Jotai (state), shadcn/ui (components)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `internal/importfile/importfile.go` | Format detection, types (`ImportCandidate`, `ImportPreview`) |
| Create | `internal/importfile/json.go` | Parse shsh JSON envelope into candidates |
| Create | `internal/importfile/csv.go` | Parse shsh CSV and Termius CSV into candidates |
| Create | `internal/importfile/importfile_test.go` | Tests for all parsers and format detection |
| Modify | `internal/store/store.go` | Add `FindHostID(hostname, port, username)` method |
| Modify | `tools_facade.go` | Add `ParseImportFile()` and `CommitImport()` methods |
| Rename+Modify | `frontend/src/components/modals/ImportSSHConfigModal.tsx` → `ImportHostsModal.tsx` | Source toggle, file import path, editable preview |
| Modify | `frontend/src/store/atoms.ts:55` | Rename atom |
| Modify | `frontend/src/App.tsx:15,162` | Update import + component name |
| Modify | `frontend/src/components/CommandPalette.tsx:23,115-119` | Update atom import + label |
| Modify | `frontend/src/components/sidebar/SidebarFooter.tsx:7,28,70-75` | Update atom import + tooltip |
| Modify | `frontend/src/components/welcome/WelcomeScreen.tsx:11,40,200` | Update atom import |
| Modify | `frontend/src/hooks/useMenuEvents.ts:5,16,25` | Update atom import + event name |
| Modify | `frontend/src/store/useAppInit.ts:13,30,74` | Update atom import + setter name |
| Modify | `frontend/src/events/topics.ts:21` | Rename event topic |
| Modify | `main.go:38-39` | Update menu label and event name |
| Modify | `frontend/src/types/index.ts` | Add `ImportCandidate` and `ImportPreview` types |

---

### Task 1: Import File Parsing — Types & Format Detection

**Files:**
- Create: `internal/importfile/importfile.go`
- Create: `internal/importfile/importfile_test.go`

- [ ] **Step 1: Write failing test for format detection**

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/importfile/... -run TestDetectFormat -v`
Expected: FAIL — package does not exist

- [ ] **Step 3: Implement types and DetectFormat**

```go
// internal/importfile/importfile.go
package importfile

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"strings"
)

// Format identifies the detected import file format.
type Format string

const (
	FormatShshJSON   Format = "shsh-json"
	FormatShshCSV    Format = "shsh-csv"
	FormatTermiusCSV Format = "termius-csv"
)

// ImportCandidate is a normalised host entry parsed from any supported format.
type ImportCandidate struct {
	Label           string   `json:"label"`
	Hostname        string   `json:"hostname"`
	Port            int      `json:"port"`
	Username        string   `json:"username"`
	AuthMethod      string   `json:"authMethod"`
	KeyPath         string   `json:"keyPath,omitempty"`
	Password        string   `json:"password,omitempty"`
	Tags            []string `json:"tags,omitempty"`
	GroupName       string   `json:"groupName,omitempty"`
	Color           string   `json:"color,omitempty"`
	IsDuplicate     bool     `json:"isDuplicate"`
	DuplicateHostID string   `json:"duplicateHostId,omitempty"`
}

// ImportPreview is the result of parsing an import file, before any DB writes.
type ImportPreview struct {
	Candidates     []ImportCandidate `json:"candidates"`
	DetectedFormat string            `json:"detectedFormat"`
	SkippedCount   int               `json:"skippedCount"` // e.g. non-SSH rows in Termius CSV
}

// DetectFormat inspects file content and returns the detected format.
func DetectFormat(content []byte) (Format, error) {
	// Try JSON first: look for version field.
	trimmed := strings.TrimSpace(string(content))
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var envelope struct {
			Version int `json:"version"`
		}
		if err := json.Unmarshal(content, &envelope); err == nil && envelope.Version > 0 {
			return FormatShshJSON, nil
		}
	}

	// Try CSV: read the header row.
	r := csv.NewReader(strings.NewReader(string(content)))
	header, err := r.Read()
	if err == nil && len(header) > 0 {
		first := strings.TrimSpace(strings.ToLower(header[0]))
		switch first {
		case "groups":
			return FormatTermiusCSV, nil
		case "label":
			return FormatShshCSV, nil
		}
	}

	return "", errors.New("unrecognized file format: expected shsh JSON, shsh CSV, or Termius CSV")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/importfile/... -run TestDetectFormat -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/importfile/importfile.go internal/importfile/importfile_test.go
git commit -m "feat(store): add import file format detection and types"
```

---

### Task 2: JSON Parser

**Files:**
- Create: `internal/importfile/json.go`
- Modify: `internal/importfile/importfile_test.go`

- [ ] **Step 1: Write failing tests for JSON parsing**

Add to `internal/importfile/importfile_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/importfile/... -run TestParseJSON -v`
Expected: FAIL — `ParseJSON` undefined

- [ ] **Step 3: Implement ParseJSON**

```go
// internal/importfile/json.go
package importfile

import "encoding/json"

// jsonEnvelope matches the shsh JSON export format.
type jsonEnvelope struct {
	Version    int            `json:"version"`
	ExportedAt string         `json:"exportedAt"`
	Hosts      []jsonHostItem `json:"hosts"`
}

type jsonHostItem struct {
	Label      string   `json:"label"`
	Hostname   string   `json:"hostname"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthMethod string   `json:"authMethod"`
	KeyPath    string   `json:"keyPath,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	Group      string   `json:"group,omitempty"`
	Color      string   `json:"color,omitempty"`
}

// ParseJSON parses shsh JSON export content into import candidates.
func ParseJSON(content []byte) ([]ImportCandidate, error) {
	var env jsonEnvelope
	if err := json.Unmarshal(content, &env); err != nil {
		return nil, err
	}

	candidates := make([]ImportCandidate, 0, len(env.Hosts))
	for _, h := range env.Hosts {
		auth := h.AuthMethod
		if auth == "" {
			auth = "agent"
		}
		candidates = append(candidates, ImportCandidate{
			Label:      h.Label,
			Hostname:   h.Hostname,
			Port:       h.Port,
			Username:   h.Username,
			AuthMethod: auth,
			KeyPath:    h.KeyPath,
			Tags:       h.Tags,
			GroupName:  h.Group,
			Color:      h.Color,
		})
	}
	return candidates, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/importfile/... -run TestParseJSON -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/importfile/json.go internal/importfile/importfile_test.go
git commit -m "feat(store): add shsh JSON import parser"
```

---

### Task 3: CSV Parsers (shsh + Termius)

**Files:**
- Create: `internal/importfile/csv.go`
- Modify: `internal/importfile/importfile_test.go`

- [ ] **Step 1: Write failing tests for CSV parsing**

Add to `internal/importfile/importfile_test.go`:

```go
func TestParseShshCSV(t *testing.T) {
	content := []byte("label,hostname,port,username,auth_method,key_path,tags,group,color\nprod-web,10.0.0.1,22,deploy,key,~/.ssh/id_ed25519,prod|web,Production,#ff0000\nstaging,10.0.1.1,2222,admin,password,,,,\n")

	candidates, skipped, err := ParseCSV(content, FormatShshCSV)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if skipped != 0 {
		t.Errorf("got skipped=%d, want 0", skipped)
	}
	if len(candidates) != 2 {
		t.Fatalf("got %d candidates, want 2", len(candidates))
	}

	c := candidates[0]
	if c.Label != "prod-web" || c.Hostname != "10.0.0.1" || c.Port != 22 {
		t.Errorf("unexpected first candidate: %+v", c)
	}
	if c.AuthMethod != "key" || c.KeyPath != "~/.ssh/id_ed25519" {
		t.Errorf("unexpected auth: %+v", c)
	}
	if len(c.Tags) != 2 || c.Tags[0] != "prod" || c.Tags[1] != "web" {
		t.Errorf("unexpected tags: %v", c.Tags)
	}
	if c.GroupName != "Production" || c.Color != "#ff0000" {
		t.Errorf("unexpected group/color: %+v", c)
	}
}

func TestParseTermiusCSV(t *testing.T) {
	content := []byte("Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,Password,SSH_KEY\nProduction,prod-web,web,10.0.0.1,ssh,22,deploy,secret123,\nStaging,staging,,10.0.1.1,ssh,2222,admin,,/path/to/key\n,rdp-host,,10.0.2.1,rdp,3389,admin,,\n")

	candidates, skipped, err := ParseCSV(content, FormatTermiusCSV)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if skipped != 1 {
		t.Errorf("got skipped=%d, want 1 (rdp row)", skipped)
	}
	if len(candidates) != 2 {
		t.Fatalf("got %d candidates, want 2", len(candidates))
	}

	c := candidates[0]
	if c.Label != "prod-web" || c.Hostname != "10.0.0.1" || c.Port != 22 {
		t.Errorf("unexpected first candidate: %+v", c)
	}
	if c.AuthMethod != "password" || c.Password != "secret123" {
		t.Errorf("unexpected auth: method=%s password=%s", c.AuthMethod, c.Password)
	}
	if c.GroupName != "Production" {
		t.Errorf("unexpected group: %s", c.GroupName)
	}
	if len(c.Tags) != 1 || c.Tags[0] != "web" {
		t.Errorf("unexpected tags: %v", c.Tags)
	}

	c2 := candidates[1]
	if c2.AuthMethod != "key" || c2.KeyPath != "/path/to/key" {
		t.Errorf("unexpected second candidate auth: method=%s keyPath=%s", c2.AuthMethod, c2.KeyPath)
	}
}

func TestParseTermiusCSV_NoAuthDefaultsToAgent(t *testing.T) {
	content := []byte("Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,Password,SSH_KEY\n,test,,10.0.0.1,ssh,22,user,,\n")

	candidates, _, err := ParseCSV(content, FormatTermiusCSV)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if candidates[0].AuthMethod != "agent" {
		t.Errorf("got %q, want %q", candidates[0].AuthMethod, "agent")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/importfile/... -run TestParse.*CSV -v`
Expected: FAIL — `ParseCSV` undefined

- [ ] **Step 3: Implement ParseCSV**

```go
// internal/importfile/csv.go
package importfile

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
)

// ParseCSV parses CSV content into import candidates.
// format must be FormatShshCSV or FormatTermiusCSV (determines column mapping).
// Returns the parsed candidates and the number of skipped rows (e.g. non-SSH in Termius).
func ParseCSV(content []byte, format Format) ([]ImportCandidate, int, error) {
	r := csv.NewReader(strings.NewReader(string(content)))
	records, err := r.ReadAll()
	if err != nil {
		return nil, 0, fmt.Errorf("parse CSV: %w", err)
	}
	if len(records) < 2 {
		return []ImportCandidate{}, 0, nil // header only or empty
	}

	switch format {
	case FormatShshCSV:
		return parseShshCSV(records[1:])
	case FormatTermiusCSV:
		return parseTermiusCSV(records[1:])
	default:
		return nil, 0, fmt.Errorf("unsupported CSV format: %s", format)
	}
}

func parseShshCSV(rows [][]string) ([]ImportCandidate, int, error) {
	// Columns: label, hostname, port, username, auth_method, key_path, tags, group, color
	candidates := make([]ImportCandidate, 0, len(rows))
	for i, row := range rows {
		if len(row) < 9 {
			return nil, 0, fmt.Errorf("row %d: expected 9 columns, got %d", i+2, len(row))
		}
		port, err := strconv.Atoi(row[2])
		if err != nil {
			return nil, 0, fmt.Errorf("row %d: invalid port %q", i+2, row[2])
		}

		var tags []string
		if row[6] != "" {
			tags = strings.Split(row[6], "|")
		}

		auth := row[4]
		if auth == "" {
			auth = "agent"
		}

		candidates = append(candidates, ImportCandidate{
			Label:      row[0],
			Hostname:   row[1],
			Port:       port,
			Username:   row[3],
			AuthMethod: auth,
			KeyPath:    row[5],
			Tags:       tags,
			GroupName:  row[7],
			Color:      row[8],
		})
	}
	return candidates, 0, nil
}

func parseTermiusCSV(rows [][]string) ([]ImportCandidate, int, error) {
	// Columns: Groups, Label, Tags, Hostname/IP, Protocol, Port, Username, Password, SSH_KEY
	candidates := make([]ImportCandidate, 0, len(rows))
	skipped := 0

	for i, row := range rows {
		if len(row) < 9 {
			return nil, 0, fmt.Errorf("row %d: expected 9 columns, got %d", i+2, len(row))
		}

		protocol := strings.ToLower(strings.TrimSpace(row[4]))
		if protocol != "ssh" && protocol != "" {
			skipped++
			continue
		}

		port, err := strconv.Atoi(row[5])
		if err != nil {
			port = 22
		}

		password := strings.TrimSpace(row[7])
		sshKey := strings.TrimSpace(row[8])

		var authMethod string
		switch {
		case password != "":
			authMethod = "password"
		case sshKey != "":
			authMethod = "key"
		default:
			authMethod = "agent"
		}

		var tags []string
		if t := strings.TrimSpace(row[2]); t != "" {
			for _, tag := range strings.Split(t, ",") {
				tag = strings.TrimSpace(tag)
				if tag != "" {
					tags = append(tags, tag)
				}
			}
		}

		candidates = append(candidates, ImportCandidate{
			Label:      strings.TrimSpace(row[1]),
			Hostname:   strings.TrimSpace(row[3]),
			Port:       port,
			Username:   strings.TrimSpace(row[6]),
			AuthMethod: authMethod,
			KeyPath:    sshKey,
			Password:   password,
			Tags:       tags,
			GroupName:  strings.TrimSpace(row[0]),
		})
	}
	return candidates, skipped, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/importfile/... -run TestParse.*CSV -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all importfile tests**

Run: `go test ./internal/importfile/... -v -race`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add internal/importfile/csv.go internal/importfile/importfile_test.go
git commit -m "feat(store): add shsh CSV and Termius CSV import parsers"
```

---

### Task 4: Store — FindHostID Method

**Files:**
- Modify: `internal/store/store.go`

- [ ] **Step 1: Add FindHostID method to store**

Add after `HostExists` (line 756) in `internal/store/store.go`:

```go
// FindHostID returns the ID of a host matching the given hostname, port, and username,
// or "" if no match exists.
func (s *Store) FindHostID(hostname string, port int, username string) (string, error) {
	var id string
	err := s.db.QueryRow(
		`SELECT id FROM hosts WHERE hostname=? AND port=? AND username=? LIMIT 1`,
		hostname, port, username,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `go build ./...`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add internal/store/store.go
git commit -m "feat(store): add FindHostID for duplicate detection during import"
```

---

### Task 5: Backend — ParseImportFile & CommitImport

**Files:**
- Modify: `tools_facade.go`

- [ ] **Step 1: Add import to tools_facade.go**

Add `"github.com/dylanbr0wn/shsh/internal/importfile"` to the import block in `tools_facade.go` (after the `export` import on line 16).

- [ ] **Step 2: Add ParseImportFile method**

Add after the `ExportHosts` method (after line 133) in `tools_facade.go`:

```go
// --- Import ---

// ParseImportFile opens a native file dialog, reads the selected file,
// auto-detects its format, and returns a preview of hosts to import.
// Returns an empty preview if the user cancels the dialog.
func (f *ToolsFacade) ParseImportFile() (importfile.ImportPreview, error) {
	home, _ := os.UserHomeDir()
	path, err := wailsruntime.OpenFileDialog(f.d.Ctx, wailsruntime.OpenDialogOptions{
		DefaultDirectory: home,
		Title:            "Import Hosts",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "JSON & CSV files", Pattern: "*.json;*.csv"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return importfile.ImportPreview{}, err
	}
	if path == "" {
		return importfile.ImportPreview{Candidates: []importfile.ImportCandidate{}}, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return importfile.ImportPreview{}, fmt.Errorf("read import file: %w", err)
	}

	format, err := importfile.DetectFormat(content)
	if err != nil {
		return importfile.ImportPreview{}, err
	}

	var candidates []importfile.ImportCandidate
	var skipped int
	switch format {
	case importfile.FormatShshJSON:
		candidates, err = importfile.ParseJSON(content)
	case importfile.FormatShshCSV, importfile.FormatTermiusCSV:
		candidates, skipped, err = importfile.ParseCSV(content, format)
	}
	if err != nil {
		return importfile.ImportPreview{}, err
	}

	// Mark duplicates.
	for i := range candidates {
		c := &candidates[i]
		id, findErr := f.d.Store.FindHostID(c.Hostname, c.Port, c.Username)
		if findErr != nil {
			return importfile.ImportPreview{}, findErr
		}
		if id != "" {
			c.IsDuplicate = true
			c.DuplicateHostID = id
		}
	}

	return importfile.ImportPreview{
		Candidates:     candidates,
		DetectedFormat: string(format),
		SkippedCount:   skipped,
	}, nil
}

// CommitImportInput is the payload for committing a previewed import.
type CommitImportInput struct {
	Candidates []importfile.ImportCandidate `json:"candidates"`
}

// CommitImport persists the selected import candidates to the database.
// Creates groups as needed. Overwrites duplicates when IsDuplicate is true.
func (f *ToolsFacade) CommitImport(input CommitImportInput) ([]store.Host, error) {
	// Build group name → ID map from existing groups.
	existingGroups, err := f.d.Store.ListGroups()
	if err != nil {
		return nil, err
	}
	groupMap := make(map[string]string, len(existingGroups))
	for _, g := range existingGroups {
		groupMap[g.Name] = g.ID
	}

	var results []store.Host
	for _, c := range input.Candidates {
		// Resolve group.
		var groupID *string
		if c.GroupName != "" {
			if id, ok := groupMap[c.GroupName]; ok {
				groupID = &id
			} else {
				g, gErr := f.d.Store.AddGroup(store.CreateGroupInput{Name: c.GroupName})
				if gErr != nil {
					return nil, fmt.Errorf("create group %q: %w", c.GroupName, gErr)
				}
				groupMap[c.GroupName] = g.ID
				groupID = &g.ID
			}
		}

		var keyPath *string
		if c.KeyPath != "" {
			keyPath = &c.KeyPath
		}

		if c.IsDuplicate && c.DuplicateHostID != "" {
			host, uErr := f.d.Store.UpdateHost(store.UpdateHostInput{
				ID:         c.DuplicateHostID,
				Label:      c.Label,
				Hostname:   c.Hostname,
				Port:       c.Port,
				Username:   c.Username,
				AuthMethod: store.AuthMethod(c.AuthMethod),
				Password:   c.Password,
				KeyPath:    keyPath,
				GroupID:    groupID,
				Color:      c.Color,
				Tags:       c.Tags,
			})
			if uErr != nil {
				return nil, fmt.Errorf("update host %q: %w", c.Label, uErr)
			}
			results = append(results, host)
		} else {
			host, aErr := f.d.Store.AddHost(store.CreateHostInput{
				Label:      c.Label,
				Hostname:   c.Hostname,
				Port:       c.Port,
				Username:   c.Username,
				AuthMethod: store.AuthMethod(c.AuthMethod),
				Password:   c.Password,
				KeyPath:    keyPath,
				GroupID:    groupID,
				Color:      c.Color,
				Tags:       c.Tags,
			})
			if aErr != nil {
				return nil, fmt.Errorf("add host %q: %w", c.Label, aErr)
			}
			results = append(results, host)
		}
	}

	if results == nil {
		results = []store.Host{}
	}
	return results, nil
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `go build ./...`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add tools_facade.go
git commit -m "feat(store): add ParseImportFile and CommitImport backend methods"
```

---

### Task 6: Regenerate Wails Bindings

**Files:**
- Auto-generated: `frontend/wailsjs/go/`

- [ ] **Step 1: Regenerate bindings**

Run: `wails generate module`
Expected: SUCCESS — new bindings generated for `ParseImportFile` and `CommitImport` on `ToolsFacade`

- [ ] **Step 2: Verify the generated bindings exist**

Run: `grep -l "ParseImportFile\|CommitImport" frontend/wailsjs/go/main/ToolsFacade.js`
Expected: File found with both function names

- [ ] **Step 3: Commit**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate wails bindings for import methods"
```

---

### Task 7: Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add ImportCandidate and ImportPreview types**

Add at the end of `frontend/src/types/index.ts` (after the `WorkspaceTemplate` interface, line 194):

```typescript
// --- Import ---

export interface ImportCandidate {
  label: string
  hostname: string
  port: number
  username: string
  authMethod: string
  keyPath?: string
  password?: string
  tags?: string[]
  groupName?: string
  color?: string
  isDuplicate: boolean
  duplicateHostId?: string
}

export interface ImportPreview {
  candidates: ImportCandidate[]
  detectedFormat: string
  skippedCount: number
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(ui): add ImportCandidate and ImportPreview types"
```

---

### Task 8: Rename Atom & Update All References

**Files:**
- Modify: `frontend/src/store/atoms.ts:55`
- Modify: `frontend/src/App.tsx:15,162`
- Modify: `frontend/src/components/CommandPalette.tsx:23,43,115-119`
- Modify: `frontend/src/components/sidebar/SidebarFooter.tsx:7,28,70-75`
- Modify: `frontend/src/components/welcome/WelcomeScreen.tsx:11,40,200`
- Modify: `frontend/src/hooks/useMenuEvents.ts:5,16,25`
- Modify: `frontend/src/store/useAppInit.ts:13,30,74`
- Modify: `frontend/src/events/topics.ts:21`
- Modify: `main.go:38-39`

- [ ] **Step 1: Rename the Jotai atom**

In `frontend/src/store/atoms.ts`, change line 55:

```typescript
// Before:
export const isImportSSHConfigOpenAtom = atom<boolean>(false)
// After:
export const isImportHostsOpenAtom = atom<boolean>(false)
```

- [ ] **Step 2: Update all frontend references**

In every file that imports `isImportSSHConfigOpenAtom`, rename to `isImportHostsOpenAtom`. The files are:

**`frontend/src/App.tsx`:**
- Line 15: `import { ImportSSHConfigModal }` → `import { ImportHostsModal }` and update the path from `'./components/modals/ImportSSHConfigModal'` to `'./components/modals/ImportHostsModal'`
- Line 162: `<ImportSSHConfigModal />` → `<ImportHostsModal />`

**`frontend/src/components/CommandPalette.tsx`:**
- Line 23: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`
- Line 43: `setIsImportSSHConfigOpen` → `setIsImportHostsOpen`, referencing `isImportHostsOpenAtom`
- Lines 115-119: Update the command item:
  ```tsx
  <CommandItem onSelect={() => runAction(() => setIsImportHostsOpen(true))}>
    <Download />
    Import Hosts
    <CommandShortcut>⌘I</CommandShortcut>
  </CommandItem>
  ```

**`frontend/src/components/sidebar/SidebarFooter.tsx`:**
- Line 7: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`
- Line 28: `setIsImportSSHConfigOpen` → `setIsImportHostsOpen`, referencing `isImportHostsOpenAtom`
- Line 70: `onClick={() => setIsImportHostsOpen(true)}`
- Line 75: tooltip text `"Import from SSH Config"` → `"Import Hosts"`

**`frontend/src/components/welcome/WelcomeScreen.tsx`:**
- Line 11: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`
- Line 40: `setIsImportSSHConfigOpen` → `setIsImportHostsOpen`, referencing `isImportHostsOpenAtom`
- Line 200: `onClick={() => setIsImportHostsOpen(true)}`

**`frontend/src/hooks/useMenuEvents.ts`:**
- Line 5: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`
- Line 16: `setIsImportSSHConfigOpen` → `setIsImportHostsOpen`, referencing `isImportHostsOpenAtom`
- Line 25: `useWailsEvent('menu:import-hosts', () => setIsImportHostsOpen(true))`

**`frontend/src/store/useAppInit.ts`:**
- Line 13: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`
- Line 30: `setIsImportSSHConfigOpen` → `setIsImportHostsOpen`, referencing `isImportHostsOpenAtom`
- Line 74: `setIsImportHostsOpen((prev) => !prev)`
- Line 85 (useEffect deps): `setIsImportHostsOpen`

**`frontend/src/events/topics.ts`:**
- Line 21: `'menu:import-ssh-config': void` → `'menu:import-hosts': void`

- [ ] **Step 3: Update Go menu event**

In `main.go`, lines 38-39:

```go
// Before:
file.AddText("Import SSH Config...", nil, func(_ *menu.CallbackData) {
    runtime.EventsEmit(app.deps.Ctx, "menu:import-ssh-config")
})
// After:
file.AddText("Import Hosts...", nil, func(_ *menu.CallbackData) {
    runtime.EventsEmit(app.deps.Ctx, "menu:import-hosts")
})
```

- [ ] **Step 4: Rename the modal file**

```bash
mv frontend/src/components/modals/ImportSSHConfigModal.tsx frontend/src/components/modals/ImportHostsModal.tsx
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: SUCCESS

- [ ] **Step 6: Verify Go builds**

Run: `go build ./...`
Expected: SUCCESS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(ui): rename ImportSSHConfig to ImportHosts across codebase"
```

---

### Task 9: Build the Import Hosts Modal — Source Toggle + File Import

**Files:**
- Modify: `frontend/src/components/modals/ImportHostsModal.tsx`

This is the main UI task. The modal gets a source toggle at the top and a new "From File" path with editable preview.

- [ ] **Step 1: Rewrite ImportHostsModal with source toggle and both paths**

Replace the entire content of `frontend/src/components/modals/ImportHostsModal.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle } from 'lucide-react'
import type { Host, ImportCandidate, ImportPreview } from '../../types'
import { isImportHostsOpenAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import { ListSSHConfigHosts, ImportSSHConfigHosts } from '../../../wailsjs/go/main/HostFacade'
import { ParseImportFile, CommitImport } from '../../../wailsjs/go/main/ToolsFacade'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type ImportSource = 'sshconfig' | 'file'

interface SSHConfigEntry {
  alias: string
  hostname: string
  port: number
  user: string
}

export function ImportHostsModal() {
  const [isOpen, setIsOpen] = useAtom(isImportHostsOpenAtom)
  const setHosts = useSetAtom(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  const [source, setSource] = useState<ImportSource>('sshconfig')

  // SSH Config state (existing)
  const [sshEntries, setSSHEntries] = useState<SSHConfigEntry[]>([])
  const [sshSelected, setSSHSelected] = useState<Set<string>>(new Set())
  const [sshLoading, setSSHLoading] = useState(false)

  // File import state
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [fileSelected, setFileSelected] = useState<Set<number>>(new Set())
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const [importing, setImporting] = useState(false)

  // Load SSH config when modal opens with sshconfig source
  useEffect(() => {
    if (!isOpen || source !== 'sshconfig') return
    setSSHLoading(true)
    ListSSHConfigHosts()
      .then((result) => {
        const list = (result as SSHConfigEntry[]) ?? []
        setSSHEntries(list)
        setSSHSelected(new Set(list.map((e) => e.alias)))
      })
      .catch((err) => toast.error('Failed to read SSH config', { description: String(err) }))
      .finally(() => setSSHLoading(false))
  }, [isOpen, source])

  function close() {
    setIsOpen(false)
    setSource('sshconfig')
    setSSHEntries([])
    setSSHSelected(new Set())
    setPreview(null)
    setCandidates([])
    setFileSelected(new Set())
    setFileError(null)
  }

  // --- SSH Config handlers ---

  function toggleSSHAll() {
    if (sshSelected.size === sshEntries.length) {
      setSSHSelected(new Set())
    } else {
      setSSHSelected(new Set(sshEntries.map((e) => e.alias)))
    }
  }

  function toggleSSH(alias: string) {
    setSSHSelected((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })
  }

  async function handleSSHImport() {
    if (sshSelected.size === 0) return
    setImporting(true)
    try {
      const newHosts = (await ImportSSHConfigHosts(Array.from(sshSelected))) as unknown as Host[]
      if (newHosts.length === 0) {
        toast.info('All hosts already exist')
      } else {
        setHosts((prev) => [...prev, ...newHosts])
        toast.success(`Imported ${newHosts.length} host${newHosts.length === 1 ? '' : 's'}`)
      }
      close()
    } catch (err) {
      toast.error('Import failed', { description: String(err) })
    } finally {
      setImporting(false)
    }
  }

  // --- File import handlers ---

  async function handleChooseFile() {
    setFileError(null)
    setFileLoading(true)
    try {
      const result = (await ParseImportFile()) as unknown as ImportPreview
      if (!result.candidates || result.candidates.length === 0) {
        if (result.detectedFormat) {
          setFileError('No hosts found in the selected file.')
        }
        // else: user cancelled the dialog
        setPreview(null)
        setCandidates([])
        setFileSelected(new Set())
        return
      }
      setPreview(result)
      setCandidates(result.candidates)
      // Select all non-duplicates by default
      const selected = new Set<number>()
      result.candidates.forEach((c: ImportCandidate, i: number) => {
        if (!c.isDuplicate) selected.add(i)
      })
      setFileSelected(selected)
    } catch (err) {
      setFileError(String(err))
    } finally {
      setFileLoading(false)
    }
  }

  function toggleFileAll() {
    if (fileSelected.size === candidates.length) {
      setFileSelected(new Set())
    } else {
      setFileSelected(new Set(candidates.map((_, i) => i)))
    }
  }

  function toggleFile(index: number) {
    setFileSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const updateCandidate = useCallback((index: number, field: keyof ImportCandidate, value: string | number) => {
    setCandidates((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }, [])

  async function handleFileImport() {
    if (fileSelected.size === 0) return
    setImporting(true)
    try {
      const selected = candidates.filter((_, i) => fileSelected.has(i))
      const result = (await CommitImport({ candidates: selected })) as unknown as Host[]
      setHosts((prev) => {
        // For duplicates that were overwritten, replace in-place; add new ones at end.
        const dupIds = new Set(selected.filter((c) => c.isDuplicate).map((c) => c.duplicateHostId))
        const updated = prev.map((h) => {
          if (dupIds.has(h.id)) {
            const replacement = result.find((r) => r.id === h.id)
            return replacement ?? h
          }
          return h
        })
        const newHosts = result.filter((r) => !dupIds.has(r.id))
        return [...updated, ...newHosts]
      })
      toast.success(`Imported ${result.length} host${result.length === 1 ? '' : 's'}`)
      close()
    } catch (err) {
      toast.error('Import failed', { description: String(err) })
    } finally {
      setImporting(false)
    }
  }

  // Collect new group names from file candidates
  const existingGroupNames = new Set(groups.map((g) => g.name))
  const newGroupNames = [
    ...new Set(
      candidates
        .filter((_, i) => fileSelected.has(i))
        .map((c) => c.groupName)
        .filter((n): n is string => !!n && !existingGroupNames.has(n))
    ),
  ]

  const sshAllSelected = sshEntries.length > 0 && sshSelected.size === sshEntries.length
  const sshSomeSelected = sshSelected.size > 0 && !sshAllSelected
  const fileAllSelected = candidates.length > 0 && fileSelected.size === candidates.length
  const fileSomeSelected = fileSelected.size > 0 && !fileAllSelected

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Hosts</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Source toggle */}
          <ToggleGroup
            type="single"
            variant="outline"
            value={source}
            onValueChange={(v) => v && setSource(v as ImportSource)}
            className="w-full"
          >
            <ToggleGroupItem value="sshconfig" className="flex-1 text-xs">
              SSH Config
            </ToggleGroupItem>
            <ToggleGroupItem value="file" className="flex-1 text-xs">
              From File
            </ToggleGroupItem>
          </ToggleGroup>

          {/* SSH Config path */}
          {source === 'sshconfig' && (
            <>
              {sshLoading ? (
                <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
              ) : sshEntries.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No hosts found in ~/.ssh/config
                </p>
              ) : (
                <>
                  <div className="border-foreground/15 overflow-hidden rounded-md border">
                    <Table className="table-fixed">
                      <colgroup>
                        <col className="w-10" />
                        <col className="w-1/4" />
                        <col className="w-2/5" />
                        <col />
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Checkbox
                              checked={sshAllSelected ? true : sshSomeSelected ? 'indeterminate' : false}
                              onCheckedChange={toggleSSHAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead>Alias</TableHead>
                          <TableHead>Host</TableHead>
                          <TableHead>User</TableHead>
                        </TableRow>
                      </TableHeader>
                    </Table>
                    <div className="border-foreground/15 h-60 overflow-y-auto border-t">
                      <Table className="table-fixed">
                        <colgroup>
                          <col className="w-10" />
                          <col className="w-1/4" />
                          <col className="w-2/5" />
                          <col />
                        </colgroup>
                        <TableBody>
                          {sshEntries.map((entry) => (
                            <TableRow
                              key={entry.alias}
                              data-state={sshSelected.has(entry.alias) ? 'selected' : undefined}
                              className="cursor-pointer"
                              onClick={() => toggleSSH(entry.alias)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={sshSelected.has(entry.alias)}
                                  onCheckedChange={() => toggleSSH(entry.alias)}
                                  aria-label={`Select ${entry.alias}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{entry.alias}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {entry.hostname}:{entry.port}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{entry.user}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">Duplicate hosts will be skipped.</p>
                </>
              )}
            </>
          )}

          {/* File import path */}
          {source === 'file' && (
            <>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleChooseFile} disabled={fileLoading}>
                  {fileLoading ? 'Reading…' : 'Choose File…'}
                </Button>
                <span className="text-muted-foreground text-xs">
                  Supports shsh JSON, shsh CSV, and Termius CSV
                </span>
              </div>

              {fileError && (
                <p className="text-destructive text-sm">{fileError}</p>
              )}

              {candidates.length > 0 && (
                <>
                  <div className="border-foreground/15 overflow-hidden rounded-md border">
                    <Table className="table-fixed">
                      <colgroup>
                        <col className="w-9" />
                        <col className="w-5" />
                        <col />
                        <col />
                        <col className="w-14" />
                        <col />
                        <col className="w-18" />
                        <col />
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Checkbox
                              checked={fileAllSelected ? true : fileSomeSelected ? 'indeterminate' : false}
                              onCheckedChange={toggleFileAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead />
                          <TableHead>Label</TableHead>
                          <TableHead>Hostname</TableHead>
                          <TableHead>Port</TableHead>
                          <TableHead>Username</TableHead>
                          <TableHead>Auth</TableHead>
                          <TableHead>Group</TableHead>
                        </TableRow>
                      </TableHeader>
                    </Table>
                    <div className="border-foreground/15 h-60 overflow-y-auto border-t">
                      <Table className="table-fixed">
                        <colgroup>
                          <col className="w-9" />
                          <col className="w-5" />
                          <col />
                          <col />
                          <col className="w-14" />
                          <col />
                          <col className="w-18" />
                          <col />
                        </colgroup>
                        <TableBody>
                          {candidates.map((c, i) => (
                            <TableRow
                              key={i}
                              data-state={fileSelected.has(i) ? 'selected' : undefined}
                              className="cursor-pointer"
                              onClick={() => toggleFile(i)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={fileSelected.has(i)}
                                  onCheckedChange={() => toggleFile(i)}
                                  aria-label={`Select ${c.label}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="px-0">
                                {c.isDuplicate && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle className="text-amber-500 size-3.5" />
                                    </TooltipTrigger>
                                    <TooltipContent>Host already exists — will overwrite</TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.label}
                                  onChange={(e) => updateCandidate(i, 'label', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.hostname}
                                  onChange={(e) => updateCandidate(i, 'hostname', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={c.port}
                                  onChange={(e) => updateCandidate(i, 'port', parseInt(e.target.value) || 22)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.username}
                                  onChange={(e) => updateCandidate(i, 'username', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={c.authMethod}
                                  onValueChange={(v) => updateCandidate(i, 'authMethod', v)}
                                >
                                  <SelectTrigger
                                    className="h-7 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="agent">Agent</SelectItem>
                                    <SelectItem value="password">Password</SelectItem>
                                    <SelectItem value="key">Key</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={c.groupName ?? ''}
                                  onChange={(e) => updateCandidate(i, 'groupName', e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 text-xs"
                                  placeholder="None"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Badge variant="secondary">{fileSelected.size}</Badge>
                    {fileSelected.size === 1 ? 'host' : 'hosts'} selected
                    {preview?.skippedCount ? ` · ${preview.skippedCount} non-SSH entries skipped` : ''}
                    {newGroupNames.length > 0 && (
                      <>
                        {' · '}
                        {newGroupNames.length} new {newGroupNames.length === 1 ? 'group' : 'groups'} will be created
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          {source === 'sshconfig' ? (
            <Button
              onClick={handleSSHImport}
              disabled={importing || sshSelected.size === 0 || sshEntries.length === 0}
            >
              {importing ? 'Importing…' : `Import Selected (${sshSelected.size})`}
            </Button>
          ) : (
            <Button
              onClick={handleFileImport}
              disabled={importing || fileSelected.size === 0 || candidates.length === 0}
            >
              {importing ? 'Importing…' : `Import Selected (${fileSelected.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: SUCCESS

- [ ] **Step 3: Verify lint passes**

Run: `cd frontend && pnpm lint`
Expected: SUCCESS (or only pre-existing warnings)

- [ ] **Step 4: Verify format**

Run: `cd frontend && pnpm format:check`
Expected: SUCCESS (run `pnpm format` first if needed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/modals/ImportHostsModal.tsx
git commit -m "feat(ui): build Import Hosts modal with source toggle and editable preview"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Run Go tests**

Run: `go test ./internal/... -race -timeout 60s`
Expected: All tests PASS

- [ ] **Step 2: Run Go vet**

Run: `go vet ./internal/...`
Expected: No issues

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && pnpm build`
Expected: SUCCESS

- [ ] **Step 4: Run frontend lint**

Run: `cd frontend && pnpm lint`
Expected: SUCCESS

- [ ] **Step 5: Run frontend format check**

Run: `cd frontend && pnpm format:check`
Expected: SUCCESS

- [ ] **Step 6: Manual smoke test**

Run: `wails dev`

Test the following:
1. ⌘I opens the Import Hosts modal
2. SSH Config tab loads entries from `~/.ssh/config` and imports work
3. "From File" tab → "Choose File" opens native dialog
4. Select a shsh JSON export file → see editable preview table
5. Edit a host label inline → confirm it persists in the table
6. Duplicate hosts show warning icon, default unchecked
7. Check a duplicate → import → confirm it overwrites
8. Import creates new groups shown with count in footer
9. Command palette shows "Import Hosts" with ⌘I shortcut
10. Sidebar import button tooltip says "Import Hosts"
