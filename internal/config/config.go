package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config holds application-level settings that are not per-host.
// All values have sensible defaults via Default().
type Config struct {
	SSH    SSHConfig    `json:"ssh"`
	SFTP   SFTPConfig   `json:"sftp"`
	Window WindowConfig `json:"window"`
	Log    LogConfig    `json:"log"`
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
			ConnectionTimeoutSeconds:          30,
			HostKeyVerificationTimeoutSeconds: 120,
			TCPPingTimeoutSeconds:             5,
			DefaultRSAKeyBits:                 4096,
			TerminalType:                      "xterm-256color",
			PortForwardBindAddress:            "127.0.0.1",
		},
		SFTP: SFTPConfig{
			BufferSizeKB: 32,
		},
		Window: WindowConfig{
			Width:  1280,
			Height: 800,
		},
		Log: LogConfig{
			Level:      "info",
			MaxSizeMB:  10,
			MaxBackups: 3,
			MaxAgeDays: 30,
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
