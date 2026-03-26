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
