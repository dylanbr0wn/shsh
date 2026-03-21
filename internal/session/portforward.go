package session

import (
	"fmt"
	"io"
	"net"

	"github.com/google/uuid"
)

// PortForwardInfo is the serialisable view sent to the frontend.
type PortForwardInfo struct {
	ID         string `json:"id"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
}

// AddPortForward starts a local TCP listener on localPort and forwards connections
// to remoteHost:remotePort through the SSH session.
func (m *Manager) AddPortForward(sessionID string, localPort int, remoteHost string, remotePort int) (PortForwardInfo, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return PortForwardInfo{}, fmt.Errorf("session %s not found", sessionID)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		return PortForwardInfo{}, fmt.Errorf("failed to listen on port %d: %w", localPort, err)
	}

	pf := &portForward{
		id:         uuid.New().String(),
		localPort:  localPort,
		remoteHost: remoteHost,
		remotePort: remotePort,
		listener:   listener,
	}

	sess.pfMu.Lock()
	sess.portForwards[pf.id] = pf
	sess.pfMu.Unlock()

	sess.wg.Go(func() {
		defer listener.Close()
		for {
			local, err := listener.Accept()
			if err != nil {
				return // closed by disconnect or RemovePortForward
			}
			sess.wg.Go(func() {
				defer local.Close()
				remote, err := sess.client.Client.Dial("tcp", fmt.Sprintf("%s:%d", remoteHost, remotePort))
				if err != nil {
					return
				}
				defer remote.Close()
				done := make(chan struct{})
				go func() {
					io.Copy(remote, local) //nolint:errcheck
					close(done)
				}()
				io.Copy(local, remote) //nolint:errcheck
				<-done
			})
		}
	})

	return PortForwardInfo{
		ID:         pf.id,
		LocalPort:  localPort,
		RemoteHost: remoteHost,
		RemotePort: remotePort,
	}, nil
}

// RemovePortForward closes the listener for the given forward, stopping new connections.
func (m *Manager) RemovePortForward(sessionID, forwardID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.pfMu.Lock()
	pf, exists := sess.portForwards[forwardID]
	if exists {
		pf.listener.Close()
		delete(sess.portForwards, forwardID)
	}
	sess.pfMu.Unlock()

	if !exists {
		return fmt.Errorf("forward %s not found", forwardID)
	}
	return nil
}

// ListPortForwards returns all active port forwards for the given session.
func (m *Manager) ListPortForwards(sessionID string) ([]PortForwardInfo, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	sess.pfMu.Lock()
	result := make([]PortForwardInfo, 0, len(sess.portForwards))
	for _, pf := range sess.portForwards {
		result = append(result, PortForwardInfo{
			ID:         pf.id,
			LocalPort:  pf.localPort,
			RemoteHost: pf.remoteHost,
			RemotePort: pf.remotePort,
		})
	}
	sess.pfMu.Unlock()

	return result, nil
}
