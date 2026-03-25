package session

import (
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// ReconnectConfig holds resolved (global + per-host override) reconnect settings.
type ReconnectConfig struct {
	Enabled            bool
	MaxRetries         int
	InitialDelay       time.Duration
	MaxDelay           time.Duration
	KeepAliveInterval  time.Duration
	KeepAliveMaxMissed int
}

// ResolveReconnectConfig merges global SSH config with per-host overrides.
func ResolveReconnectConfig(ssh config.SSHConfig, host store.Host) ReconnectConfig {
	rc := ReconnectConfig{
		Enabled:            ssh.ReconnectEnabled,
		MaxRetries:         ssh.ReconnectMaxRetries,
		InitialDelay:       time.Duration(ssh.ReconnectInitialDelaySeconds) * time.Second,
		MaxDelay:           time.Duration(ssh.ReconnectMaxDelaySeconds) * time.Second,
		KeepAliveInterval:  time.Duration(ssh.KeepAliveIntervalSeconds) * time.Second,
		KeepAliveMaxMissed: ssh.KeepAliveMaxMissed,
	}

	if host.ReconnectEnabled != nil {
		rc.Enabled = *host.ReconnectEnabled
	}
	if host.ReconnectMaxRetries != nil {
		rc.MaxRetries = *host.ReconnectMaxRetries
	}
	if host.ReconnectInitialDelaySeconds != nil {
		rc.InitialDelay = time.Duration(*host.ReconnectInitialDelaySeconds) * time.Second
	}
	if host.ReconnectMaxDelaySeconds != nil {
		rc.MaxDelay = time.Duration(*host.ReconnectMaxDelaySeconds) * time.Second
	}
	if host.KeepAliveIntervalSeconds != nil {
		rc.KeepAliveInterval = time.Duration(*host.KeepAliveIntervalSeconds) * time.Second
	}
	if host.KeepAliveMaxMissed != nil {
		rc.KeepAliveMaxMissed = *host.KeepAliveMaxMissed
	}
	return rc
}

// BackoffDelay computes the delay for a given attempt using exponential backoff.
func BackoffDelay(attempt int, initial, max time.Duration) time.Duration {
	delay := initial
	for i := 0; i < attempt; i++ {
		delay *= 2
		if delay >= max {
			return max
		}
	}
	return delay
}

// resolveReconnectConfig is the package-internal alias used by Connection creation.
var resolveReconnectConfig = ResolveReconnectConfig
