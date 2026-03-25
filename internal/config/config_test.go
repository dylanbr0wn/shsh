package config

import "testing"

func TestDefault_ReconnectFields(t *testing.T) {
	cfg := Default()
	if !cfg.SSH.ReconnectEnabled {
		t.Error("expected ReconnectEnabled default true")
	}
	if cfg.SSH.ReconnectMaxRetries != 5 {
		t.Errorf("expected ReconnectMaxRetries=5, got %d", cfg.SSH.ReconnectMaxRetries)
	}
	if cfg.SSH.ReconnectInitialDelaySeconds != 2 {
		t.Errorf("expected ReconnectInitialDelaySeconds=2, got %d", cfg.SSH.ReconnectInitialDelaySeconds)
	}
	if cfg.SSH.ReconnectMaxDelaySeconds != 30 {
		t.Errorf("expected ReconnectMaxDelaySeconds=30, got %d", cfg.SSH.ReconnectMaxDelaySeconds)
	}
	if cfg.SSH.KeepAliveIntervalSeconds != 30 {
		t.Errorf("expected KeepAliveIntervalSeconds=30, got %d", cfg.SSH.KeepAliveIntervalSeconds)
	}
	if cfg.SSH.KeepAliveMaxMissed != 3 {
		t.Errorf("expected KeepAliveMaxMissed=3, got %d", cfg.SSH.KeepAliveMaxMissed)
	}
	if cfg.SSH.ConnectionTimeoutSeconds != 15 {
		t.Errorf("expected ConnectionTimeoutSeconds=15, got %d", cfg.SSH.ConnectionTimeoutSeconds)
	}
}
