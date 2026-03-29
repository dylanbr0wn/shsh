package store

import (
	"context"
	"fmt"
	"testing"
)

// fakeResolver is a test double for CredentialResolver that records calls
// and returns canned values.
type fakeResolver struct {
	// InlineSecretFn, if set, overrides InlineSecret behavior.
	InlineSecretFn func(key, fallback string) (string, error)
	// ResolveFn, if set, overrides Resolve behavior.
	ResolveFn func(ctx context.Context, source, ref string) (string, error)
	// StoreSecretFn, if set, overrides StoreSecret behavior.
	StoreSecretFn func(key, value string) error

	storedSecrets  map[string]string
	deletedSecrets []string
}

func newFakeResolver() *fakeResolver {
	return &fakeResolver{storedSecrets: make(map[string]string)}
}

func (f *fakeResolver) Resolve(ctx context.Context, source, ref string) (string, error) {
	if f.ResolveFn != nil {
		return f.ResolveFn(ctx, source, ref)
	}
	return "", fmt.Errorf("unexpected Resolve call: source=%s ref=%s", source, ref)
}

func (f *fakeResolver) InlineSecret(key, fallback string) (string, error) {
	if f.InlineSecretFn != nil {
		return f.InlineSecretFn(key, fallback)
	}
	// Default: return whatever was stored, else fallback.
	if pw, ok := f.storedSecrets[key]; ok {
		return pw, nil
	}
	return fallback, nil
}

func (f *fakeResolver) StoreSecret(key, value string) error {
	if f.StoreSecretFn != nil {
		return f.StoreSecretFn(key, value)
	}
	f.storedSecrets[key] = value
	return nil
}

func (f *fakeResolver) DeleteSecret(key string) error {
	delete(f.storedSecrets, key)
	f.deletedSecrets = append(f.deletedSecrets, key)
	return nil
}

func newTestStore(t *testing.T) (*Store, *fakeResolver) {
	t.Helper()
	fr := newFakeResolver()
	s, err := New(":memory:", fr)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Close)
	return s, fr
}

func TestNew_MigrationIdempotent(t *testing.T) {
	// Opening the same in-memory DB twice would be a separate DB, so just
	// verify that New succeeds and the schema is ready to use.
	s, _ := newTestStore(t)
	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts after New: %v", err)
	}
	if len(hosts) != 0 {
		t.Fatalf("expected empty DB, got %d hosts", len(hosts))
	}
}

func TestListHosts_EmptyReturnsSliceNotNil(t *testing.T) {
	s, _ := newTestStore(t)
	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if hosts == nil {
		t.Fatal("ListHosts returned nil, want empty slice")
	}
}

func TestAddHost(t *testing.T) {
	s, _ := newTestStore(t)

	input := CreateHostInput{
		Label:      "prod",
		Hostname:   "prod.example.com",
		Port:       22,
		Username:   "alice",
		AuthMethod: AuthPassword,
		Password:   "s3cr3t",
	}
	host, err := s.AddHost(input)
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	if host.ID == "" {
		t.Error("expected non-empty ID")
	}
	if host.Label != input.Label {
		t.Errorf("Label = %q, want %q", host.Label, input.Label)
	}
	if host.Hostname != input.Hostname {
		t.Errorf("Hostname = %q, want %q", host.Hostname, input.Hostname)
	}
	if host.Port != input.Port {
		t.Errorf("Port = %d, want %d", host.Port, input.Port)
	}
	if host.Username != input.Username {
		t.Errorf("Username = %q, want %q", host.Username, input.Username)
	}
	if host.AuthMethod != input.AuthMethod {
		t.Errorf("AuthMethod = %q, want %q", host.AuthMethod, input.AuthMethod)
	}
	if host.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
	if host.LastConnectedAt != nil {
		t.Error("expected nil LastConnectedAt for new host")
	}
}

func TestListHosts_OrderedByCreatedAt(t *testing.T) {
	s, _ := newTestStore(t)

	for _, label := range []string{"alpha", "beta", "gamma"} {
		_, err := s.AddHost(CreateHostInput{Label: label, Hostname: label + ".example.com", Port: 22, Username: "u", AuthMethod: AuthAgent})
		if err != nil {
			t.Fatalf("AddHost %q: %v", label, err)
		}
	}

	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 3 {
		t.Fatalf("expected 3 hosts, got %d", len(hosts))
	}
	labels := []string{hosts[0].Label, hosts[1].Label, hosts[2].Label}
	want := []string{"alpha", "beta", "gamma"}
	for i := range want {
		if labels[i] != want[i] {
			t.Errorf("hosts[%d].Label = %q, want %q", i, labels[i], want[i])
		}
	}
}

func TestUpdateHost(t *testing.T) {
	s, _ := newTestStore(t)

	host, err := s.AddHost(CreateHostInput{Label: "old", Hostname: "old.example.com", Port: 22, Username: "u", AuthMethod: AuthPassword})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	updated, err := s.UpdateHost(UpdateHostInput{
		ID:         host.ID,
		Label:      "new",
		Hostname:   "new.example.com",
		Port:       2222,
		Username:   "bob",
		AuthMethod: AuthAgent,
	})
	if err != nil {
		t.Fatalf("UpdateHost: %v", err)
	}

	if updated.ID != host.ID {
		t.Errorf("ID changed: got %q, want %q", updated.ID, host.ID)
	}
	if updated.Label != "new" {
		t.Errorf("Label = %q, want %q", updated.Label, "new")
	}
	if updated.Hostname != "new.example.com" {
		t.Errorf("Hostname = %q, want %q", updated.Hostname, "new.example.com")
	}
	if updated.Port != 2222 {
		t.Errorf("Port = %d, want 2222", updated.Port)
	}
}

func TestDeleteHost(t *testing.T) {
	s, _ := newTestStore(t)

	host, err := s.AddHost(CreateHostInput{Label: "tmp", Hostname: "tmp.example.com", Port: 22, Username: "u", AuthMethod: AuthPassword})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	if err := s.DeleteHost(host.ID); err != nil {
		t.Fatalf("DeleteHost: %v", err)
	}

	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	for _, h := range hosts {
		if h.ID == host.ID {
			t.Error("deleted host still present in ListHosts")
		}
	}
}

func TestGetHostForConnect(t *testing.T) {
	s, _ := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{Label: "l", Hostname: "h.example.com", Port: 22, Username: "u", AuthMethod: AuthPassword, Password: "pw"})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	host, password, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if host.ID != added.ID {
		t.Errorf("ID = %q, want %q", host.ID, added.ID)
	}
	if password != "pw" {
		t.Errorf("password = %q, want %q", password, "pw")
	}
}

func TestGetHostForConnect_EmptyPasswordCoalesces(t *testing.T) {
	s, _ := newTestStore(t)

	// Add a host with no password (agent auth).
	added, err := s.AddHost(CreateHostInput{Label: "l", Hostname: "h.example.com", Port: 22, Username: "u", AuthMethod: AuthAgent})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, password, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if password != "" {
		t.Errorf("expected empty password via COALESCE, got %q", password)
	}
}

func TestAddHost_CredentialSourceStored(t *testing.T) {
	s, _ := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{
		Label:            "pm",
		Hostname:         "pm.example.com",
		Port:             22,
		Username:         "u",
		AuthMethod:       AuthPassword,
		CredentialSource: "1password",
		CredentialRef:    "op://Personal/MyServer/password",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}
	if added.CredentialSource != "1password" {
		t.Errorf("CredentialSource = %q, want %q", added.CredentialSource, "1password")
	}
	if added.CredentialRef != "op://Personal/MyServer/password" {
		t.Errorf("CredentialRef = %q, want %q", added.CredentialRef, "op://Personal/MyServer/password")
	}

	// Round-trip through ListHosts
	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("expected 1 host, got %d", len(hosts))
	}
	if hosts[0].CredentialSource != "1password" {
		t.Errorf("ListHosts CredentialSource = %q, want %q", hosts[0].CredentialSource, "1password")
	}
}

func TestUpdateHost_CredentialSourceRoundTrip(t *testing.T) {
	s, _ := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{
		Label:      "h",
		Hostname:   "h.example.com",
		Port:       22,
		Username:   "u",
		AuthMethod: AuthPassword,
		Password:   "inline-pw",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}
	if added.CredentialSource != "inline" {
		t.Errorf("initial CredentialSource = %q, want inline", added.CredentialSource)
	}

	updated, err := s.UpdateHost(UpdateHostInput{
		ID:               added.ID,
		Label:            added.Label,
		Hostname:         added.Hostname,
		Port:             added.Port,
		Username:         added.Username,
		AuthMethod:       AuthPassword,
		CredentialSource: "bitwarden",
		CredentialRef:    "MyServer",
	})
	if err != nil {
		t.Fatalf("UpdateHost: %v", err)
	}
	if updated.CredentialSource != "bitwarden" {
		t.Errorf("updated CredentialSource = %q, want bitwarden", updated.CredentialSource)
	}
	if updated.CredentialRef != "MyServer" {
		t.Errorf("updated CredentialRef = %q, want MyServer", updated.CredentialRef)
	}
}

func TestGetHostForConnect_NotFound(t *testing.T) {
	s, _ := newTestStore(t)

	_, _, err := s.GetHostForConnect("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for missing host, got nil")
	}
}

func TestTouchLastConnected(t *testing.T) {
	s, _ := newTestStore(t)

	host, err := s.AddHost(CreateHostInput{Label: "l", Hostname: "h.example.com", Port: 22, Username: "u", AuthMethod: AuthPassword})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	if host.LastConnectedAt != nil {
		t.Fatal("expected nil LastConnectedAt before touch")
	}

	s.TouchLastConnected(host.ID)

	hosts, err := s.ListHosts()
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if hosts[0].LastConnectedAt == nil {
		t.Error("expected non-nil LastConnectedAt after touch")
	}
}

func TestTouchLastConnected_UnknownIDSilent(t *testing.T) {
	s, _ := newTestStore(t)
	// Must not panic or cause errors.
	s.TouchLastConnected("ghost-id")
}

func TestHostExists(t *testing.T) {
	s, _ := newTestStore(t)

	_, err := s.AddHost(CreateHostInput{Label: "l", Hostname: "h.example.com", Port: 22, Username: "u", AuthMethod: AuthPassword})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	exists, err := s.HostExists("h.example.com", 22, "u")
	if err != nil {
		t.Fatalf("HostExists: %v", err)
	}
	if !exists {
		t.Error("expected HostExists to return true")
	}

	exists, err = s.HostExists("h.example.com", 2222, "u")
	if err != nil {
		t.Fatalf("HostExists (different port): %v", err)
	}
	if exists {
		t.Error("expected HostExists to return false for different port")
	}

	exists, err = s.HostExists("other.example.com", 22, "u")
	if err != nil {
		t.Fatalf("HostExists (different host): %v", err)
	}
	if exists {
		t.Error("expected HostExists to return false for different hostname")
	}
}

// --- Credential-path tests ---

func TestGetHostForConnect_InlineKeychain(t *testing.T) {
	s, fr := newTestStore(t)
	fr.InlineSecretFn = func(key, fallback string) (string, error) {
		return "keychain-pw", nil
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "db-pw",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, pw, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if pw != "keychain-pw" {
		t.Errorf("password = %q, want %q", pw, "keychain-pw")
	}
}

func TestGetHostForConnect_KeychainUnavailable(t *testing.T) {
	s, fr := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "db-fallback",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	// Simulate the state where keychain was unavailable at AddHost time:
	// the password is stored in the DB column as fallback.
	s.db.Exec(`UPDATE hosts SET password=? WHERE id=?`, "db-fallback", added.ID) //nolint:errcheck

	// Make InlineSecret fail (keychain unavailable at connect time).
	fr.InlineSecretFn = func(key, fallback string) (string, error) {
		return "", ErrKeychainUnavailable
	}

	_, pw, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if pw != "db-fallback" {
		t.Errorf("password = %q, want %q (DB fallback)", pw, "db-fallback")
	}
}

func TestGetHostForConnect_ExternalPM(t *testing.T) {
	s, fr := newTestStore(t)
	fr.ResolveFn = func(ctx context.Context, source, ref string) (string, error) {
		if source != "1password" {
			t.Errorf("source = %q, want 1password", source)
		}
		if ref != "op://Vault/Item/password" {
			t.Errorf("ref = %q, want op://Vault/Item/password", ref)
		}
		return "pm-secret", nil
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "pm", Hostname: "pm.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword,
		CredentialSource: "1password",
		CredentialRef:    "op://Vault/Item/password",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, pw, err := s.GetHostForConnect(added.ID)
	if err != nil {
		t.Fatalf("GetHostForConnect: %v", err)
	}
	if pw != "pm-secret" {
		t.Errorf("password = %q, want %q", pw, "pm-secret")
	}
}

func TestGetHostForConnect_ExternalPMTimeout(t *testing.T) {
	s, fr := newTestStore(t)
	fr.ResolveFn = func(ctx context.Context, source, ref string) (string, error) {
		return "", context.DeadlineExceeded
	}

	added, err := s.AddHost(CreateHostInput{
		Label: "pm", Hostname: "pm.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword,
		CredentialSource: "bitwarden",
		CredentialRef:    "MyServer",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	_, _, err = s.GetHostForConnect(added.ID)
	if err == nil {
		t.Fatal("expected error for timed-out PM fetch, got nil")
	}
}

func TestAddHost_StoresSecret(t *testing.T) {
	s, fr := newTestStore(t)

	_, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "s3cret",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	if len(fr.storedSecrets) == 0 {
		t.Fatal("expected StoreSecret to be called")
	}
	for _, v := range fr.storedSecrets {
		if v == "s3cret" {
			return
		}
	}
	t.Errorf("expected stored secret to contain %q, got %v", "s3cret", fr.storedSecrets)
}

func TestDeleteHost_DeletesSecrets(t *testing.T) {
	s, fr := newTestStore(t)

	added, err := s.AddHost(CreateHostInput{
		Label: "l", Hostname: "h.example.com", Port: 22,
		Username: "u", AuthMethod: AuthPassword, Password: "pw",
	})
	if err != nil {
		t.Fatalf("AddHost: %v", err)
	}

	fr.deletedSecrets = nil // reset

	if err := s.DeleteHost(added.ID); err != nil {
		t.Fatalf("DeleteHost: %v", err)
	}

	if len(fr.deletedSecrets) < 2 {
		t.Fatalf("expected at least 2 DeleteSecret calls, got %d", len(fr.deletedSecrets))
	}
	found := map[string]bool{}
	for _, k := range fr.deletedSecrets {
		found[k] = true
	}
	if !found[added.ID] {
		t.Errorf("expected DeleteSecret(%q), not found in %v", added.ID, fr.deletedSecrets)
	}
	if !found[added.ID+":passphrase"] {
		t.Errorf("expected DeleteSecret(%q), not found in %v", added.ID+":passphrase", fr.deletedSecrets)
	}
}

// --- vaultFakeResolver and vault test infrastructure ---

type vaultFakeResolver struct {
	fakeResolver
}

var testVaultKey = []byte("01234567890123456789012345678901")

func newTestStoreWithVault(t *testing.T) (*Store, *vaultFakeResolver) {
	t.Helper()
	vfr := &vaultFakeResolver{fakeResolver: *newFakeResolver()}
	s, err := New(":memory:", &vfr.fakeResolver)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	s.SetVaultKeyFunc(func() ([]byte, error) { return testVaultKey, nil })
	t.Cleanup(s.Close)
	return s, vfr
}

// --- Group CRUD tests ---

func TestAddGroup(t *testing.T) {
	s, _ := newTestStore(t)

	g1, err := s.AddGroup(CreateGroupInput{Name: "Servers"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	if g1.Name != "Servers" {
		t.Errorf("Name = %q, want %q", g1.Name, "Servers")
	}
	if g1.SortOrder != 0 {
		t.Errorf("SortOrder = %d, want 0", g1.SortOrder)
	}

	g2, err := s.AddGroup(CreateGroupInput{Name: "Dev"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	if g2.SortOrder != 1 {
		t.Errorf("SortOrder = %d, want 1", g2.SortOrder)
	}
}

func TestListGroups(t *testing.T) {
	s, _ := newTestStore(t)

	for _, name := range []string{"C", "A", "B"} {
		if _, err := s.AddGroup(CreateGroupInput{Name: name}); err != nil {
			t.Fatalf("AddGroup %q: %v", name, err)
		}
	}

	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	if len(groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(groups))
	}
	// Added in order, so sort_order is 0, 1, 2 which matches insertion order.
	want := []string{"C", "A", "B"}
	for i, g := range groups {
		if g.Name != want[i] {
			t.Errorf("groups[%d].Name = %q, want %q", i, g.Name, want[i])
		}
	}
}

func TestListGroups_EmptyReturnsSlice(t *testing.T) {
	s, _ := newTestStore(t)

	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	if groups == nil {
		t.Fatal("ListGroups returned nil, want empty slice")
	}
	if len(groups) != 0 {
		t.Fatalf("expected 0 groups, got %d", len(groups))
	}
}

func TestUpdateGroup(t *testing.T) {
	s, _ := newTestStore(t)

	// Create a profile to assign.
	p, err := s.AddProfile(CreateProfileInput{Name: "mono", FontSize: 12, CursorStyle: "block", Scrollback: 1000, ColorTheme: "dark"})
	if err != nil {
		t.Fatalf("AddProfile: %v", err)
	}

	g, err := s.AddGroup(CreateGroupInput{Name: "Old"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}

	updated, err := s.UpdateGroup(UpdateGroupInput{
		ID:                g.ID,
		Name:              "New",
		SortOrder:         5,
		TerminalProfileID: &p.ID,
	})
	if err != nil {
		t.Fatalf("UpdateGroup: %v", err)
	}
	if updated.Name != "New" {
		t.Errorf("Name = %q, want %q", updated.Name, "New")
	}
	if updated.SortOrder != 5 {
		t.Errorf("SortOrder = %d, want 5", updated.SortOrder)
	}
	if updated.TerminalProfileID == nil || *updated.TerminalProfileID != p.ID {
		t.Errorf("TerminalProfileID = %v, want %q", updated.TerminalProfileID, p.ID)
	}
}

func TestDeleteGroup(t *testing.T) {
	s, _ := newTestStore(t)

	g, err := s.AddGroup(CreateGroupInput{Name: "Tmp"})
	if err != nil {
		t.Fatalf("AddGroup: %v", err)
	}
	if err := s.DeleteGroup(g.ID); err != nil {
		t.Fatalf("DeleteGroup: %v", err)
	}

	groups, err := s.ListGroups()
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	for _, gr := range groups {
		if gr.ID == g.ID {
			t.Error("deleted group still present")
		}
	}
}

func TestAddGroup_SortOrderAfterDeletion(t *testing.T) {
	s, _ := newTestStore(t)

	g1, err := s.AddGroup(CreateGroupInput{Name: "A"})
	if err != nil {
		t.Fatalf("AddGroup A: %v", err)
	}
	g2, err := s.AddGroup(CreateGroupInput{Name: "B"})
	if err != nil {
		t.Fatalf("AddGroup B: %v", err)
	}
	if g2.SortOrder != 1 {
		t.Fatalf("B SortOrder = %d, want 1", g2.SortOrder)
	}

	// Delete first group; next sort_order should still increment past max.
	if err := s.DeleteGroup(g1.ID); err != nil {
		t.Fatalf("DeleteGroup: %v", err)
	}

	g3, err := s.AddGroup(CreateGroupInput{Name: "C"})
	if err != nil {
		t.Fatalf("AddGroup C: %v", err)
	}
	if g3.SortOrder != 2 {
		t.Errorf("C SortOrder = %d, want 2 (should not compact)", g3.SortOrder)
	}
}

// --- Terminal Profile CRUD tests ---

func TestAddProfile(t *testing.T) {
	s, _ := newTestStore(t)

	p, err := s.AddProfile(CreateProfileInput{
		Name:        "Dev",
		FontSize:    16,
		CursorStyle: "underline",
		CursorBlink: true,
		Scrollback:  10000,
		ColorTheme:  "monokai",
	})
	if err != nil {
		t.Fatalf("AddProfile: %v", err)
	}
	if p.ID == "" {
		t.Error("expected non-empty ID")
	}
	if p.Name != "Dev" {
		t.Errorf("Name = %q, want %q", p.Name, "Dev")
	}
	if p.FontSize != 16 {
		t.Errorf("FontSize = %d, want 16", p.FontSize)
	}
	if p.CursorStyle != "underline" {
		t.Errorf("CursorStyle = %q, want %q", p.CursorStyle, "underline")
	}
	if !p.CursorBlink {
		t.Error("CursorBlink = false, want true")
	}
	if p.Scrollback != 10000 {
		t.Errorf("Scrollback = %d, want 10000", p.Scrollback)
	}
	if p.ColorTheme != "monokai" {
		t.Errorf("ColorTheme = %q, want %q", p.ColorTheme, "monokai")
	}
	if p.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
}

func TestListProfiles(t *testing.T) {
	s, _ := newTestStore(t)

	for _, name := range []string{"A", "B", "C"} {
		if _, err := s.AddProfile(CreateProfileInput{Name: name, FontSize: 14, CursorStyle: "block", Scrollback: 1000, ColorTheme: "auto"}); err != nil {
			t.Fatalf("AddProfile %q: %v", name, err)
		}
	}

	profiles, err := s.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles: %v", err)
	}
	if len(profiles) != 3 {
		t.Fatalf("expected 3 profiles, got %d", len(profiles))
	}
}

func TestUpdateProfile(t *testing.T) {
	s, _ := newTestStore(t)

	p, err := s.AddProfile(CreateProfileInput{
		Name:        "Old",
		FontSize:    14,
		CursorStyle: "block",
		CursorBlink: true,
		Scrollback:  5000,
		ColorTheme:  "auto",
	})
	if err != nil {
		t.Fatalf("AddProfile: %v", err)
	}

	updated, err := s.UpdateProfile(UpdateProfileInput{
		ID:          p.ID,
		Name:        "New",
		FontSize:    18,
		CursorStyle: "bar",
		CursorBlink: false,
		Scrollback:  2000,
		ColorTheme:  "solarized",
	})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if updated.Name != "New" {
		t.Errorf("Name = %q, want %q", updated.Name, "New")
	}
	if updated.FontSize != 18 {
		t.Errorf("FontSize = %d, want 18", updated.FontSize)
	}
	if updated.CursorStyle != "bar" {
		t.Errorf("CursorStyle = %q, want %q", updated.CursorStyle, "bar")
	}
	if updated.CursorBlink {
		t.Error("CursorBlink = true, want false")
	}
	if updated.Scrollback != 2000 {
		t.Errorf("Scrollback = %d, want 2000", updated.Scrollback)
	}
	if updated.ColorTheme != "solarized" {
		t.Errorf("ColorTheme = %q, want %q", updated.ColorTheme, "solarized")
	}
}

func TestDeleteProfile(t *testing.T) {
	s, _ := newTestStore(t)

	p, err := s.AddProfile(CreateProfileInput{Name: "Tmp", FontSize: 14, CursorStyle: "block", Scrollback: 1000, ColorTheme: "auto"})
	if err != nil {
		t.Fatalf("AddProfile: %v", err)
	}
	if err := s.DeleteProfile(p.ID); err != nil {
		t.Fatalf("DeleteProfile: %v", err)
	}

	profiles, err := s.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles: %v", err)
	}
	for _, pr := range profiles {
		if pr.ID == p.ID {
			t.Error("deleted profile still present")
		}
	}
}
