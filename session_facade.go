package main

import (
	"fmt"
	"path/filepath"

	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// QuickConnectInput is the payload for an ad hoc SSH connection (not saved to DB).
type QuickConnectInput struct {
	Hostname   string           `json:"hostname"`
	Port       int              `json:"port"`
	Username   string           `json:"username"`
	Password   string           `json:"password,omitempty"`
	AuthMethod store.AuthMethod `json:"authMethod"`
}

// BulkConnectResult pairs connection/channel IDs with the host that initiated it.
type BulkConnectResult struct {
	ConnectionID string `json:"connectionId"`
	ChannelID    string `json:"channelId"`
	HostID       string `json:"hostId"`
}

// SessionFacade handles SSH connections, channels, SFTP ops, local FS,
// port forwarding, and session logging delegation.
type SessionFacade struct {
	d *deps.Deps
}

// NewSessionFacade creates a new SessionFacade.
func NewSessionFacade(d *deps.Deps) *SessionFacade {
	return &SessionFacade{d: d}
}

// resolveWithJump fetches host+password by ID and resolves jump host if configured.
func (f *SessionFacade) resolveWithJump(hostID string) (host store.Host, password string, jumpHost *store.Host, jumpPassword string, err error) {
	host, password, err = f.d.Store.GetHostForConnect(hostID)
	if err != nil {
		return
	}
	if host.JumpHostID != nil {
		jh, jp, err2 := f.d.Store.GetHostForConnect(*host.JumpHostID)
		if err2 != nil {
			err = fmt.Errorf("resolving jump host: %w", err2)
			return
		}
		jumpHost = &jh
		jumpPassword = jp
	}
	return
}

// --- Connection lifecycle ---

// BulkConnectGroup dials SSH for all hosts in the given group and returns the resulting connection/channel pairs.
func (f *SessionFacade) BulkConnectGroup(groupID string) ([]BulkConnectResult, error) {
	hosts, err := f.d.Store.GetHostsByGroup(groupID)
	if err != nil {
		return nil, err
	}
	var results []BulkConnectResult
	for _, h := range hosts {
		host, password, jumpHost, jumpPassword, err := f.resolveWithJump(h.ID)
		if err != nil {
			log.Warn().Err(err).Str("hostID", h.ID).Msg("skipping bulk connect: could not resolve host")
			continue
		}
		connResult, err := f.d.Manager.Connect(host, password, jumpHost, jumpPassword, func() {
			f.d.Store.TouchLastConnected(h.ID)
		})
		if err != nil {
			log.Warn().Err(err).Str("hostID", h.ID).Msg("skipping bulk connect: connection failed")
			continue
		}
		channelID, err := f.d.Manager.OpenTerminal(connResult.ConnectionID)
		if err != nil {
			log.Warn().Err(err).Str("hostID", h.ID).Msg("skipping bulk connect: terminal open failed")
			continue
		}
		results = append(results, BulkConnectResult{ConnectionID: connResult.ConnectionID, ChannelID: channelID, HostID: h.ID})
	}
	if results == nil {
		results = []BulkConnectResult{}
	}
	return results, nil
}

// QuickConnect dials SSH with the given credentials without saving a host record.
func (f *SessionFacade) QuickConnect(input QuickConnectInput) (session.ConnectHostResult, error) {
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
	connResult, err := f.d.Manager.Connect(host, input.Password, nil, "", nil)
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	channelID, err := f.d.Manager.OpenTerminal(connResult.ConnectionID)
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	return session.ConnectHostResult{ConnectionID: connResult.ConnectionID, ChannelID: channelID}, nil
}

// ConnectHost dials SSH for the given host and returns a connection+channel result.
func (f *SessionFacade) ConnectHost(hostID string) (session.ConnectHostResult, error) {
	host, password, jumpHost, jumpPassword, err := f.resolveWithJump(hostID)
	if err != nil {
		return session.ConnectHostResult{}, err
	}

	log.Info().Str("hostID", hostID).Str("hostname", host.Hostname).Int("port", host.Port).Str("username", host.Username).Msg("Connecting to host")

	connResult, err := f.d.Manager.Connect(host, password, jumpHost, jumpPassword, func() {
		f.d.Store.TouchLastConnected(hostID)
	})
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	channelID, err := f.d.Manager.OpenTerminal(connResult.ConnectionID)
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	return session.ConnectHostResult{ConnectionID: connResult.ConnectionID, ChannelID: channelID}, nil
}

// ConnectForSFTP dials SSH for the given host and opens an SFTP channel.
func (f *SessionFacade) ConnectForSFTP(hostID string) (session.ConnectHostResult, error) {
	host, password, jumpHost, jumpPassword, err := f.resolveWithJump(hostID)
	if err != nil {
		return session.ConnectHostResult{}, err
	}

	connResult, err := f.d.Manager.Connect(host, password, jumpHost, jumpPassword, func() {
		f.d.Store.TouchLastConnected(hostID)
	})
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	channelID, err := f.d.Manager.OpenSFTPChannel(connResult.ConnectionID)
	if err != nil {
		return session.ConnectHostResult{}, err
	}
	return session.ConnectHostResult{ConnectionID: connResult.ConnectionID, ChannelID: channelID}, nil
}

// --- Terminal I/O ---

func (f *SessionFacade) WriteToChannel(channelID string, data string) error {
	return f.d.Manager.Write(channelID, data)
}

func (f *SessionFacade) ResizeChannel(channelID string, cols int, rows int) error {
	return f.d.Manager.Resize(channelID, cols, rows)
}

// CloseChannel closes a terminal or SFTP channel.
func (f *SessionFacade) CloseChannel(channelID string) error {
	return f.d.Manager.CloseChannel(channelID)
}

// RetryConnection manually retries a failed connection.
func (f *SessionFacade) RetryConnection(connectionID string) error {
	return f.d.Manager.RetryConnection(connectionID)
}

// OpenTerminal opens a new terminal channel on an existing connection.
func (f *SessionFacade) OpenTerminal(connectionID string) (string, error) {
	return f.d.Manager.OpenTerminal(connectionID)
}

// OpenSFTPChannel opens a new SFTP channel on an existing connection.
func (f *SessionFacade) OpenSFTPChannel(connectionID string) (string, error) {
	return f.d.Manager.OpenSFTPChannel(connectionID)
}

// OpenLocalFSChannel creates a new local filesystem channel.
func (f *SessionFacade) OpenLocalFSChannel() (string, error) {
	return f.d.Manager.OpenLocalFSChannel()
}

func (f *SessionFacade) RespondHostKey(connectionID string, accepted bool) {
	f.d.Manager.RespondConnHostKey(connectionID, accepted)
}

// --- Local FS ---

func (f *SessionFacade) LocalListDir(channelID string, path string) ([]session.SFTPEntry, error) {
	return f.d.Manager.LocalListDir(channelID, path)
}

func (f *SessionFacade) LocalMkdir(channelID string, path string) error {
	return f.d.Manager.LocalMkdir(channelID, path)
}

func (f *SessionFacade) LocalDelete(channelID string, path string) error {
	return f.d.Manager.LocalDelete(channelID, path)
}

func (f *SessionFacade) LocalRename(channelID string, oldPath string, newPath string) error {
	return f.d.Manager.LocalRename(channelID, oldPath, newPath)
}

// --- SFTP ---

func (f *SessionFacade) SFTPListDir(channelID string, path string) ([]session.SFTPEntry, error) {
	return f.d.Manager.SFTPListDir(channelID, path)
}

func (f *SessionFacade) SFTPDownload(channelID string, remotePath string) error {
	localPath, err := wailsruntime.SaveFileDialog(f.d.Ctx, wailsruntime.SaveDialogOptions{
		DefaultFilename: filepath.Base(remotePath),
		Title:           "Save file",
	})
	if err != nil || localPath == "" {
		return nil
	}
	return f.d.Manager.SFTPDownload(channelID, remotePath, localPath)
}

func (f *SessionFacade) SFTPDownloadDir(channelID string, remotePath string) error {
	localDir, err := wailsruntime.OpenDirectoryDialog(f.d.Ctx, wailsruntime.OpenDialogOptions{
		Title: "Save folder to",
	})
	if err != nil || localDir == "" {
		return nil
	}
	return f.d.Manager.SFTPDownloadDir(channelID, remotePath, localDir)
}

func (f *SessionFacade) SFTPUpload(channelID string, remoteDir string) error {
	localPath, err := wailsruntime.OpenFileDialog(f.d.Ctx, wailsruntime.OpenDialogOptions{
		Title: "Upload file",
	})
	if err != nil || localPath == "" {
		return nil
	}
	return f.d.Manager.SFTPUpload(channelID, remoteDir, localPath)
}

func (f *SessionFacade) SFTPUploadPath(channelID string, localPath string, remotePath string) error {
	return f.d.Manager.SFTPUploadPath(channelID, localPath, remotePath)
}

func (f *SessionFacade) SFTPMkdir(channelID string, path string) error {
	return f.d.Manager.SFTPMkdir(channelID, path)
}

func (f *SessionFacade) SFTPDelete(channelID string, path string) error {
	return f.d.Manager.SFTPDelete(channelID, path)
}

func (f *SessionFacade) SFTPRename(channelID string, oldPath string, newPath string) error {
	return f.d.Manager.SFTPRename(channelID, oldPath, newPath)
}

// TransferBetweenChannels copies a file between any two channels (SFTP or local FS).
func (f *SessionFacade) TransferBetweenChannels(srcChannelID string, srcPath string, dstChannelID string, dstPath string) error {
	return f.d.Manager.TransferBetweenChannels(srcChannelID, srcPath, dstChannelID, dstPath)
}

// --- Port Forwarding ---

func (f *SessionFacade) AddPortForward(connectionID string, localPort int, remoteHost string, remotePort int) (session.PortForwardInfo, error) {
	return f.d.Manager.AddPortForward(connectionID, localPort, remoteHost, remotePort)
}

func (f *SessionFacade) RemovePortForward(connectionID string, forwardID string) error {
	return f.d.Manager.RemovePortForward(connectionID, forwardID)
}

func (f *SessionFacade) ListPortForwards(connectionID string) ([]session.PortForwardInfo, error) {
	return f.d.Manager.ListPortForwards(connectionID)
}

// --- Session Logging (active session ops) ---

func (f *SessionFacade) StartSessionLog(channelID string) (string, error) {
	return f.d.Manager.StartSessionLog(channelID)
}

func (f *SessionFacade) StopSessionLog(channelID string) error {
	return f.d.Manager.StopSessionLog(channelID)
}

func (f *SessionFacade) GetSessionLogPath(channelID string) (string, error) {
	return f.d.Manager.GetSessionLogPath(channelID)
}
