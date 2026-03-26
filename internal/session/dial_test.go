package session_test

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

// splitHostPort parses a net.Addr string into host and port.
func splitHostPort(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("splitHostPort: %v", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("splitHostPort: invalid port %q: %v", portStr, err)
	}
	return host, port
}

// hostKeyCallback returns an ssh.HostKeyCallback that accepts the given signer's public key.
func hostKeyCallback(signer ssh.Signer) ssh.HostKeyCallback {
	return ssh.FixedHostKey(signer.PublicKey())
}

// newTestSSHServer starts an in-process SSH server that accepts password auth.
// Returns the listener address and the host key signer.
func newTestSSHServer(t *testing.T, password string) (string, ssh.Signer) {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("wrong password")
		},
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleTestSSHConn(conn, cfg)
		}
	}()

	return ln.Addr().String(), signer
}

// handleTestSSHConn performs the SSH handshake and discards all channels/requests.
func handleTestSSHConn(conn net.Conn, cfg *ssh.ServerConfig) {
	defer conn.Close()
	sConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sConn.Close()
	go ssh.DiscardRequests(reqs)
	for ch := range chans {
		ch.Reject(ssh.Prohibited, "no channels supported")
	}
}

// newForwardingSSHServer starts an SSH server that handles direct-tcpip forwarding.
func newForwardingSSHServer(t *testing.T, password string) (string, ssh.Signer) {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("wrong password")
		},
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleForwardingSSHConn(conn, cfg)
		}
	}()

	return ln.Addr().String(), signer
}

// directTCPIPPayload is the wire format for direct-tcpip channel extra data.
type directTCPIPPayload struct {
	DestAddr string
	DestPort uint32
	SrcAddr  string
	SrcPort  uint32
}

// handleForwardingSSHConn handles SSH connections with direct-tcpip forwarding support.
func handleForwardingSSHConn(conn net.Conn, cfg *ssh.ServerConfig) {
	defer conn.Close()
	sConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sConn.Close()
	go ssh.DiscardRequests(reqs)

	for newCh := range chans {
		if newCh.ChannelType() != "direct-tcpip" {
			newCh.Reject(ssh.Prohibited, "only direct-tcpip supported")
			continue
		}

		var payload directTCPIPPayload
		if err := ssh.Unmarshal(newCh.ExtraData(), &payload); err != nil {
			newCh.Reject(ssh.ConnectionFailed, "bad payload")
			continue
		}

		target := net.JoinHostPort(payload.DestAddr, strconv.Itoa(int(payload.DestPort)))
		targetConn, err := net.DialTimeout("tcp", target, 5*time.Second)
		if err != nil {
			newCh.Reject(ssh.ConnectionFailed, fmt.Sprintf("cannot reach %s: %v", target, err))
			continue
		}

		ch, reqs, err := newCh.Accept()
		if err != nil {
			targetConn.Close()
			continue
		}
		go ssh.DiscardRequests(reqs)

		go func() {
			defer ch.Close()
			defer targetConn.Close()
			done := make(chan struct{}, 2)
			go func() { io.Copy(ch, targetConn); done <- struct{}{} }()
			go func() { io.Copy(targetConn, ch); done <- struct{}{} }()
			<-done
		}()
	}
}

// --- Tests ---

func TestDial_DirectSuccess(t *testing.T) {
	const pw = "test-password"
	addr, signer := newTestSSHServer(t, pw)
	host, port := splitHostPort(t, addr)

	res, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "testuser",
			AuthMethod: store.AuthPassword,
		},
		Password:        pw,
		Timeout:         5 * time.Second,
		HostKeyCallback: hostKeyCallback(signer),
	})
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer res.Client.Close()

	if res.Client == nil {
		t.Fatal("expected non-nil Client")
	}
	if res.JumpClient != nil {
		t.Fatal("expected nil JumpClient for direct connection")
	}
}

func TestDial_DirectAuthFailure(t *testing.T) {
	const pw = "correct-password"
	addr, signer := newTestSSHServer(t, pw)
	host, port := splitHostPort(t, addr)

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
		t.Fatal("expected error for wrong password")
	}
}

func TestDial_JumpHostSuccess(t *testing.T) {
	const jumpPW = "jump-password"
	const targetPW = "target-password"

	// Start target SSH server
	targetAddr, targetSigner := newTestSSHServer(t, targetPW)
	targetHost, targetPort := splitHostPort(t, targetAddr)

	// Start forwarding jump SSH server
	jumpAddr, jumpSigner := newForwardingSSHServer(t, jumpPW)
	jumpHost, jumpPort := splitHostPort(t, jumpAddr)

	// Accept both host keys
	cb := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		jumpPub := jumpSigner.PublicKey().Marshal()
		targetPub := targetSigner.PublicKey().Marshal()
		got := key.Marshal()
		if string(got) == string(jumpPub) || string(got) == string(targetPub) {
			return nil
		}
		return fmt.Errorf("unknown host key")
	}

	res, err := session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   targetHost,
			Port:       targetPort,
			Username:   "targetuser",
			AuthMethod: store.AuthPassword,
		},
		Password: targetPW,
		JumpHost: &store.Host{
			Hostname:   jumpHost,
			Port:       jumpPort,
			Username:   "jumpuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    jumpPW,
		Timeout:         5 * time.Second,
		HostKeyCallback: cb,
	})
	if err != nil {
		t.Fatalf("Dial via jump host failed: %v", err)
	}
	defer res.Client.Close()
	defer res.JumpClient.Close()

	if res.Client == nil {
		t.Fatal("expected non-nil Client")
	}
	if res.JumpClient == nil {
		t.Fatal("expected non-nil JumpClient for jump host connection")
	}
}

func TestDial_JumpHostTCPFailure(t *testing.T) {
	// Use a port that nothing is listening on
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // close immediately so nothing is listening

	host, port := splitHostPort(t, addr)

	_, err = session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       22222,
			Username:   "targetuser",
			AuthMethod: store.AuthPassword,
		},
		Password: "pw",
		JumpHost: &store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "jumpuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    "pw",
		Timeout:         2 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err == nil {
		t.Fatal("expected error for unreachable jump host")
	}
	if !strings.Contains(err.Error(), "failed to dial jump host") {
		t.Fatalf("expected error to contain 'failed to dial jump host', got: %v", err)
	}
}

func TestDial_JumpHostSSHFailure(t *testing.T) {
	// Start a TCP listener that accepts then immediately closes (not an SSH server)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			// Write some garbage and close to trigger SSH handshake failure
			conn.Write([]byte("not-ssh"))
			conn.Close()
		}
	}()

	host, port := splitHostPort(t, ln.Addr().String())

	_, err = session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       22222,
			Username:   "targetuser",
			AuthMethod: store.AuthPassword,
		},
		Password: "pw",
		JumpHost: &store.Host{
			Hostname:   host,
			Port:       port,
			Username:   "jumpuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    "pw",
		Timeout:         2 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err == nil {
		t.Fatal("expected error for non-SSH jump host")
	}
	if !strings.Contains(err.Error(), "failed to establish SSH connection to jump host") {
		t.Fatalf("expected error to contain 'failed to establish SSH connection to jump host', got: %v", err)
	}
}

func TestDial_TargetViaJumpFailure(t *testing.T) {
	const jumpPW = "jump-password"

	// Start forwarding jump server — but target is unreachable
	jumpAddr, jumpSigner := newForwardingSSHServer(t, jumpPW)
	jumpHost, jumpPort := splitHostPort(t, jumpAddr)

	// Pick a port that nothing listens on for the target
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadAddr := ln.Addr().String()
	ln.Close()
	_, deadPort := splitHostPort(t, deadAddr)

	_, err = session.Dial(session.DialRequest{
		Host: store.Host{
			Hostname:   "127.0.0.1",
			Port:       deadPort,
			Username:   "targetuser",
			AuthMethod: store.AuthPassword,
		},
		Password: "pw",
		JumpHost: &store.Host{
			Hostname:   jumpHost,
			Port:       jumpPort,
			Username:   "jumpuser",
			AuthMethod: store.AuthPassword,
		},
		JumpPassword:    jumpPW,
		Timeout:         5 * time.Second,
		HostKeyCallback: hostKeyCallback(jumpSigner),
	})
	if err == nil {
		t.Fatal("expected error for unreachable target via jump host")
	}
	if !strings.Contains(err.Error(), "failed to dial target through jump host") {
		t.Fatalf("expected error to contain 'failed to dial target through jump host', got: %v", err)
	}
}
