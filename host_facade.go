package main

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/sshconfig"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// PingResult is the TCP reachability result for one host.
type PingResult struct {
	HostID    string `json:"hostId"`
	LatencyMs int64  `json:"latencyMs"` // -1 = unreachable / timed out
}

// HostFacade handles host CRUD, groups, terminal profiles, SSH config imports,
// ping, and workspace templates.
type HostFacade struct {
	d *deps.Deps
}

// NewHostFacade creates a new HostFacade.
func NewHostFacade(d *deps.Deps) *HostFacade {
	return &HostFacade{d: d}
}

// checkVaultUnlocked returns an error if the vault is enabled and locked.
// It also resets the idle timer on successful access.
func (f *HostFacade) checkVaultUnlocked() error {
	if f.d.Cfg.Vault.Enabled && f.d.LockState != nil && f.d.LockState.IsLocked() {
		return fmt.Errorf("vault is locked")
	}
	if f.d.LockState != nil {
		f.d.LockState.Touch()
	}
	return nil
}

// --- Host CRUD ---

func (f *HostFacade) ListHosts() ([]store.Host, error) {
	return f.d.Store.ListHosts()
}

func (f *HostFacade) AddHost(input store.CreateHostInput) (store.Host, error) {
	if err := f.checkVaultUnlocked(); err != nil {
		return store.Host{}, err
	}
	return f.d.Store.AddHost(input)
}

func (f *HostFacade) UpdateHost(input store.UpdateHostInput) (store.Host, error) {
	if err := f.checkVaultUnlocked(); err != nil {
		return store.Host{}, err
	}
	return f.d.Store.UpdateHost(input)
}

func (f *HostFacade) DeleteHost(id string) error {
	return f.d.Store.DeleteHost(id)
}

// --- Terminal Profile CRUD ---

func (f *HostFacade) ListTerminalProfiles() ([]store.TerminalProfile, error) {
	return f.d.Store.ListProfiles()
}

func (f *HostFacade) AddTerminalProfile(input store.CreateProfileInput) (store.TerminalProfile, error) {
	return f.d.Store.AddProfile(input)
}

func (f *HostFacade) UpdateTerminalProfile(input store.UpdateProfileInput) (store.TerminalProfile, error) {
	return f.d.Store.UpdateProfile(input)
}

func (f *HostFacade) DeleteTerminalProfile(id string) error {
	return f.d.Store.DeleteProfile(id)
}

// --- Group CRUD ---

func (f *HostFacade) ListGroups() ([]store.Group, error) {
	return f.d.Store.ListGroups()
}

func (f *HostFacade) AddGroup(input store.CreateGroupInput) (store.Group, error) {
	return f.d.Store.AddGroup(input)
}

func (f *HostFacade) UpdateGroup(input store.UpdateGroupInput) (store.Group, error) {
	return f.d.Store.UpdateGroup(input)
}

func (f *HostFacade) DeleteGroup(id string) error {
	return f.d.Store.DeleteGroup(id)
}

// --- SSH Config ---

func (f *HostFacade) ListSSHConfigHosts() ([]sshconfig.Entry, error) {
	return sshconfig.List()
}

// ImportSSHConfigHosts imports the specified aliases from ~/.ssh/config into the hosts DB.
// Skips entries that already exist (matched on hostname+port+user).
func (f *HostFacade) ImportSSHConfigHosts(aliases []string) ([]store.Host, error) {
	all, err := sshconfig.List()
	if err != nil {
		return nil, err
	}

	byAlias := make(map[string]sshconfig.Entry, len(all))
	for _, e := range all {
		byAlias[e.Alias] = e
	}

	var imported []store.Host
	for _, alias := range aliases {
		e, ok := byAlias[alias]
		if !ok {
			continue
		}

		exists, err := f.d.Store.HostExists(e.Hostname, e.Port, e.User)
		if err != nil {
			return nil, err
		}
		if exists {
			continue
		}

		host, err := f.d.Store.AddHost(store.CreateHostInput{
			Label:      alias,
			Hostname:   e.Hostname,
			Port:       e.Port,
			Username:   e.User,
			AuthMethod: store.AuthAgent,
		})
		if err != nil {
			return nil, err
		}
		imported = append(imported, host)
	}

	if imported == nil {
		imported = []store.Host{}
	}
	return imported, nil
}

// --- Host Health ---

// PingHosts performs concurrent TCP pings on each host's SSH port (5 s timeout).
func (f *HostFacade) PingHosts(hostIDs []string) []PingResult {
	hosts, _ := f.d.Store.ListHosts()
	hostMap := make(map[string]store.Host, len(hosts))
	for _, h := range hosts {
		hostMap[h.ID] = h
	}

	results := make([]PingResult, len(hostIDs))
	var wg sync.WaitGroup
	for i, id := range hostIDs {
		wg.Add(1)
		go func(idx int, hostID string) {
			defer wg.Done()
			r := PingResult{HostID: hostID, LatencyMs: -1}
			if h, ok := hostMap[hostID]; ok {
				addr := net.JoinHostPort(h.Hostname, fmt.Sprintf("%d", h.Port))
				start := time.Now()
				conn, err := net.DialTimeout("tcp", addr, time.Duration(f.d.Cfg.SSH.TCPPingTimeoutSeconds)*time.Second)
				if err == nil {
					r.LatencyMs = time.Since(start).Milliseconds()
					conn.Close()
				}
			}
			results[idx] = r
		}(i, id)
	}
	wg.Wait()
	return results
}

// --- Workspace Templates ---

func (f *HostFacade) SaveWorkspaceTemplate(input store.CreateTemplateInput) (store.WorkspaceTemplate, error) {
	return f.d.Store.SaveWorkspaceTemplate(input)
}

func (f *HostFacade) ListWorkspaceTemplates() ([]store.WorkspaceTemplate, error) {
	return f.d.Store.ListWorkspaceTemplates()
}

func (f *HostFacade) DeleteWorkspaceTemplate(id string) error {
	return f.d.Store.DeleteWorkspaceTemplate(id)
}
