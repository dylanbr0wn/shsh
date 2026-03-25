package session

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// localConnectionID is the fixed ID for the virtual local-filesystem connection.
const localConnectionID = "local"

// LocalFSChannel is a virtual channel representing a local filesystem pane.
// It does not require a real SSH connection.
type LocalFSChannel struct {
	id string
}

func (l *LocalFSChannel) ID() string           { return l.id }
func (l *LocalFSChannel) Kind() ChannelKind    { return ChannelLocalFS }
func (l *LocalFSChannel) ConnectionID() string { return localConnectionID }
func (l *LocalFSChannel) Close() error         { return nil }

// ensureLocalConnection lazily creates the singleton virtual Connection for the
// local filesystem. It is stored in both m.connections and m.connByIdent so that
// existing lookup paths work. The connection has no real SSH client and its cancel
// is a no-op — it persists for the lifetime of the app.
func (m *Manager) ensureLocalConnection() *Connection {
	m.mu.Lock()
	defer m.mu.Unlock()

	if conn, ok := m.connections[localConnectionID]; ok {
		return conn
	}

	connCtx, cancel := context.WithCancel(m.ctx)
	conn := &Connection{
		id:           localConnectionID,
		hostID:       localConnectionID,
		hostLabel:    "Local",
		ctx:          connCtx,
		cancel:       cancel,
		portForwards: make(map[string]*portForward),
	}

	ident := connIdentity{hostID: localConnectionID}
	m.connections[localConnectionID] = conn
	m.connByIdent[ident] = conn
	return conn
}

// OpenLocalFSChannel creates a new LocalFSChannel, increments the virtual
// connection's ref count, and emits a channel:status connected event.
func (m *Manager) OpenLocalFSChannel() (string, error) {
	conn := m.ensureLocalConnection()

	channelID := uuid.New().String()
	ch := &LocalFSChannel{id: channelID}

	conn.incrRefs()

	m.mu.Lock()
	m.channels[channelID] = ch
	m.mu.Unlock()

	m.emitter.Emit("channel:status", ChannelStatusEvent{
		ChannelID:    channelID,
		ConnectionID: localConnectionID,
		Kind:         ChannelLocalFS,
		Status:       StatusConnected,
	})

	return channelID, nil
}

// getLocalFSChannel looks up a LocalFSChannel by channelID.
func (m *Manager) getLocalFSChannel(channelID string) (*LocalFSChannel, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelID)
	}
	lc, ok := ch.(*LocalFSChannel)
	if !ok {
		return nil, fmt.Errorf("channel %s is not a local FS channel", channelID)
	}
	return lc, nil
}
