package session

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
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

	conn.mu.RLock()
	gen := conn.generation
	conn.mu.RUnlock()

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
					m.emitDebug("network", "warn", "", conn.hostLabel,
						"keep-alive missed", map[string]any{
							"connectionId": conn.id,
							"missed":       missed,
							"maxMissed":    cfg.KeepAliveMaxMissed,
							"error":        err.Error(),
						})
					if missed >= cfg.KeepAliveMaxMissed {
						m.markDead(conn, gen)
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
// The gen parameter is the connection generation the caller was started in;
// stale calls from goroutines that outlived a reconnect cycle are ignored.
// Safe to call from multiple goroutines — the state+generation check under
// conn.mu ensures only the first valid call takes effect.
func (m *Manager) markDead(conn *Connection, gen uint64) {
	conn.mu.Lock()
	if conn.generation != gen || conn.state != stateConnected {
		curGen := conn.generation
		curState := conn.state
		conn.mu.Unlock()
		m.emitDebug("ssh", "debug", "", conn.hostLabel,
			"markDead ignored (stale or already reconnecting)", map[string]any{
				"connectionId": conn.id,
				"callerGen":    gen,
				"currentGen":   curGen,
				"state":        curState,
			})
		return
	}
	conn.state = stateReconnecting
	conn.mu.Unlock()

	m.emitDebug("ssh", "warn", "", conn.hostLabel,
		"connection marked dead, starting reconnect", map[string]any{
			"connectionId": conn.id,
			"generation":   gen,
		})

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
	result, err := Dial(DialRequest{
		Host:            conn.host,
		Password:        conn.password,
		JumpHost:        conn.jumpHost,
		JumpPassword:    conn.jumpPass,
		Timeout:         timeout,
		HostKeyCallback: m.reconnectHostKeyCallback(),
	})
	if err != nil {
		return err
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
	conn.client = result.Client
	conn.jumpClient = result.JumpClient
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
	conn.generation++
	conn.reconnectDone = make(chan struct{})
	conn.mu.Unlock()

	close(oldDone) // unblock any ConnectOrReuse waiters

	// Restore terminal and SFTP channels.
	// reopen() calls wg.Wait() which ensures old reader goroutines finish
	// before new ones start — this must happen before startKeepAlive so
	// stale goroutines cannot race with the new generation.
	m.mu.Lock()
	channels := make([]Channel, 0)
	for _, ch := range m.channels {
		if ch.ConnectionID() == conn.id {
			channels = append(channels, ch)
		}
	}
	m.mu.Unlock()

	conn.mu.RLock()
	gen := conn.generation
	conn.mu.RUnlock()

	sshClient := conn.SSHClient()
	for _, ch := range channels {
		r, ok := ch.(Reopenable)
		if !ok {
			continue
		}
		hook, err := r.Reopen(sshClient, ReopenConfig{
			TerminalType: m.cfg.SSH.TerminalType,
			MarkDead:     func() { m.markDead(conn, gen) },
			Emitter:      m.emitter,
		})
		if err != nil {
			log.Error().Err(err).Str("channelId", ch.ID()).Msg("failed to reopen channel")
			m.emitter.Emit("channel:status", ChannelStatusEvent{
				ChannelID:    ch.ID(),
				ConnectionID: conn.id,
				Kind:         ch.Kind(),
				Status:       StatusFailed,
				Error:        err.Error(),
			})
			continue
		}
		if hook != nil {
			hook()
		}
		m.emitter.Emit("channel:status", ChannelStatusEvent{
			ChannelID:    ch.ID(),
			ConnectionID: conn.id,
			Kind:         ch.Kind(),
			Status:       StatusConnected,
		})
	}

	// Start keep-alive after channels are restored so the generation is stable.
	m.startKeepAlive(conn)

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

	m.emitDebug("ssh", "info", "", conn.hostLabel,
		"connection reconnected successfully", map[string]any{
			"connectionId": conn.id,
			"generation":   gen,
		})

	log.Info().Str("connectionId", conn.id).Msg("connection reconnected successfully")
}

// RetryConnection allows manual retry after auto-reconnect fails.
func (m *Manager) RetryConnection(connectionID string) error {
	m.mu.Lock()
	conn, ok := m.connections[connectionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("connection %s not found", connectionID)
	}
	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		return fmt.Errorf("connection %s is not in failed state", connectionID)
	}

	// Reset state for new reconnect attempt
	conn.mu.Lock()
	conn.state = stateReconnecting
	conn.reconnectDone = make(chan struct{})
	conn.mu.Unlock()

	m.emitter.Emit("connection:status", ConnectionStatusEvent{
		ConnectionID: conn.id,
		Status:       StatusReconnecting,
		Attempt:      0,
		MaxRetries:   conn.reconnCfg.MaxRetries,
	})

	go m.reconnectLoop(conn)
	return nil
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
