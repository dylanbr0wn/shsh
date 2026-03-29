package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config holds application-level settings that are not per-host.
// All values have sensible defaults via Default().
type Config struct {
	SSH         SSHConfig         `json:"ssh"`
	SFTP        SFTPConfig        `json:"sftp"`
	Window      WindowConfig      `json:"window"`
	Log         LogConfig         `json:"log"`
	Debug       DebugConfig       `json:"debug"`
	Keybindings map[string]string `json:"keybindings,omitempty"`
}

// LogConfig controls application logging behaviour.
type LogConfig struct {
	// Level is the minimum log level: trace, debug, info, warn, error, disabled.
	Level string `json:"level"`
	// MaxSizeMB is the maximum size of shsh.log in megabytes before rotation.
	MaxSizeMB int `json:"max_size_mb"`
	// MaxBackups is the number of rotated log files to retain.
	MaxBackups int `json:"max_backups"`
	// MaxAgeDays is the number of days to retain rotated log files.
	MaxAgeDays int `json:"max_age_days"`
	// SessionLoggingEnabled controls whether terminal session logging is allowed.
	// When false, StartSessionLog calls are rejected. Defaults to true.
	SessionLoggingEnabled bool `json:"session_logging_enabled"`
}

// DebugConfig controls the debug panel and structured log emission.
type DebugConfig struct {
	// DefaultLevel is the global minimum level for the debug sink: trace, debug, info, warn, error.
	DefaultLevel string `json:"default_level"`
	// CategoryLevels holds per-category level overrides (e.g. {"ssh": "trace"}).
	CategoryLevels map[string]string `json:"category_levels"`
	// RingBufferSize is the max entries held in the frontend ring buffer.
	RingBufferSize int `json:"ring_buffer_size"`
	// PersistenceMaxSizeMB is the max size of debug.jsonl before rotation.
	PersistenceMaxSizeMB int `json:"persistence_max_size_mb"`
	// PersistenceMaxBackups is the number of rotated debug.jsonl files to retain.
	PersistenceMaxBackups int `json:"persistence_max_backups"`
	// PersistenceMaxAgeDays is the number of days to retain rotated debug log files.
	PersistenceMaxAgeDays int `json:"persistence_max_age_days"`
}

// SSHConfig controls SSH connection behaviour.
type SSHConfig struct {
	// ConnectionTimeoutSeconds is the dial timeout when establishing an SSH connection.
	ConnectionTimeoutSeconds int `json:"connection_timeout_seconds"`
	// HostKeyVerificationTimeoutSeconds is how long to wait for the user to accept/reject an unknown host key.
	HostKeyVerificationTimeoutSeconds int `json:"host_key_verification_timeout_seconds"`
	// TCPPingTimeoutSeconds is the timeout used when TCP-pinging hosts for health checks.
	TCPPingTimeoutSeconds int `json:"tcp_ping_timeout_seconds"`
	// DefaultRSAKeyBits is the default bit length used when generating RSA keys.
	DefaultRSAKeyBits int `json:"default_rsa_key_bits"`
	// TerminalType is the TERM value requested for PTY sessions.
	TerminalType string `json:"terminal_type"`
	// PortForwardBindAddress is the local address port forwards listen on.
	PortForwardBindAddress string `json:"port_forward_bind_address"`
	// ReconnectEnabled controls whether dropped connections auto-reconnect.
	ReconnectEnabled bool `json:"reconnect_enabled"`
	// ReconnectMaxRetries is the max reconnect attempts before giving up.
	ReconnectMaxRetries int `json:"reconnect_max_retries"`
	// ReconnectInitialDelaySeconds is the delay before the first retry.
	ReconnectInitialDelaySeconds int `json:"reconnect_initial_delay_seconds"`
	// ReconnectMaxDelaySeconds caps the exponential backoff delay.
	ReconnectMaxDelaySeconds int `json:"reconnect_max_delay_seconds"`
	// KeepAliveIntervalSeconds is the interval between SSH keep-alive pings.
	KeepAliveIntervalSeconds int `json:"keep_alive_interval_seconds"`
	// KeepAliveMaxMissed is how many missed keep-alive pings trigger disconnect.
	KeepAliveMaxMissed int `json:"keep_alive_max_missed"`
}

// SFTPConfig controls SFTP transfer behaviour.
type SFTPConfig struct {
	// BufferSizeKB is the I/O buffer size in kibibytes used for file transfers.
	BufferSizeKB int `json:"buffer_size_kb"`
}

// WindowConfig controls the initial window geometry.
type WindowConfig struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Default returns a Config populated with sensible defaults.
func Default() *Config {
	return &Config{
		SSH: SSHConfig{
			ConnectionTimeoutSeconds:          15,
			HostKeyVerificationTimeoutSeconds: 120,
			TCPPingTimeoutSeconds:             5,
			DefaultRSAKeyBits:                 4096,
			TerminalType:                      "xterm-256color",
			PortForwardBindAddress:            "127.0.0.1",
			ReconnectEnabled:                  true,
			ReconnectMaxRetries:               5,
			ReconnectInitialDelaySeconds:      2,
			ReconnectMaxDelaySeconds:          30,
			KeepAliveIntervalSeconds:          30,
			KeepAliveMaxMissed:                3,
		},
		SFTP: SFTPConfig{
			BufferSizeKB: 32,
		},
		Window: WindowConfig{
			Width:  1280,
			Height: 800,
		},
		Log: LogConfig{
			Level:                 "info",
			MaxSizeMB:             10,
			MaxBackups:            3,
			MaxAgeDays:            30,
			SessionLoggingEnabled: true,
		},
		Debug: DebugConfig{
			DefaultLevel:          "info",
			CategoryLevels:        map[string]string{},
			RingBufferSize:        10000,
			PersistenceMaxSizeMB:  10,
			PersistenceMaxBackups: 3,
			PersistenceMaxAgeDays: 30,
		},
	}
}

// DefaultConfigPath returns the canonical path for the config file,
// typically ~/.config/shsh/config.json.
func DefaultConfigPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "shsh", "config.json")
	}
	return filepath.Join(configDir, "shsh", "config.json")
}

// Load reads the config file at path, merging it on top of Default().
// If the file does not exist, Default() is returned with no error.
func Load(path string) (*Config, error) {
	cfg := Default()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

// Save writes the config as formatted JSON to path.
func (c *Config) Save(path string) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
