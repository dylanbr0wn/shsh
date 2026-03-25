package session

import (
	"context"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
)

type stubEmitter struct{}

func (s *stubEmitter) Emit(topic string, data any) {}

func newTestManager() *Manager {
	return NewManager(context.Background(), &config.Config{}, &stubEmitter{})
}

func TestOpenLocalFSChannel(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	m.mu.Lock()
	ch, ok := m.channels[channelID]
	conn, connOk := m.connections[localConnectionID]
	m.mu.Unlock()

	if !ok {
		t.Fatalf("channel %s not found in map", channelID)
	}
	if ch.Kind() != ChannelLocalFS {
		t.Errorf("Kind() = %q, want %q", ch.Kind(), ChannelLocalFS)
	}
	if ch.ConnectionID() != localConnectionID {
		t.Errorf("ConnectionID() = %q, want %q", ch.ConnectionID(), localConnectionID)
	}
	if !connOk {
		t.Fatalf("virtual connection %q not found", localConnectionID)
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 1 {
		t.Errorf("channelRefs = %d, want 1", refs)
	}
}

func TestOpenMultipleLocalFSChannels(t *testing.T) {
	m := newTestManager()

	_, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("first OpenLocalFSChannel() error = %v", err)
	}
	_, err = m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("second OpenLocalFSChannel() error = %v", err)
	}

	m.mu.Lock()
	conn, connOk := m.connections[localConnectionID]
	m.mu.Unlock()

	if !connOk {
		t.Fatalf("virtual connection %q not found", localConnectionID)
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 2 {
		t.Errorf("channelRefs = %d, want 2", refs)
	}
}

func TestCloseLocalFSChannel(t *testing.T) {
	m := newTestManager()

	channelID, err := m.OpenLocalFSChannel()
	if err != nil {
		t.Fatalf("OpenLocalFSChannel() error = %v", err)
	}

	if err := m.CloseChannel(channelID); err != nil {
		t.Fatalf("CloseChannel() error = %v", err)
	}

	m.mu.Lock()
	_, channelExists := m.channels[channelID]
	conn, connExists := m.connections[localConnectionID]
	m.mu.Unlock()

	if channelExists {
		t.Error("channel should have been removed from map after close")
	}
	if !connExists {
		t.Error("virtual connection should persist after last channel closes")
	}
	conn.mu.Lock()
	refs := conn.channelRefs
	conn.mu.Unlock()
	if refs != 0 {
		t.Errorf("channelRefs = %d, want 0", refs)
	}
}
