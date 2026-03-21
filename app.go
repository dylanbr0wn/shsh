package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"myproject/internal/session"
	"myproject/internal/sshconfig"
	"myproject/internal/store"
)

// App is the Wails application coordinator.
type App struct {
	ctx     context.Context
	store   *store.Store
	manager *session.Manager
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
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

	a.manager = session.NewManager(ctx)
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
		sessionID := a.manager.Connect(host, password, func() {
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
	sessionID := a.manager.Connect(host, input.Password, nil)
	return sessionID, nil
}

// ConnectHost dials SSH for the given host and returns a session ID.
func (a *App) ConnectHost(hostID string) (string, error) {
	host, password, err := a.store.GetHostForConnect(hostID)
	if err != nil {
		return "", err
	}

	log.Info().Str("hostID", hostID).Str("hostname", host.Hostname).Int("port", host.Port).Str("username", host.Username).Msg("Connecting to host")

	sessionID := a.manager.Connect(host, password, func() {
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
	return a.manager.SFTPDownload(sessionID, remotePath)
}

func (a *App) SFTPDownloadDir(sessionID string, remotePath string) error {
	return a.manager.SFTPDownloadDir(sessionID, remotePath)
}

func (a *App) SFTPUpload(sessionID string, remoteDir string) error {
	return a.manager.SFTPUpload(sessionID, remoteDir)
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
			bits = 4096
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
				addr := fmt.Sprintf("%s:%d", h.Hostname, h.Port)
				start := time.Now()
				conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
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
