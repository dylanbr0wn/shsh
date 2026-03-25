package session

import (
	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// ReconnectConfig holds resolved reconnect settings.
// Fully implemented in a later task.
type ReconnectConfig struct {
	Enabled bool
}

// resolveReconnectConfig is a placeholder — fully implemented in a later task.
func resolveReconnectConfig(_ config.SSHConfig, _ store.Host) ReconnectConfig {
	return ReconnectConfig{}
}
