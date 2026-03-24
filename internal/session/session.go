package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"strconv"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/google/uuid"
	"github.com/melbahja/goph"
	"github.com/pkg/sftp"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// EventEmitter abstracts event delivery so session logic is not coupled to any UI framework.
type EventEmitter interface {
	Emit(topic string, data any)
}

// ansiRe strips ANSI/VT escape sequences from terminal output for log files.
var ansiRe = regexp.MustCompile(`\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07|.)`)

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

// SplitSessionResult is returned by SplitSession.
type SplitSessionResult struct {
	SessionID       string `json:"sessionId"`
	ParentSessionID string `json:"parentSessionId"`
}

type sshSession struct {
	id           string
	hostID       string
	hostLabel    string
	client       *goph.Client
	jumpClient   *ssh.Client // non-nil when connected via a jump host; closed after client
	sshSess      *ssh.Session
	stdin        io.WriteCloser
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	sftpClient   *sftp.Client
	sftpMu       sync.Mutex
	portForwards map[string]*portForward
	pfMu         sync.Mutex
	logFile      *os.File
	logMu        sync.Mutex
	logPath      string
}

func (s *sshSession) start(emitter EventEmitter, stdout io.Reader) {
	s.wg.Go(func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				emitter.Emit("session:output:"+s.id, chunk)
				s.logMu.Lock()
				if s.logFile != nil {
					s.logFile.WriteString(ansiRe.ReplaceAllString(chunk, "")) //nolint:errcheck
				}
				s.logMu.Unlock()
			}
			if err != nil {
				break
			}
		}
		s.cancel()
		// Close log file on disconnect if still open.
		s.logMu.Lock()
		if s.logFile != nil {
			fmt.Fprintf(s.logFile, "\n# Ended: %s\n", time.Now().Format("2006-01-02 15:04:05"))
			s.logFile.Close()
			s.logFile = nil
			s.logPath = ""
		}
		s.logMu.Unlock()
		emitter.Emit("session:status", StatusEvent{
			SessionID: s.id,
			Status:    StatusDisconnected,
		})
	})
}

// Manager manages SSH sessions.
type Manager struct {
	ctx         context.Context
	cfg         *config.Config
	emitter     EventEmitter
	sessions    map[string]*sshSession
	pendingKeys map[string]chan bool
	mu          sync.Mutex
	wg          sync.WaitGroup
	clientRefs  map[*goph.Client]int
	jumpRefs    map[*ssh.Client]int
}

// NewManager creates a new Manager with the given app context, config, and event emitter.
func NewManager(ctx context.Context, cfg *config.Config, emitter EventEmitter) *Manager {
	return &Manager{
		ctx:         ctx,
		cfg:         cfg,
		emitter:     emitter,
		sessions:    make(map[string]*sshSession),
		pendingKeys: make(map[string]chan bool),
		clientRefs:  make(map[*goph.Client]int),
		jumpRefs:    make(map[*ssh.Client]int),
	}
}

// incrClientRefs increments ref counts for client and jumpClient (if non-nil).
// Caller MUST hold m.mu.
func (m *Manager) incrClientRefs(client *goph.Client, jumpClient *ssh.Client) {
	m.clientRefs[client]++
	if jumpClient != nil {
		m.jumpRefs[jumpClient]++
	}
}

// releaseClient decrements ref counts and closes resources whose count hits zero.
// Caller must NOT hold m.mu. Closes are performed outside mu.
// Panics if called for a client that was never retained (programming error).
func (m *Manager) releaseClient(client *goph.Client, jumpClient *ssh.Client) {
	m.mu.Lock()
	count, ok := m.clientRefs[client]
	if !ok {
		m.mu.Unlock()
		panic(fmt.Sprintf("releaseClient: client %p was never retained", client))
	}
	count--
	if count == 0 {
		delete(m.clientRefs, client)
	} else {
		m.clientRefs[client] = count
	}
	var jumpCount int
	if jumpClient != nil {
		jCount, jOk := m.jumpRefs[jumpClient]
		if !jOk {
			m.mu.Unlock()
			panic(fmt.Sprintf("releaseClient: jumpClient %p was never retained", jumpClient))
		}
		jumpCount = jCount - 1
		if jumpCount == 0 {
			delete(m.jumpRefs, jumpClient)
		} else {
			m.jumpRefs[jumpClient] = jumpCount
		}
	}
	m.mu.Unlock()

	if count == 0 {
		client.Close()
	}
	if jumpClient != nil && jumpCount == 0 {
		jumpClient.Close()
	}
}

// resolveAuth builds a goph.Auth for the given host and secret (password or key passphrase).
func resolveAuth(host store.Host, secret string) (goph.Auth, error) {
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
		agent, err := goph.UseAgent()
		if err != nil {
			return goph.Password(secret), nil
		}
		return agent, nil
	}
}

// Connect dials SSH for the given host and returns a session ID immediately.
// When jumpHost is non-nil, the connection is tunnelled through it.
// The actual connection runs in a goroutine; onConnected is called once connected.
func (m *Manager) Connect(host store.Host, password string, jumpHost *store.Host, jumpPassword string, onConnected func()) string {
	sessionID := uuid.New().String()

	m.emitter.Emit("session:status", StatusEvent{
		SessionID: sessionID,
		Status:    StatusConnecting,
	})

	emitErr := func(msg string, err error) {
		log.Error().Err(err).Msg(msg)
		m.emitter.Emit("session:status", StatusEvent{
			SessionID: sessionID,
			Status:    StatusError,
			Error:     err.Error(),
		})
	}

	m.wg.Go(func() {
		timeout := time.Duration(m.cfg.SSH.ConnectionTimeoutSeconds) * time.Second

		var client *goph.Client
		var jumpSSHClient *ssh.Client

		if jumpHost != nil {
			// --- Jump host path ---
			jumpAuth, err := resolveAuth(*jumpHost, jumpPassword)
			if err != nil {
				emitErr("Failed to build jump host auth", err)
				return
			}

			jumpSSHConfig := &ssh.ClientConfig{
				User:            jumpHost.Username,
				Auth:            jumpAuth,
				HostKeyCallback: m.hostKeyCallback(sessionID),
				Timeout:         timeout,
			}
			jumpTCPConn, err := net.DialTimeout("tcp",
				net.JoinHostPort(jumpHost.Hostname, strconv.Itoa(jumpHost.Port)),
				timeout)
			if err != nil {
				emitErr("Failed to dial jump host", err)
				return
			}
			jumpNCC, chans, reqs, err := ssh.NewClientConn(jumpTCPConn, jumpHost.Hostname, jumpSSHConfig)
			if err != nil {
				jumpTCPConn.Close()
				emitErr("Failed to establish SSH connection to jump host", err)
				return
			}
			jumpSSHClient = ssh.NewClient(jumpNCC, chans, reqs)

			targetAuth, err := resolveAuth(host, password)
			if err != nil {
				jumpSSHClient.Close()
				emitErr("Failed to build target host auth", err)
				return
			}
			targetSSHConfig := &ssh.ClientConfig{
				User:            host.Username,
				Auth:            targetAuth,
				HostKeyCallback: m.hostKeyCallback(sessionID),
				Timeout:         timeout,
			}
			tunnelConn, err := jumpSSHClient.Dial("tcp",
				net.JoinHostPort(host.Hostname, strconv.Itoa(host.Port)))
			if err != nil {
				jumpSSHClient.Close()
				emitErr("Failed to dial target through jump host", err)
				return
			}
			targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(tunnelConn, host.Hostname, targetSSHConfig)
			if err != nil {
				tunnelConn.Close()
				jumpSSHClient.Close()
				emitErr("Failed to establish SSH connection to target via jump host", err)
				return
			}
			client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
		} else {
			// --- Direct connection path ---
			auth, err := resolveAuth(host, password)
			if err != nil {
				emitErr("Failed to build auth", err)
				return
			}
			client, err = goph.NewConn(&goph.Config{
				User:     host.Username,
				Addr:     host.Hostname,
				Port:     uint(host.Port),
				Auth:     auth,
				Timeout:  timeout,
				Callback: m.hostKeyCallback(sessionID),
			})
			if err != nil {
				emitErr("Failed to connect to host", err)
				return
			}
		}

		sshSess, err := client.NewSession()
		if err != nil {
			client.Close()
			if jumpSSHClient != nil {
				jumpSSHClient.Close()
			}
			emitErr("Failed to create SSH session", err)
			return
		}

		if err := sshSess.RequestPty(m.cfg.SSH.TerminalType, 24, 80, ssh.TerminalModes{}); err != nil {
			sshSess.Close()
			client.Close()
			if jumpSSHClient != nil {
				jumpSSHClient.Close()
			}
			emitErr("Failed to request PTY", err)
			return
		}

		stdin, err := sshSess.StdinPipe()
		if err != nil {
			sshSess.Close()
			client.Close()
			if jumpSSHClient != nil {
				jumpSSHClient.Close()
			}
			emitErr("Failed to get stdin pipe", err)
			return
		}

		stdout, err := sshSess.StdoutPipe()
		if err != nil {
			sshSess.Close()
			client.Close()
			if jumpSSHClient != nil {
				jumpSSHClient.Close()
			}
			emitErr("Failed to get stdout pipe", err)
			return
		}

		if err := sshSess.Shell(); err != nil {
			sshSess.Close()
			client.Close()
			if jumpSSHClient != nil {
				jumpSSHClient.Close()
			}
			emitErr("Failed to start shell", err)
			return
		}

		sessCtx, cancel := context.WithCancel(context.Background())
		sess := &sshSession{
			id:           sessionID,
			hostID:       host.ID,
			hostLabel:    host.Label,
			client:       client,
			jumpClient:   jumpSSHClient,
			sshSess:      sshSess,
			stdin:        stdin,
			ctx:          sessCtx,
			cancel:       cancel,
			portForwards: make(map[string]*portForward),
		}

		m.mu.Lock()
		m.incrClientRefs(client, jumpSSHClient)
		m.sessions[sessionID] = sess
		m.mu.Unlock()

		if onConnected != nil {
			onConnected()
		}

		m.emitter.Emit("session:status", StatusEvent{
			SessionID: sessionID,
			Status:    StatusConnected,
		})

		sess.start(m.emitter, stdout)

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
		m.releaseClient(client, sess.jumpClient)
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

// SplitSession opens a new PTY on the existing SSH connection for existingSessionID.
// The new session shares the underlying SSH client but has its own shell and PTY.
func (m *Manager) SplitSession(existingSessionID string) (SplitSessionResult, error) {
	m.mu.Lock()
	parent, ok := m.sessions[existingSessionID]
	if !ok {
		m.mu.Unlock()
		return SplitSessionResult{}, fmt.Errorf("session %s not found", existingSessionID)
	}
	m.incrClientRefs(parent.client, parent.jumpClient)
	parentClient := parent.client
	parentJumpClient := parent.jumpClient
	parentHostID := parent.hostID
	parentHostLabel := parent.hostLabel
	m.mu.Unlock()

	// Use the inner *ssh.Client, not the outer goph.Client wrapper.
	// This correctly targets the destination host even for jump-host connections.
	targetClient := parentClient.Client

	sshSess, err := targetClient.NewSession()
	if err != nil {
		m.releaseClient(parentClient, parentJumpClient)
		return SplitSessionResult{}, fmt.Errorf("failed to create SSH session: %w", err)
	}

	if err := sshSess.RequestPty(m.cfg.SSH.TerminalType, 24, 80, ssh.TerminalModes{}); err != nil {
		sshSess.Close()
		m.releaseClient(parentClient, parentJumpClient)
		return SplitSessionResult{}, fmt.Errorf("failed to request PTY: %w", err)
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		sshSess.Close()
		m.releaseClient(parentClient, parentJumpClient)
		return SplitSessionResult{}, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		sshSess.Close()
		m.releaseClient(parentClient, parentJumpClient)
		return SplitSessionResult{}, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := sshSess.Shell(); err != nil {
		sshSess.Close()
		m.releaseClient(parentClient, parentJumpClient)
		return SplitSessionResult{}, fmt.Errorf("failed to start shell: %w", err)
	}

	newID := uuid.New().String()
	sessCtx, cancel := context.WithCancel(context.Background())
	newSess := &sshSession{
		id:           newID,
		hostID:       parentHostID,
		hostLabel:    parentHostLabel,
		client:       parentClient,
		jumpClient:   parentJumpClient,
		sshSess:      sshSess,
		stdin:        stdin,
		ctx:          sessCtx,
		cancel:       cancel,
		portForwards: make(map[string]*portForward),
	}

	m.mu.Lock()
	m.sessions[newID] = newSess
	m.mu.Unlock()

	runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
		SessionID: newID,
		Status:    StatusConnecting,
	})

	// Start the output reader goroutine and cleanup goroutine.
	m.wg.Go(func() {
		newSess.start(m.ctx, stdout)

		runtime.EventsEmit(m.ctx, "session:status", StatusEvent{
			SessionID: newID,
			Status:    StatusConnected,
		})

		<-sessCtx.Done()
		newSess.pfMu.Lock()
		for _, pf := range newSess.portForwards {
			pf.listener.Close()
		}
		newSess.pfMu.Unlock()
		sshSess.Close()
		m.releaseClient(newSess.client, newSess.jumpClient)
		newSess.wg.Wait()

		m.mu.Lock()
		delete(m.sessions, newID)
		m.mu.Unlock()
	})

	return SplitSessionResult{
		SessionID:       newID,
		ParentSessionID: existingSessionID,
	}, nil
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

// StartSessionLog begins writing terminal output for the given session to a timestamped log file.
// Returns the path of the created log file.
func (m *Manager) StartSessionLog(sessionID string) (string, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("session %s not found", sessionID)
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.TempDir()
	}
	logsDir := filepath.Join(configDir, "shsh", "logs")
	if err := os.MkdirAll(logsDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create logs directory: %w", err)
	}

	safeName := safeFilename(sess.hostLabel)
	ts := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s_%s.log", safeName, ts, sessionID[:8])
	logPath := filepath.Join(logsDir, filename)

	f, err := os.Create(logPath)
	if err != nil {
		return "", fmt.Errorf("failed to create log file: %w", err)
	}
	fmt.Fprintf(f, "# shsh session log\n# Host: %s\n# Started: %s\n#\n",
		sess.hostLabel, time.Now().Format("2006-01-02 15:04:05"))

	sess.logMu.Lock()
	if sess.logFile != nil {
		sess.logFile.Close()
	}
	sess.logFile = f
	sess.logPath = logPath
	sess.logMu.Unlock()

	return logPath, nil
}

// StopSessionLog stops writing to the current log file for the given session.
func (m *Manager) StopSessionLog(sessionID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.logMu.Lock()
	defer sess.logMu.Unlock()
	if sess.logFile == nil {
		return nil
	}
	fmt.Fprintf(sess.logFile, "\n# Ended: %s\n", time.Now().Format("2006-01-02 15:04:05"))
	err := sess.logFile.Close()
	sess.logFile = nil
	sess.logPath = ""
	return err
}

// GetSessionLogPath returns the current log file path for a session, or empty string if not logging.
func (m *Manager) GetSessionLogPath(sessionID string) (string, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("session %s not found", sessionID)
	}
	sess.logMu.Lock()
	defer sess.logMu.Unlock()
	return sess.logPath, nil
}

// safeFilename converts a string to a safe filename component (alphanumeric + dash only).
func safeFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	result := b.String()
	if result == "" {
		return "session"
	}
	if len(result) > 40 {
		return result[:40]
	}
	return result
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

		m.emitter.Emit("session:hostkey", HostKeyEvent{
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
		case <-time.After(time.Duration(m.cfg.SSH.HostKeyVerificationTimeoutSeconds) * time.Second):
			return fmt.Errorf("host key verification timed out")
		}
	}
}
