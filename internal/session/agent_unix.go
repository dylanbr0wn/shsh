//go:build !windows

package session

import (
	"fmt"
	"net"
	"os"

	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// useAgent connects to the SSH agent via the SSH_AUTH_SOCK Unix socket.
func useAgent() (goph.Auth, error) {
	sock := os.Getenv("SSH_AUTH_SOCK")
	if sock == "" {
		return nil, fmt.Errorf("SSH_AUTH_SOCK not set; is an SSH agent running?")
	}
	conn, err := net.Dial("unix", sock)
	if err != nil {
		return nil, fmt.Errorf("could not connect to SSH agent: %w", err)
	}
	return goph.Auth{
		ssh.PublicKeysCallback(agent.NewClient(conn).Signers),
	}, nil
}
