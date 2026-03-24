package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/export"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/sshconfig"
	"github.com/dylanbr0wn/shsh/internal/store"

	"github.com/google/uuid"
	"github.com/melbahja/goph"
	"github.com/rs/zerolog/log"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"

	"github.com/dylanbr0wn/shsh/internal/credstore"
)

// wailsEventEmitter implements session.EventEmitter using the Wails runtime.
type wailsEventEmitter struct {
	ctx context.Context
}

func (w *wailsEventEmitter) Emit(topic string, data any) {
	wailsruntime.EventsEmit(w.ctx, topic, data)
}

// App is the Wails application coordinator.
type App struct {
	ctx     context.Context
	store   *store.Store
	manager *session.Manager
	cfg     *config.Config
	cfgPath string
}

// NewApp creates a new App application struct.
func NewApp(cfg *config.Config) *App {
	return &App{cfg: cfg}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.TempDir()
	}
	dbDir := filepath.Join(configDir, "shsh")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create config dir: %v\n", err)
		return
	}

	a.cfgPath = filepath.Join(dbDir, "config.json")
	if _, statErr := os.Stat(a.cfgPath); os.IsNotExist(statErr) {
		// Write defaults so the user has a reference to all available settings.
		if saveErr := a.cfg.Save(a.cfgPath); saveErr != nil {
			log.Warn().Err(saveErr).Msg("could not write default config file")
		}
	}

	dbPath := filepath.Join(dbDir, "shsh.db")

	s, err := store.New(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		return
	}
	a.store = s

	if err := s.MigratePasswordsToKeychain(); err != nil {
		log.Warn().Err(err).Msg("keychain migration encountered errors")
	}

	a.manager = session.NewManager(ctx, a.cfg, &wailsEventEmitter{ctx: ctx})

	wailsruntime.OnFileDrop(ctx, func(_ int, _ int, paths []string) {
		wailsruntime.EventsEmit(ctx, "window:filedrop", map[string]interface{}{
			"paths": paths,
		})
	})
}

// shutdown is called by Wails on window close.
func (a *App) shutdown(_ context.Context) {
	if a.manager != nil {
		a.manager.Shutdown()
	}
	if a.store != nil {
		a.store.Close()
	}
}

// --- App Config ---

// GetConfig returns the current application configuration.
func (a *App) GetConfig() config.Config {
	return *a.cfg
}

// UpdateConfig replaces the current configuration and persists it to disk.
func (a *App) UpdateConfig(cfg config.Config) error {
	a.cfg = &cfg
	if a.cfgPath != "" {
		return cfg.Save(a.cfgPath)
	}
	return nil
}

// --- Host CRUD ---

func (a *App) ListHosts() ([]store.Host, error) {
	return a.store.ListHosts()
}

func (a *App) AddHost(input store.CreateHostInput) (store.Host, error) {
	return a.store.AddHost(input)
}

func (a *App) UpdateHost(input store.UpdateHostInput) (store.Host, error) {
	return a.store.UpdateHost(input)
}

func (a *App) DeleteHost(id string) error {
	return a.store.DeleteHost(id)
}

// --- Password Manager Integration ---

// CheckPasswordManagers returns the availability and lock status of each
// supported external password manager CLI.
func (a *App) CheckPasswordManagers() credstore.PasswordManagersStatus {
	return credstore.Check()
}

// TestHostCredential attempts to fetch the credential for the given host
// using its configured credential source. Returns nil on success or an
// error describing the failure.
func (a *App) TestHostCredential(hostID string) error {
	_, _, err := a.store.GetHostForConnect(hostID)
	return err
}

// TestCredentialRef fetches a credential directly by source and ref,
// without requiring the host to be saved first.
func (a *App) TestCredentialRef(source string, ref string) error {
	_, err := credstore.Fetch(credstore.Source(source), ref)
	return err
}

// --- Terminal Profile CRUD ---

func (a *App) ListTerminalProfiles() ([]store.TerminalProfile, error) {
	return a.store.ListProfiles()
}

func (a *App) AddTerminalProfile(input store.CreateProfileInput) (store.TerminalProfile, error) {
	return a.store.AddProfile(input)
}

func (a *App) UpdateTerminalProfile(input store.UpdateProfileInput) (store.TerminalProfile, error) {
	return a.store.UpdateProfile(input)
}

func (a *App) DeleteTerminalProfile(id string) error {
	return a.store.DeleteProfile(id)
}

// --- Group CRUD ---

func (a *App) ListGroups() ([]store.Group, error) {
	return a.store.ListGroups()
}

func (a *App) AddGroup(input store.CreateGroupInput) (store.Group, error) {
	return a.store.AddGroup(input)
}

func (a *App) UpdateGroup(input store.UpdateGroupInput) (store.Group, error) {
	return a.store.UpdateGroup(input)
}

func (a *App) DeleteGroup(id string) error {
	return a.store.DeleteGroup(id)
}

// BulkConnectResult pairs a session ID with the host that initiated it.
type BulkConnectResult struct {
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId"`
}

// BulkConnectGroup dials SSH for all hosts in the given group and returns the resulting session/host pairs.
func (a *App) BulkConnectGroup(groupID string) ([]BulkConnectResult, error) {
	hosts, err := a.store.GetHostsByGroup(groupID)
	if err != nil {
		return nil, err
	}
	var results []BulkConnectResult
	for _, h := range hosts {
		host, password, err := a.store.GetHostForConnect(h.ID)
		if err != nil {
			continue
		}
		var jumpHost *store.Host
		var jumpPassword string
		if host.JumpHostID != nil {
			jh, jp, err := a.store.GetHostForConnect(*host.JumpHostID)
			if err != nil {
				log.Warn().Err(err).Str("hostID", h.ID).Msg("skipping bulk connect: could not resolve jump host")
				continue
			}
			jumpHost = &jh
			jumpPassword = jp
		}
		sessionID := a.manager.Connect(host, password, jumpHost, jumpPassword, func() {
			a.store.TouchLastConnected(h.ID)
		})
		results = append(results, BulkConnectResult{SessionID: sessionID, HostID: h.ID})
	}
	if results == nil {
		results = []BulkConnectResult{}
	}
	return results, nil
}

// --- SSH Config ---

func (a *App) ListSSHConfigHosts() ([]sshconfig.Entry, error) {
	return sshconfig.List()
}

// ImportSSHConfigHosts imports the specified aliases from ~/.ssh/config into the hosts DB.
// Skips entries that already exist (matched on hostname+port+user).
func (a *App) ImportSSHConfigHosts(aliases []string) ([]store.Host, error) {
	all, err := sshconfig.List()
	if err != nil {
		return nil, err
	}

	byAlias := make(map[string]sshconfig.Entry, len(all))
	for _, e := range all {
		byAlias[e.Alias] = e
	}

	var imported []store.Host
	for _, alias := range aliases {
		e, ok := byAlias[alias]
		if !ok {
			continue
		}

		exists, err := a.store.HostExists(e.Hostname, e.Port, e.User)
		if err != nil {
			return nil, err
		}
		if exists {
			continue
		}

		host, err := a.store.AddHost(store.CreateHostInput{
			Label:      alias,
			Hostname:   e.Hostname,
			Port:       e.Port,
			Username:   e.User,
			AuthMethod: store.AuthAgent,
		})
		if err != nil {
			return nil, err
		}
		imported = append(imported, host)
	}

	if imported == nil {
		imported = []store.Host{}
	}
	return imported, nil
}

// --- Export ---

// ExportInput is the payload sent from the frontend to initiate a host export.
// GroupID filters to a single group; HostIDs filters to specific hosts.
// If both are empty/nil, all hosts are exported.
type ExportInput struct {
	Format  string   `json:"format"`  // "sshconfig" | "json" | "csv"
	HostIDs []string `json:"hostIds"` // nil or empty = no ID filter
	GroupID string   `json:"groupId"` // "" = no group filter
}

// ExportHosts opens a native save-file dialog and writes the exported hosts to disk.
// Returns the path written, or "" if the user cancelled the dialog.
func (a *App) ExportHosts(input ExportInput) (string, error) {
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
	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
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

	hosts, err := a.store.ListHosts()
	if err != nil {
		return "", err
	}
	groups, err := a.store.ListGroups()
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

// --- Session management ---

// QuickConnectInput is the payload for an ad hoc SSH connection (not saved to DB).
type QuickConnectInput struct {
	Hostname   string           `json:"hostname"`
	Port       int              `json:"port"`
	Username   string           `json:"username"`
	Password   string           `json:"password,omitempty"`
	AuthMethod store.AuthMethod `json:"authMethod"`
}

// QuickConnect dials SSH with the given credentials without saving a host record.
func (a *App) QuickConnect(input QuickConnectInput) (string, error) {
	port := input.Port
	if port == 0 {
		port = 22
	}
	host := store.Host{
		ID:         uuid.New().String(),
		Label:      input.Username + "@" + input.Hostname,
		Hostname:   input.Hostname,
		Port:       port,
		Username:   input.Username,
		AuthMethod: input.AuthMethod,
	}
	sessionID := a.manager.Connect(host, input.Password, nil, "", nil)
	return sessionID, nil
}

// ConnectHost dials SSH for the given host and returns a session ID.
func (a *App) ConnectHost(hostID string) (string, error) {
	host, password, err := a.store.GetHostForConnect(hostID)
	if err != nil {
		return "", err
	}

	log.Info().Str("hostID", hostID).Str("hostname", host.Hostname).Int("port", host.Port).Str("username", host.Username).Msg("Connecting to host")

	var jumpHost *store.Host
	var jumpPassword string
	if host.JumpHostID != nil {
		jh, jp, err := a.store.GetHostForConnect(*host.JumpHostID)
		if err != nil {
			return "", fmt.Errorf("resolving jump host: %w", err)
		}
		jumpHost = &jh
		jumpPassword = jp
	}

	sessionID := a.manager.Connect(host, password, jumpHost, jumpPassword, func() {
		a.store.TouchLastConnected(hostID)
	})
	return sessionID, nil
}

func (a *App) WriteToSession(sessionID string, data string) error {
	return a.manager.Write(sessionID, data)
}

func (a *App) ResizeSession(sessionID string, cols int, rows int) error {
	return a.manager.Resize(sessionID, cols, rows)
}

func (a *App) DisconnectSession(sessionID string) error {
	return a.manager.Disconnect(sessionID)
}

func (a *App) RespondHostKey(sessionID string, accepted bool) {
	a.manager.RespondHostKey(sessionID, accepted)
}

// --- SFTP ---

func (a *App) OpenSFTP(sessionID string) error {
	return a.manager.OpenSFTP(sessionID)
}

func (a *App) CloseSFTP(sessionID string) error {
	return a.manager.CloseSFTP(sessionID)
}

func (a *App) SFTPListDir(sessionID string, path string) ([]session.SFTPEntry, error) {
	return a.manager.SFTPListDir(sessionID, path)
}

func (a *App) SFTPDownload(sessionID string, remotePath string) error {
	localPath, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		DefaultFilename: filepath.Base(remotePath),
		Title:           "Save file",
	})
	if err != nil || localPath == "" {
		return nil
	}
	return a.manager.SFTPDownload(sessionID, remotePath, localPath)
}

func (a *App) SFTPDownloadDir(sessionID string, remotePath string) error {
	localDir, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Save folder to",
	})
	if err != nil || localDir == "" {
		return nil
	}
	return a.manager.SFTPDownloadDir(sessionID, remotePath, localDir)
}

func (a *App) SFTPUpload(sessionID string, remoteDir string) error {
	localPath, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Upload file",
	})
	if err != nil || localPath == "" {
		return nil
	}
	return a.manager.SFTPUpload(sessionID, remoteDir, localPath)
}

func (a *App) SFTPUploadPath(sessionID string, localPath string, remotePath string) error {
	return a.manager.SFTPUploadPath(sessionID, localPath, remotePath)
}

func (a *App) SFTPMkdir(sessionID string, path string) error {
	return a.manager.SFTPMkdir(sessionID, path)
}

func (a *App) SFTPDelete(sessionID string, path string) error {
	return a.manager.SFTPDelete(sessionID, path)
}

func (a *App) SFTPRename(sessionID string, oldPath string, newPath string) error {
	return a.manager.SFTPRename(sessionID, oldPath, newPath)
}

// --- Port Forwarding ---

func (a *App) AddPortForward(sessionID string, localPort int, remoteHost string, remotePort int) (session.PortForwardInfo, error) {
	return a.manager.AddPortForward(sessionID, localPort, remoteHost, remotePort)
}

func (a *App) RemovePortForward(sessionID string, forwardID string) error {
	return a.manager.RemovePortForward(sessionID, forwardID)
}

func (a *App) ListPortForwards(sessionID string) ([]session.PortForwardInfo, error) {
	return a.manager.ListPortForwards(sessionID)
}

// --- Session Logging ---

// LogFileInfo describes a session log file on disk.
type LogFileInfo struct {
	Path      string `json:"path"`
	Filename  string `json:"filename"`
	HostLabel string `json:"hostLabel"`
	CreatedAt string `json:"createdAt"`
	SizeBytes int64  `json:"sizeBytes"`
}

func (a *App) StartSessionLog(sessionID string) (string, error) {
	return a.manager.StartSessionLog(sessionID)
}

func (a *App) StopSessionLog(sessionID string) error {
	return a.manager.StopSessionLog(sessionID)
}

func (a *App) GetSessionLogPath(sessionID string) (string, error) {
	return a.manager.GetSessionLogPath(sessionID)
}

// ListSessionLogs returns metadata for all log files in the shsh logs directory.
func (a *App) ListSessionLogs() ([]LogFileInfo, error) {
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
func (a *App) ReadSessionLog(path string) (string, error) {
	if err := a.validateLogPath(path); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteSessionLog removes a log file.
func (a *App) DeleteSessionLog(path string) error {
	if err := a.validateLogPath(path); err != nil {
		return err
	}
	return os.Remove(path)
}

// OpenLogsDirectory opens the shsh logs folder in the system file manager.
func (a *App) OpenLogsDirectory() {
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

// GenerateKeyInput holds the parameters for SSH key pair generation.
type GenerateKeyInput struct {
	KeyType    string `json:"keyType"`    // "ed25519" or "rsa"
	RSABits    int    `json:"rsaBits"`    // 2048 or 4096 (RSA only)
	SavePath   string `json:"savePath"`   // full path for the private key
	Passphrase string `json:"passphrase"` // optional encryption passphrase
	Comment    string `json:"comment"`    // appended to the public key line
}

// GenerateKeyResult holds the paths and public key text after generation.
type GenerateKeyResult struct {
	PrivateKeyPath string `json:"privateKeyPath"`
	PublicKeyPath  string `json:"publicKeyPath"`
	PublicKeyText  string `json:"publicKeyText"`
}

// GenerateSSHKey generates a new SSH key pair and writes both files to disk.
func (a *App) GenerateSSHKey(input GenerateKeyInput) (GenerateKeyResult, error) {
	// Expand ~ in save path
	if strings.HasPrefix(input.SavePath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("resolve home directory: %w", err)
		}
		input.SavePath = filepath.Join(home, input.SavePath[2:])
	}
	if input.SavePath == "" {
		return GenerateKeyResult{}, fmt.Errorf("save path is required")
	}

	// Ensure the directory exists
	if err := os.MkdirAll(filepath.Dir(input.SavePath), 0700); err != nil {
		return GenerateKeyResult{}, fmt.Errorf("create directory: %w", err)
	}

	var privBlock *pem.Block
	var sshPub ssh.PublicKey

	switch input.KeyType {
	case "ed25519":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("generate ed25519 key: %w", err)
		}
		sshPub, err = ssh.NewPublicKey(pub)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("encode public key: %w", err)
		}
		if input.Passphrase != "" {
			privBlock, err = ssh.MarshalPrivateKeyWithPassphrase(priv, input.Comment, []byte(input.Passphrase))
		} else {
			privBlock, err = ssh.MarshalPrivateKey(priv, input.Comment)
		}
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("marshal private key: %w", err)
		}
	case "rsa":
		bits := input.RSABits
		if bits == 0 {
			bits = a.cfg.SSH.DefaultRSAKeyBits
		}
		priv, err := rsa.GenerateKey(rand.Reader, bits)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("generate rsa key: %w", err)
		}
		sshPub, err = ssh.NewPublicKey(&priv.PublicKey)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("encode public key: %w", err)
		}
		if input.Passphrase != "" {
			privBlock, err = ssh.MarshalPrivateKeyWithPassphrase(priv, input.Comment, []byte(input.Passphrase))
		} else {
			privBlock, err = ssh.MarshalPrivateKey(priv, input.Comment)
		}
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("marshal private key: %w", err)
		}
	default:
		return GenerateKeyResult{}, fmt.Errorf("unsupported key type: %s", input.KeyType)
	}

	// Write private key (mode 0600)
	privBytes := pem.EncodeToMemory(privBlock)
	if err := os.WriteFile(input.SavePath, privBytes, 0600); err != nil {
		return GenerateKeyResult{}, fmt.Errorf("write private key: %w", err)
	}

	// Build public key line (optionally with comment)
	pubLine := strings.TrimRight(string(ssh.MarshalAuthorizedKey(sshPub)), "\n")
	if input.Comment != "" {
		pubLine += " " + input.Comment
	}
	pubLine += "\n"

	// Write public key (mode 0644)
	pubPath := input.SavePath + ".pub"
	if err := os.WriteFile(pubPath, []byte(pubLine), 0644); err != nil { //nolint:gosec
		return GenerateKeyResult{}, fmt.Errorf("write public key: %w", err)
	}

	return GenerateKeyResult{
		PrivateKeyPath: input.SavePath,
		PublicKeyPath:  pubPath,
		PublicKeyText:  pubLine,
	}, nil
}

// BrowseKeyFile opens a native file picker defaulting to ~/.ssh/ and returns
// the selected file path, or an empty string if the user cancelled.
func (a *App) BrowseKeyFile() (string, error) {
	home, _ := os.UserHomeDir()
	defaultDir := filepath.Join(home, ".ssh")
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		DefaultDirectory: defaultDir,
		Title:            "Select SSH Private Key",
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// ReadPublicKeyText reads a public key file and returns its first line.
// If path does not end in ".pub", ".pub" is appended before reading.
// Used by the frontend to preview the key in the Deploy Public Key dialog.
func (a *App) ReadPublicKeyText(path string) (string, error) {
	pubPath := path
	if !strings.HasSuffix(pubPath, ".pub") {
		pubPath = path + ".pub"
	}
	data, err := os.ReadFile(pubPath)
	if err != nil {
		return "", fmt.Errorf("read public key: %w", err)
	}
	line := strings.SplitN(strings.TrimRight(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n"), "\n", 2)[0]
	return line, nil
}

// DeployPublicKey installs a public key on the remote host's ~/.ssh/authorized_keys,
// equivalent to running ssh-copy-id. The operation is idempotent.
// publicKeyPath may be the private key path; ".pub" is appended if missing.
// Returns the SHA256 fingerprint of the deployed key on success.
func (a *App) DeployPublicKey(hostID string, publicKeyPath string) (string, error) {
	// 1. Derive and read the public key file.
	pubPath := publicKeyPath
	if !strings.HasSuffix(pubPath, ".pub") {
		pubPath = publicKeyPath + ".pub"
	}
	pubKeyBytes, err := os.ReadFile(pubPath)
	if err != nil {
		return "", fmt.Errorf("read public key file: %w", err)
	}

	// 2. Parse for fingerprint and canonical form (type + base64, no comment).
	parsed, _, _, _, err := ssh.ParseAuthorizedKey(pubKeyBytes)
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}
	fingerprint := ssh.FingerprintSHA256(parsed)
	canonical := strings.TrimRight(string(ssh.MarshalAuthorizedKey(parsed)), "\n")

	// 3. Resolve credentials — error if no saved credential.
	host, secret, err := a.store.GetHostForConnect(hostID)
	if err != nil {
		return "", fmt.Errorf("get credentials: %w", err)
	}

	// 4. Build known-hosts callback.
	hostKeyCallback, err := goph.DefaultKnownHosts()
	if err != nil {
		return "", fmt.Errorf("load known_hosts: %w", err)
	}

	const dialTimeout = 30 * time.Second

	// 5. Dial SSH (direct or via jump host).
	var client *goph.Client

	if host.JumpHostID != nil {
		jh, jp, err := a.store.GetHostForConnect(*host.JumpHostID)
		if err != nil {
			return "", fmt.Errorf("get jump host credentials: %w", err)
		}
		jumpAuth, err := buildGophAuth(jh, jp)
		if err != nil {
			return "", fmt.Errorf("jump host auth: %w", err)
		}
		jumpSSHCfg := &ssh.ClientConfig{
			User:            jh.Username,
			Auth:            jumpAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         dialTimeout,
		}
		jumpConn, err := net.DialTimeout("tcp",
			net.JoinHostPort(jh.Hostname, fmt.Sprintf("%d", jh.Port)), dialTimeout)
		if err != nil {
			return "", fmt.Errorf("dial jump host: %w", err)
		}
		ncc, chans, reqs, err := ssh.NewClientConn(jumpConn, jh.Hostname, jumpSSHCfg)
		if err != nil {
			jumpConn.Close()
			return "", fmt.Errorf("connect jump host: %w", err)
		}
		jumpClient := ssh.NewClient(ncc, chans, reqs)
		defer jumpClient.Close()

		targetAuth, err := buildGophAuth(host, secret)
		if err != nil {
			return "", fmt.Errorf("target host auth: %w", err)
		}
		targetSSHCfg := &ssh.ClientConfig{
			User:            host.Username,
			Auth:            targetAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         dialTimeout,
		}
		tunnelConn, err := jumpClient.Dial("tcp",
			net.JoinHostPort(host.Hostname, fmt.Sprintf("%d", host.Port)))
		if err != nil {
			return "", fmt.Errorf("dial target through jump host: %w", err)
		}
		targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(
			tunnelConn, host.Hostname, targetSSHCfg)
		if err != nil {
			tunnelConn.Close()
			return "", fmt.Errorf("connect target via jump host: %w", err)
		}
		client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
	} else {
		auth, err := buildGophAuth(host, secret)
		if err != nil {
			return "", fmt.Errorf("host auth: %w", err)
		}
		client, err = goph.NewConn(&goph.Config{
			User:     host.Username,
			Addr:     host.Hostname,
			Port:     uint(host.Port),
			Auth:     auth,
			Timeout:  dialTimeout,
			Callback: hostKeyCallback,
		})
		if err != nil {
			return "", fmt.Errorf(
				"connect to host (host key unknown? connect via terminal first): %w", err)
		}
	}
	defer client.Close()

	// 6. Ensure ~/.ssh exists with correct permissions.
	if _, err := client.Run("mkdir -p ~/.ssh && chmod 700 ~/.ssh"); err != nil {
		return "", fmt.Errorf("create ~/.ssh on remote: %w", err)
	}

	// 7. Idempotent append via SFTP (avoids shell injection from key comment field).
	sftpClient, err := client.NewSftp()
	if err != nil {
		return "", fmt.Errorf("open sftp: %w", err)
	}
	defer sftpClient.Close()

	const akPath = ".ssh/authorized_keys"
	existing, err := func() ([]byte, error) {
		f, err := sftpClient.Open(akPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, nil
			}
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(f)
	}()
	if err != nil {
		return "", fmt.Errorf("read authorized_keys: %w", err)
	}

	if !bytes.Contains(existing, []byte(canonical)) {
		newContent := append(existing, []byte(canonical+"\n")...)
		f, err := sftpClient.OpenFile(akPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
		if err != nil {
			return "", fmt.Errorf("open authorized_keys for writing: %w", err)
		}
		if _, writeErr := f.Write(newContent); writeErr != nil {
			f.Close()
			return "", fmt.Errorf("write authorized_keys: %w", writeErr)
		}
		f.Close()
	}

	// 8. Fix permissions on authorized_keys.
	if _, err := client.Run("chmod 600 ~/.ssh/authorized_keys"); err != nil {
		return "", fmt.Errorf("chmod authorized_keys: %w", err)
	}

	return fingerprint, nil
}

// buildGophAuth constructs a goph.Auth value for the given host and secret.
// Mirrors the resolveAuth logic in internal/session but operates on App-level
// code without importing the session package's unexported helper.
func buildGophAuth(host store.Host, secret string) (goph.Auth, error) {
	switch host.AuthMethod {
	case store.AuthPassword:
		return goph.Password(secret), nil
	case store.AuthKey:
		if host.KeyPath == nil || *host.KeyPath == "" {
			return nil, fmt.Errorf("no key file configured for this host")
		}
		return goph.Key(*host.KeyPath, secret)
	case store.AuthAgent:
		return goph.UseAgent()
	default:
		return nil, fmt.Errorf("unknown auth method %q", host.AuthMethod)
	}
}

// validateLogPath ensures the given path is within the shsh logs directory.
func (a *App) validateLogPath(path string) error {
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

// --- Host Health ---

// PingResult is the TCP reachability result for one host.
type PingResult struct {
	HostID    string `json:"hostId"`
	LatencyMs int64  `json:"latencyMs"` // -1 = unreachable / timed out
}

// PingHosts performs concurrent TCP pings on each host's SSH port (5 s timeout).
func (a *App) PingHosts(hostIDs []string) []PingResult {
	hosts, _ := a.store.ListHosts()
	hostMap := make(map[string]store.Host, len(hosts))
	for _, h := range hosts {
		hostMap[h.ID] = h
	}

	results := make([]PingResult, len(hostIDs))
	var wg sync.WaitGroup
	for i, id := range hostIDs {
		wg.Add(1)
		go func(idx int, hostID string) {
			defer wg.Done()
			r := PingResult{HostID: hostID, LatencyMs: -1}
			if h, ok := hostMap[hostID]; ok {
				addr := net.JoinHostPort(h.Hostname, fmt.Sprintf("%d", h.Port))
				start := time.Now()
				conn, err := net.DialTimeout("tcp", addr, time.Duration(a.cfg.SSH.TCPPingTimeoutSeconds)*time.Second)
				if err == nil {
					r.LatencyMs = time.Since(start).Milliseconds()
					conn.Close()
				}
			}
			results[idx] = r
		}(i, id)
	}
	wg.Wait()
	return results
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
