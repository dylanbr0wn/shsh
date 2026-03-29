package session

import (
	"context"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
)

func TestReconnectLoop_ExhaustsRetries(t *testing.T) {
	ks := newKillableSSHServer(t, "pass")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, _ := hostFromKillable(t, ks)

	// Kill the server so every reconnect attempt fails.
	ks.Kill()

	conn := &Connection{
		id:        "conn-exhaust",
		hostID:    host.ID,
		hostLabel: host.Label,
		host:      host,
		password:  "pass",
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   2,
			InitialDelay: time.Millisecond,
			MaxDelay:     5 * time.Millisecond,
		},
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	// Register a fake channel so the loop doesn't abort due to "no channels".
	m.channels["ch-exhaust"] = &fakeChannel{id: "ch-exhaust", connectionID: conn.id}
	m.mu.Unlock()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Fatalf("expected stateFailed, got %d", state)
	}

	select {
	case <-conn.reconnectDone:
	default:
		t.Fatal("reconnectDone should be closed")
	}

	// Should have a StatusFailed event.
	for _, ev := range tm.Emitter.EventsByTopic("connection:status") {
		cse, ok := ev.Data.(ConnectionStatusEvent)
		if ok && cse.Status == StatusFailed && cse.ConnectionID == conn.id {
			return
		}
	}
	t.Fatal("expected StatusFailed connection:status event")
}

func TestReconnectLoop_AllChannelsClosedAbort(t *testing.T) {
	ks := newKillableSSHServer(t, "pass")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, cb := hostFromKillable(t, ks)

	// Dial while server is alive to get a real client for teardownConnection.
	dr, err := Dial(DialRequest{
		Host:            host,
		Password:        "pass",
		Timeout:         5 * time.Second,
		HostKeyCallback: cb,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	ks.Kill()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn := &Connection{
		id:        "conn-no-ch",
		hostID:    host.ID,
		hostLabel: host.Label,
		host:      host,
		password:  "pass",
		client:    dr.Client,
		ctx:       ctx,
		cancel:    cancel,
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   10,
			InitialDelay: time.Millisecond,
			MaxDelay:     5 * time.Millisecond,
		},
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	// Do NOT register any channels — loop should abort immediately.
	m.mu.Unlock()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Fatalf("expected stateFailed after no-channels abort, got %d", state)
	}
}

func TestReconnectLoop_ManagerContextCancelled(t *testing.T) {
	ks := newKillableSSHServer(t, "pass")

	ctx, cancel := context.WithCancel(context.Background())
	emitter := &recordingEmitter{}
	m := NewManager(ctx, newRecordingTestManagerConfig(), emitter, &noopDebugEmitter{})
	t.Cleanup(func() {
		cancel()
		m.Shutdown()
	})

	host, _ := hostFromKillable(t, ks)
	ks.Kill()

	conn := &Connection{
		id:        "conn-ctx-cancel",
		hostID:    host.ID,
		hostLabel: host.Label,
		host:      host,
		password:  "pass",
		state:     stateReconnecting,
		reconnCfg: ReconnectConfig{
			Enabled:      true,
			MaxRetries:   100,
			InitialDelay: 500 * time.Millisecond,
			MaxDelay:     time.Second,
		},
		reconnectDone: make(chan struct{}),
		portForwards:  make(map[string]*portForward),
		cancel:        func() {},
	}

	m.mu.Lock()
	m.connections[conn.id] = conn
	m.channels["ch-ctx"] = &fakeChannel{id: "ch-ctx", connectionID: conn.id}
	m.mu.Unlock()

	// Cancel manager context after 100ms.
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	m.reconnectLoop(conn)

	conn.mu.RLock()
	state := conn.state
	conn.mu.RUnlock()
	if state != stateFailed {
		t.Fatalf("expected stateFailed after context cancel, got %d", state)
	}
}

// newRecordingTestManagerConfig returns the config used by newRecordingTestManager.
func newRecordingTestManagerConfig() *config.Config {
	cfg := config.Default()
	cfg.SSH.ConnectionTimeoutSeconds = 5
	cfg.SSH.ReconnectEnabled = true
	cfg.SSH.ReconnectMaxRetries = 3
	cfg.SSH.ReconnectInitialDelaySeconds = 0
	cfg.SSH.ReconnectMaxDelaySeconds = 1
	cfg.SSH.KeepAliveIntervalSeconds = 0
	return cfg
}
