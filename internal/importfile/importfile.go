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
	SkippedCount   int               `json:"skippedCount"`
}

// DetectFormat inspects file content and returns the detected format.
func DetectFormat(content []byte) (Format, error) {
	trimmed := strings.TrimSpace(string(content))
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var envelope struct {
			Version int `json:"version"`
		}
		if err := json.Unmarshal(content, &envelope); err == nil && envelope.Version > 0 {
			return FormatShshJSON, nil
		}
	}

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
