//go:build windows

package session

import (
	"fmt"

	"github.com/Microsoft/go-winio"
	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const opensshAgentPipe = `\\.\pipe\openssh-ssh-agent`

// useAgent connects to the Windows OpenSSH agent via its named pipe.
func useAgent() (goph.Auth, error) {
	conn, err := winio.DialPipe(opensshAgentPipe, nil)
	if err != nil {
		return nil, fmt.Errorf("could not connect to OpenSSH agent at %s: %w", opensshAgentPipe, err)
	}
	return goph.Auth{
		ssh.PublicKeysCallback(agent.NewClient(conn).Signers),
	}, nil
}
