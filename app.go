package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kevinburke/ssh_config"
	"github.com/melbahja/goph"
	"github.com/pkg/sftp"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	_ "modernc.org/sqlite"
)

// AuthMethod represents the SSH authentication method.
type AuthMethod string

const (
	AuthPassword AuthMethod = "password"
	AuthKey      AuthMethod = "key"
	AuthAgent    AuthMethod = "agent"
)

// SessionStatus represents the state of an SSH session.
type SessionStatus string

const (
	StatusConnecting   SessionStatus = "connecting"
	StatusConnected    SessionStatus = "connected"
	StatusDisconnected SessionStatus = "disconnected"
	StatusError        SessionStatus = "error"
)

// Host represents a saved SSH host entry.
type Host struct {
	ID              string     `json:"id"`
	Label           string     `json:"label"`
	Hostname        string     `json:"hostname"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthMethod      AuthMethod `json:"authMethod"`
	CreatedAt       string     `json:"createdAt"`
	LastConnectedAt *string    `json:"lastConnectedAt,omitempty"`
}

// CreateHostInput is the payload for adding a new host.
type CreateHostInput struct {
	Label      string     `json:"label"`
	Hostname   string     `json:"hostname"`
	Port       int        `json:"port"`
	Username   string     `json:"username"`
	AuthMethod AuthMethod `json:"authMethod"`
	Password   string     `json:"password,omitempty"`
}

// UpdateHostInput is the payload for editing an existing host.
type UpdateHostInput struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Hostname   string     `json:"hostname"`
	Port       int        `json:"port"`
	Username   string     `json:"username"`
	AuthMethod AuthMethod `json:"authMethod"`
	Password   string     `json:"password,omitempty"`
}

// HostKeyEvent is emitted when an unknown or changed host key is encountered.
type HostKeyEvent struct {
	SessionID   string `json:"sessionId"`
	Fingerprint string `json:"fingerprint"` // "SHA256:..."
	IsNew       bool   `json:"isNew"`        // true = never seen before
	HasChanged  bool   `json:"hasChanged"`   // true = different from stored (possible MITM)
}

// SSHConfigEntry represents a host parsed from ~/.ssh/config.
type SSHConfigEntry struct {
	Alias    string `json:"alias"`
	Hostname string `json:"hostname"`
	Port     int    `json:"port"`
	User     string `json:"user"`
}

// SessionStatusEvent is emitted to the frontend when session state changes.
type SessionStatusEvent struct {
	SessionID string        `json:"sessionId"`
	Status    SessionStatus `json:"status"`
	Error     string        `json:"error,omitempty"`
}

// SFTPEntry represents a single file or directory in an SFTP listing.
type SFTPEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
	Mode    string `json:"mode"`
}

// SFTPProgressEvent is emitted during file transfers.
type SFTPProgressEvent struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
	Total int64  `json:"total"`
}

type sshSession struct {
	id         string
	hostID     string
	hostLabel  string
	client     *goph.Client
	sshSess    *ssh.Session
	stdin      io.WriteCloser
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	sftpClient *sftp.Client // nil until OpenSFTP is called
	sftpMu     sync.Mutex
}

func (s *sshSession) start(appCtx context.Context, stdout io.Reader) {
	s.wg.Go(func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				runtime.EventsEmit(appCtx, "session:output:"+s.id, string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
		s.cancel()
		runtime.EventsEmit(appCtx, "session:status", SessionStatusEvent{
			SessionID: s.id,
			Status:    StatusDisconnected,
		})
	})
}

// App struct
type App struct {
	ctx         context.Context
	db          *sql.DB
	sessions    map[string]*sshSession
	pendingKeys map[string]chan bool // sessionID → host key response channel
	mu          sync.Mutex
	wg          sync.WaitGroup
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sessions:    make(map[string]*sshSession),
		pendingKeys: make(map[string]chan bool),
	}
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

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		return
	}
	a.db = db

	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		fmt.Fprintf(os.Stderr, "WAL mode: %v\n", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS hosts (
		id TEXT PRIMARY KEY,
		label TEXT NOT NULL,
		hostname TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 22,
		username TEXT NOT NULL,
		auth_method TEXT NOT NULL DEFAULT 'password',
		password TEXT,
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create hosts table: %v\n", err)
	}

	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN last_connected_at TEXT`)
}

// ListHosts returns all saved hosts.
func (a *App) ListHosts() ([]Host, error) {
	rows, err := a.db.Query(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at FROM hosts ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn sql.NullString
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}

// AddHost saves a new SSH host to the database.
func (a *App) AddHost(input CreateHostInput) (Host, error) {
	host := Host{
		ID:         uuid.New().String(),
		Label:      input.Label,
		Hostname:   input.Hostname,
		Port:       input.Port,
		Username:   input.Username,
		AuthMethod: input.AuthMethod,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	_, err := a.db.Exec(
		`INSERT INTO hosts (id, label, hostname, port, username, auth_method, password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Label, host.Hostname, host.Port, host.Username, host.AuthMethod, input.Password, host.CreatedAt,
	)
	if err != nil {
		return Host{}, err
	}
	return host, nil
}

// UpdateHost updates an existing host record.
func (a *App) UpdateHost(input UpdateHostInput) (Host, error) {
	_, err := a.db.Exec(
		`UPDATE hosts SET label=?, hostname=?, port=?, username=?, auth_method=?, password=? WHERE id=?`,
		input.Label, input.Hostname, input.Port, input.Username, input.AuthMethod, input.Password, input.ID,
	)
	if err != nil {
		return Host{}, err
	}
	var h Host
	var lastConn sql.NullString
	err = a.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at FROM hosts WHERE id=?`, input.ID,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn)
	if err != nil {
		return Host{}, err
	}
	if lastConn.Valid {
		h.LastConnectedAt = &lastConn.String
	}
	return h, nil
}

// DeleteHost removes a saved host by ID.
func (a *App) DeleteHost(id string) error {
	_, err := a.db.Exec(`DELETE FROM hosts WHERE id = ?`, id)
	return err
}

// hostKeyCallback returns an ssh.HostKeyCallback that implements TOFU via ~/.ssh/known_hosts.
func (a *App) hostKeyCallback(sessionID string) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fingerprint := ssh.FingerprintSHA256(key)

		home, _ := os.UserHomeDir()
		khPath := filepath.Join(home, ".ssh", "known_hosts")
		os.MkdirAll(filepath.Dir(khPath), 0700) //nolint:errcheck
		f, err := os.OpenFile(khPath, os.O_CREATE|os.O_RDONLY, 0600)
		if err == nil {
			f.Close()
		}

		var checkErr error
		checker, err := knownhosts.New(khPath)
		if err == nil {
			checkErr = checker(hostname, remote, key)
		} else {
			checkErr = err
		}
		if checkErr == nil {
			return nil // known and matching — silent pass
		}
		var keyErr *knownhosts.KeyError
		if !errors.As(checkErr, &keyErr) {
			return checkErr // unexpected error
		}
		isNew := len(keyErr.Want) == 0
		hasChanged := !isNew

		ch := make(chan bool, 1)
		a.mu.Lock()
		a.pendingKeys[sessionID] = ch
		a.mu.Unlock()
		defer func() {
			a.mu.Lock()
			delete(a.pendingKeys, sessionID)
			a.mu.Unlock()
		}()

		runtime.EventsEmit(a.ctx, "session:hostkey", HostKeyEvent{
			SessionID:   sessionID,
			Fingerprint: fingerprint,
			IsNew:       isNew,
			HasChanged:  hasChanged,
		})

		select {
		case accepted := <-ch:
			if !accepted {
				return fmt.Errorf("host key rejected by user")
			}
			wf, err := os.OpenFile(khPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
			if err == nil {
				defer wf.Close()
				// known_hosts format: "hostname keytype base64key\n"
				fmt.Fprintf(wf, "%s %s", hostname, ssh.MarshalAuthorizedKey(key)) //nolint:errcheck
			}
			return nil
		case <-time.After(2 * time.Minute):
			return fmt.Errorf("host key verification timed out")
		}
	}
}

// RespondHostKey unblocks a pending host key verification with the user's decision.
func (a *App) RespondHostKey(sessionID string, accepted bool) {
	a.mu.Lock()
	ch, ok := a.pendingKeys[sessionID]
	a.mu.Unlock()
	if ok {
		ch <- accepted
	}
}

// ConnectHost dials SSH for the given host and returns a session ID.
func (a *App) ConnectHost(hostID string) (string, error) {
	var h Host
	var password string
	err := a.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, COALESCE(password,'') FROM hosts WHERE id = ?`, hostID,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &password)
	if err != nil {
		return "", fmt.Errorf("host not found: %w", err)
	}

	log.Info().Str("hostID", hostID).Str("hostname", h.Hostname).Str("password", password).Int("port", h.Port).Str("username", h.Username).Msg("Connecting to host")

	sessionID := uuid.New().String()

	runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
		SessionID: sessionID,
		Status:    StatusConnecting,
	})

	a.wg.Go(func() {

		var auth goph.Auth
		switch h.AuthMethod {
		case AuthPassword:
			auth = goph.Password(password)
		case AuthAgent:
			var err error
			auth, err = goph.UseAgent()
			if err != nil {
				log.Error().Err(err).Msg("SSH agent unavailable")
				runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
					SessionID: sessionID,
					Status:    StatusError,
					Error:     "SSH agent unavailable: " + err.Error(),
				})
				return
			}
		default:
			var err error
			auth, err = goph.UseAgent()
			if err != nil {
				auth = goph.Password(password)
			}
		}

		client, err := goph.NewConn(&goph.Config{
			User:     h.Username,
			Addr:     h.Hostname,
			Port:     uint(h.Port),
			Auth:     auth,
			Timeout:  goph.DefaultTimeout,
			Callback: a.hostKeyCallback(sessionID),
		})
		if err != nil {
			log.Error().Err(err).Msg("Failed to connect to host")
			runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
				SessionID: sessionID,
				Status:    StatusError,
				Error:     err.Error(),
			})
			return
		}

		sshSess, err := client.NewSession()
		if err != nil {
			client.Close()
			log.Error().Err(err).Msg("Failed to create SSH session")
			runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
				SessionID: sessionID,
				Status:    StatusError,
				Error:     err.Error(),
			})
			return
		}

		if err := sshSess.RequestPty("xterm-256color", 24, 80, ssh.TerminalModes{}); err != nil {
			sshSess.Close()
			client.Close()
			log.Error().Err(err).Msg("Failed to request PTY")
			runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
				SessionID: sessionID,
				Status:    StatusError,
				Error:     err.Error(),
			})
			return
		}

		stdin, err := sshSess.StdinPipe()
		if err != nil {
			log.Error().Err(err).Msg("Failed to get stdin pipe")
			sshSess.Close()
			client.Close()
			return
		}

		stdout, err := sshSess.StdoutPipe()
		if err != nil {
			sshSess.Close()
			client.Close()
			return
		}

		if err := sshSess.Shell(); err != nil {
			sshSess.Close()
			client.Close()
			runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
				SessionID: sessionID,
				Status:    StatusError,
				Error:     err.Error(),
			})
			return
		}

		sessCtx, cancel := context.WithCancel(context.Background())
		sess := &sshSession{
			id:        sessionID,
			hostID:    hostID,
			hostLabel: h.Label,
			client:    client,
			sshSess:   sshSess,
			stdin:     stdin,
			ctx:       sessCtx,
			cancel:    cancel,
		}

		a.mu.Lock()
		a.sessions[sessionID] = sess
		a.mu.Unlock()

		now := time.Now().UTC().Format(time.RFC3339)
		a.db.Exec(`UPDATE hosts SET last_connected_at = ? WHERE id = ?`, now, hostID) //nolint:errcheck

		runtime.EventsEmit(a.ctx, "session:status", SessionStatusEvent{
			SessionID: sessionID,
			Status:    StatusConnected,
		})

		sess.start(a.ctx, stdout)

		<-sessCtx.Done()
		sess.sftpMu.Lock()
		if sess.sftpClient != nil {
			sess.sftpClient.Close()
			sess.sftpClient = nil
		}
		sess.sftpMu.Unlock()
		sshSess.Close()
		client.Close()
		sess.wg.Wait()

		a.mu.Lock()
		delete(a.sessions, sessionID)
		a.mu.Unlock()
	})

	return sessionID, nil
}

// WriteToSession sends input data to an active SSH session.
func (a *App) WriteToSession(sessionID string, data string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
	_, err := io.WriteString(sess.stdin, data)
	return err
}

// ResizeSession updates the PTY dimensions for an active session.
func (a *App) ResizeSession(sessionID string, cols int, rows int) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return nil
	}
	return sess.sshSess.WindowChange(rows, cols)
}

// DisconnectSession terminates an active SSH session.
func (a *App) DisconnectSession(sessionID string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return nil
	}
	sess.cancel()
	return nil
}

// OpenSFTP opens an SFTP subsystem on an existing SSH session.
func (a *App) OpenSFTP(sessionID string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	defer sess.sftpMu.Unlock()

	if sess.sftpClient != nil {
		return nil // already open
	}

	sc, err := sftp.NewClient(sess.client.Client)
	if err != nil {
		return fmt.Errorf("sftp negotiation failed: %w", err)
	}
	sess.sftpClient = sc
	return nil
}

// CloseSFTP closes the SFTP subsystem for a session.
func (a *App) CloseSFTP(sessionID string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return nil
	}

	sess.sftpMu.Lock()
	defer sess.sftpMu.Unlock()

	if sess.sftpClient != nil {
		sess.sftpClient.Close()
		sess.sftpClient = nil
	}
	return nil
}

// SFTPListDir lists entries in the given remote directory, dirs first then files.
func (a *App) SFTPListDir(sessionID string, path string) ([]SFTPEntry, error) {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()

	if sc == nil {
		return nil, fmt.Errorf("sftp not open for session %s", sessionID)
	}

	// Resolve ~ to home dir
	if path == "~" {
		home, err := sc.Getwd()
		if err != nil {
			home = "/"
		}
		path = home
	}

	infos, err := sc.ReadDir(path)
	if err != nil {
		return nil, err
	}

	entries := make([]SFTPEntry, 0, len(infos))
	for _, fi := range infos {
		fullPath := path + "/" + fi.Name()
		entries = append(entries, SFTPEntry{
			Name:    fi.Name(),
			Path:    fullPath,
			IsDir:   fi.IsDir(),
			Size:    fi.Size(),
			ModTime: fi.ModTime().UTC().Format(time.RFC3339),
			Mode:    fi.Mode().String(),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})

	return entries, nil
}

// SFTPDownload opens a save dialog and downloads the remote file to the chosen path.
func (a *App) SFTPDownload(sessionID string, remotePath string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: filepath.Base(remotePath),
		Title:           "Save file",
	})
	if err != nil || localPath == "" {
		return nil // user cancelled
	}

	remoteFile, err := sc.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	stat, _ := remoteFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	buf := make([]byte, 32*1024)
	var written int64
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localFile.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(a.ctx, "sftp:progress:"+sessionID, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

// SFTPDownloadDir tars a remote directory, downloads it, and unpacks it locally.
func (a *App) SFTPDownloadDir(sessionID string, remotePath string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	// 1. Pick local destination directory
	localDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Save folder to",
	})
	if err != nil || localDir == "" {
		return nil // cancelled
	}

	// 2. Create tar.gz on remote in /tmp
	dirName := filepath.Base(remotePath)
	parentDir := filepath.Dir(remotePath)
	tempRemote := fmt.Sprintf("/tmp/shsh_%s.tar.gz", uuid.New().String())
	tarCmd := fmt.Sprintf("tar czf %s -C %s %s", tempRemote, parentDir, dirName)
	if _, err := sess.client.Run(tarCmd); err != nil {
		return fmt.Errorf("tar failed (is tar installed on remote?): %w", err)
	}

	// 3. Download tar.gz via SFTP with progress events
	remoteFile, err := sc.Open(tempRemote)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	stat, _ := remoteFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	localTmp, err := os.CreateTemp("", "shsh-*.tar.gz")
	if err != nil {
		return err
	}
	localTmpPath := localTmp.Name()
	defer os.Remove(localTmpPath)

	buf := make([]byte, 32*1024)
	var written int64
	eventKey := "sftp:progress:" + sessionID
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localTmp.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(a.ctx, eventKey, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				localTmp.Close()
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			localTmp.Close()
			return rerr
		}
	}
	localTmp.Close()

	// 4. Clean up remote temp file (best-effort)
	sess.client.Run("rm " + tempRemote) //nolint:errcheck

	// 5. Unpack tar.gz into localDir
	return extractTarGz(localTmpPath, localDir)
}

// extractTarGz unpacks a .tar.gz archive into destDir.
func extractTarGz(archivePath, destDir string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// Security: prevent path traversal
		target := filepath.Join(destDir, filepath.Clean("/"+hdr.Name))
		if !strings.HasPrefix(target, filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755) //nolint:errcheck
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755) //nolint:errcheck
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
	return nil
}

// SFTPUpload opens a file picker and uploads the chosen file to remoteDir.
func (a *App) SFTPUpload(sessionID string, remoteDir string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	localPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Upload file",
	})
	if err != nil || localPath == "" {
		return nil // user cancelled
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	stat, _ := localFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	remotePath := remoteDir + "/" + filepath.Base(localPath)
	remoteFile, err := sc.Create(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	buf := make([]byte, 32*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(a.ctx, "sftp:progress:"+sessionID, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

// SFTPMkdir creates a directory at the given remote path.
func (a *App) SFTPMkdir(sessionID string, path string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	return sc.Mkdir(path)
}

// SFTPDelete removes a file or directory at the given remote path.
func (a *App) SFTPDelete(sessionID string, path string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	fi, err := sc.Stat(path)
	if err != nil {
		return err
	}
	if fi.IsDir() {
		return sc.RemoveAll(path)
	}
	return sc.Remove(path)
}

// SFTPRename renames/moves a remote file or directory.
func (a *App) SFTPRename(sessionID string, oldPath string, newPath string) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	return sc.Rename(oldPath, newPath)
}

// ListSSHConfigHosts parses ~/.ssh/config and returns the host entries.
func (a *App) ListSSHConfigHosts() ([]SSHConfigEntry, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return []SSHConfigEntry{}, nil
	}
	cfgPath := filepath.Join(home, ".ssh", "config")
	f, err := os.Open(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []SSHConfigEntry{}, nil
		}
		return nil, err
	}
	defer f.Close()

	cfg, err := ssh_config.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("parse ssh config: %w", err)
	}

	var entries []SSHConfigEntry
	for _, host := range cfg.Hosts {
		for _, pattern := range host.Patterns {
			alias := pattern.String()
			if alias == "*" || strings.Contains(alias, "*") || strings.Contains(alias, "?") {
				continue
			}

			hostname, _ := cfg.Get(alias, "HostName")
			if hostname == "" {
				hostname = alias
			}

			portStr, _ := cfg.Get(alias, "Port")
			port := 22
			if portStr != "" {
				if p, err := strconv.Atoi(portStr); err == nil {
					port = p
				}
			}

			user, _ := cfg.Get(alias, "User")
			if user == "" {
				user = os.Getenv("USER")
			}

			entries = append(entries, SSHConfigEntry{
				Alias:    alias,
				Hostname: hostname,
				Port:     port,
				User:     user,
			})
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Alias < entries[j].Alias
	})

	if entries == nil {
		entries = []SSHConfigEntry{}
	}
	return entries, nil
}

// ImportSSHConfigHosts imports the specified aliases from ~/.ssh/config into the hosts DB.
// Skips entries that already exist (matched on hostname+port+user).
func (a *App) ImportSSHConfigHosts(aliases []string) ([]Host, error) {
	all, err := a.ListSSHConfigHosts()
	if err != nil {
		return nil, err
	}

	byAlias := make(map[string]SSHConfigEntry, len(all))
	for _, e := range all {
		byAlias[e.Alias] = e
	}

	var imported []Host
	for _, alias := range aliases {
		e, ok := byAlias[alias]
		if !ok {
			continue
		}

		var exists bool
		err := a.db.QueryRow(
			`SELECT EXISTS(SELECT 1 FROM hosts WHERE hostname=? AND port=? AND username=?)`,
			e.Hostname, e.Port, e.User,
		).Scan(&exists)
		if err != nil {
			return nil, err
		}
		if exists {
			continue
		}

		host, err := a.AddHost(CreateHostInput{
			Label:      alias,
			Hostname:   e.Hostname,
			Port:       e.Port,
			Username:   e.User,
			AuthMethod: AuthAgent,
		})
		if err != nil {
			return nil, err
		}
		imported = append(imported, host)
	}

	if imported == nil {
		imported = []Host{}
	}
	return imported, nil
}

// shutdown is called by Wails on window close. It cancels all active sessions,
// waits for all goroutines to finish, then closes the DB.
func (a *App) shutdown(_ context.Context) {
	a.mu.Lock()
	for _, sess := range a.sessions {
		sess.cancel()
	}
	a.mu.Unlock()

	a.wg.Wait()

	if a.db != nil {
		a.db.Close()
	}
}
