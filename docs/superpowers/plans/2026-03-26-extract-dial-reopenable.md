# Extract Dial & Reopenable Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~120 lines of duplicated SSH dial logic and replace a hard-coded type switch with interface dispatch, adding test coverage for the extracted code.

**Architecture:** Extract the SSH dial sequence (direct + jump-host paths) into a stateless `Dial` function in `dial.go`. Add a `Reopenable` interface to `channel.go` so `onReconnected` uses interface dispatch instead of a type switch. Both `TerminalChannel` and `SFTPChannel` implement `Reopenable`; `LocalFSChannel` does not.

**Tech Stack:** Go, `golang.org/x/crypto/ssh`, `github.com/melbahja/goph`, `github.com/pkg/sftp`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `internal/session/dial.go` | Create | `DialRequest`, `DialResult`, `Dial` function |
| `internal/session/dial_test.go` | Create | Table-driven tests for `Dial` with in-process SSH servers |
| `internal/session/channel.go` | Modify | Add `Reopenable` interface + `ReopenConfig`; update `reopen` → `Reopen` on both channel types |
| `internal/session/connection.go` | Modify | Replace dial block in `ConnectOrReuse` with `Dial()` call |
| `internal/session/reconnect.go` | Modify | Replace dial block in `attemptReconnect` with `Dial()` call; replace type switch in `onReconnected` with `Reopenable` loop |

---

### Task 1: Create `Dial` function with direct-connect test

**Files:**
- Create: `internal/session/dial.go`
- Create: `internal/session/dial_test.go`

- [ ] **Step 1: Write `dial.go` with types and `Dial` function**

Create `internal/session/dial.go`:

```go
package session

import (
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
)

// DialRequest contains everything needed to establish an SSH connection.
type DialRequest struct {
	Host            store.Host
	Password        string
	JumpHost        *store.Host
	JumpPassword    string
	Timeout         time.Duration
	HostKeyCallback ssh.HostKeyCallback
}

// DialResult holds the established SSH clients.
type DialResult struct {
	Client     *goph.Client
	JumpClient *ssh.Client // nil for direct connections
}

// Dial establishes an SSH connection, optionally through a jump host.
// It is stateless — callers own secret lifecycle and host key callback creation.
func Dial(req DialRequest) (DialResult, error) {
	if req.JumpHost != nil {
		return dialViaJumpHost(req)
	}
	return dialDirect(req)
}

func dialDirect(req DialRequest) (DialResult, error) {
	auth, err := ResolveAuth(req.Host, req.Password)
	if err != nil {
		return DialResult{}, fmt.Errorf("failed to build auth: %w", err)
	}
	client, err := goph.NewConn(&goph.Config{
		User:     req.Host.Username,
		Addr:     req.Host.Hostname,
		Port:     uint(req.Host.Port),
		Auth:     auth,
		Timeout:  req.Timeout,
		Callback: req.HostKeyCallback,
	})
	if err != nil {
		return DialResult{}, fmt.Errorf("failed to connect to host: %w", err)
	}
	return DialResult{Client: client}, nil
}

func dialViaJumpHost(req DialRequest) (DialResult, error) {
	jumpHost := req.JumpHost

	jumpAuth, err := ResolveAuth(*jumpHost, req.JumpPassword)
	if err != nil {
		return DialResult{}, fmt.Errorf("failed to build jump host auth: %w", err)
	}

	jumpCfg := &ssh.ClientConfig{
		User:            jumpHost.Username,
		Auth:            jumpAuth,
		HostKeyCallback: req.HostKeyCallback,
		Timeout:         req.Timeout,
	}

	jumpTCPConn, err := net.DialTimeout("tcp",
		net.JoinHostPort(jumpHost.Hostname, strconv.Itoa(jumpHost.Port)),
		req.Timeout)
	if err != nil {
		return DialResult{}, fmt.Errorf("failed to dial jump host: %w", err)
	}

	jumpNCC, chans, reqs, err := ssh.NewClientConn(jumpTCPConn, jumpHost.Hostname, jumpCfg)
	if err != nil {
		jumpTCPConn.Close()
		return DialResult{}, fmt.Errorf("failed to establish SSH connection to jump host: %w", err)
	}
	jumpClient := ssh.NewClient(jumpNCC, chans, reqs)

	targetAuth, err := ResolveAuth(req.Host, req.Password)
	if err != nil {
		jumpClient.Close()
		return DialResult{}, fmt.Errorf("failed to build target host auth: %w", err)
	}

	targetCfg := &ssh.ClientConfig{
		User:            req.Host.Username,
		Auth:            targetAuth,
		HostKeyCallback: req.HostKeyCallback,
		Timeout:         req.Timeout,
	}

	tunnelConn, err := jumpClient.Dial("tcp",
		net.JoinHostPort(req.Host.Hostname, strconv.Itoa(req.Host.Port)))
	if err != nil {
		jumpClient.Close()
		return DialResult{}, fmt.Errorf("failed to dial target through jump host: %w", err)
	}

	targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(tunnelConn, req.Host.Hostname, targetCfg)
	if err != nil {
		tunnelConn.Close()
		jumpClient.Close()
		return DialResult{}, fmt.Errorf("failed to establish SSH connection to target via jump host: %w", err)
	}

	client := &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
	return DialResult{Client: client, JumpClient: jumpClient}, nil
}
```

- [ ] **Step 2: Write the direct-connect success test**

Create `internal/session/dial_test.go`:

```go
package session_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
	"golang.org/x/crypto/ssh"
)

// newTestSSHServer starts an in-process SSH server on a random port.
// It accepts password auth with the given password. Returns the listener
// and a cleanup function.
func newTestSSHServer(t *testing.T, password string) (net.Listener, ssh.Signer) {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}

	serverCfg := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if conn.User() == "testuser" && string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("auth failed")
		},
	}
	serverCfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return // listener closed
			}
			go handleTestSSHConn(conn, serverCfg)
		}
	}()

	return ln, signer
}

func handleTestSSHConn(c net.Conn, cfg *ssh.ServerConfig) {
	defer c.Close()
	_, chans, reqs, err := ssh.NewServerConn(c, cfg)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for newCh := range chans {
		ch, _, _ := newCh.Accept()
		if ch != nil {
			ch.Close()
		}
	}
}

func hostKeyCallback(signer ssh.Signer) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != ssh.FingerprintSHA256(signer.PublicKey()) {
			return fmt.Errorf("host key mismatch")
		}
		return nil
	}
}

func TestDial_DirectSuccess(t *testing.T) {
	ln, signer := newTestSSHServer(t, "secret")
	defer ln.Close()

	host, port := splitHostPort(t, ln.Addr().String())

	result, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password:        "secret",
		Timeout:         5 * time.Second,
		HostKeyCallback: hostKeyCallback(signer),
	})
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer result.Client.Close()

	if result.Client == nil {
		t.Fatal("expected non-nil Client")
	}
	if result.JumpClient != nil {
		t.Fatal("expected nil JumpClient for direct connection")
	}
}

func splitHostPort(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatal(err)
	}
	return host, port
}
```

Note: add `"fmt"` and `"strconv"` to the imports.

Full import block for `dial_test.go`:

```go
import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
	"golang.org/x/crypto/ssh"
)
```

- [ ] **Step 3: Run the test**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go test ./internal/session/... -run TestDial_DirectSuccess -v -race -timeout 30s`

Expected: PASS

- [ ] **Step 4: Write the direct-connect auth failure test**

Add to `dial_test.go`:

```go
func TestDial_DirectAuthFailure(t *testing.T) {
	ln, signer := newTestSSHServer(t, "secret")
	defer ln.Close()

	host, port := splitHostPort(t, ln.Addr().String())

	_, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password:        "wrong-password",
		Timeout:         5 * time.Second,
		HostKeyCallback: hostKeyCallback(signer),
	})
	if err == nil {
		t.Fatal("expected error for bad password")
	}
}
```

- [ ] **Step 5: Run all Dial tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go test ./internal/session/... -run TestDial -v -race -timeout 30s`

Expected: PASS (both tests)

- [ ] **Step 6: Write jump-host tests**

Add to `dial_test.go`:

```go
// newForwardingSSHServer starts an SSH server that supports direct-tcpip channel forwarding.
func newForwardingSSHServer(t *testing.T, password string) (net.Listener, ssh.Signer) {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}

	serverCfg := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if conn.User() == "testuser" && string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("auth failed")
		},
	}
	serverCfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleForwardingSSHConn(conn, serverCfg)
		}
	}()

	return ln, signer
}

func handleForwardingSSHConn(c net.Conn, cfg *ssh.ServerConfig) {
	defer c.Close()
	srvConn, chans, reqs, err := ssh.NewServerConn(c, cfg)
	if err != nil {
		return
	}
	_ = srvConn
	go ssh.DiscardRequests(reqs)
	for newCh := range chans {
		switch newCh.ChannelType() {
		case "direct-tcpip":
			// Parse the extra data to get the target address
			var payload struct {
				DestAddr string
				DestPort uint32
				SrcAddr  string
				SrcPort  uint32
			}
			if err := ssh.Unmarshal(newCh.ExtraData(), &payload); err != nil {
				newCh.Reject(ssh.UnknownChannelType, "bad payload")
				continue
			}
			ch, _, _ := newCh.Accept()
			if ch == nil {
				continue
			}
			target := net.JoinHostPort(payload.DestAddr, strconv.Itoa(int(payload.DestPort)))
			targetConn, err := net.DialTimeout("tcp", target, 5*time.Second)
			if err != nil {
				ch.Close()
				continue
			}
			go func() {
				defer ch.Close()
				defer targetConn.Close()
				go func() {
					io.Copy(ch, targetConn)
				}()
				io.Copy(targetConn, ch)
			}()
		default:
			ch, _, _ := newCh.Accept()
			if ch != nil {
				ch.Close()
			}
		}
	}
}

func TestDial_JumpHostSuccess(t *testing.T) {
	// Start target server
	targetLn, targetSigner := newTestSSHServer(t, "target-pass")
	defer targetLn.Close()

	// Start jump server that forwards direct-tcpip
	jumpLn, jumpSigner := newForwardingSSHServer(t, "jump-pass")
	defer jumpLn.Close()

	jumpHost, jumpPort := splitHostPort(t, jumpLn.Addr().String())
	targetHost, targetPort := splitHostPort(t, targetLn.Addr().String())

	// Use a callback that accepts both signers
	callback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		if fp == ssh.FingerprintSHA256(jumpSigner.PublicKey()) ||
			fp == ssh.FingerprintSHA256(targetSigner.PublicKey()) {
			return nil
		}
		return fmt.Errorf("unknown host key")
	}

	jumpHostEntry := store.Host{
		Hostname:   jumpHost,
		Port:       jumpPort,
		Username:   "testuser",
		AuthMethod: store.AuthPassword,
	}
	result, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   targetHost,
			Port:       targetPort,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password:        "target-pass",
		JumpHost:        &jumpHostEntry,
		JumpPassword:    "jump-pass",
		Timeout:         5 * time.Second,
		HostKeyCallback: callback,
	})
	if err != nil {
		t.Fatalf("Dial via jump host failed: %v", err)
	}
	defer result.Client.Close()
	defer result.JumpClient.Close()

	if result.Client == nil {
		t.Fatal("expected non-nil Client")
	}
	if result.JumpClient == nil {
		t.Fatal("expected non-nil JumpClient")
	}
}

func TestDial_JumpHostTCPFailure(t *testing.T) {
	// Use a port with nothing listening
	_, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       1,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password: "pass",
		JumpHost: &store.Host{
			Hostname:   "127.0.0.1",
			Port:       1, // nothing listening
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    "pass",
		Timeout:         1 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err == nil {
		t.Fatal("expected error for unreachable jump host")
	}
	if !strings.Contains(err.Error(), "failed to dial jump host") {
		t.Fatalf("expected 'failed to dial jump host' in error, got: %v", err)
	}
}

func TestDial_JumpHostSSHFailure(t *testing.T) {
	// Start a TCP listener that doesn't speak SSH
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.Close() // close immediately — not an SSH server
		}
	}()

	host, port := splitHostPort(t, ln.Addr().String())

	_, err = session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       1,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password: "pass",
		JumpHost: &store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    "pass",
		Timeout:         2 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err == nil {
		t.Fatal("expected error for non-SSH jump host")
	}
	if !strings.Contains(err.Error(), "failed to establish SSH connection to jump host") {
		t.Fatalf("expected SSH connection error, got: %v", err)
	}
}

func TestDial_TargetViaJumpFailure(t *testing.T) {
	// Start a jump host that forwards, but target is unreachable
	jumpLn, jumpSigner := newForwardingSSHServer(t, "jump-pass")
	defer jumpLn.Close()

	jumpHost, jumpPort := splitHostPort(t, jumpLn.Addr().String())

	jumpHostEntry := store.Host{
		Hostname:   jumpHost,
		Port:       jumpPort,
		Username:   "testuser",
		AuthMethod: store.AuthPassword,
	}
	_, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       1, // nothing listening
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password:        "pass",
		JumpHost:        &jumpHostEntry,
		JumpPassword:    "jump-pass",
		Timeout:         2 * time.Second,
		HostKeyCallback: hostKeyCallback(jumpSigner),
	})
	if err == nil {
		t.Fatal("expected error for unreachable target via jump")
	}
	if !strings.Contains(err.Error(), "failed to dial target through jump host") {
		t.Fatalf("expected target dial error, got: %v", err)
	}
}
```

Note: add `"io"` and `"strings"` to the imports.

Full import block for `dial_test.go` (final):

```go
import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
	"golang.org/x/crypto/ssh"
)
```

- [ ] **Step 7: Run all Dial tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go test ./internal/session/... -run TestDial -v -race -timeout 60s`

Expected: All 6 tests PASS

- [ ] **Step 8: Run full test suite**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go test ./internal/... -race -timeout 60s`

Expected: PASS (no regressions — `Dial` isn't called by anything yet)

- [ ] **Step 9: Commit**

```bash
git add internal/session/dial.go internal/session/dial_test.go
git commit -m "feat(session): add Dial function with table-driven tests

Extract SSH dial logic (direct + jump-host paths) into a stateless
Dial function. This is the first half of #47 — callers are not yet
updated to use it.

Closes #47 (partial)"
```

---

### Task 2: Add `Reopenable` interface and update channel types

**Files:**
- Modify: `internal/session/channel.go:25-31` (add interface), `81-123` (TerminalChannel.reopen), `179-189` (SFTPChannel.reopen)

- [ ] **Step 1: Add `Reopenable` interface and `ReopenConfig` to `channel.go`**

After the existing `Channel` interface (line 31), add:

```go
// Reopenable is implemented by channels that can restore themselves on a new SSH connection.
type Reopenable interface {
	Channel
	Reopen(client *ssh.Client, cfg ReopenConfig) (postHook func(), err error)
}

// ReopenConfig provides dependencies needed by channels during reconnect.
type ReopenConfig struct {
	TerminalType string
	MarkDead     func()
	Emitter      EventEmitter
}
```

- [ ] **Step 2: Update `TerminalChannel.reopen` → `Reopen` with new signature**

Replace `internal/session/channel.go` lines 81-123. The old signature:

```go
func (tc *TerminalChannel) reopen(client *ssh.Client, termType string) (io.Reader, error) {
```

becomes:

```go
// Reopen replaces the SSH session and pipes on a reconnected client.
func (tc *TerminalChannel) Reopen(client *ssh.Client, cfg ReopenConfig) (func(), error) {
	tc.wg.Wait() // ensure old reader goroutine is done

	sshSess, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	if err := sshSess.RequestPty(cfg.TerminalType, 24, 80, ssh.TerminalModes{}); err != nil {
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
	tc.markDeadFn = cfg.MarkDead
	tc.mu.Unlock()

	return func() { tc.startReader(stdout, cfg.Emitter) }, nil
}
```

- [ ] **Step 3: Update `SFTPChannel.reopen` → `Reopen` with new signature**

Replace `internal/session/channel.go` lines 179-189. The old signature:

```go
func (sc *SFTPChannel) reopen(client *ssh.Client) error {
```

becomes:

```go
// Reopen replaces the SFTP client on a reconnected SSH connection.
func (sc *SFTPChannel) Reopen(client *ssh.Client, cfg ReopenConfig) (func(), error) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	newClient, err := sftp.NewClient(client)
	if err != nil {
		return nil, fmt.Errorf("sftp negotiation failed: %w", err)
	}
	sc.client = newClient
	return nil, nil
}
```

- [ ] **Step 4: Verify it compiles (callers still use old names — expect errors in reconnect.go)**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go vet ./internal/session/...`

Expected: Compile errors in `reconnect.go` referencing `c.reopen` — this is expected and will be fixed in Task 4.

- [ ] **Step 5: Commit (will not compile until Task 4, but the channel changes are self-contained)**

```bash
git add internal/session/channel.go
git commit -m "refactor(session): add Reopenable interface and update channel Reopen signatures

Add Reopenable interface with ReopenConfig. Rename reopen -> Reopen on
TerminalChannel and SFTPChannel with unified signatures. TerminalChannel
now sets markDeadFn inside Reopen and returns startReader as postHook.

Part of #47"
```

---

### Task 3: Wire `Dial` into `ConnectOrReuse`

**Files:**
- Modify: `internal/session/connection.go:187-265`

- [ ] **Step 1: Replace the dial block in `ConnectOrReuse`**

Replace lines 187-265 of `connection.go` (from `var client *goph.Client` through the closing `}` of the else block) with:

```go
	var client *goph.Client
	var jumpSSHClient *ssh.Client

	result, err := Dial(DialRequest{
		Host:            host,
		Password:        password,
		JumpHost:        jumpHost,
		JumpPassword:    jumpPassword,
		Timeout:         timeout,
		HostKeyCallback: m.connHostKeyCallback(connectionID),
	})
	if err != nil {
		cleanup()
		return ConnectResult{}, err
	}
	client = result.Client
	jumpSSHClient = result.JumpClient
```

- [ ] **Step 2: Remove unused imports from `connection.go`**

After the replacement, these imports are no longer needed in `connection.go`:
- `"strconv"` (used only in the dial block for `strconv.Itoa`)

Keep: `"net"` (still used by `connHostKeyCallback`), `"golang.org/x/crypto/ssh"` (still used), `"github.com/melbahja/goph"` (still used for `goph.Client` type).

Check if `"strconv"` is used elsewhere in the file before removing. If `connHostKeyCallback` or other code uses it, keep it.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go build ./internal/session/...`

Expected: Compile errors only in `reconnect.go` (old `c.reopen` calls). `connection.go` should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add internal/session/connection.go
git commit -m "refactor(session): use Dial in ConnectOrReuse

Replace ~75-line dial block with a single Dial() call. Host key
callback differences preserved — ConnectOrReuse passes
connHostKeyCallback (interactive).

Part of #47"
```

---

### Task 4: Wire `Dial` and `Reopenable` into reconnect path

**Files:**
- Modify: `internal/session/reconnect.go:278-482`

- [ ] **Step 1: Replace the dial block in `attemptReconnect`**

Replace lines 278-348 of `reconnect.go` (the full `attemptReconnect` body from `var client` through the end of the else block, before the port-forward cleanup) with:

```go
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
```

- [ ] **Step 2: Replace the type switch in `onReconnected` with `Reopenable` dispatch**

Replace lines 407-449 (the `for _, ch := range channels` loop with the type switch) with:

```go
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
```

- [ ] **Step 3: Remove unused imports from `reconnect.go`**

After the replacement, these imports are no longer needed in `reconnect.go`:
- `"strconv"` (was used in dial block for port formatting)
- `"github.com/melbahja/goph"` (was used for `goph.Client` and `goph.NewConn`)

Keep: `"net"` (still used by `reconnectHostKeyCallback`), `"golang.org/x/crypto/ssh"` (still used), `"github.com/dylanbr0wn/shsh/internal/store"` (check if still used — it was used in `ResolveAuth` calls which are now in `Dial`; if no other references, remove).

Check each import for remaining usage before removing.

- [ ] **Step 4: Verify everything compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go build ./internal/session/...`

Expected: Clean compile — no errors.

- [ ] **Step 5: Run `go vet`**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go vet ./internal/session/...`

Expected: Clean — no warnings.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial && go test ./internal/... -race -timeout 60s`

Expected: All tests PASS (including new `Dial` tests and existing reconnect config tests).

- [ ] **Step 7: Commit**

```bash
git add internal/session/reconnect.go
git commit -m "refactor(session): use Dial and Reopenable in reconnect path

Replace ~70-line dial block in attemptReconnect with Dial() call.
Replace type switch in onReconnected with Reopenable interface dispatch.
Generation counter protocol preserved.

Closes #47"
```

---

### Task 5: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run Go checks**

```bash
cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial
go vet ./internal/...
go test ./internal/... -race -timeout 60s
go mod tidy && git diff --exit-code go.mod go.sum
```

Expected: All clean.

- [ ] **Step 2: Run frontend checks**

```bash
cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial/frontend
pnpm build
```

Expected: Clean build — no frontend files were changed.

- [ ] **Step 3: Run govulncheck**

```bash
cd /Users/dylan/.superset/worktrees/shsh/feat/extract-dial
govulncheck ./...
```

Expected: No new vulnerabilities.
