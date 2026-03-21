package sshconfig

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/kevinburke/ssh_config"
)

// Entry represents a host parsed from ~/.ssh/config.
type Entry struct {
	Alias    string `json:"alias"`
	Hostname string `json:"hostname"`
	Port     int    `json:"port"`
	User     string `json:"user"`
}

// List parses ~/.ssh/config and returns all non-wildcard host entries.
func List() ([]Entry, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return []Entry{}, nil
	}
	cfgPath := filepath.Join(home, ".ssh", "config")
	f, err := os.Open(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Entry{}, nil
		}
		return nil, err
	}
	defer f.Close()

	cfg, err := ssh_config.Decode(f)
	if err != nil {
		return nil, err
	}

	var entries []Entry
	for _, host := range cfg.Hosts {
		for _, pattern := range host.Patterns {
			alias := pattern.String()
			if alias == "*" || strings.Contains(alias, "*") || strings.Contains(alias, "?") {
				continue
			}

			hostname, _ := cfg.Get(alias, "HostName")
			if hostname == "" {
				hostname = alias
			}

			portStr, _ := cfg.Get(alias, "Port")
			port := 22
			if portStr != "" {
				if p, err := strconv.Atoi(portStr); err == nil {
					port = p
				}
			}

			user, _ := cfg.Get(alias, "User")
			if user == "" {
				user = os.Getenv("USER")
			}

			entries = append(entries, Entry{
				Alias:    alias,
				Hostname: hostname,
				Port:     port,
				User:     user,
			})
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Alias < entries[j].Alias
	})

	if entries == nil {
		entries = []Entry{}
	}
	return entries, nil
}
