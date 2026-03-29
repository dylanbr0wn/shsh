package session

import (
	"sync"
	"testing"
	"time"
)

func TestMarkDead_StaleGeneration(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:            "conn-stale",
		hostID:        "h1",
		hostLabel:     "test",
		state:         stateConnected,
		generation:    5,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.mu.Unlock()

	// Call markDead with a stale generation — should be a no-op.
	m.markDead(conn, 3)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateConnected {
		t.Fatalf("expected stateConnected, got %d", state)
	}
}

func TestMarkDead_ReconnectDisabled(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:        "conn-no-reconnect",
		hostID:    "h2",
		hostLabel: "test",
		state:     stateConnected,
		reconnCfg: ReconnectConfig{
			Enabled: false,
		},
		generation:    0,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.mu.Unlock()

	m.markDead(conn, 0)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Fatalf("expected stateFailed, got %d", state)
	}

	// reconnectDone should be closed.
	select {
	case <-conn.reconnectDone:
	default:
		t.Fatal("reconnectDone should be closed")
	}

	// Should have emitted a StatusFailed event.
	failed := tm.Emitter.EventsByTopic("connection:status")
	foundFailed := false
	for _, ev := range failed {
		cse, ok := ev.Data.(ConnectionStatusEvent)
		if ok && cse.Status == StatusFailed && cse.ConnectionID == conn.id {
			foundFailed = true
			break
		}
	}
	if !foundFailed {
		t.Fatal("expected StatusFailed event for the connection")
	}
}

func TestMarkDead_FirstCallerWins(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:        "conn-race",
		hostID:    "h3",
		hostLabel: "test",
		state:     stateConnected,
		reconnCfg: ReconnectConfig{
			Enabled: false,
		},
		generation:    0,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(5)
	for range 5 {
		go func() {
			defer wg.Done()
			m.markDead(conn, 0)
		}()
	}
	wg.Wait()

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Fatalf("expected stateFailed, got %d", state)
	}

	// reconnectDone should be closed without panic from double close.
	select {
	case <-conn.reconnectDone:
	default:
		t.Fatal("reconnectDone should be closed")
	}
}

// fakeChannel is a test-only Channel with a configurable connectionID.
type fakeChannel struct {
	id           string
	connectionID string
}

func (f *fakeChannel) ID() string           { return f.id }
func (f *fakeChannel) Kind() ChannelKind    { return ChannelLocalFS }
func (f *fakeChannel) ConnectionID() string { return f.connectionID }
func (f *fakeChannel) Close() error         { return nil }

func TestMarkDead_EmitsChannelReconnecting(t *testing.T) {
	tm := newRecordingTestManager(t)
	m := tm.Manager

	conn := &Connection{
		id:        "conn-ch-status",
		hostID:    "h4",
		hostLabel: "test",
		state:     stateConnected,
		reconnCfg: ReconnectConfig{
			Enabled: false,
		},
		generation:    0,
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.channels["ch1"] = &fakeChannel{id: "ch1", connectionID: conn.id}
	m.mu.Unlock()

	m.markDead(conn, 0)

	// Wait briefly for events.
	time.Sleep(10 * time.Millisecond)

	chEvents := tm.Emitter.EventsByTopic("channel:status")
	foundReconnecting := false
	for _, ev := range chEvents {
		cse, ok := ev.Data.(ChannelStatusEvent)
		if ok && cse.Status == StatusReconnecting && cse.ChannelID == "ch1" {
			foundReconnecting = true
			break
		}
	}
	if !foundReconnecting {
		t.Fatal("expected channel:status reconnecting event for ch1")
	}
}
