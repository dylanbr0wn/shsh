package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
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
