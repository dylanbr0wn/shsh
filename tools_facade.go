package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"

	"github.com/dylanbr0wn/shsh/internal/credstore"
	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/export"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ExportInput is the payload sent from the frontend to initiate a host export.
// GroupID filters to a single group; HostIDs filters to specific hosts.
// If both are empty/nil, all hosts are exported.
type ExportInput struct {
	Format  string   `json:"format"`  // "sshconfig" | "json" | "csv"
	HostIDs []string `json:"hostIds"` // nil or empty = no ID filter
	GroupID string   `json:"groupId"` // "" = no group filter
}

// LogFileInfo describes a session log file on disk.
type LogFileInfo struct {
	Path      string `json:"path"`
	Filename  string `json:"filename"`
	HostLabel string `json:"hostLabel"`
	CreatedAt string `json:"createdAt"`
	SizeBytes int64  `json:"sizeBytes"`
}

// ToolsFacade handles export, credential testing, log file management, and utilities.
type ToolsFacade struct {
	d *deps.Deps
}

// NewToolsFacade creates a new ToolsFacade.
func NewToolsFacade(d *deps.Deps) *ToolsFacade {
	return &ToolsFacade{d: d}
}

// --- Export ---

// ExportHosts opens a native save-file dialog and writes the exported hosts to disk.
// Returns the path written, or "" if the user cancelled the dialog.
func (f *ToolsFacade) ExportHosts(input ExportInput) (string, error) {
	// Determine dialog defaults based on format.
	var defaultFilename string
	var filters []wailsruntime.FileFilter
	switch input.Format {
	case "json":
		defaultFilename = "shsh_hosts.json"
		filters = []wailsruntime.FileFilter{{DisplayName: "JSON files (*.json)", Pattern: "*.json"}}
	case "csv":
		defaultFilename = "shsh_hosts.csv"
		filters = []wailsruntime.FileFilter{{DisplayName: "CSV files (*.csv)", Pattern: "*.csv"}}
	default: // sshconfig
		defaultFilename = "ssh_config"
		filters = []wailsruntime.FileFilter{{DisplayName: "All files (*)", Pattern: "*"}}
	}

	home, _ := os.UserHomeDir()
	path, err := wailsruntime.SaveFileDialog(f.d.Ctx, wailsruntime.SaveDialogOptions{
		DefaultDirectory: home,
		DefaultFilename:  defaultFilename,
		Title:            "Export Hosts",
		Filters:          filters,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // user cancelled
	}

	hosts, err := f.d.Store.ListHosts()
	if err != nil {
		return "", err
	}
	groups, err := f.d.Store.ListGroups()
	if err != nil {
		return "", err
	}

	// Apply filters.
	if input.GroupID != "" {
		filtered := hosts[:0]
		for _, h := range hosts {
			if h.GroupID != nil && *h.GroupID == input.GroupID {
				filtered = append(filtered, h)
			}
		}
		hosts = filtered
	} else if len(input.HostIDs) > 0 {
		idSet := make(map[string]struct{}, len(input.HostIDs))
		for _, id := range input.HostIDs {
			idSet[id] = struct{}{}
		}
		filtered := hosts[:0]
		for _, h := range hosts {
			if _, ok := idSet[h.ID]; ok {
				filtered = append(filtered, h)
			}
		}
		hosts = filtered
	}

	records := export.BuildRecords(hosts, groups)

	var data []byte
	switch input.Format {
	case "json":
		data, err = export.JSON(records)
	case "csv":
		data, err = export.CSV(records)
	default:
		data, err = export.SSHConfig(records)
	}
	if err != nil {
		return "", fmt.Errorf("export: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil { //nolint:gosec
		return "", fmt.Errorf("write export file: %w", err)
	}
	return path, nil
}

// --- Password Manager Integration ---

// CheckPasswordManagers returns the availability and lock status of each
// supported external password manager CLI.
func (f *ToolsFacade) CheckPasswordManagers() credstore.PasswordManagersStatus {
	return credstore.Check()
}

// TestHostCredential attempts to fetch the credential for the given host
// using its configured credential source. Returns nil on success or an
// error describing the failure.
func (f *ToolsFacade) TestHostCredential(hostID string) error {
	_, _, err := f.d.Store.GetHostForConnect(hostID)
	return err
}

// TestCredentialRef fetches a credential directly by source and ref,
// without requiring the host to be saved first.
func (f *ToolsFacade) TestCredentialRef(source string, ref string) error {
	_, err := credstore.Fetch(credstore.Source(source), ref)
	return err
}

// --- Log File Management ---

// ListSessionLogs returns metadata for all log files in the shsh logs directory.
func (f *ToolsFacade) ListSessionLogs() ([]LogFileInfo, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	logsDir := filepath.Join(configDir, "shsh", "logs")
	entries, err := os.ReadDir(logsDir)
	if os.IsNotExist(err) {
		return []LogFileInfo{}, nil
	}
	if err != nil {
		return nil, err
	}

	var logs []LogFileInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		logs = append(logs, LogFileInfo{
			Path:      filepath.Join(logsDir, e.Name()),
			Filename:  e.Name(),
			HostLabel: hostLabelFromFilename(e.Name()),
			CreatedAt: info.ModTime().Format(time.RFC3339),
			SizeBytes: info.Size(),
		})
	}
	sort.Slice(logs, func(i, j int) bool {
		return logs[i].CreatedAt > logs[j].CreatedAt
	})
	if logs == nil {
		logs = []LogFileInfo{}
	}
	return logs, nil
}

// ReadSessionLog returns the text content of a log file.
func (f *ToolsFacade) ReadSessionLog(path string) (string, error) {
	if err := f.validateLogPath(path); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteSessionLog removes a log file.
func (f *ToolsFacade) DeleteSessionLog(path string) error {
	if err := f.validateLogPath(path); err != nil {
		return err
	}
	return os.Remove(path)
}

// OpenLogsDirectory opens the shsh logs folder in the system file manager.
func (f *ToolsFacade) OpenLogsDirectory() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return
	}
	logsDir := filepath.Join(configDir, "shsh", "logs")
	os.MkdirAll(logsDir, 0700) //nolint:errcheck
	switch goruntime.GOOS {
	case "darwin":
		exec.Command("open", logsDir).Start() //nolint:errcheck
	case "windows":
		exec.Command("explorer", logsDir).Start() //nolint:errcheck
	default:
		exec.Command("xdg-open", logsDir).Start() //nolint:errcheck
	}
}

// --- Utilities ---

// GetHomeDir returns the current user's home directory path.
func (f *ToolsFacade) GetHomeDir() (string, error) {
	return os.UserHomeDir()
}

// validateLogPath ensures the given path is within the shsh logs directory.
func (f *ToolsFacade) validateLogPath(path string) error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	logsDir := filepath.Join(configDir, "shsh", "logs")
	abs, err := filepath.Abs(path)
	if err != nil || !strings.HasPrefix(abs, logsDir+string(filepath.Separator)) {
		return fmt.Errorf("invalid log path")
	}
	return nil
}

// hostLabelFromFilename extracts the host label from a log filename.
// Format: {label}_{YYYYMMDD}_{HHMMSS}_{sessionId8}.log
func hostLabelFromFilename(name string) string {
	s := strings.TrimSuffix(name, ".log")
	parts := strings.Split(s, "_")
	if len(parts) < 4 {
		return s
	}
	return strings.Join(parts[:len(parts)-3], "_")
}
