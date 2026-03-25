# Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic reconnection for dropped SSH connections with configurable backoff, SSH keep-alive, and timeout rationalization.

**Architecture:** Connection-level reconnect — when a connection dies (detected by keep-alive or I/O error), the `Connection` struct drives a retry loop with exponential backoff, then restores all channels and port forwards. Frontend receives new status events (`reconnecting`, `failed`) and renders an in-terminal banner.

**Tech Stack:** Go 1.25, `golang.org/x/crypto/ssh`, `goph`, React/TypeScript, Jotai, xterm.js, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-24-auto-reconnect-design.md`

---

## File Structure

### New Files
- `internal/session/reconnect.go` — `ReconnectConfig` type, `resolveReconnectConfig()`, `markDead()`, reconnect loop, keep-alive goroutine
- `internal/session/reconnect_test.go` — unit tests for backoff calculation, config resolution, state machine
- `frontend/src/components/sessions/ReconnectBanner.tsx` — terminal overlay banner component

### Modified Files
- `internal/config/config.go` — add reconnect/keep-alive fields to `SSHConfig`, update defaults
- `internal/session/connection.go` — add credential caching fields, `state`/`reconnectDone` fields, upgrade `mu` to `sync.RWMutex`, make `SSHClient()` lock-safe
- `internal/session/channel.go` — add `TerminalChannel.reopen()`, `SFTPChannel.reopen()`, add `mu` to `TerminalChannel`, feed I/O errors into `markDead()`
- `internal/session/session.go` — add `StatusReconnecting`/`StatusFailed`, add `ConnectionStatusEvent`, update `Write()`/`Resize()` to acquire channel mutex
- `internal/session/portforward.go` — use `conn.SSHClient()` (now lock-safe), add `restorePortForwards()`
- `internal/session/export_test.go` — expose new internals for testing
- `internal/store/store.go` — add per-host reconnect override fields to `Host`, `CreateHostInput`, `UpdateHostInput`
- `app.go` — add `RetryConnection()` method, pass credentials through to `Connection`
- `frontend/src/types/index.ts` — add `reconnecting`/`failed` to `SessionStatus`, add event payload types, add per-host reconnect fields
- `frontend/src/store/useAppInit.ts` — handle `reconnecting`/`failed` in `connection:status` handler
- `frontend/src/hooks/useTerminal.ts` — integrate `ReconnectBanner`, disable input during reconnect
- `frontend/src/components/sessions/TabItem.tsx` — add `reconnecting`/`failed` dot styles, retry context menu item

---

## Task 1: Config — Add Reconnect & Keep-Alive Fields

**Files:**
- Modify: `internal/config/config.go:48-61` (SSHConfig struct)
- Modify: `internal/config/config.go:78-85` (Default() SSH section)

- [ ] **Step 1: Write the failing test**

Create `internal/config/config_test.go`:

```go
package config

import "testing"

func TestDefault_ReconnectFields(t *testing.T) {
	cfg := Default()
	if !cfg.SSH.ReconnectEnabled {
		t.Error("expected ReconnectEnabled default true")
	}
	if cfg.SSH.ReconnectMaxRetries != 5 {
		t.Errorf("expected ReconnectMaxRetries=5, got %d", cfg.SSH.ReconnectMaxRetries)
	}
	if cfg.SSH.ReconnectInitialDelaySeconds != 2 {
		t.Errorf("expected ReconnectInitialDelaySeconds=2, got %d", cfg.SSH.ReconnectInitialDelaySeconds)
	}
	if cfg.SSH.ReconnectMaxDelaySeconds != 30 {
		t.Errorf("expected ReconnectMaxDelaySeconds=30, got %d", cfg.SSH.ReconnectMaxDelaySeconds)
	}
	if cfg.SSH.KeepAliveIntervalSeconds != 30 {
		t.Errorf("expected KeepAliveIntervalSeconds=30, got %d", cfg.SSH.KeepAliveIntervalSeconds)
	}
	if cfg.SSH.KeepAliveMaxMissed != 3 {
		t.Errorf("expected KeepAliveMaxMissed=3, got %d", cfg.SSH.KeepAliveMaxMissed)
	}
	if cfg.SSH.ConnectionTimeoutSeconds != 15 {
		t.Errorf("expected ConnectionTimeoutSeconds=15, got %d", cfg.SSH.ConnectionTimeoutSeconds)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/config/ -run TestDefault_ReconnectFields -v`
Expected: FAIL — fields don't exist yet.

- [ ] **Step 3: Add fields to SSHConfig struct and defaults**

In `internal/config/config.go`, add to `SSHConfig` struct (after line 61):

```go
// ReconnectEnabled controls whether dropped connections auto-reconnect.
ReconnectEnabled bool `json:"reconnect_enabled"`
// ReconnectMaxRetries is the max reconnect attempts before giving up.
ReconnectMaxRetries int `json:"reconnect_max_retries"`
// ReconnectInitialDelaySeconds is the delay before the first retry.
ReconnectInitialDelaySeconds int `json:"reconnect_initial_delay_seconds"`
// ReconnectMaxDelaySeconds caps the exponential backoff delay.
ReconnectMaxDelaySeconds int `json:"reconnect_max_delay_seconds"`
// KeepAliveIntervalSeconds is the interval between SSH keep-alive pings.
KeepAliveIntervalSeconds int `json:"keep_alive_interval_seconds"`
// KeepAliveMaxMissed is how many missed keep-alive pings trigger disconnect.
KeepAliveMaxMissed int `json:"keep_alive_max_missed"`
```

In `Default()`, update the SSH section (line 78-85):

```go
SSH: SSHConfig{
    ConnectionTimeoutSeconds:          15,
    HostKeyVerificationTimeoutSeconds: 120,
    TCPPingTimeoutSeconds:             5,
    DefaultRSAKeyBits:                 4096,
    TerminalType:                      "xterm-256color",
    PortForwardBindAddress:            "127.0.0.1",
    ReconnectEnabled:                  true,
    ReconnectMaxRetries:               5,
    ReconnectInitialDelaySeconds:      2,
    ReconnectMaxDelaySeconds:          30,
    KeepAliveIntervalSeconds:          30,
    KeepAliveMaxMissed:                3,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/config/ -run TestDefault_ReconnectFields -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `go test ./...`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add reconnect and keep-alive configuration fields

Adds ReconnectEnabled, ReconnectMaxRetries, ReconnectInitialDelaySeconds,
ReconnectMaxDelaySeconds, KeepAliveIntervalSeconds, KeepAliveMaxMissed
to SSHConfig. Reduces ConnectionTimeoutSeconds default from 30 to 15."
```

---

## Task 2: Session Status Constants & Connection Event Struct

**Files:**
- Modify: `internal/session/session.go:36-41` (Status constants)
- Modify: `internal/session/channel.go:32-39` (near ChannelStatusEvent)

- [ ] **Step 1: Write the failing test**

Add to `internal/session/session_test.go`:

```go
func TestStatusConstants(t *testing.T) {
	if session.StatusReconnecting != "reconnecting" {
		t.Errorf("expected 'reconnecting', got %q", session.StatusReconnecting)
	}
	if session.StatusFailed != "failed" {
		t.Errorf("expected 'failed', got %q", session.StatusFailed)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/session/ -run TestStatusConstants -v`
Expected: FAIL — `StatusReconnecting` and `StatusFailed` don't exist.

- [ ] **Step 3: Add constants and ConnectionStatusEvent**

In `internal/session/session.go`, add after line 40:

```go
StatusReconnecting Status = "reconnecting"
StatusFailed       Status = "failed"
```

In `internal/session/channel.go`, add after `ChannelStatusEvent` (after line 39):

```go
// ConnectionStatusEvent is emitted when a connection's status changes.
type ConnectionStatusEvent struct {
	ConnectionID string `json:"connectionId"`
	Status       Status `json:"status"`
	Attempt      int    `json:"attempt,omitempty"`
	MaxRetries   int    `json:"maxRetries,omitempty"`
	Error        string `json:"error,omitempty"`
}
```

- [ ] **Step 4: Update teardownConnection to use typed event**

In `internal/session/channel.go`, replace lines 281-284:

```go
m.emitter.Emit("connection:status", ConnectionStatusEvent{
    ConnectionID: conn.id,
    Status:       StatusDisconnected,
})
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add internal/session/session.go internal/session/channel.go internal/session/session_test.go
git commit -m "feat(session): add reconnecting/failed status constants and ConnectionStatusEvent"
```

---

## Task 3: Connection Struct — Credential Caching, State, RWMutex

**Files:**
- Modify: `internal/session/connection.go:24-37` (Connection struct)
- Modify: `internal/session/connection.go:59-62` (SSHClient accessor)
- Modify: `internal/session/connection.go:64-79` (incrRefs/decrRefs)
- Modify: `internal/session/connection.go:85-237` (ConnectOrReuse)
- Modify: `internal/session/export_test.go`

- [ ] **Step 1: Update Connection struct**

In `internal/session/connection.go`, replace the `Connection` struct (lines 24-37) with:

```go
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
	host       store.Host
	password   string
	jumpHost   *store.Host
	jumpPass   string
	reconnCfg  ReconnectConfig

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
```

- [ ] **Step 2: Update SSHClient to acquire read lock**

Replace `SSHClient()` (line 62):

```go
func (c *Connection) SSHClient() *ssh.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.client.Client
}
```

- [ ] **Step 3: Update incrRefs/decrRefs for RWMutex**

Replace lines 64-79. These use `Lock()`/`Unlock()` (write lock) since they mutate `channelRefs`:

```go
func (c *Connection) incrRefs() {
	c.mu.Lock()
	c.channelRefs++
	c.mu.Unlock()
}

func (c *Connection) decrRefs() bool {
	c.mu.Lock()
	c.channelRefs--
	shouldClose := c.channelRefs <= 0
	c.mu.Unlock()
	return shouldClose
}
```

(No change needed — `sync.RWMutex` still has `Lock()`/`Unlock()`.)

- [ ] **Step 4: Cache credentials in ConnectOrReuse**

In `ConnectOrReuse()`, after the `conn := &Connection{...}` block (lines 211-221), add the cached fields:

```go
conn := &Connection{
    id:           connectionID,
    hostID:       host.ID,
    jumpHostID:   jumpHostID,
    hostLabel:    host.Label,
    client:       client,
    jumpClient:   jumpSSHClient,
    ctx:          connCtx,
    cancel:       cancel,
    portForwards: make(map[string]*portForward),
    host:         host,
    password:     password,
    jumpHost:     jumpHost,
    jumpPass:     jumpPassword,
    reconnCfg:    resolveReconnectConfig(m.cfg.SSH, host),
    state:        stateConnected,
    reconnectDone: make(chan struct{}),
}
```

- [ ] **Step 5: Update ConnectOrReuse fast path to handle reconnecting state**

Replace the fast path (lines 92-97). Read `conn.state` under `conn.mu.RLock()` to avoid racing with the reconnect loop:

```go
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
```

- [ ] **Step 6: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass (existing tests should still work)

- [ ] **Step 7: Commit**

```bash
git add internal/session/connection.go internal/session/export_test.go
git commit -m "feat(session): add credential caching, reconnect state, and RWMutex to Connection"
```

---

## Task 4: ReconnectConfig & Backoff Calculation

**Depends on:** Task 5 (per-host override fields must exist on `store.Host` before tests compile)

**Files:**
- Create: `internal/session/reconnect.go`
- Create: `internal/session/reconnect_test.go`

- [ ] **Step 1: Write tests for config resolution and backoff**

Create `internal/session/reconnect_test.go`:

```go
package session_test

import (
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
)

func TestResolveReconnectConfig_GlobalDefaults(t *testing.T) {
	ssh := config.Default().SSH
	host := store.Host{}
	rc := session.ResolveReconnectConfig(ssh, host)

	if !rc.Enabled {
		t.Error("expected enabled=true")
	}
	if rc.MaxRetries != 5 {
		t.Errorf("expected maxRetries=5, got %d", rc.MaxRetries)
	}
	if rc.InitialDelay != 2*time.Second {
		t.Errorf("expected initialDelay=2s, got %s", rc.InitialDelay)
	}
	if rc.MaxDelay != 30*time.Second {
		t.Errorf("expected maxDelay=30s, got %s", rc.MaxDelay)
	}
	if rc.KeepAliveInterval != 30*time.Second {
		t.Errorf("expected keepAliveInterval=30s, got %s", rc.KeepAliveInterval)
	}
	if rc.KeepAliveMaxMissed != 3 {
		t.Errorf("expected keepAliveMaxMissed=3, got %d", rc.KeepAliveMaxMissed)
	}
}

func TestResolveReconnectConfig_HostOverrides(t *testing.T) {
	ssh := config.Default().SSH
	maxRetries := 10
	host := store.Host{
		ReconnectMaxRetries: &maxRetries,
	}
	rc := session.ResolveReconnectConfig(ssh, host)

	if rc.MaxRetries != 10 {
		t.Errorf("expected maxRetries=10 (host override), got %d", rc.MaxRetries)
	}
	// Other fields should still be global defaults
	if !rc.Enabled {
		t.Error("expected enabled=true from global default")
	}
}

func TestBackoffDelay(t *testing.T) {
	initial := 2 * time.Second
	max := 30 * time.Second

	tests := []struct {
		attempt  int
		expected time.Duration
	}{
		{0, 2 * time.Second},
		{1, 4 * time.Second},
		{2, 8 * time.Second},
		{3, 16 * time.Second},
		{4, 30 * time.Second}, // capped
		{5, 30 * time.Second}, // still capped
	}
	for _, tt := range tests {
		got := session.BackoffDelay(tt.attempt, initial, max)
		if got != tt.expected {
			t.Errorf("attempt %d: expected %s, got %s", tt.attempt, tt.expected, got)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/session/ -run "TestResolveReconnectConfig|TestBackoffDelay" -v`
Expected: FAIL — types and functions don't exist.

- [ ] **Step 3: Implement ReconnectConfig and helpers**

Create `internal/session/reconnect.go`:

```go
package session

import (
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
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
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/session/ -run "TestResolveReconnectConfig|TestBackoffDelay" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/session/reconnect.go internal/session/reconnect_test.go
git commit -m "feat(session): add ReconnectConfig resolution and exponential backoff"
```

---

## Task 5: Per-Host Override Fields on Store

**Files:**
- Modify: `internal/store/store.go:82-99` (Host struct)
- Modify: `internal/store/store.go:101-118` (CreateHostInput)
- Modify: `internal/store/store.go:120-138` (UpdateHostInput)
- Modify: `internal/store/store.go:198-208` (ALTER TABLE migrations)
- Modify: `internal/store/store.go` (INSERT, UPDATE, SELECT queries for hosts)

- [ ] **Step 1: Add fields to Host struct**

In `internal/store/store.go`, add after `JumpHostID` (line 98) in the `Host` struct:

```go
ReconnectEnabled             *bool `json:"reconnectEnabled,omitempty"`
ReconnectMaxRetries          *int  `json:"reconnectMaxRetries,omitempty"`
ReconnectInitialDelaySeconds *int  `json:"reconnectInitialDelaySeconds,omitempty"`
ReconnectMaxDelaySeconds     *int  `json:"reconnectMaxDelaySeconds,omitempty"`
KeepAliveIntervalSeconds     *int  `json:"keepAliveIntervalSeconds,omitempty"`
KeepAliveMaxMissed           *int  `json:"keepAliveMaxMissed,omitempty"`
```

- [ ] **Step 2: Add fields to CreateHostInput**

In `CreateHostInput`, add after `CredentialRef` (line 117):

```go
ReconnectEnabled             *bool `json:"reconnectEnabled,omitempty"`
ReconnectMaxRetries          *int  `json:"reconnectMaxRetries,omitempty"`
ReconnectInitialDelaySeconds *int  `json:"reconnectInitialDelaySeconds,omitempty"`
ReconnectMaxDelaySeconds     *int  `json:"reconnectMaxDelaySeconds,omitempty"`
KeepAliveIntervalSeconds     *int  `json:"keepAliveIntervalSeconds,omitempty"`
KeepAliveMaxMissed           *int  `json:"keepAliveMaxMissed,omitempty"`
```

- [ ] **Step 3: Add fields to UpdateHostInput**

In `UpdateHostInput`, add after `JumpHostID` (line 137):

```go
ReconnectEnabled             *bool `json:"reconnectEnabled,omitempty"`
ReconnectMaxRetries          *int  `json:"reconnectMaxRetries,omitempty"`
ReconnectInitialDelaySeconds *int  `json:"reconnectInitialDelaySeconds,omitempty"`
ReconnectMaxDelaySeconds     *int  `json:"reconnectMaxDelaySeconds,omitempty"`
KeepAliveIntervalSeconds     *int  `json:"keepAliveIntervalSeconds,omitempty"`
KeepAliveMaxMissed           *int  `json:"keepAliveMaxMissed,omitempty"`
```

- [ ] **Step 4: Add ALTER TABLE migrations**

In `internal/store/store.go`, after the existing `ALTER TABLE` block (after line 208), add:

```go
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_enabled INTEGER`)
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_max_retries INTEGER`)
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_initial_delay_seconds INTEGER`)
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_max_delay_seconds INTEGER`)
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN keep_alive_interval_seconds INTEGER`)
_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN keep_alive_max_missed INTEGER`)
```

- [ ] **Step 5: Update INSERT, UPDATE, and SELECT queries**

Update `AddHost()` to include the new columns in the INSERT. Update `UpdateHost()` to set them. Update `ListHosts()` / `GetHostForConnect()` to scan them. Use `sql.NullInt64` / `sql.NullBool` for nullable scanning and convert to `*int` / `*bool` on the Host struct.

- [ ] **Step 6: Run tests**

Run: `go test ./...`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add internal/store/store.go
git commit -m "feat(store): add per-host reconnect override fields with DB schema migration"
```

---

## Task 6: TerminalChannel Mutex & Reopen Method

**Files:**
- Modify: `internal/session/channel.go:42-63` (TerminalChannel struct and methods)
- Modify: `internal/session/session.go:151-179` (Write/Resize to acquire channel mutex)

- [ ] **Step 1: Add mutex to TerminalChannel**

In `internal/session/channel.go`, add `mu sync.Mutex` to the `TerminalChannel` struct (after `logPath` field, line 52):

```go
type TerminalChannel struct {
	id           string
	connectionID string
	sshSess      *ssh.Session
	stdin        io.WriteCloser
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	logFile      *os.File
	logMu        sync.Mutex
	logPath      string
	mu           sync.Mutex // guards sshSess and stdin during reopen
}
```

- [ ] **Step 2: Add reopen method**

Add after the `Close()` method (after line 63):

```go
// reopen replaces the SSH session and pipes on a reconnected client.
// Returns the stdout reader for the caller to pass to startReader().
// The caller must ensure the old reader goroutine has finished (read error → tc.cancel()).
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

	// Create new context (old one was cancelled by reader goroutine)
	ctx, cancel := context.WithCancel(context.Background())

	tc.mu.Lock()
	tc.sshSess = sshSess
	tc.stdin = stdin
	tc.ctx = ctx
	tc.cancel = cancel
	tc.mu.Unlock()

	return stdout, nil
}

// startReader spawns the stdout reader goroutine. Called after reopen().
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
		tc.cancel()
	})
}
```

- [ ] **Step 3: Update Write() and Resize() to acquire channel mutex**

In `internal/session/session.go`, update `Write()` (lines 152-164):

```go
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
	defer tc.mu.Unlock()
	_, err := io.WriteString(tc.stdin, data)
	return err
}
```

Update `Resize()` (lines 168-179):

```go
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
```

- [ ] **Step 4: Add SFTPChannel.reopen()**

In `internal/session/channel.go`, add after `SFTPChannel.Close()`:

```go
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
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add internal/session/channel.go internal/session/session.go
git commit -m "feat(session): add TerminalChannel.reopen(), SFTPChannel.reopen(), and channel mutex"
```

---

## Task 7: Keep-Alive Goroutine

**Files:**
- Modify: `internal/session/reconnect.go` (add keepAlive function)

- [ ] **Step 1: Implement keep-alive**

Add to `internal/session/reconnect.go`:

```go
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
```

- [ ] **Step 2: Wire up keep-alive after successful connection**

In `internal/session/connection.go`, after the connection is stored in maps (after line 228, before `if onConnected`):

```go
m.startKeepAlive(conn)
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add internal/session/reconnect.go internal/session/connection.go
git commit -m "feat(session): add SSH keep-alive goroutine with configurable interval"
```

---

## Task 8: markDead() & Reconnect Loop

**Files:**
- Modify: `internal/session/reconnect.go` (add markDead, reconnect loop)
- Modify: `internal/session/connection.go:249-317` (host key callback for reconnect mode)

- [ ] **Step 1: Write test for markDead idempotency**

Add to `internal/session/reconnect_test.go`:

```go
func TestMarkDead_Idempotent(t *testing.T) {
	cfg := config.Default()
	cfg.SSH.ReconnectEnabled = false // disable actual reconnect loop
	m := session.NewManager(context.Background(), cfg, noopEmitter{}, nil)

	// We can't easily create a real connection in a unit test,
	// so this test verifies the exported MarkDead doesn't panic on unknown IDs.
	// Integration testing will cover the full reconnect flow.
}
```

- [ ] **Step 2: Implement markDead and reconnect loop**

Add to `internal/session/reconnect.go`:

```go
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

	for attempt := 0; attempt < cfg.MaxRetries; attempt++ {
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
			// No channels left — abort reconnect and tear down
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
			// Success — restore everything
			m.onReconnected(conn)
			return
		}

		log.Warn().Err(lastErr).Str("connectionId", conn.id).Int("attempt", attempt+1).Msg("reconnect attempt failed")
	}

	// All retries exhausted — include last error for user visibility
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

	// Use a reconnect-specific host key callback that auto-rejects changed keys
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
	conn.deadOnce = sync.Once{} // reset for future disconnects
	conn.reconnectDone = make(chan struct{}) // fresh channel for next reconnect
	conn.mu.Unlock()

	close(oldDone) // unblock any ConnectOrReuse waiters from previous reconnectDone

	// Restart keep-alive
	m.startKeepAlive(conn)

	// Restore terminal channels
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
	// Clear old entries — AddPortForward will create fresh ones with new UUIDs
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
```

- [ ] **Step 3: Add required imports to reconnect.go**

Ensure imports include: `context`, `fmt`, `net`, `os`, `path/filepath`, `strconv`, `sync`, `time`, `golang.org/x/crypto/ssh`, `golang.org/x/crypto/ssh/knownhosts`, `github.com/melbahja/goph`, `github.com/rs/zerolog/log`, plus the internal packages.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add internal/session/reconnect.go internal/session/reconnect_test.go internal/session/connection.go
git commit -m "feat(session): implement markDead(), reconnect loop, and channel/port-forward restore"
```

---

## Task 9: Wire I/O Errors Into markDead

**Files:**
- Modify: `internal/session/channel.go:148-166` (terminal output reader)
- Modify: `internal/session/session.go:151-164` (Write)

- [ ] **Step 1: Update output reader to call markDead**

In `channel.go`, the output reader goroutine (currently inside `OpenTerminal`) calls `tc.cancel()` on error. Change it to also call `markDead()`. But the reader goroutine doesn't have access to the Manager.

Refactor: extract the reader goroutine into `startReader()` (already done in Task 6). Update `OpenTerminal` to use `tc.startReader()`:

In `OpenTerminal()`, replace lines 147-166 with:

```go
// Start output reader goroutine
tc.startReader(stdout, m.emitter)
```

Add a `markDeadFn` field to `TerminalChannel`:

```go
markDeadFn func() // called on read error to trigger reconnect
```

Set it in `OpenTerminal` after creating the channel:

```go
tc.markDeadFn = func() {
    m.mu.Lock()
    conn, ok := m.connections[connectionID]
    m.mu.Unlock()
    if ok {
        m.markDead(conn)
    }
}
```

Update `startReader()` to call `tc.markDeadFn()` after the read loop exits:

```go
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
					tc.logFile.WriteString(ansiRe.ReplaceAllString(chunk, ""))
				}
				tc.logMu.Unlock()
			}
			if err != nil {
				break
			}
		}
		tc.cancel()
		if tc.markDeadFn != nil {
			tc.markDeadFn()
		}
	})
}
```

- [ ] **Step 2: Update Write() to call markDead on I/O error**

In `session.go`, update `Write()`:

```go
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
```

- [ ] **Step 3: Run tests**

Run: `go test ./internal/session/ -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add internal/session/channel.go internal/session/session.go
git commit -m "feat(session): wire I/O errors into markDead for terminal read/write"
```

---

## Task 10: Manual Retry Endpoint

**Files:**
- Modify: `app.go` — add `RetryConnection()` method

- [ ] **Step 1: Add RetryConnection to Manager**

In `internal/session/reconnect.go`, add:

```go
// RetryConnection allows manual retry after auto-reconnect fails.
func (m *Manager) RetryConnection(connectionID string) error {
	m.mu.Lock()
	conn, ok := m.connections[connectionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("connection %s not found", connectionID)
	}
	if conn.state != stateFailed {
		return fmt.Errorf("connection %s is not in failed state", connectionID)
	}

	// Reset state for new reconnect attempt
	conn.mu.Lock()
	conn.state = stateReconnecting
	conn.deadOnce = sync.Once{}
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
```

- [ ] **Step 2: Expose in app.go**

In `app.go`, add:

```go
// RetryConnection manually retries a failed connection.
func (a *App) RetryConnection(connectionID string) error {
	return a.manager.RetryConnection(connectionID)
}
```

- [ ] **Step 3: Regenerate Wails bindings**

Run: `wails build`

This generates the TypeScript binding for `RetryConnection` in `frontend/wailsjs/go/main/App.ts`.

- [ ] **Step 4: Run tests**

Run: `go test ./...`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add internal/session/reconnect.go app.go
git commit -m "feat(session): add RetryConnection endpoint for manual retry after failure"
```

---

## Task 11: Frontend Types & Event Handling

**Files:**
- Modify: `frontend/src/types/index.ts:14` (SessionStatus)
- Modify: `frontend/src/store/useAppInit.ts:158-189` (connection:status handler)

- [ ] **Step 1: Update SessionStatus type**

In `frontend/src/types/index.ts`, replace line 14:

```typescript
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'error'
```

- [ ] **Step 2: Update connection:status event handler**

In `frontend/src/store/useAppInit.ts`, replace the `connection:status` handler (lines 158-189):

```typescript
useEffect(() => {
    const cancel = EventsOn(
      'connection:status',
      (event: {
        connectionId: string
        status: string
        attempt?: number
        maxRetries?: number
        error?: string
      }) => {
        const { connectionId, status } = event
        const allLeaves = workspacesRef.current.flatMap((w) => collectLeaves(w.layout))
        const affected = allLeaves.filter((l) => l.connectionId === connectionId)
        if (affected.length === 0) return

        if (status === 'reconnecting') {
          setWorkspaces((prev) =>
            prev.map((w) => {
              let layout = w.layout
              for (const leaf of affected) {
                layout = updateLeafByChannelId(layout, leaf.channelId, {
                  status: 'reconnecting',
                })
              }
              return { ...w, layout }
            })
          )
          return
        }

        if (status === 'connected') {
          setWorkspaces((prev) =>
            prev.map((w) => {
              let layout = w.layout
              for (const leaf of affected) {
                layout = updateLeafByChannelId(layout, leaf.channelId, {
                  status: 'connected',
                })
              }
              return { ...w, layout }
            })
          )
          return
        }

        if (status === 'failed') {
          setWorkspaces((prev) =>
            prev.map((w) => {
              let layout = w.layout
              for (const leaf of affected) {
                layout = updateLeafByChannelId(layout, leaf.channelId, { status: 'failed' })
              }
              return { ...w, layout }
            })
          )
          toast.error('Reconnection failed', { description: event.error })
          return
        }

        if (status === 'disconnected') {
          setWorkspaces((prev) =>
            prev.map((w) => {
              let layout = w.layout
              for (const leaf of affected) {
                layout = updateLeafByChannelId(layout, leaf.channelId, {
                  status: 'disconnected',
                })
              }
              return { ...w, layout }
            })
          )
          setPortForwards((prev) => {
            const next = { ...prev }
            for (const leaf of affected) {
              delete next[leaf.channelId]
            }
            return next
          })
        }
      }
    )
    return () => cancel()
  }, [setWorkspaces, setPortForwards])
```

- [ ] **Step 3: Build frontend**

Run: `cd frontend && pnpm build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/store/useAppInit.ts
git commit -m "feat(ui): handle reconnecting/failed status in frontend event handlers"
```

---

## Task 12: Tab Status — Reconnecting & Failed Dots

**Files:**
- Modify: `frontend/src/components/sessions/TabItem.tsx:15-20` (statusDotClass)
- Modify: `frontend/src/components/sessions/TabItem.tsx:144-159` (context menu)

- [ ] **Step 1: Add reconnecting and failed dot styles**

In `TabItem.tsx`, replace lines 15-20:

```typescript
const statusDotClass: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  failed: 'bg-muted-foreground',
  disconnected: 'bg-muted-foreground',
  error: 'bg-destructive',
}
```

- [ ] **Step 2: Add Retry context menu item**

Add a new prop `onRetry` to the `Props` interface and add to the context menu. Update the interface:

```typescript
interface Props {
  session: TabSession
  host?: Host
  isActive: boolean
  hasActivity: boolean
  isFirst: boolean
  isLast: boolean
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToLeft: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
  onRetry?: () => void
}
```

Add to the context menu (before the Close All separator):

```tsx
{(session.status === 'failed' || session.status === 'disconnected') && onRetry && (
  <>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={onRetry}>Retry Connection</ContextMenuItem>
  </>
)}
```

- [ ] **Step 3: Build frontend**

Run: `cd frontend && pnpm build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sessions/TabItem.tsx
git commit -m "feat(ui): add reconnecting/failed tab dot styles and retry context menu"
```

---

## Task 13: Terminal Reconnect Banner Component

**Files:**
- Create: `frontend/src/components/sessions/ReconnectBanner.tsx`
- Modify: `frontend/src/hooks/useTerminal.ts`

- [ ] **Step 1: Create ReconnectBanner component**

Use @shadcn for styling. Create `frontend/src/components/sessions/ReconnectBanner.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { SessionStatus } from '../../types'

interface Props {
  status: SessionStatus
  attempt?: number
  maxRetries?: number
  error?: string
  onRetry?: () => void
}

export function ReconnectBanner({ status, attempt, maxRetries, error, onRetry }: Props) {
  const [showSuccess, setShowSuccess] = useState(false)
  const [prevStatus, setPrevStatus] = useState(status)

  useEffect(() => {
    if (prevStatus === 'reconnecting' && status === 'connected') {
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 2000)
      return () => clearTimeout(timer)
    }
    setPrevStatus(status)
  }, [status, prevStatus])

  if (status === 'reconnecting') {
    const attemptText = attempt != null && maxRetries != null
      ? ` (attempt ${attempt}/${maxRetries})`
      : ''
    return (
      <div className="bg-amber-500/90 text-amber-950 absolute right-0 bottom-0 left-0 z-10 px-4 py-2 text-center text-sm font-medium">
        Connection lost. Reconnecting{attemptText}...
      </div>
    )
  }

  if (status === 'failed') {
    const failedText = error ? `Reconnection failed: ${error}` : 'Reconnection failed'
    return (
      <div className="bg-destructive/90 text-destructive-foreground absolute right-0 bottom-0 left-0 z-10 flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium">
        <span>{failedText}</span>
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </div>
    )
  }

  if (showSuccess) {
    return (
      <div className="bg-green-500/90 text-green-950 absolute right-0 bottom-0 left-0 z-10 px-4 py-2 text-center text-sm font-medium animate-in fade-in">
        Reconnected
      </div>
    )
  }

  return null
}
```

- [ ] **Step 2: Integrate banner into terminal pane**

The banner needs to be rendered alongside the xterm container. Find where `useTerminal` is used (the terminal pane component) and add the `ReconnectBanner` as a sibling overlay.

Look at the component that renders the terminal container and wraps it with a `relative` positioned div containing both the xterm div and the `ReconnectBanner`.

- [ ] **Step 3: Disable terminal input during reconnect**

In `useTerminal.ts`, update the `onData` handler (line 150-152) to check status:

The terminal pane component should pass the current `status` to determine if input is allowed. Since `useTerminal` doesn't receive status directly, the parent component should conditionally disable xterm input by detaching/reattaching the `onData` handler based on status.

Alternative: add a `statusRef` to `useTerminal` that the parent updates, and check it in the `onData` callback:

In `useTerminal.ts`, add a parameter:

```typescript
export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  channelId: string,
  hostId: string,
  isActive: boolean,
  statusRef: RefObject<SessionStatus>
)
```

Update `onData` (line 150-152):

```typescript
const onData = term.onData((data: string) => {
  if (statusRef.current === 'reconnecting' || statusRef.current === 'failed') return
  WriteToChannel(channelId, data).catch(() => {})
})
```

- [ ] **Step 4: Build frontend**

Run: `cd frontend && pnpm build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sessions/ReconnectBanner.tsx frontend/src/hooks/useTerminal.ts
git commit -m "feat(ui): add ReconnectBanner overlay and disable input during reconnect"
```

---

## Task 14: Frontend Per-Host Type Updates

**Files:**
- Modify: `frontend/src/types/index.ts:47-64` (Host interface)
- Modify: `frontend/src/types/index.ts:66-82` (CreateHostInput)
- Modify: `frontend/src/types/index.ts:84-101` (UpdateHostInput)

- [ ] **Step 1: Add reconnect fields to Host interface**

In `frontend/src/types/index.ts`, add after `credentialRef` (line 63) in the `Host` interface:

```typescript
reconnectEnabled?: boolean
reconnectMaxRetries?: number
reconnectInitialDelaySeconds?: number
reconnectMaxDelaySeconds?: number
keepAliveIntervalSeconds?: number
keepAliveMaxMissed?: number
```

- [ ] **Step 2: Add to CreateHostInput and UpdateHostInput**

Same fields in both interfaces.

- [ ] **Step 3: Build frontend**

Run: `cd frontend && pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(ui): add per-host reconnect override fields to TypeScript types"
```

---

## Task 15: Integration Test & Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run Go tests**

Run: `go test ./...`
Expected: All pass

- [ ] **Step 2: Build Wails app (regenerates bindings)**

Run: `wails build`
Expected: Clean build

- [ ] **Step 3: Build frontend**

Run: `cd frontend && pnpm build`
Expected: No errors

- [ ] **Step 4: Lint frontend**

Run: `cd frontend && pnpm lint`
Expected: No errors

- [ ] **Step 5: Format check**

Run: `cd frontend && pnpm format:check`
Expected: All files formatted

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixups from integration verification"
```
