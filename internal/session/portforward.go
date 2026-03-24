package session

import (
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// PortForwardInfo is the serialisable view sent to the frontend.
type PortForwardInfo struct {
	ID         string `json:"id"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
}

// AddPortForward starts a local TCP listener on localPort and forwards connections
// to remoteHost:remotePort through the SSH connection.
func (m *Manager) AddPortForward(connectionId string, localPort int, remoteHost string, remotePort int) (PortForwardInfo, error) {
	conn, err := m.getConnection(connectionId)
	if err != nil {
		return PortForwardInfo{}, err
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", m.cfg.SSH.PortForwardBindAddress, localPort))
	if err != nil {
		log.Error().Err(err).Str("connectionId", connectionId).Int("localPort", localPort).Msg("port forward failed to bind")
		return PortForwardInfo{}, fmt.Errorf("failed to listen on port %d: %w", localPort, err)
	}

	pf := &portForward{
		id:         uuid.New().String(),
		localPort:  localPort,
		remoteHost: remoteHost,
		remotePort: remotePort,
		listener:   listener,
	}

	conn.pfMu.Lock()
	conn.portForwards[pf.id] = pf
	conn.pfMu.Unlock()

	log.Info().Str("connectionId", connectionId).Int("localPort", localPort).Str("remoteHost", remoteHost).Int("remotePort", remotePort).Msg("port forward started")

	var wg sync.WaitGroup

	go func() {
		defer listener.Close()
		for {
			local, err := listener.Accept()
			if err != nil {
				return // closed by disconnect or RemovePortForward
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer local.Close()
				remote, err := conn.SSHClient().Dial("tcp", fmt.Sprintf("%s:%d", remoteHost, remotePort))
				if err != nil {
					log.Error().Err(err).Str("connectionId", connectionId).Str("remoteHost", remoteHost).Int("remotePort", remotePort).Msg("port forward dial failed")
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
			}()
		}
	}()

	return PortForwardInfo{
		ID:         pf.id,
		LocalPort:  localPort,
		RemoteHost: remoteHost,
		RemotePort: remotePort,
	}, nil
}

// RemovePortForward closes the listener for the given forward, stopping new connections.
func (m *Manager) RemovePortForward(connectionId, forwardID string) error {
	conn, err := m.getConnection(connectionId)
	if err != nil {
		return err
	}

	conn.pfMu.Lock()
	pf, exists := conn.portForwards[forwardID]
	if exists {
		pf.listener.Close()
		delete(conn.portForwards, forwardID)
	}
	conn.pfMu.Unlock()

	if !exists {
		return fmt.Errorf("forward %s not found", forwardID)
	}
	log.Info().Str("connectionId", connectionId).Str("forwardID", forwardID).Int("localPort", pf.localPort).Msg("port forward stopped")
	return nil
}

// ListPortForwards returns all active port forwards for the given connection.
func (m *Manager) ListPortForwards(connectionId string) ([]PortForwardInfo, error) {
	conn, err := m.getConnection(connectionId)
	if err != nil {
		return nil, err
	}

	conn.pfMu.Lock()
	result := make([]PortForwardInfo, 0, len(conn.portForwards))
	for _, pf := range conn.portForwards {
		result = append(result, PortForwardInfo{
			ID:         pf.id,
			LocalPort:  pf.localPort,
			RemoteHost: pf.remoteHost,
			RemotePort: pf.remotePort,
		})
	}
	conn.pfMu.Unlock()

	return result, nil
}
