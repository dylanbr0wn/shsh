package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/melbahja/goph"
	"github.com/pkg/sftp"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"myproject/internal/store"
)

// Status represents the state of an SSH session.
type Status string

const (
	StatusConnecting   Status = "connecting"
	StatusConnected    Status = "connected"
	StatusDisconnected Status = "disconnected"
	StatusError        Status = "error"
)

// StatusEvent is emitted to the frontend when session state changes.
type StatusEvent struct {
	SessionID string `json:"sessionId"`
	Status    Status `json:"status"`
	Error     string `json:"error,omitempty"`
}

// HostKeyEvent is emitted when an unknown or changed host key is encountered.
type HostKeyEvent struct {
	SessionID   string `json:"sessionId"`
	Fingerprint string `json:"fingerprint"`
	IsNew       bool   `json:"isNew"`
	HasChanged  bool   `json:"hasChanged"`
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

type portForward struct {
	id         string
	localPort  int
	remoteHost string
	remotePort int
	listener   net.Listener
}

type sshSession struct {
	id           string
	hostID       string
	hostLabel    string
	client       *goph.Client
	sshSess      *ssh.Session
	stdin        io.WriteCloser
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	sftpClient   *sftp.Client
	sftpMu       sync.Mutex
	portForwards map[string]*portForward
	pfMu         sync.Mutex
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
		runtime.EventsEmit(appCtx, "session:status", StatusEvent{
			SessionID: s.id,
			Status:    StatusDisconnected,
		})
	})
}

// Manager manages SSH sessions.
type Manager struct {
	ctx         context.Context
	sessions    map[string]*sshSession
	pendingKeys map[string]chan bool
	mu          sync.Mutex
	wg          sync.WaitGroup
}

// NewManager creates a new Manager with the given Wails app context.
func NewManager(ctx context.Context) *Manager {
	return &Manager{
		ctx:         ctx,
		sessions:    make(map[string]*sshSession),
		pendingKeys: make(map[string]chan bool),
	}
}

// Connect dials SSH for the given host and returns a session ID immediately.
// The actual connection runs in a goroutine; onConnected is called once connected.
func (m *Manager) Connect(host store.Host, password string, onConnected func()) string {
	sessionID := uuid.New().String()

	runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
		SessionID: sessionID,
		Status:    StatusConnecting,
	})

	m.wg.Go(func() {
		var auth goph.Auth
		switch host.AuthMethod {
		case store.AuthPassword:
			auth = goph.Password(password)
		case store.AuthAgent:
			var err error
			auth, err = goph.UseAgent()
			if err != nil {
				log.Error().Err(err).Msg("SSH agent unavailable")
				runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
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
			User:     host.Username,
			Addr:     host.Hostname,
			Port:     uint(host.Port),
			Auth:     auth,
			Timeout:  goph.DefaultTimeout,
			Callback: m.hostKeyCallback(sessionID),
		})
		if err != nil {
			log.Error().Err(err).Msg("Failed to connect to host")
			runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
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
			runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
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
			runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
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
			runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
				SessionID: sessionID,
				Status:    StatusError,
				Error:     err.Error(),
			})
			return
		}

		sessCtx, cancel := context.WithCancel(context.Background())
		sess := &sshSession{
			id:           sessionID,
			hostID:       host.ID,
			hostLabel:    host.Label,
			client:       client,
			sshSess:      sshSess,
			stdin:        stdin,
			ctx:          sessCtx,
			cancel:       cancel,
			portForwards: make(map[string]*portForward),
		}

		m.mu.Lock()
		m.sessions[sessionID] = sess
		m.mu.Unlock()

		if onConnected != nil {
			onConnected()
		}

		runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
			SessionID: sessionID,
			Status:    StatusConnected,
		})

		sess.start(m.ctx, stdout)

		<-sessCtx.Done()
		sess.sftpMu.Lock()
		if sess.sftpClient != nil {
			sess.sftpClient.Close()
			sess.sftpClient = nil
		}
		sess.sftpMu.Unlock()
		sess.pfMu.Lock()
		for _, pf := range sess.portForwards {
			pf.listener.Close()
		}
		sess.pfMu.Unlock()
		sshSess.Close()
		client.Close()
		sess.wg.Wait()

		m.mu.Lock()
		delete(m.sessions, sessionID)
		m.mu.Unlock()
	})

	return sessionID
}

// Write sends input data to an active SSH session.
func (m *Manager) Write(sessionID, data string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
	_, err := io.WriteString(sess.stdin, data)
	return err
}

// Resize updates the PTY dimensions for an active session.
func (m *Manager) Resize(sessionID string, cols, rows int) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	return sess.sshSess.WindowChange(rows, cols)
}

// Disconnect terminates an active SSH session.
func (m *Manager) Disconnect(sessionID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	sess.cancel()
	return nil
}

// RespondHostKey unblocks a pending host key verification with the user's decision.
func (m *Manager) RespondHostKey(sessionID string, accepted bool) {
	m.mu.Lock()
	ch, ok := m.pendingKeys[sessionID]
	m.mu.Unlock()
	if ok {
		ch <- accepted
	}
}

// Shutdown cancels all active sessions and waits for all goroutines to finish.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	for _, sess := range m.sessions {
		sess.cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
}

// hostKeyCallback returns an ssh.HostKeyCallback implementing TOFU via ~/.ssh/known_hosts.
func (m *Manager) hostKeyCallback(sessionID string) ssh.HostKeyCallback {
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
			return nil
		}
		var keyErr *knownhosts.KeyError
		if !errors.As(checkErr, &keyErr) {
			return checkErr
		}
		isNew := len(keyErr.Want) == 0
		hasChanged := !isNew

		ch := make(chan bool, 1)
		m.mu.Lock()
		m.pendingKeys[sessionID] = ch
		m.mu.Unlock()
		defer func() {
			m.mu.Lock()
			delete(m.pendingKeys, sessionID)
			m.mu.Unlock()
		}()

		runtime.EventsEmit(m.ctx, "session:hostkey", HostKeyEvent{
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
				fmt.Fprintf(wf, "%s %s", hostname, ssh.MarshalAuthorizedKey(key)) //nolint:errcheck
			}
			return nil
		case <-time.After(2 * time.Minute):
			return fmt.Errorf("host key verification timed out")
		}
	}
}
