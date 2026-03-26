package session

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"
)

// ChannelKind identifies the type of channel.
type ChannelKind string

const (
	ChannelTerminal ChannelKind = "terminal"
	ChannelSFTP     ChannelKind = "sftp"
	ChannelLocalFS  ChannelKind = "local"
)

// Channel is an SSH subsystem opened on a Connection.
type Channel interface {
	ID() string
	Kind() ChannelKind
	ConnectionID() string
	Close() error
}

// ChannelStatusEvent is emitted when a channel's status changes.
type ChannelStatusEvent struct {
	ChannelID    string      `json:"channelId"`
	ConnectionID string      `json:"connectionId"`
	Kind         ChannelKind `json:"kind"`
	Status       Status      `json:"status"`
	Error        string      `json:"error,omitempty"`
}

// ConnectionStatusEvent is emitted when a connection's status changes.
type ConnectionStatusEvent struct {
	ConnectionID string `json:"connectionId"`
	Status       Status `json:"status"`
	Attempt      int    `json:"attempt,omitempty"`
	MaxRetries   int    `json:"maxRetries,omitempty"`
	Error        string `json:"error,omitempty"`
}

// TerminalChannel owns an SSH session with PTY.
type TerminalChannel struct {
	id           string
	connectionID string
	mu           sync.Mutex
	sshSess      *ssh.Session
	stdin        io.WriteCloser
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	logFile      *os.File
	logMu        sync.Mutex
	logPath      string
	closing      bool   // set by Close() to distinguish intentional teardown from connection loss
	markDeadFn   func() // called on read error to trigger reconnect
}

func (t *TerminalChannel) ID() string           { return t.id }
func (t *TerminalChannel) Kind() ChannelKind    { return ChannelTerminal }
func (t *TerminalChannel) ConnectionID() string { return t.connectionID }
func (t *TerminalChannel) Close() error {
	t.mu.Lock()
	t.closing = true
	t.mu.Unlock()
	t.cancel()
	t.sshSess.Close()
	t.wg.Wait() // Wait for output reader goroutine to finish
	return nil
}

// reopen replaces the SSH session and pipes on a reconnected client.
// Returns the stdout reader for the caller to pass to startReader().
func (tc *TerminalChannel) reopen(client *ssh.Client, termType string) (io.Reader, error) {
	tc.wg.Wait() // ensure old reader goroutine is done

	sshSess, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	if err := sshSess.RequestPty(termType, 24, 80, ssh.TerminalModes{}); err != nil {
		sshSess.Close()
		return nil, fmt.Errorf("failed to request PTY: %w", err)
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		sshSess.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		sshSess.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := sshSess.Shell(); err != nil {
		sshSess.Close()
		return nil, fmt.Errorf("failed to start shell: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	tc.mu.Lock()
	tc.sshSess = sshSess
	tc.stdin = stdin
	tc.ctx = ctx
	tc.cancel = cancel
	tc.mu.Unlock()

	return stdout, nil
}

// startReader spawns the stdout reader goroutine. Called after reopen() or initial open.
func (tc *TerminalChannel) startReader(stdout io.Reader, emitter EventEmitter) {
	tc.wg.Go(func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				emitter.Emit("channel:output:"+tc.id, chunk)
				tc.logMu.Lock()
				if tc.logFile != nil {
					tc.logFile.WriteString(ansiRe.ReplaceAllString(chunk, "")) //nolint:errcheck
				}
				tc.logMu.Unlock()
			}
			if err != nil {
				break
			}
		}
		// Only signal connection death if this wasn't an intentional
		// Close() — Close() sets the closing flag before closing the
		// SSH session, so we can distinguish user teardown from real loss.
		tc.mu.Lock()
		intentional := tc.closing
		tc.mu.Unlock()
		tc.cancel()
		if !intentional && tc.markDeadFn != nil {
			tc.markDeadFn()
		}
	})
}

// SFTPChannel owns an SFTP client subsystem.
type SFTPChannel struct {
	id           string
	connectionID string
	client       *sftp.Client
	mu           sync.Mutex
}

func (s *SFTPChannel) ID() string           { return s.id }
func (s *SFTPChannel) Kind() ChannelKind    { return ChannelSFTP }
func (s *SFTPChannel) ConnectionID() string { return s.connectionID }
func (s *SFTPChannel) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil {
		err := s.client.Close()
		s.client = nil
		return err
	}
	return nil
}

// reopen replaces the SFTP client on a reconnected SSH connection.
func (sc *SFTPChannel) reopen(client *ssh.Client) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	newClient, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("sftp negotiation failed: %w", err)
	}
	sc.client = newClient
	return nil
}

// OpenTerminal opens a new PTY shell channel on the given connection.
func (m *Manager) OpenTerminal(connectionID string) (string, error) {
	m.mu.Lock()
	conn, ok := m.connections[connectionID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("connection %s not found", connectionID)
	}

	sshSess, err := conn.SSHClient().NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}

	if err := sshSess.RequestPty(m.cfg.SSH.TerminalType, 24, 80, ssh.TerminalModes{}); err != nil {
		sshSess.Close()
		return "", fmt.Errorf("failed to request PTY: %w", err)
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		sshSess.Close()
		return "", fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		sshSess.Close()
		return "", fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := sshSess.Shell(); err != nil {
		sshSess.Close()
		return "", fmt.Errorf("failed to start shell: %w", err)
	}

	channelID := uuid.New().String()
	chCtx, cancel := context.WithCancel(context.Background())
	tc := &TerminalChannel{
		id:           channelID,
		connectionID: connectionID,
		sshSess:      sshSess,
		stdin:        stdin,
		ctx:          chCtx,
		cancel:       cancel,
	}
	conn.mu.RLock()
	gen := conn.generation
	conn.mu.RUnlock()
	tc.markDeadFn = func() {
		m.markDead(conn, gen)
	}

	conn.incrRefs()

	m.mu.Lock()
	m.channels[channelID] = tc
	m.mu.Unlock()

	conn.mu.RLock()
	refs := conn.channelRefs
	conn.mu.RUnlock()

	m.emitDebug("ssh", "info", channelID, conn.hostLabel,
		"terminal channel opened", map[string]any{
			"connectionId": connectionID,
			"channelRefs":  refs,
		})

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: connectionID,
		Kind:         ChannelTerminal,
		Status:       StatusConnecting,
	})

	tc.startReader(stdout, m.emitter)

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: connectionID,
		Kind:         ChannelTerminal,
		Status:       StatusConnected,
	})

	return channelID, nil
}

// OpenSFTPChannel opens an SFTP subsystem channel on the given connection.
func (m *Manager) OpenSFTPChannel(connectionID string) (string, error) {
	m.mu.Lock()
	conn, ok := m.connections[connectionID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("connection %s not found", connectionID)
	}

	sc, err := sftp.NewClient(conn.SSHClient())
	if err != nil {
		return "", fmt.Errorf("sftp negotiation failed: %w", err)
	}

	channelID := uuid.New().String()
	sftpCh := &SFTPChannel{
		id:           channelID,
		connectionID: connectionID,
		client:       sc,
	}

	conn.incrRefs()

	m.mu.Lock()
	m.channels[channelID] = sftpCh
	m.mu.Unlock()

	log.Debug().Str("channelId", channelID).Str("connectionId", connectionID).Msg("SFTP channel opened")

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: connectionID,
		Kind:         ChannelSFTP,
		Status:       StatusConnected,
	})

	return channelID, nil
}

// CloseChannel closes a channel and decrements its connection's ref count.
// If the connection has no more interactive channels, it is torn down.
func (m *Manager) CloseChannel(channelID string) error {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("channel %s not found", channelID)
	}
	delete(m.channels, channelID)
	conn, connOk := m.connections[ch.ConnectionID()]
	m.mu.Unlock()

	if !connOk {
		log.Warn().Str("channelId", channelID).Str("connectionId", ch.ConnectionID()).Msg("channel has no matching connection (already torn down?)")
	}

	m.emitDebug("ssh", "info", channelID, m.connLabel(ch.ConnectionID()),
		"closing channel", map[string]any{
			"connectionId": ch.ConnectionID(),
			"kind":         string(ch.Kind()),
		})

	// Close the channel itself
	if err := ch.Close(); err != nil {
		log.Warn().Err(err).Str("channelId", channelID).Msg("error closing channel")
	}

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: ch.ConnectionID(),
		Kind:         ch.Kind(),
		Status:       StatusDisconnected,
	})

	// Decrement connection refs; tear down if zero
	if connOk && conn.decrRefs() {
		conn.mu.RLock()
		refs := conn.channelRefs
		conn.mu.RUnlock()
		m.emitDebug("ssh", "info", channelID, conn.hostLabel,
			"last channel closed, tearing down connection", map[string]any{
				"connectionId": conn.id,
				"channelRefs":  refs,
			})
		m.teardownConnection(conn)
	} else if connOk {
		conn.mu.RLock()
		refs := conn.channelRefs
		conn.mu.RUnlock()
		m.emitDebug("ssh", "debug", channelID, conn.hostLabel,
			"channel closed, connection still active", map[string]any{
				"connectionId": conn.id,
				"channelRefs":  refs,
			})
	}

	return nil
}

// teardownConnection closes a connection and all its port forwards.
func (m *Manager) teardownConnection(conn *Connection) {
	// The virtual local connection is a singleton that persists for app lifetime.
	if conn.id == localConnectionID {
		return
	}

	log.Info().Str("connectionId", conn.id).Msg("tearing down connection (no more channels)")

	// Close all port forwards on this connection
	conn.pfMu.Lock()
	for _, pf := range conn.portForwards {
		pf.listener.Close()
	}
	conn.pfMu.Unlock()

	// Cancel connection context
	conn.cancel()

	// Close SSH clients
	conn.client.Close()
	if conn.jumpClient != nil {
		conn.jumpClient.Close()
	}

	// Remove from maps
	m.mu.Lock()
	delete(m.connections, conn.id)
	ident := connIdentity{hostID: conn.hostID, jumpHostID: conn.jumpHostID}
	delete(m.connByIdent, ident)
	m.mu.Unlock()

	m.emitter.Emit("connection:status", ConnectionStatusEvent{
		ConnectionID: conn.id,
		Status:       StatusDisconnected,
	})
}
