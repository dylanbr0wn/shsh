package session_test

import (
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
)

func TestResolveReconnectConfig_GlobalDefaults(t *testing.T) {
	ssh := config.Default().SSH
	host := store.Host{}
	rc := session.ResolveReconnectConfig(ssh, host)

	if !rc.Enabled {
		t.Error("expected enabled=true")
	}
	if rc.MaxRetries != 5 {
		t.Errorf("expected maxRetries=5, got %d", rc.MaxRetries)
	}
	if rc.InitialDelay != 2*time.Second {
		t.Errorf("expected initialDelay=2s, got %s", rc.InitialDelay)
	}
	if rc.MaxDelay != 30*time.Second {
		t.Errorf("expected maxDelay=30s, got %s", rc.MaxDelay)
	}
	if rc.KeepAliveInterval != 30*time.Second {
		t.Errorf("expected keepAliveInterval=30s, got %s", rc.KeepAliveInterval)
	}
	if rc.KeepAliveMaxMissed != 3 {
		t.Errorf("expected keepAliveMaxMissed=3, got %d", rc.KeepAliveMaxMissed)
	}
}

func TestResolveReconnectConfig_HostOverrides(t *testing.T) {
	ssh := config.Default().SSH
	maxRetries := 10
	host := store.Host{
		ReconnectMaxRetries: &maxRetries,
	}
	rc := session.ResolveReconnectConfig(ssh, host)

	if rc.MaxRetries != 10 {
		t.Errorf("expected maxRetries=10 (host override), got %d", rc.MaxRetries)
	}
	if !rc.Enabled {
		t.Error("expected enabled=true from global default")
	}
}

func TestResolveReconnectConfig_AllOverrides(t *testing.T) {
	ssh := config.Default().SSH
	enabled := false
	maxRetries := 42
	initialDelay := 7
	maxDelay := 120
	keepAliveInterval := 15
	keepAliveMaxMissed := 10

	host := store.Host{
		ReconnectEnabled:             &enabled,
		ReconnectMaxRetries:          &maxRetries,
		ReconnectInitialDelaySeconds: &initialDelay,
		ReconnectMaxDelaySeconds:     &maxDelay,
		KeepAliveIntervalSeconds:     &keepAliveInterval,
		KeepAliveMaxMissed:           &keepAliveMaxMissed,
	}
	rc := session.ResolveReconnectConfig(ssh, host)

	if rc.Enabled != false {
		t.Errorf("expected enabled=false, got %v", rc.Enabled)
	}
	if rc.MaxRetries != 42 {
		t.Errorf("expected maxRetries=42, got %d", rc.MaxRetries)
	}
	if rc.InitialDelay != 7*time.Second {
		t.Errorf("expected initialDelay=7s, got %s", rc.InitialDelay)
	}
	if rc.MaxDelay != 120*time.Second {
		t.Errorf("expected maxDelay=120s, got %s", rc.MaxDelay)
	}
	if rc.KeepAliveInterval != 15*time.Second {
		t.Errorf("expected keepAliveInterval=15s, got %s", rc.KeepAliveInterval)
	}
	if rc.KeepAliveMaxMissed != 10 {
		t.Errorf("expected keepAliveMaxMissed=10, got %d", rc.KeepAliveMaxMissed)
	}
}

func TestBackoffDelay(t *testing.T) {
	initial := 2 * time.Second
	max := 30 * time.Second

	tests := []struct {
		attempt  int
		expected time.Duration
	}{
		{0, 2 * time.Second},
		{1, 4 * time.Second},
		{2, 8 * time.Second},
		{3, 16 * time.Second},
		{4, 30 * time.Second},
		{5, 30 * time.Second},
	}
	for _, tt := range tests {
		got := session.BackoffDelay(tt.attempt, initial, max)
		if got != tt.expected {
			t.Errorf("attempt %d: expected %s, got %s", tt.attempt, tt.expected, got)
		}
	}
}
