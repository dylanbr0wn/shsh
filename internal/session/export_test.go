package session

import "sync"

// Test-only exports for white-box testing of connection ref count internals.

func (m *Manager) Mu() *sync.Mutex { return &m.mu }

// Connections returns the internal connections map for test inspection.
func (m *Manager) Connections() map[string]*Connection {
	return m.connections
}

// Channels returns the internal channels map for test inspection.
func (m *Manager) Channels() map[string]Channel {
	return m.channels
}
