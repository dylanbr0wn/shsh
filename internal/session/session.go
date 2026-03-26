package session

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// EventEmitter abstracts event delivery so session logic is not coupled to any UI framework.
type EventEmitter interface {
	Emit(topic string, data any)
}

// DebugEmitter emits structured debug log entries. Optional — pass nil to disable.
type DebugEmitter interface {
	EmitDebug(category string, level string, channelID, channelLabel, message string, fields map[string]any)
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
	StatusReconnecting Status = "reconnecting"
	StatusFailed       Status = "failed"
)

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

// ConnectHostResult is returned by ConnectHost / QuickConnect / BulkConnectGroup.
type ConnectHostResult struct {
	ConnectionID string `json:"connectionId"`
	ChannelID    string `json:"channelId"`
}

// Manager manages SSH connections and channels.
type Manager struct {
	ctx     context.Context
	cfg     *config.Config
	emitter EventEmitter
	debug   DebugEmitter
	mu      sync.Mutex
	wg      sync.WaitGroup

	connections     map[string]*Connection        // connectionId -> Connection
	connByIdent     map[connIdentity]*Connection  // for reuse lookups
	channels        map[string]Channel            // channelId -> Channel
	pending         map[connIdentity]chan struct{} // in-flight connection gate
	pendingConnKeys map[string]chan bool           // connection-level host key verification
}

// NewManager creates a new Manager with the given app context, config, and event emitter.
// The debug parameter is optional — pass nil to disable debug emissions.
func NewManager(ctx context.Context, cfg *config.Config, emitter EventEmitter, debug DebugEmitter) *Manager {
	return &Manager{
		ctx:             ctx,
		cfg:             cfg,
		emitter:         emitter,
		debug:           debug,
		connections:     make(map[string]*Connection),
		connByIdent:     make(map[connIdentity]*Connection),
		channels:        make(map[string]Channel),
		pending:         make(map[connIdentity]chan struct{}),
		pendingConnKeys: make(map[string]chan bool),
	}
}

// emitDebug sends a debug log entry if a DebugEmitter is configured.
func (m *Manager) emitDebug(category string, level string, channelID, channelLabel, message string, fields map[string]any) {
	if m.debug != nil {
		m.debug.EmitDebug(category, level, channelID, channelLabel, message, fields)
	}
}

// connLabel returns the host label for a connection, or "unknown" if not found.
func (m *Manager) connLabel(connectionID string) string {
	m.mu.Lock()
	conn, ok := m.connections[connectionID]
	m.mu.Unlock()
	if ok {
		return conn.hostLabel
	}
	return "unknown"
}


// Connect dials SSH for the given host (or reuses an existing connection)
// and returns a ConnectResult. The onConnected callback fires only for new connections.
func (m *Manager) Connect(host store.Host, password string, jumpHost *store.Host, jumpPassword string, onConnected func()) (ConnectResult, error) {
	return m.ConnectOrReuse(host, password, jumpHost, jumpPassword, onConnected)
}

// Write sends input data to a terminal channel.
func (m *Manager) Write(channelId, data string) error {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("channel %s not found", channelId)
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return fmt.Errorf("channel %s is not a terminal", channelId)
	}
	tc.mu.Lock()
	_, err := io.WriteString(tc.stdin, data)
	tc.mu.Unlock()
	if err != nil {
		if conn, connErr := m.getConnection(tc.connectionID); connErr == nil {
			m.markDead(conn)
		}
	}
	return err
}

// Resize updates the PTY dimensions for a terminal channel.
func (m *Manager) Resize(channelId string, cols, rows int) error {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return nil
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.sshSess.WindowChange(rows, cols)
}

// Shutdown cancels all connections and waits for goroutines to finish.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	for _, conn := range m.connections {
		conn.cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
}

// StartSessionLog begins writing terminal output for the given channel to a timestamped log file.
func (m *Manager) StartSessionLog(channelId string) (string, error) {
	if !m.cfg.Log.SessionLoggingEnabled {
		return "", fmt.Errorf("session logging is disabled in configuration")
	}

	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("channel %s not found", channelId)
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return "", fmt.Errorf("channel %s is not a terminal", channelId)
	}

	// Get host label from connection
	m.mu.Lock()
	conn, connOk := m.connections[tc.connectionID]
	m.mu.Unlock()
	hostLabel := "unknown"
	if connOk {
		hostLabel = conn.hostLabel
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.TempDir()
	}
	logsDir := filepath.Join(configDir, "shsh", "logs")
	if err := os.MkdirAll(logsDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create logs directory: %w", err)
	}

	safeName := safeFilename(hostLabel)
	ts := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s_%s.log", safeName, ts, channelId[:8])
	logPath := filepath.Join(logsDir, filename)

	f, err := os.Create(logPath)
	if err != nil {
		return "", fmt.Errorf("failed to create log file: %w", err)
	}
	fmt.Fprintf(f, "# shsh session log\n# Host: %s\n# Started: %s\n#\n",
		hostLabel, time.Now().Format("2006-01-02 15:04:05"))

	tc.logMu.Lock()
	if tc.logFile != nil {
		tc.logFile.Close()
	}
	tc.logFile = f
	tc.logPath = logPath
	tc.logMu.Unlock()

	return logPath, nil
}

// StopSessionLog stops writing to the current log file for the given channel.
func (m *Manager) StopSessionLog(channelId string) error {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("channel %s not found", channelId)
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return fmt.Errorf("channel %s is not a terminal", channelId)
	}

	tc.logMu.Lock()
	defer tc.logMu.Unlock()
	if tc.logFile == nil {
		return nil
	}
	fmt.Fprintf(tc.logFile, "\n# Ended: %s\n", time.Now().Format("2006-01-02 15:04:05"))
	err := tc.logFile.Close()
	tc.logFile = nil
	tc.logPath = ""
	return err
}

// GetSessionLogPath returns the current log file path for a channel, or empty string if not logging.
func (m *Manager) GetSessionLogPath(channelId string) (string, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("channel %s not found", channelId)
	}
	tc, ok := ch.(*TerminalChannel)
	if !ok {
		return "", fmt.Errorf("channel %s is not a terminal", channelId)
	}
	tc.logMu.Lock()
	defer tc.logMu.Unlock()
	return tc.logPath, nil
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

// getSFTPChannel looks up an SFTPChannel by channelId.
func (m *Manager) getSFTPChannel(channelId string) (*SFTPChannel, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelId]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelId)
	}
	sc, ok := ch.(*SFTPChannel)
	if !ok {
		return nil, fmt.Errorf("channel %s is not an SFTP channel", channelId)
	}
	return sc, nil
}

// getConnection looks up a Connection by connectionId.
func (m *Manager) getConnection(connectionId string) (*Connection, error) {
	m.mu.Lock()
	conn, ok := m.connections[connectionId]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("connection %s not found", connectionId)
	}
	return conn, nil
}
