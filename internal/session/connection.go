package session

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/google/uuid"
	"github.com/melbahja/goph"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Connection represents an SSH transport to a single host.
// Multiple channels (terminal, SFTP, port-forward) share one Connection.
type Connection struct {
	id           string
	hostID       string
	jumpHostID   string
	hostLabel    string
	client       *goph.Client
	jumpClient   *ssh.Client
	ctx          context.Context
	cancel       context.CancelFunc
	mu           sync.RWMutex
	channelRefs  int
	portForwards map[string]*portForward
	pfMu         sync.Mutex

	// Credential & config caching for reconnect
	host      store.Host
	password  string
	jumpHost  *store.Host
	jumpPass  string
	reconnCfg ReconnectConfig

	// Reconnect state
	state         connState
	reconnectDone chan struct{}
	deadOnce      sync.Once
}

type connState int

const (
	stateConnected    connState = iota
	stateReconnecting
	stateFailed
)

// connIdentity is the key used for connection reuse and in-flight dedup.
type connIdentity struct {
	hostID     string
	jumpHostID string
}

// ConnectResult is returned by ConnectOrReuse.
type ConnectResult struct {
	ConnectionID string `json:"connectionId"`
	Reused       bool   `json:"reused"`
}

// ConnHostKeyEvent is emitted when an unknown or changed host key is encountered on a connection.
type ConnHostKeyEvent struct {
	ConnectionID string `json:"connectionId"`
	Fingerprint  string `json:"fingerprint"`
	IsNew        bool   `json:"isNew"`
	HasChanged   bool   `json:"hasChanged"`
}

func (c *Connection) ID() string            { return c.id }
func (c *Connection) HostID() string         { return c.hostID }
func (c *Connection) HostLabel() string      { return c.hostLabel }
func (c *Connection) SSHClient() *ssh.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.client.Client
}

// incrRefs increments the interactive channel ref count.
func (c *Connection) incrRefs() {
	c.mu.Lock()
	c.channelRefs++
	c.mu.Unlock()
}

// decrRefs decrements the interactive channel ref count.
// Returns true if the count hit zero (caller should tear down).
func (c *Connection) decrRefs() bool {
	c.mu.Lock()
	c.channelRefs--
	shouldClose := c.channelRefs <= 0
	c.mu.Unlock()
	return shouldClose
}

// ConnectOrReuse dials a new SSH connection or returns an existing one for the
// same (hostID, jumpHostID) pair. In-flight connection attempts are deduplicated
// so that concurrent callers wait for and share the same result.
// The onConnected callback fires only for NEW connections (not reuse).
func (m *Manager) ConnectOrReuse(host store.Host, password string, jumpHost *store.Host, jumpPassword string, onConnected func()) (ConnectResult, error) {
	jumpHostID := ""
	if jumpHost != nil {
		jumpHostID = jumpHost.ID
	}
	ident := connIdentity{hostID: host.ID, jumpHostID: jumpHostID}

	// Fast path: existing connection.
	m.mu.Lock()
	if conn, ok := m.connByIdent[ident]; ok {
		conn.mu.RLock()
		state := conn.state
		done := conn.reconnectDone
		conn.mu.RUnlock()
		m.mu.Unlock()

		if state == stateReconnecting {
			select {
			case <-done:
			case <-m.ctx.Done():
				return ConnectResult{}, fmt.Errorf("manager shutting down")
			}
			// Re-read state after reconnect completes
			conn.mu.RLock()
			state = conn.state
			conn.mu.RUnlock()
			if state == stateConnected {
				return ConnectResult{ConnectionID: conn.id, Reused: true}, nil
			}
			// Reconnect failed — fall through to fresh dial
		} else if state == stateConnected {
			return ConnectResult{ConnectionID: conn.id, Reused: true}, nil
		}
		// stateFailed — fall through to fresh dial
		m.mu.Lock()
		delete(m.connByIdent, ident)
		delete(m.connections, conn.id)
		m.mu.Unlock()

		// Re-enter from the top to hit the pending/gate path cleanly
		return m.ConnectOrReuse(host, password, jumpHost, jumpPassword, onConnected)
	}

	// Check for in-flight dial.
	if gate, ok := m.pending[ident]; ok {
		m.mu.Unlock()
		// Wait for the in-flight dial to complete.
		<-gate
		// Re-check: connection should now be available.
		m.mu.Lock()
		if conn, ok := m.connByIdent[ident]; ok {
			m.mu.Unlock()
			return ConnectResult{ConnectionID: conn.id, Reused: true}, nil
		}
		m.mu.Unlock()
		return ConnectResult{}, fmt.Errorf("connection to host %s failed (waited on in-flight dial)", host.ID)
	}

	// We are the first: create a gate and dial.
	gate := make(chan struct{})
	m.pending[ident] = gate
	m.mu.Unlock()

	connectionID := uuid.New().String()

	cleanup := func() {
		m.mu.Lock()
		delete(m.pending, ident)
		m.mu.Unlock()
		close(gate)
	}

	timeout := time.Duration(m.cfg.SSH.ConnectionTimeoutSeconds) * time.Second

	var client *goph.Client
	var jumpSSHClient *ssh.Client

	if jumpHost != nil {
		// --- Jump host path ---
		jumpAuth, err := resolveAuth(*jumpHost, jumpPassword)
		if err != nil {
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to build jump host auth: %w", err)
		}

		jumpSSHConfig := &ssh.ClientConfig{
			User:            jumpHost.Username,
			Auth:            jumpAuth,
			HostKeyCallback: m.connHostKeyCallback(connectionID),
			Timeout:         timeout,
		}
		jumpTCPConn, err := net.DialTimeout("tcp",
			net.JoinHostPort(jumpHost.Hostname, strconv.Itoa(jumpHost.Port)),
			timeout)
		if err != nil {
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to dial jump host: %w", err)
		}
		jumpNCC, chans, reqs, err := ssh.NewClientConn(jumpTCPConn, jumpHost.Hostname, jumpSSHConfig)
		if err != nil {
			jumpTCPConn.Close()
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to establish SSH connection to jump host: %w", err)
		}
		jumpSSHClient = ssh.NewClient(jumpNCC, chans, reqs)

		targetAuth, err := resolveAuth(host, password)
		if err != nil {
			jumpSSHClient.Close()
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to build target host auth: %w", err)
		}
		targetSSHConfig := &ssh.ClientConfig{
			User:            host.Username,
			Auth:            targetAuth,
			HostKeyCallback: m.connHostKeyCallback(connectionID),
			Timeout:         timeout,
		}
		tunnelConn, err := jumpSSHClient.Dial("tcp",
			net.JoinHostPort(host.Hostname, strconv.Itoa(host.Port)))
		if err != nil {
			jumpSSHClient.Close()
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to dial target through jump host: %w", err)
		}
		targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(tunnelConn, host.Hostname, targetSSHConfig)
		if err != nil {
			tunnelConn.Close()
			jumpSSHClient.Close()
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to establish SSH connection to target via jump host: %w", err)
		}
		client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
	} else {
		// --- Direct connection path ---
		auth, err := resolveAuth(host, password)
		if err != nil {
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to build auth: %w", err)
		}
		client, err = goph.NewConn(&goph.Config{
			User:     host.Username,
			Addr:     host.Hostname,
			Port:     uint(host.Port),
			Auth:     auth,
			Timeout:  timeout,
			Callback: m.connHostKeyCallback(connectionID),
		})
		if err != nil {
			cleanup()
			return ConnectResult{}, fmt.Errorf("failed to connect to host: %w", err)
		}
	}

	connCtx, cancel := context.WithCancel(context.Background())
	conn := &Connection{
		id:            connectionID,
		hostID:        host.ID,
		jumpHostID:    jumpHostID,
		hostLabel:     host.Label,
		client:        client,
		jumpClient:    jumpSSHClient,
		ctx:           connCtx,
		cancel:        cancel,
		portForwards:  make(map[string]*portForward),
		host:          host,
		password:      password,
		jumpHost:      jumpHost,
		jumpPass:      jumpPassword,
		reconnCfg:     resolveReconnectConfig(m.cfg.SSH, host),
		state:         stateConnected,
		reconnectDone: make(chan struct{}),
	}

	m.mu.Lock()
	m.connections[connectionID] = conn
	m.connByIdent[ident] = conn
	delete(m.pending, ident)
	m.mu.Unlock()
	close(gate)

	m.startKeepAlive(conn)

	if onConnected != nil {
		onConnected()
	}

	log.Info().Str("connectionId", connectionID).Str("hostId", host.ID).Str("hostLabel", host.Label).Msg("new SSH connection established")

	return ConnectResult{ConnectionID: connectionID, Reused: false}, nil
}

// RespondConnHostKey unblocks a pending host key verification for a connection.
func (m *Manager) RespondConnHostKey(connectionID string, accepted bool) {
	m.mu.Lock()
	ch, ok := m.pendingConnKeys[connectionID]
	m.mu.Unlock()
	if ok {
		ch <- accepted
	}
}

// connHostKeyCallback returns an ssh.HostKeyCallback for new Connection-based dials.
// It emits "connection:hostkey" events with connectionId instead of sessionId.
func (m *Manager) connHostKeyCallback(connectionID string) ssh.HostKeyCallback {
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
		m.pendingConnKeys[connectionID] = ch
		m.mu.Unlock()
		defer func() {
			m.mu.Lock()
			delete(m.pendingConnKeys, connectionID)
			m.mu.Unlock()
		}()

		m.emitter.Emit("connection:hostkey", ConnHostKeyEvent{
			ConnectionID: connectionID,
			Fingerprint:  fingerprint,
			IsNew:        isNew,
			HasChanged:   hasChanged,
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
			// Drain any pending response to avoid blocking RespondConnHostKey
			select {
			case <-ch:
			default:
			}
			return fmt.Errorf("host key verification timed out")
		}
	}
}
