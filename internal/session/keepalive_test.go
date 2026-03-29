package session

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestStartKeepAlive_MissedPingsCallMarkDead(t *testing.T) {
	ks := newKillableSSHServer(t, "pass")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, cb := hostFromKillable(t, ks)

	dr, err := Dial(DialRequest{
		Host:            host,
		Password:        "pass",
		Timeout:         5 * time.Second,
		HostKeyCallback: cb,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn := &Connection{
		id:        "conn-keepalive",
		hostID:    host.ID,
		hostLabel: host.Label,
		host:      host,
		password:  "pass",
		client:    dr.Client,
		ctx:       ctx,
		cancel:    cancel,
		state:     stateConnected,
		reconnCfg: ReconnectConfig{
			Enabled:            false, // so markDead goes straight to stateFailed
			KeepAliveInterval:  50 * time.Millisecond,
			KeepAliveMaxMissed: 2,
		},
		generation:    0,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.mu.Unlock()

	// Kill the server so keepalive pings fail.
	ks.Kill()

	kaCancel := m.startKeepAlive(conn)
	defer kaCancel()

	// Wait for missed pings to accumulate and trigger markDead.
	deadline := time.After(2 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for stateFailed")
		case <-ticker.C:
			conn.mu.RLock()
			state := conn.state
			conn.mu.RUnlock()
			if state == stateFailed {
				return // success
			}
		}
	}
}

// addToKnownHosts writes the server's host key into a temp known_hosts file
// and sets HOME so that reconnectHostKeyCallback (which reads ~/.ssh/known_hosts)
// uses the temp file instead of the real one.
func addToKnownHosts(t *testing.T, addr string, signer ssh.Signer) {
	t.Helper()
	tmpHome := t.TempDir()
	sshDir := filepath.Join(tmpHome, ".ssh")
	os.MkdirAll(sshDir, 0700) //nolint:errcheck

	host, port, _ := net.SplitHostPort(addr)
	// knownhosts uses [host]:port format for non-standard ports.
	var hostname string
	if port == "22" {
		hostname = host
	} else {
		hostname = fmt.Sprintf("[%s]:%s", host, port)
	}
	line := fmt.Sprintf("%s %s", hostname, ssh.MarshalAuthorizedKey(signer.PublicKey()))

	khPath := filepath.Join(sshDir, "known_hosts")
	if err := os.WriteFile(khPath, []byte(line), 0600); err != nil {
		t.Fatalf("write temp known_hosts: %v", err)
	}

	t.Setenv("HOME", tmpHome)
}

func TestReconnectLoop_Success(t *testing.T) {
	ks := newKillableSSHServer(t, "pass")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, cb := hostFromKillable(t, ks)

	// Add the server's key to known_hosts so reconnectHostKeyCallback accepts it.
	addToKnownHosts(t, ks.Addr, ks.Signer)

	// Dial while server is alive to get a real client (needed by attemptReconnect
	// which closes the old client on success).
	dr, err := Dial(DialRequest{
		Host:            host,
		Password:        "pass",
		Timeout:         5 * time.Second,
		HostKeyCallback: cb,
	})
	if err != nil {
		t.Fatalf("initial dial: %v", err)
	}

	// Kill the server before starting reconnectLoop.
	ks.Kill()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn := &Connection{
		id:        "conn-success",
		hostID:    host.ID,
		hostLabel: host.Label,
		host:      host,
		password:  "pass",
		client:    dr.Client,
		ctx:       ctx,
		cancel:    cancel,
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   20,
			InitialDelay: 50 * time.Millisecond,
			MaxDelay:     100 * time.Millisecond,
		},
		generation:    0,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.channels["ch-success"] = &fakeChannel{id: "ch-success", connectionID: conn.id}
	m.mu.Unlock()

	// Restart server after 200ms so a reconnect attempt succeeds.
	go func() {
		time.Sleep(200 * time.Millisecond)
		ks.Restart(t)
	}()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateConnected {
		t.Fatalf("expected stateConnected after successful reconnect, got %d", state)
	}
}
