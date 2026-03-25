package session

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/melbahja/goph"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// ReconnectConfig holds resolved (global + per-host override) reconnect settings.
type ReconnectConfig struct {
	Enabled            bool
	MaxRetries         int
	InitialDelay       time.Duration
	MaxDelay           time.Duration
	KeepAliveInterval  time.Duration
	KeepAliveMaxMissed int
}

// ResolveReconnectConfig merges global SSH config with per-host overrides.
func ResolveReconnectConfig(ssh config.SSHConfig, host store.Host) ReconnectConfig {
	rc := ReconnectConfig{
		Enabled:            ssh.ReconnectEnabled,
		MaxRetries:         ssh.ReconnectMaxRetries,
		InitialDelay:       time.Duration(ssh.ReconnectInitialDelaySeconds) * time.Second,
		MaxDelay:           time.Duration(ssh.ReconnectMaxDelaySeconds) * time.Second,
		KeepAliveInterval:  time.Duration(ssh.KeepAliveIntervalSeconds) * time.Second,
		KeepAliveMaxMissed: ssh.KeepAliveMaxMissed,
	}

	if host.ReconnectEnabled != nil {
		rc.Enabled = *host.ReconnectEnabled
	}
	if host.ReconnectMaxRetries != nil {
		rc.MaxRetries = *host.ReconnectMaxRetries
	}
	if host.ReconnectInitialDelaySeconds != nil {
		rc.InitialDelay = time.Duration(*host.ReconnectInitialDelaySeconds) * time.Second
	}
	if host.ReconnectMaxDelaySeconds != nil {
		rc.MaxDelay = time.Duration(*host.ReconnectMaxDelaySeconds) * time.Second
	}
	if host.KeepAliveIntervalSeconds != nil {
		rc.KeepAliveInterval = time.Duration(*host.KeepAliveIntervalSeconds) * time.Second
	}
	if host.KeepAliveMaxMissed != nil {
		rc.KeepAliveMaxMissed = *host.KeepAliveMaxMissed
	}
	return rc
}

// BackoffDelay computes the delay for a given attempt using exponential backoff.
func BackoffDelay(attempt int, initial, max time.Duration) time.Duration {
	delay := initial
	for i := 0; i < attempt; i++ {
		delay *= 2
		if delay >= max {
			return max
		}
	}
	return delay
}

// resolveReconnectConfig is the package-internal alias used by Connection creation.
var resolveReconnectConfig = ResolveReconnectConfig

// startKeepAlive spawns a goroutine that sends SSH keep-alive pings.
// It calls markDead() if KeepAliveMaxMissed consecutive pings fail.
// Returns a cancel func to stop the goroutine.
func (m *Manager) startKeepAlive(conn *Connection) context.CancelFunc {
	ctx, cancel := context.WithCancel(conn.ctx)
	cfg := conn.reconnCfg

	if cfg.KeepAliveInterval <= 0 {
		return cancel
	}

	go func() {
		missed := 0
		ticker := time.NewTicker(cfg.KeepAliveInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _, err := conn.SSHClient().SendRequest("keepalive@openssh.com", true, nil)
				if err != nil {
					missed++
					if missed >= cfg.KeepAliveMaxMissed {
						m.markDead(conn)
						return
					}
				} else {
					missed = 0
				}
			}
		}
	}()

	return cancel
}

// markDead marks a connection as dead and starts the reconnect loop.
// Safe to call from multiple goroutines — only the first call takes effect.
func (m *Manager) markDead(conn *Connection) {
	conn.deadOnce.Do(func() {
		conn.mu.Lock()
		conn.state = stateReconnecting
		conn.mu.Unlock()

		conn.cancel() // cancel old connection context

		m.emitter.Emit("connection:status", ConnectionStatusEvent{
			ConnectionID: conn.id,
			Status:       StatusReconnecting,
			Attempt:      0,
			MaxRetries:   conn.reconnCfg.MaxRetries,
		})

		// Emit reconnecting for all channels on this connection
		m.mu.Lock()
		for _, ch := range m.channels {
			if ch.ConnectionID() == conn.id {
				m.emitter.Emit("channel:status", ChannelStatusEvent{
					ChannelID:    ch.ID(),
					ConnectionID: conn.id,
					Kind:         ch.Kind(),
					Status:       StatusReconnecting,
				})
			}
		}
		m.mu.Unlock()

		if !conn.reconnCfg.Enabled {
			conn.mu.Lock()
			conn.state = stateFailed
			conn.mu.Unlock()
			close(conn.reconnectDone)
			m.emitter.Emit("connection:status", ConnectionStatusEvent{
				ConnectionID: conn.id,
				Status:       StatusFailed,
				Error:        "auto-reconnect disabled",
			})
			return
		}

		go m.reconnectLoop(conn)
	})
}

// reconnectLoop attempts to re-establish the SSH connection.
func (m *Manager) reconnectLoop(conn *Connection) {
	cfg := conn.reconnCfg
	timeout := time.Duration(m.cfg.SSH.ConnectionTimeoutSeconds) * time.Second
	var lastErr error

	for attempt := range cfg.MaxRetries {
		delay := BackoffDelay(attempt, cfg.InitialDelay, cfg.MaxDelay)

		// Check if all channels have been closed (user closed tabs during reconnect)
		m.mu.Lock()
		hasChannels := false
		for _, ch := range m.channels {
			if ch.ConnectionID() == conn.id {
				hasChannels = true
				break
			}
		}
		m.mu.Unlock()
		if !hasChannels {
			conn.mu.Lock()
			conn.state = stateFailed
			conn.mu.Unlock()
			close(conn.reconnectDone)
			m.teardownConnection(conn)
			return
		}

		// Sleep with cancellation
		select {
		case <-time.After(delay):
		case <-m.ctx.Done():
			conn.mu.Lock()
			conn.state = stateFailed
			conn.mu.Unlock()
			close(conn.reconnectDone)
			return
		}

		m.emitter.Emit("connection:status", ConnectionStatusEvent{
			ConnectionID: conn.id,
			Status:       StatusReconnecting,
			Attempt:      attempt + 1,
			MaxRetries:   cfg.MaxRetries,
		})

		lastErr = m.attemptReconnect(conn, timeout)
		if lastErr == nil {
			m.onReconnected(conn)
			return
		}

		log.Warn().Err(lastErr).Str("connectionId", conn.id).Int("attempt", attempt+1).Msg("reconnect attempt failed")
	}

	// All retries exhausted
	conn.mu.Lock()
	conn.state = stateFailed
	conn.mu.Unlock()
	close(conn.reconnectDone)

	m.emitter.Emit("connection:status", ConnectionStatusEvent{
		ConnectionID: conn.id,
		Status:       StatusFailed,
		Error:        fmt.Sprintf("reconnect failed after %d attempts: %v", cfg.MaxRetries, lastErr),
		MaxRetries:   cfg.MaxRetries,
	})

	// Emit failed for all channels
	m.mu.Lock()
	for _, ch := range m.channels {
		if ch.ConnectionID() == conn.id {
			m.emitter.Emit("channel:status", ChannelStatusEvent{
				ChannelID:    ch.ID(),
				ConnectionID: conn.id,
				Kind:         ch.Kind(),
				Status:       StatusFailed,
			})
		}
	}
	m.mu.Unlock()
}

// attemptReconnect tries to re-dial the SSH connection.
func (m *Manager) attemptReconnect(conn *Connection, timeout time.Duration) error {
	var client *goph.Client
	var jumpSSHClient *ssh.Client

	hostKeyCallback := m.reconnectHostKeyCallback()

	if conn.jumpHost != nil {
		jumpAuth, err := resolveAuth(*conn.jumpHost, conn.jumpPass)
		if err != nil {
			return fmt.Errorf("jump host auth: %w", err)
		}
		jumpCfg := &ssh.ClientConfig{
			User:            conn.jumpHost.Username,
			Auth:            jumpAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         timeout,
		}
		jumpTCPConn, err := net.DialTimeout("tcp",
			net.JoinHostPort(conn.jumpHost.Hostname, strconv.Itoa(conn.jumpHost.Port)),
			timeout)
		if err != nil {
			return fmt.Errorf("dial jump host: %w", err)
		}
		jumpNCC, chans, reqs, err := ssh.NewClientConn(jumpTCPConn, conn.jumpHost.Hostname, jumpCfg)
		if err != nil {
			jumpTCPConn.Close()
			return fmt.Errorf("ssh to jump host: %w", err)
		}
		jumpSSHClient = ssh.NewClient(jumpNCC, chans, reqs)

		targetAuth, err := resolveAuth(conn.host, conn.password)
		if err != nil {
			jumpSSHClient.Close()
			return fmt.Errorf("target auth: %w", err)
		}
		targetCfg := &ssh.ClientConfig{
			User:            conn.host.Username,
			Auth:            targetAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         timeout,
		}
		tunnelConn, err := jumpSSHClient.Dial("tcp",
			net.JoinHostPort(conn.host.Hostname, strconv.Itoa(conn.host.Port)))
		if err != nil {
			jumpSSHClient.Close()
			return fmt.Errorf("dial target through jump: %w", err)
		}
		targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(tunnelConn, conn.host.Hostname, targetCfg)
		if err != nil {
			tunnelConn.Close()
			jumpSSHClient.Close()
			return fmt.Errorf("ssh to target: %w", err)
		}
		client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
	} else {
		auth, err := resolveAuth(conn.host, conn.password)
		if err != nil {
			return fmt.Errorf("auth: %w", err)
		}
		client, err = goph.NewConn(&goph.Config{
			User:     conn.host.Username,
			Addr:     conn.host.Hostname,
			Port:     uint(conn.host.Port),
			Auth:     auth,
			Timeout:  timeout,
			Callback: hostKeyCallback,
		})
		if err != nil {
			return fmt.Errorf("connect: %w", err)
		}
	}

	// Close old port forward listeners before swapping client
	conn.pfMu.Lock()
	for _, pf := range conn.portForwards {
		pf.listener.Close()
	}
	conn.pfMu.Unlock()

	// Swap client under write lock
	conn.mu.Lock()
	oldClient := conn.client
	oldJumpClient := conn.jumpClient
	conn.client = client
	conn.jumpClient = jumpSSHClient
	newCtx, cancel := context.WithCancel(context.Background())
	conn.ctx = newCtx
	conn.cancel = cancel
	conn.mu.Unlock()

	// Close old clients (best effort)
	oldClient.Close()
	if oldJumpClient != nil {
		oldJumpClient.Close()
	}

	return nil
}

// onReconnected restores channels and port forwards after a successful reconnect.
func (m *Manager) onReconnected(conn *Connection) {
	oldDone := conn.reconnectDone

	conn.mu.Lock()
	conn.state = stateConnected
	conn.deadOnce = sync.Once{}
	conn.reconnectDone = make(chan struct{})
	conn.mu.Unlock()

	close(oldDone) // unblock any ConnectOrReuse waiters

	// Restart keep-alive
	m.startKeepAlive(conn)

	// Restore terminal and SFTP channels
	m.mu.Lock()
	channels := make([]Channel, 0)
	for _, ch := range m.channels {
		if ch.ConnectionID() == conn.id {
			channels = append(channels, ch)
		}
	}
	m.mu.Unlock()

	sshClient := conn.SSHClient()
	for _, ch := range channels {
		switch c := ch.(type) {
		case *TerminalChannel:
			stdout, err := c.reopen(sshClient, m.cfg.SSH.TerminalType)
			if err != nil {
				log.Error().Err(err).Str("channelId", c.id).Msg("failed to reopen terminal channel")
				m.emitter.Emit("channel:status", ChannelStatusEvent{
					ChannelID:    c.id,
					ConnectionID: conn.id,
					Kind:         ChannelTerminal,
					Status:       StatusFailed,
					Error:        err.Error(),
				})
				continue
			}
			c.startReader(stdout, m.emitter)
			m.emitter.Emit("channel:status", ChannelStatusEvent{
				ChannelID:    c.id,
				ConnectionID: conn.id,
				Kind:         ChannelTerminal,
				Status:       StatusConnected,
			})
		case *SFTPChannel:
			if err := c.reopen(sshClient); err != nil {
				log.Error().Err(err).Str("channelId", c.id).Msg("failed to reopen SFTP channel")
				m.emitter.Emit("channel:status", ChannelStatusEvent{
					ChannelID:    c.id,
					ConnectionID: conn.id,
					Kind:         ChannelSFTP,
					Status:       StatusFailed,
					Error:        err.Error(),
				})
				continue
			}
			m.emitter.Emit("channel:status", ChannelStatusEvent{
				ChannelID:    c.id,
				ConnectionID: conn.id,
				Kind:         ChannelSFTP,
				Status:       StatusConnected,
			})
		}
	}

	// Restore port forwards — snapshot and clear old (dead) entries to avoid duplicates
	conn.pfMu.Lock()
	forwards := make([]*portForward, 0, len(conn.portForwards))
	for _, pf := range conn.portForwards {
		forwards = append(forwards, pf)
	}
	conn.portForwards = make(map[string]*portForward)
	conn.pfMu.Unlock()

	for _, pf := range forwards {
		_, err := m.AddPortForward(conn.id, pf.localPort, pf.remoteHost, pf.remotePort)
		if err != nil {
			log.Warn().Err(err).Str("connectionId", conn.id).Int("localPort", pf.localPort).Msg("failed to restore port forward")
		}
	}

	m.emitter.Emit("connection:status", ConnectionStatusEvent{
		ConnectionID: conn.id,
		Status:       StatusConnected,
	})

	log.Info().Str("connectionId", conn.id).Msg("connection reconnected successfully")
}

// reconnectHostKeyCallback returns a callback that auto-rejects changed/unknown host keys.
// During reconnect we don't prompt the user — changed keys fail the attempt.
func (m *Manager) reconnectHostKeyCallback() ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		home, _ := os.UserHomeDir()
		khPath := filepath.Join(home, ".ssh", "known_hosts")

		checker, err := knownhosts.New(khPath)
		if err != nil {
			return fmt.Errorf("known_hosts error: %w", err)
		}
		if err := checker(hostname, remote, key); err != nil {
			return fmt.Errorf("host key verification failed during reconnect: %w", err)
		}
		return nil
	}
}
