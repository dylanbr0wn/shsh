package main

import (
	"fmt"
	"slices"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/regclient"
	"github.com/dylanbr0wn/shsh/internal/registry"
	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/google/uuid"
)

// RegistryFacade exposes registry operations to the frontend via Wails bindings.
type RegistryFacade struct {
	d *deps.Deps
}

// NewRegistryFacade creates a new RegistryFacade.
func NewRegistryFacade(d *deps.Deps) *RegistryFacade {
	return &RegistryFacade{d: d}
}

// RegistryStatus is the response for GetRegistries, enriching config with sync state.
type RegistryStatus struct {
	Name    string   `json:"name"`
	URL     string   `json:"url"`
	Bundles []string `json:"bundles"`
}

// GetRegistries returns the configured registries.
func (f *RegistryFacade) GetRegistries() []RegistryStatus {
	out := make([]RegistryStatus, len(f.d.Cfg.Registries))
	for i, r := range f.d.Cfg.Registries {
		out[i] = RegistryStatus{
			Name:    r.Name,
			URL:     r.URL,
			Bundles: r.Bundles,
		}
	}
	return out
}

// AddRegistryInput is the payload for adding a new registry connection.
type AddRegistryInput struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
}

// AddRegistry adds a new registry connection and persists the config.
func (f *RegistryFacade) AddRegistry(input AddRegistryInput) error {
	for _, r := range f.d.Cfg.Registries {
		if r.Name == input.Name {
			return fmt.Errorf("registry %q already exists", input.Name)
		}
	}
	f.d.Cfg.Registries = append(f.d.Cfg.Registries, config.RegistryConfig{
		Name:    input.Name,
		URL:     input.URL,
		APIKey:  input.APIKey,
		Bundles: []string{},
	})
	return f.d.Cfg.Save(f.d.CfgPath)
}

// RemoveRegistry removes a registry connection by name, cleans up synced hosts/groups, and persists.
func (f *RegistryFacade) RemoveRegistry(name string) error {
	idx := -1
	for i, r := range f.d.Cfg.Registries {
		if r.Name == name {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("registry %q not found", name)
	}

	// Clean up synced data for all bundles in this registry.
	reg := f.d.Cfg.Registries[idx]
	for _, bundle := range reg.Bundles {
		origin := "registry:" + name + "/" + bundle
		f.d.Store.DeleteRegistryBundle(origin) //nolint:errcheck
	}

	f.d.Cfg.Registries = append(f.d.Cfg.Registries[:idx], f.d.Cfg.Registries[idx+1:]...)
	return f.d.Cfg.Save(f.d.CfgPath)
}

// SubscribeBundleInput is the payload for subscribing to a bundle.
type SubscribeBundleInput struct {
	RegistryName string `json:"registryName"`
	Bundle       string `json:"bundle"` // "namespace/name"
}

// SubscribeBundle subscribes to a bundle and immediately pulls the latest version.
func (f *RegistryFacade) SubscribeBundle(input SubscribeBundleInput) error {
	reg := f.findRegistry(input.RegistryName)
	if reg == nil {
		return fmt.Errorf("registry %q not found", input.RegistryName)
	}

	if slices.Contains(reg.Bundles, input.Bundle) {
		return fmt.Errorf("already subscribed to %s", input.Bundle)
	}

	reg.Bundles = append(reg.Bundles, input.Bundle)
	if err := f.d.Cfg.Save(f.d.CfgPath); err != nil {
		return err
	}

	// Best-effort initial pull — the bundle may not have content yet.
	_ = f.pullBundle(reg, input.Bundle)
	return nil
}

// UnsubscribeBundle removes a bundle subscription and cleans up local data.
func (f *RegistryFacade) UnsubscribeBundle(input SubscribeBundleInput) error {
	reg := f.findRegistry(input.RegistryName)
	if reg == nil {
		return fmt.Errorf("registry %q not found", input.RegistryName)
	}

	found := false
	filtered := make([]string, 0, len(reg.Bundles))
	for _, b := range reg.Bundles {
		if b == input.Bundle {
			found = true
			continue
		}
		filtered = append(filtered, b)
	}
	if !found {
		return fmt.Errorf("not subscribed to %s", input.Bundle)
	}
	reg.Bundles = filtered

	origin := "registry:" + reg.Name + "/" + input.Bundle
	f.d.Store.DeleteRegistryBundle(origin) //nolint:errcheck

	return f.d.Cfg.Save(f.d.CfgPath)
}

// SyncBundle pulls the latest version of a bundle from the registry.
func (f *RegistryFacade) SyncBundle(registryName, bundle string) error {
	reg := f.findRegistry(registryName)
	if reg == nil {
		return fmt.Errorf("registry %q not found", registryName)
	}
	return f.pullBundle(reg, bundle)
}

// SyncAllBundles syncs all subscribed bundles across all registries.
func (f *RegistryFacade) SyncAllBundles() error {
	var lastErr error
	for i := range f.d.Cfg.Registries {
		reg := &f.d.Cfg.Registries[i]
		for _, bundle := range reg.Bundles {
			if err := f.pullBundle(reg, bundle); err != nil {
				lastErr = err
			}
		}
	}
	return lastErr
}

// ListRemoteBundles lists all bundles available on a registry for the configured namespace.
func (f *RegistryFacade) ListRemoteBundles(registryName, namespace string) ([]registry.BundleInfo, error) {
	reg := f.findRegistry(registryName)
	if reg == nil {
		return nil, fmt.Errorf("registry %q not found", registryName)
	}
	client := regclient.New(reg.URL, reg.APIKey)
	return client.ListBundles(namespace)
}

// PushBundleInput is the payload for pushing hosts to a registry.
type PushBundleInput struct {
	RegistryName string `json:"registryName"`
	Namespace    string `json:"namespace"`
	Name         string `json:"name"`
	Tag          string `json:"tag"`
	HostIDs      []string `json:"hostIds"`
}

// PushBundle pushes selected hosts as a new bundle version to a registry.
func (f *RegistryFacade) PushBundle(input PushBundleInput) error {
	reg := f.findRegistry(input.RegistryName)
	if reg == nil {
		return fmt.Errorf("registry %q not found", input.RegistryName)
	}

	allHosts, err := f.d.Store.ListHosts()
	if err != nil {
		return err
	}
	allGroups, err := f.d.Store.ListGroups()
	if err != nil {
		return err
	}

	hostMap := make(map[string]store.Host, len(allHosts))
	for _, h := range allHosts {
		hostMap[h.ID] = h
	}
	groupMap := make(map[string]store.Group, len(allGroups))
	for _, g := range allGroups {
		groupMap[g.ID] = g
	}

	var items []registry.HostItem
	for _, id := range input.HostIDs {
		h, ok := hostMap[id]
		if !ok {
			continue
		}
		item := registry.HostItem{
			Label:      h.Label,
			Hostname:   h.Hostname,
			Port:       h.Port,
			Username:   h.Username,
			AuthMethod: string(h.AuthMethod),
			Color:      h.Color,
			Tags:       h.Tags,
		}
		if h.KeyPath != nil {
			item.KeyPath = *h.KeyPath
		}
		if h.GroupID != nil {
			if g, ok := groupMap[*h.GroupID]; ok {
				item.Group = g.Name
			}
		}
		items = append(items, item)
	}

	client := regclient.New(reg.URL, reg.APIKey)
	return client.Push(input.Namespace, input.Name, registry.PushRequest{
		Tag:   input.Tag,
		Hosts: items,
	})
}

func (f *RegistryFacade) findRegistry(name string) *config.RegistryConfig {
	for i := range f.d.Cfg.Registries {
		if f.d.Cfg.Registries[i].Name == name {
			return &f.d.Cfg.Registries[i]
		}
	}
	return nil
}

func (f *RegistryFacade) pullBundle(reg *config.RegistryConfig, bundle string) error {
	ns, name, err := parseBundleRef(bundle)
	if err != nil {
		return err
	}

	client := regclient.New(reg.URL, reg.APIKey)
	b, err := client.Pull(ns, name, "")
	if err != nil {
		return fmt.Errorf("pull %s: %w", bundle, err)
	}

	origin := "registry:" + reg.Name + "/" + bundle
	now := time.Now().UTC().Format(time.RFC3339)

	// Build groups and hosts from the bundle.
	groupNames := map[string]string{} // group name → group ID
	var groups []store.Group
	var hosts []store.Host

	for _, item := range b.Hosts {
		if item.Group != "" {
			if _, ok := groupNames[item.Group]; !ok {
				gID := uuid.NewString()
				groupNames[item.Group] = gID
				groups = append(groups, store.Group{
					ID:        gID,
					Name:      item.Group,
					SortOrder: len(groups),
					CreatedAt: now,
					Origin:    origin,
				})
			}
		}
	}

	for _, item := range b.Hosts {
		h := store.Host{
			ID:         uuid.NewString(),
			Label:      item.Label,
			Hostname:   item.Hostname,
			Port:       item.Port,
			Username:   item.Username,
			AuthMethod: store.AuthMethod(item.AuthMethod),
			CreatedAt:  now,
			Color:      item.Color,
			Tags:       item.Tags,
			Origin:     origin,
		}
		if item.KeyPath != "" {
			h.KeyPath = &item.KeyPath
		}
		if item.Group != "" {
			gID := groupNames[item.Group]
			h.GroupID = &gID
		}
		hosts = append(hosts, h)
	}

	return f.d.Store.SyncRegistryBundle(origin, groups, hosts)
}

func parseBundleRef(ref string) (namespace, name string, err error) {
	for i, c := range ref {
		if c == '/' {
			return ref[:i], ref[i+1:], nil
		}
	}
	return "", "", fmt.Errorf("invalid bundle reference %q: expected namespace/name", ref)
}
