package session

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
	"golang.org/x/crypto/ssh"
)

// ---------------------------------------------------------------------------
// stubEmitter — fire-and-forget (moved from localfs_test.go)
// ---------------------------------------------------------------------------

type stubEmitter struct{}

func (s *stubEmitter) Emit(topic string, data any) {}

func newTestManager() *Manager {
	return NewManager(context.Background(), &config.Config{}, &stubEmitter{}, nil)
}

// ---------------------------------------------------------------------------
// recordingEmitter — captures events for assertions
// ---------------------------------------------------------------------------

type emittedEvent struct {
	Topic string
	Data  any
}

type recordingEmitter struct {
	mu     sync.Mutex
	events []emittedEvent
}

func (e *recordingEmitter) Emit(topic string, data any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, emittedEvent{Topic: topic, Data: data})
}

// Events returns a snapshot copy of all recorded events.
func (e *recordingEmitter) Events() []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]emittedEvent, len(e.events))
	copy(out, e.events)
	return out
}

// EventsByTopic returns a filtered copy containing only events with the given topic.
func (e *recordingEmitter) EventsByTopic(topic string) []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []emittedEvent
	for _, ev := range e.events {
		if ev.Topic == topic {
			out = append(out, ev)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// noopDebugEmitter
// ---------------------------------------------------------------------------

type noopDebugEmitter struct{}

func (n *noopDebugEmitter) EmitDebug(category string, level string, channelID, channelLabel, message string, fields map[string]any) {
}

// ---------------------------------------------------------------------------
// newRecordingTestManager
// ---------------------------------------------------------------------------

type testManagerResult struct {
	Manager *Manager
	Emitter *recordingEmitter
	Cancel  context.CancelFunc
	Ctx     context.Context
}

func newRecordingTestManager(t *testing.T) testManagerResult {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())

	cfg := config.Default()
	cfg.SSH.ConnectionTimeoutSeconds = 5
	cfg.SSH.ReconnectEnabled = true
	cfg.SSH.ReconnectMaxRetries = 3
	cfg.SSH.ReconnectInitialDelaySeconds = 0
	cfg.SSH.ReconnectMaxDelaySeconds = 1
	cfg.SSH.KeepAliveIntervalSeconds = 0

	emitter := &recordingEmitter{}
	mgr := NewManager(ctx, cfg, emitter, &noopDebugEmitter{})

	t.Cleanup(func() {
		cancel()
		mgr.Shutdown()
	})

	return testManagerResult{
		Manager: mgr,
		Emitter: emitter,
		Cancel:  cancel,
		Ctx:     ctx,
	}
}

// ---------------------------------------------------------------------------
// killableServer — SSH server that can be killed and restarted
// ---------------------------------------------------------------------------

type killableServer struct {
	Addr    string
	Signer  ssh.Signer
	mu      sync.Mutex
	ln      net.Listener
	conns   []net.Conn
	stopped bool
}

func newKillableSSHServer(t *testing.T, password string) *killableServer {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ks := &killableServer{
		Addr:   ln.Addr().String(),
		Signer: signer,
		ln:     ln,
	}

	ks.startAcceptLoop(t, password)

	t.Cleanup(func() {
		ks.Kill()
	})

	return ks
}

func (ks *killableServer) startAcceptLoop(t *testing.T, password string) {
	t.Helper()

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("wrong password")
		},
	}
	cfg.AddHostKey(ks.Signer)

	go func() {
		for {
			conn, err := ks.ln.Accept()
			if err != nil {
				return
			}
			ks.mu.Lock()
			if ks.stopped {
				ks.mu.Unlock()
				conn.Close()
				return
			}
			ks.conns = append(ks.conns, conn)
			ks.mu.Unlock()
			go ks.handleConn(conn, cfg)
		}
	}()
}

func (ks *killableServer) handleConn(conn net.Conn, cfg *ssh.ServerConfig) {
	defer conn.Close()
	sConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sConn.Close()
	go ssh.DiscardRequests(reqs)

	for newCh := range chans {
		if newCh.ChannelType() != "session" {
			newCh.Reject(ssh.Prohibited, "only session channels")
			continue
		}
		ch, requests, err := newCh.Accept()
		if err != nil {
			continue
		}
		go func(ch ssh.Channel, reqs <-chan *ssh.Request) {
			defer ch.Close()
			for req := range reqs {
				switch req.Type {
				case "pty-req", "shell", "keepalive@openssh.com":
					if req.WantReply {
						req.Reply(true, nil)
					}
					if req.Type == "shell" {
						ch.Write([]byte("welcome\r\n")) //nolint:errcheck
					}
				default:
					if req.WantReply {
						req.Reply(false, nil)
					}
				}
			}
			// Keep reading so the channel stays open until the client disconnects.
			io.Copy(io.Discard, ch) //nolint:errcheck
		}(ch, requests)
	}
}

// Kill closes the listener and all tracked connections.
func (ks *killableServer) Kill() {
	ks.mu.Lock()
	defer ks.mu.Unlock()
	ks.stopped = true
	ks.ln.Close()
	for _, c := range ks.conns {
		c.Close()
	}
	ks.conns = nil
}

// Restart re-opens the listener on the same address. Accepts ANY password.
func (ks *killableServer) Restart(t *testing.T) {
	t.Helper()
	ks.mu.Lock()
	ks.stopped = false
	ks.mu.Unlock()

	ln, err := net.Listen("tcp", ks.Addr)
	if err != nil {
		t.Fatalf("restart listen on %s: %v", ks.Addr, err)
	}
	ks.mu.Lock()
	ks.ln = ln
	ks.mu.Unlock()

	// Accept any password on restart (reconnect uses cached creds).
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			return nil, nil
		},
	}
	cfg.AddHostKey(ks.Signer)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			ks.mu.Lock()
			if ks.stopped {
				ks.mu.Unlock()
				conn.Close()
				return
			}
			ks.conns = append(ks.conns, conn)
			ks.mu.Unlock()
			go ks.handleConn(conn, cfg)
		}
	}()
}

// ---------------------------------------------------------------------------
// hostFromKillable — builds a store.Host + HostKeyCallback from a killableServer
// ---------------------------------------------------------------------------

func hostFromKillable(t *testing.T, ks *killableServer) (store.Host, ssh.HostKeyCallback) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(ks.Addr)
	if err != nil {
		t.Fatalf("splitHostPort: %v", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("invalid port %q: %v", portStr, err)
	}
	h := store.Host{
		ID:         "test-host-1",
		Label:      "test-host",
		Hostname:   host,
		Port:       port,
		Username:   "testuser",
		AuthMethod: store.AuthPassword,
	}
	cb := ssh.FixedHostKey(ks.Signer.PublicKey())
	return h, cb
}

// ---------------------------------------------------------------------------
// safeFilename tests (white-box, package session)
// ---------------------------------------------------------------------------

func TestSafeFilename(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "my-server", "my-server"},
		{"spaces and caps", "My Server 2", "My_Server_2"},
		{"empty", "", "session"},
		{"all special", "!!@@##", "______"},
		{"single char", "a", "a"},
		{"long string", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQR", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"},
		{"dots and colons", "host@domain.com:2222", "host_domain_com_2222"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := safeFilename(tt.input)
			if got != tt.expected {
				t.Errorf("safeFilename(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
