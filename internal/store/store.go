package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dylanbr0wn/shsh/internal/vault"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	_ "modernc.org/sqlite"
)

// AuthMethod represents the SSH authentication method.
type AuthMethod string

const (
	AuthPassword AuthMethod = "password"
	AuthKey      AuthMethod = "key"
	AuthAgent    AuthMethod = "agent"
)

// TerminalProfile is a saved set of terminal appearance/behavior settings.
type TerminalProfile struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	FontSize    int    `json:"fontSize"`
	CursorStyle string `json:"cursorStyle"`
	CursorBlink bool   `json:"cursorBlink"`
	Scrollback  int    `json:"scrollback"`
	ColorTheme  string `json:"colorTheme"`
	CreatedAt   string `json:"createdAt"`
}

// CreateProfileInput is the payload for adding a new terminal profile.
type CreateProfileInput struct {
	Name        string `json:"name"`
	FontSize    int    `json:"fontSize"`
	CursorStyle string `json:"cursorStyle"`
	CursorBlink bool   `json:"cursorBlink"`
	Scrollback  int    `json:"scrollback"`
	ColorTheme  string `json:"colorTheme"`
}

// UpdateProfileInput is the payload for editing a terminal profile.
type UpdateProfileInput struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	FontSize    int    `json:"fontSize"`
	CursorStyle string `json:"cursorStyle"`
	CursorBlink bool   `json:"cursorBlink"`
	Scrollback  int    `json:"scrollback"`
	ColorTheme  string `json:"colorTheme"`
}

// Group represents a named folder for organizing hosts.
type Group struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	SortOrder         int     `json:"sortOrder"`
	CreatedAt         string  `json:"createdAt"`
	TerminalProfileID *string `json:"terminalProfileId,omitempty"`
}

// CreateGroupInput is the payload for adding a new group.
type CreateGroupInput struct {
	Name string `json:"name"`
}

// UpdateGroupInput is the payload for editing a group.
type UpdateGroupInput struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	SortOrder         int     `json:"sortOrder"`
	TerminalProfileID *string `json:"terminalProfileId,omitempty"`
}

// Host represents a saved SSH host entry.
type Host struct {
	ID                string           `json:"id"`
	Label             string           `json:"label"`
	Hostname          string           `json:"hostname"`
	Port              int              `json:"port"`
	Username          string           `json:"username"`
	AuthMethod        AuthMethod       `json:"authMethod"`
	CreatedAt         string           `json:"createdAt"`
	LastConnectedAt   *string          `json:"lastConnectedAt,omitempty"`
	GroupID           *string          `json:"groupId,omitempty"`
	Color             string           `json:"color,omitempty"`
	Tags              []string         `json:"tags,omitempty"`
	TerminalProfileID *string          `json:"terminalProfileId,omitempty"`
	KeyPath           *string          `json:"keyPath,omitempty"`
	CredentialSource  string `json:"credentialSource,omitempty"`
	CredentialRef     string           `json:"credentialRef,omitempty"`
	JumpHostID                   *string          `json:"jumpHostId,omitempty"`
	ReconnectEnabled             *bool            `json:"reconnectEnabled,omitempty"`
	ReconnectMaxRetries          *int             `json:"reconnectMaxRetries,omitempty"`
	ReconnectInitialDelaySeconds *int             `json:"reconnectInitialDelaySeconds,omitempty"`
	ReconnectMaxDelaySeconds     *int             `json:"reconnectMaxDelaySeconds,omitempty"`
	KeepAliveIntervalSeconds     *int             `json:"keepAliveIntervalSeconds,omitempty"`
	KeepAliveMaxMissed           *int             `json:"keepAliveMaxMissed,omitempty"`
}

// CreateHostInput is the payload for adding a new host.
type CreateHostInput struct {
	Label             string           `json:"label"`
	Hostname          string           `json:"hostname"`
	Port              int              `json:"port"`
	Username          string           `json:"username"`
	AuthMethod        AuthMethod       `json:"authMethod"`
	Password          string           `json:"password,omitempty"`
	KeyPath           *string          `json:"keyPath,omitempty"`
	KeyPassphrase     string           `json:"keyPassphrase,omitempty"`
	GroupID           *string          `json:"groupId,omitempty"`
	Color             string           `json:"color,omitempty"`
	Tags              []string         `json:"tags,omitempty"`
	TerminalProfileID *string          `json:"terminalProfileId,omitempty"`
	JumpHostID                   *string          `json:"jumpHostId,omitempty"`
	CredentialSource             string `json:"credentialSource,omitempty"`
	CredentialRef                string           `json:"credentialRef,omitempty"`
	ReconnectEnabled             *bool            `json:"reconnectEnabled,omitempty"`
	ReconnectMaxRetries          *int             `json:"reconnectMaxRetries,omitempty"`
	ReconnectInitialDelaySeconds *int             `json:"reconnectInitialDelaySeconds,omitempty"`
	ReconnectMaxDelaySeconds     *int             `json:"reconnectMaxDelaySeconds,omitempty"`
	KeepAliveIntervalSeconds     *int             `json:"keepAliveIntervalSeconds,omitempty"`
	KeepAliveMaxMissed           *int             `json:"keepAliveMaxMissed,omitempty"`
}

// UpdateHostInput is the payload for editing an existing host.
type UpdateHostInput struct {
	ID                string           `json:"id"`
	Label             string           `json:"label"`
	Hostname          string           `json:"hostname"`
	Port              int              `json:"port"`
	Username          string           `json:"username"`
	AuthMethod        AuthMethod       `json:"authMethod"`
	Password          string           `json:"password,omitempty"`
	KeyPath           *string          `json:"keyPath,omitempty"`
	KeyPassphrase     string           `json:"keyPassphrase,omitempty"`
	GroupID           *string          `json:"groupId,omitempty"`
	Color             string           `json:"color,omitempty"`
	Tags              []string         `json:"tags,omitempty"`
	TerminalProfileID *string          `json:"terminalProfileId,omitempty"`
	CredentialSource             string `json:"credentialSource,omitempty"`
	CredentialRef                string           `json:"credentialRef,omitempty"`
	JumpHostID                   *string          `json:"jumpHostId,omitempty"`
	ReconnectEnabled             *bool            `json:"reconnectEnabled,omitempty"`
	ReconnectMaxRetries          *int             `json:"reconnectMaxRetries,omitempty"`
	ReconnectInitialDelaySeconds *int             `json:"reconnectInitialDelaySeconds,omitempty"`
	ReconnectMaxDelaySeconds     *int             `json:"reconnectMaxDelaySeconds,omitempty"`
	KeepAliveIntervalSeconds     *int             `json:"keepAliveIntervalSeconds,omitempty"`
	KeepAliveMaxMissed           *int             `json:"keepAliveMaxMissed,omitempty"`
}

// WorkspaceTemplate is a saved workspace layout that can be opened to recreate a workspace.
type WorkspaceTemplate struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Layout    json.RawMessage `json:"layout"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

// CreateTemplateInput is the payload for creating or updating a workspace template.
type CreateTemplateInput struct {
	ID     string          `json:"id"`     // empty for create, set for update
	Name   string          `json:"name"`
	Layout json.RawMessage `json:"layout"`
}

// Store manages persistent host data in SQLite.
type Store struct {
	db          *sql.DB
	credentials CredentialResolver
	vaultKey    func() ([]byte, error) // nil means vault disabled
}

// SetVaultKeyFunc sets the function used to retrieve the vault key.
// Pass nil to disable vault-aware storage (fall back to keychain).
func (s *Store) SetVaultKeyFunc(fn func() ([]byte, error)) {
	s.vaultKey = fn
}

// New opens the SQLite database at dbPath, runs migrations, and enables WAL mode.
func New(dbPath string, creds CredentialResolver) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("WAL mode: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS groups (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create groups table: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS terminal_profiles (
		id           TEXT PRIMARY KEY,
		name         TEXT NOT NULL,
		font_size    INTEGER NOT NULL DEFAULT 14,
		cursor_style TEXT NOT NULL DEFAULT 'block',
		cursor_blink INTEGER NOT NULL DEFAULT 1,
		scrollback   INTEGER NOT NULL DEFAULT 5000,
		color_theme  TEXT NOT NULL DEFAULT 'auto',
		created_at   TEXT NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create terminal_profiles table: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS hosts (
		id TEXT PRIMARY KEY,
		label TEXT NOT NULL,
		hostname TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 22,
		username TEXT NOT NULL,
		auth_method TEXT NOT NULL DEFAULT 'password',
		password TEXT,
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create hosts table: %w", err)
	}

	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN last_connected_at TEXT`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN color TEXT`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN tags TEXT`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN keychain_migrated INTEGER NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN terminal_profile_id TEXT REFERENCES terminal_profiles(id) ON DELETE SET NULL`)
	_, _ = db.Exec(`ALTER TABLE groups ADD COLUMN terminal_profile_id TEXT REFERENCES terminal_profiles(id) ON DELETE SET NULL`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN key_path TEXT`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'inline'`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN credential_ref TEXT`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN jump_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_enabled INTEGER`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_max_retries INTEGER`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_initial_delay_seconds INTEGER`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN reconnect_max_delay_seconds INTEGER`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN keep_alive_interval_seconds INTEGER`)
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN keep_alive_max_missed INTEGER`)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS workspace_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create workspace_templates table: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS vault_meta (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		salt BLOB NOT NULL,
		nonce BLOB NOT NULL,
		verify_blob BLOB NOT NULL,
		argon2_time INTEGER NOT NULL DEFAULT 3,
		argon2_memory INTEGER NOT NULL DEFAULT 65536,
		argon2_threads INTEGER NOT NULL DEFAULT 4,
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create vault_meta table: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS secrets (
		host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
		kind TEXT NOT NULL,
		nonce BLOB NOT NULL,
		ciphertext BLOB NOT NULL,
		PRIMARY KEY (host_id, kind)
	)`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("create secrets table: %w", err)
	}

	return &Store{db: db, credentials: creds}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() {
	if s.db != nil {
		s.db.Close()
	}
}

// nullStr returns a valid NullString for non-empty strings, invalid otherwise.
func nullStr(s string) sql.NullString {
	if s == "" || s == "null" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// nullStrPtr returns a NullString from a *string pointer.
func nullStrPtr(p *string) sql.NullString {
	if p == nil || *p == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

// nullIntPtr returns a NullInt64 from a *int pointer.
func nullIntPtr(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

// nullBoolPtr returns a NullInt64 (stored as INTEGER) from a *bool pointer.
// true → 1, false → 0, nil → NULL.
func nullBoolPtr(p *bool) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	if *p {
		return sql.NullInt64{Int64: 1, Valid: true}
	}
	return sql.NullInt64{Int64: 0, Valid: true}
}

// scanColorTags fills h.Color and h.Tags from nullable DB columns.
func scanColorTags(h *Host, color, tags sql.NullString) {
	if color.Valid {
		h.Color = color.String
	}
	if tags.Valid {
		json.Unmarshal([]byte(tags.String), &h.Tags) //nolint:errcheck
	}
}

// scanReconnectFields fills reconnect/keepalive override fields on h from nullable INT64 DB columns.
func scanReconnectFields(h *Host,
	reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed sql.NullInt64,
) {
	if reconnectEnabled.Valid {
		v := reconnectEnabled.Int64 != 0
		h.ReconnectEnabled = &v
	}
	if reconnectMaxRetries.Valid {
		v := int(reconnectMaxRetries.Int64)
		h.ReconnectMaxRetries = &v
	}
	if reconnectInitialDelay.Valid {
		v := int(reconnectInitialDelay.Int64)
		h.ReconnectInitialDelaySeconds = &v
	}
	if reconnectMaxDelay.Valid {
		v := int(reconnectMaxDelay.Int64)
		h.ReconnectMaxDelaySeconds = &v
	}
	if keepAliveInterval.Valid {
		v := int(keepAliveInterval.Int64)
		h.KeepAliveIntervalSeconds = &v
	}
	if keepAliveMaxMissed.Valid {
		v := int(keepAliveMaxMissed.Int64)
		h.KeepAliveMaxMissed = &v
	}
}

// --- Terminal Profile CRUD ---

// ListProfiles returns all terminal profiles ordered by created_at.
func (s *Store) ListProfiles() ([]TerminalProfile, error) {
	rows, err := s.db.Query(
		`SELECT id, name, font_size, cursor_style, cursor_blink, scrollback, color_theme, created_at FROM terminal_profiles ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []TerminalProfile
	for rows.Next() {
		var p TerminalProfile
		var cursorBlink int
		if err := rows.Scan(&p.ID, &p.Name, &p.FontSize, &p.CursorStyle, &cursorBlink, &p.Scrollback, &p.ColorTheme, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.CursorBlink = cursorBlink != 0
		profiles = append(profiles, p)
	}
	if profiles == nil {
		profiles = []TerminalProfile{}
	}
	return profiles, nil
}

// AddProfile creates a new terminal profile.
func (s *Store) AddProfile(input CreateProfileInput) (TerminalProfile, error) {
	p := TerminalProfile{
		ID:          uuid.New().String(),
		Name:        input.Name,
		FontSize:    input.FontSize,
		CursorStyle: input.CursorStyle,
		CursorBlink: input.CursorBlink,
		Scrollback:  input.Scrollback,
		ColorTheme:  input.ColorTheme,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	cursorBlink := 0
	if p.CursorBlink {
		cursorBlink = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO terminal_profiles (id, name, font_size, cursor_style, cursor_blink, scrollback, color_theme, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.FontSize, p.CursorStyle, cursorBlink, p.Scrollback, p.ColorTheme, p.CreatedAt,
	)
	if err != nil {
		return TerminalProfile{}, err
	}
	return p, nil
}

// UpdateProfile updates an existing terminal profile.
func (s *Store) UpdateProfile(input UpdateProfileInput) (TerminalProfile, error) {
	cursorBlink := 0
	if input.CursorBlink {
		cursorBlink = 1
	}
	_, err := s.db.Exec(
		`UPDATE terminal_profiles SET name=?, font_size=?, cursor_style=?, cursor_blink=?, scrollback=?, color_theme=? WHERE id=?`,
		input.Name, input.FontSize, input.CursorStyle, cursorBlink, input.Scrollback, input.ColorTheme, input.ID,
	)
	if err != nil {
		return TerminalProfile{}, err
	}
	var p TerminalProfile
	var cb int
	err = s.db.QueryRow(
		`SELECT id, name, font_size, cursor_style, cursor_blink, scrollback, color_theme, created_at FROM terminal_profiles WHERE id=?`, input.ID,
	).Scan(&p.ID, &p.Name, &p.FontSize, &p.CursorStyle, &cb, &p.Scrollback, &p.ColorTheme, &p.CreatedAt)
	if err != nil {
		return TerminalProfile{}, err
	}
	p.CursorBlink = cb != 0
	return p, nil
}

// DeleteProfile removes a terminal profile. Hosts/groups referencing it will have terminal_profile_id set to NULL.
func (s *Store) DeleteProfile(id string) error {
	_, err := s.db.Exec(`DELETE FROM terminal_profiles WHERE id = ?`, id)
	return err
}

// --- Host CRUD ---

// ListHosts returns all saved hosts.
func (s *Store) ListHosts() ([]Host, error) {
	rows, err := s.db.Query(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id, key_path, credential_source, credential_ref, jump_host_id, reconnect_enabled, reconnect_max_retries, reconnect_initial_delay_seconds, reconnect_max_delay_seconds, keep_alive_interval_seconds, keep_alive_max_missed FROM hosts ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, groupID, color, tags, profileID, keyPath, credSrc, credRef, jumpHostID sql.NullString
		var reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed sql.NullInt64
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &groupID, &color, &tags, &profileID, &keyPath, &credSrc, &credRef, &jumpHostID, &reconnectEnabled, &reconnectMaxRetries, &reconnectInitialDelay, &reconnectMaxDelay, &keepAliveInterval, &keepAliveMaxMissed); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		if groupID.Valid {
			h.GroupID = &groupID.String
		}
		if profileID.Valid {
			h.TerminalProfileID = &profileID.String
		}
		if keyPath.Valid {
			h.KeyPath = &keyPath.String
		}
		if credSrc.Valid {
			h.CredentialSource = credSrc.String
		}
		if credRef.Valid {
			h.CredentialRef = credRef.String
		}
		if jumpHostID.Valid {
			h.JumpHostID = &jumpHostID.String
		}
		scanColorTags(&h, color, tags)
		scanReconnectFields(&h, reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}

// AddHost saves a new SSH host to the database and stores its password in the OS keychain.
func (s *Store) AddHost(input CreateHostInput) (Host, error) {
	credSrc := input.CredentialSource
	if credSrc == "" {
		credSrc = "inline"
	}

	host := Host{
		ID:                           uuid.New().String(),
		Label:                        input.Label,
		Hostname:                     input.Hostname,
		Port:                         input.Port,
		Username:                     input.Username,
		AuthMethod:                   input.AuthMethod,
		CreatedAt:                    time.Now().UTC().Format(time.RFC3339),
		GroupID:                      input.GroupID,
		Color:                        input.Color,
		Tags:                         input.Tags,
		TerminalProfileID:            input.TerminalProfileID,
		KeyPath:                      input.KeyPath,
		CredentialSource:             credSrc,
		CredentialRef:                input.CredentialRef,
		JumpHostID:                   input.JumpHostID,
		ReconnectEnabled:             input.ReconnectEnabled,
		ReconnectMaxRetries:          input.ReconnectMaxRetries,
		ReconnectInitialDelaySeconds: input.ReconnectInitialDelaySeconds,
		ReconnectMaxDelaySeconds:     input.ReconnectMaxDelaySeconds,
		KeepAliveIntervalSeconds:     input.KeepAliveIntervalSeconds,
		KeepAliveMaxMissed:           input.KeepAliveMaxMissed,
	}

	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`INSERT INTO hosts (id, label, hostname, port, username, auth_method, created_at, group_id, color, tags, terminal_profile_id, key_path, credential_source, credential_ref, jump_host_id, reconnect_enabled, reconnect_max_retries, reconnect_initial_delay_seconds, reconnect_max_delay_seconds, keep_alive_interval_seconds, keep_alive_max_missed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Label, host.Hostname, host.Port, host.Username, host.AuthMethod, host.CreatedAt, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)), nullStrPtr(input.TerminalProfileID), nullStrPtr(input.KeyPath), string(credSrc), nullStr(input.CredentialRef), nullStrPtr(input.JumpHostID),
		nullBoolPtr(input.ReconnectEnabled), nullIntPtr(input.ReconnectMaxRetries), nullIntPtr(input.ReconnectInitialDelaySeconds), nullIntPtr(input.ReconnectMaxDelaySeconds), nullIntPtr(input.KeepAliveIntervalSeconds), nullIntPtr(input.KeepAliveMaxMissed),
	)
	if err != nil {
		return Host{}, err
	}

	// Only store inline passwords in keychain/vault; external PM refs are fetched at connect time.
	if input.AuthMethod == AuthPassword && credSrc == "inline" && input.Password != "" {
		if s.vaultKey != nil {
			key, err := s.vaultKey()
			if err != nil {
				s.db.Exec(`DELETE FROM hosts WHERE id=?`, host.ID) //nolint:errcheck
				return Host{}, fmt.Errorf("vault locked: %w", err)
			}
			nonce, ciphertext, err := vault.Encrypt(key, []byte(input.Password))
			if err != nil {
				s.db.Exec(`DELETE FROM hosts WHERE id=?`, host.ID) //nolint:errcheck
				return Host{}, fmt.Errorf("vault encrypt: %w", err)
			}
			if err := s.StoreEncryptedSecret(host.ID, "password", nonce, ciphertext); err != nil {
				s.db.Exec(`DELETE FROM hosts WHERE id=?`, host.ID) //nolint:errcheck
				return Host{}, err
			}
		} else {
			if err := s.credentials.StoreSecret(host.ID, input.Password); err != nil {
				if errors.Is(err, ErrKeychainUnavailable) {
					log.Warn().Str("hostID", host.ID).Msg("keychain unavailable, storing password in DB as fallback")
					s.db.Exec(`UPDATE hosts SET password=? WHERE id=?`, input.Password, host.ID) //nolint:errcheck
				} else {
					s.db.Exec(`DELETE FROM hosts WHERE id=?`, host.ID) //nolint:errcheck
					return Host{}, fmt.Errorf("store password in keychain: %w", err)
				}
			} else {
				s.db.Exec(`UPDATE hosts SET keychain_migrated=1 WHERE id=?`, host.ID) //nolint:errcheck
			}
		}
	}

	if input.AuthMethod == AuthKey && input.KeyPassphrase != "" {
		if s.vaultKey != nil {
			key, err := s.vaultKey()
			if err != nil {
				return Host{}, fmt.Errorf("vault locked: %w", err)
			}
			nonce, ciphertext, err := vault.Encrypt(key, []byte(input.KeyPassphrase))
			if err != nil {
				return Host{}, fmt.Errorf("vault encrypt: %w", err)
			}
			if err := s.StoreEncryptedSecret(host.ID, "passphrase", nonce, ciphertext); err != nil {
				return Host{}, err
			}
		} else {
			s.credentials.StoreSecret(host.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
		}
	}

	return host, nil
}

// UpdateHost updates an existing host record and manages its keychain password entry.
func (s *Store) UpdateHost(input UpdateHostInput) (Host, error) {
	credSrc := input.CredentialSource
	if credSrc == "" {
		credSrc = "inline"
	}

	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`UPDATE hosts SET label=?, hostname=?, port=?, username=?, auth_method=?, group_id=?, color=?, tags=?, terminal_profile_id=?, key_path=?, credential_source=?, credential_ref=?, jump_host_id=?, reconnect_enabled=?, reconnect_max_retries=?, reconnect_initial_delay_seconds=?, reconnect_max_delay_seconds=?, keep_alive_interval_seconds=?, keep_alive_max_missed=? WHERE id=?`,
		input.Label, input.Hostname, input.Port, input.Username, input.AuthMethod, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)), nullStrPtr(input.TerminalProfileID), nullStrPtr(input.KeyPath),
		string(credSrc), nullStr(input.CredentialRef), nullStrPtr(input.JumpHostID),
		nullBoolPtr(input.ReconnectEnabled), nullIntPtr(input.ReconnectMaxRetries), nullIntPtr(input.ReconnectInitialDelaySeconds), nullIntPtr(input.ReconnectMaxDelaySeconds), nullIntPtr(input.KeepAliveIntervalSeconds), nullIntPtr(input.KeepAliveMaxMissed),
		input.ID,
	)
	if err != nil {
		return Host{}, err
	}

	// Only store inline passwords in keychain/vault; external PM refs are fetched at connect time.
	if input.AuthMethod == AuthPassword && credSrc == "inline" && input.Password != "" {
		if s.vaultKey != nil {
			key, err := s.vaultKey()
			if err != nil {
				return Host{}, fmt.Errorf("vault locked: %w", err)
			}
			nonce, ciphertext, err := vault.Encrypt(key, []byte(input.Password))
			if err != nil {
				return Host{}, fmt.Errorf("vault encrypt: %w", err)
			}
			if err := s.StoreEncryptedSecret(input.ID, "password", nonce, ciphertext); err != nil {
				return Host{}, err
			}
		} else {
			if err := s.credentials.StoreSecret(input.ID, input.Password); err != nil {
				if errors.Is(err, ErrKeychainUnavailable) {
					log.Warn().Str("hostID", input.ID).Msg("keychain unavailable, storing password in DB as fallback")
					s.db.Exec(`UPDATE hosts SET password=? WHERE id=?`, input.Password, input.ID) //nolint:errcheck
				} else {
					return Host{}, fmt.Errorf("update password in keychain: %w", err)
				}
			} else {
				s.db.Exec(`UPDATE hosts SET keychain_migrated=1, password=NULL WHERE id=?`, input.ID) //nolint:errcheck
			}
		}
	} else if input.AuthMethod == AuthPassword && credSrc != "inline" {
		// Switching to external PM — clear any inline keychain/vault entry.
		s.credentials.DeleteSecret(input.ID)                             //nolint:errcheck
		s.db.Exec(`UPDATE hosts SET password=NULL WHERE id=?`, input.ID) //nolint:errcheck
		_ = s.DeleteEncryptedSecret(input.ID, "password")
	} else if input.AuthMethod != AuthPassword {
		s.credentials.DeleteSecret(input.ID)                             //nolint:errcheck
		s.db.Exec(`UPDATE hosts SET password=NULL WHERE id=?`, input.ID) //nolint:errcheck
		_ = s.DeleteEncryptedSecret(input.ID, "password")
	}

	if input.AuthMethod == AuthKey && input.KeyPassphrase != "" {
		if s.vaultKey != nil {
			key, err := s.vaultKey()
			if err != nil {
				return Host{}, fmt.Errorf("vault locked: %w", err)
			}
			nonce, ciphertext, err := vault.Encrypt(key, []byte(input.KeyPassphrase))
			if err != nil {
				return Host{}, fmt.Errorf("vault encrypt: %w", err)
			}
			if err := s.StoreEncryptedSecret(input.ID, "passphrase", nonce, ciphertext); err != nil {
				return Host{}, err
			}
		} else {
			s.credentials.StoreSecret(input.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
		}
	} else if input.AuthMethod != AuthKey {
		s.credentials.DeleteSecret(input.ID + ":passphrase") //nolint:errcheck
		_ = s.DeleteEncryptedSecret(input.ID, "passphrase")
	}

	var h Host
	var lastConn, gid, color, tags, profileID, keyPath, credSrcCol, credRefCol, jumpHostID sql.NullString
	var reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed sql.NullInt64
	err = s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id, key_path, credential_source, credential_ref, jump_host_id, reconnect_enabled, reconnect_max_retries, reconnect_initial_delay_seconds, reconnect_max_delay_seconds, keep_alive_interval_seconds, keep_alive_max_missed FROM hosts WHERE id=?`, input.ID,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags, &profileID, &keyPath, &credSrcCol, &credRefCol, &jumpHostID, &reconnectEnabled, &reconnectMaxRetries, &reconnectInitialDelay, &reconnectMaxDelay, &keepAliveInterval, &keepAliveMaxMissed)
	if err != nil {
		return Host{}, err
	}
	if lastConn.Valid {
		h.LastConnectedAt = &lastConn.String
	}
	if gid.Valid {
		h.GroupID = &gid.String
	}
	if profileID.Valid {
		h.TerminalProfileID = &profileID.String
	}
	if keyPath.Valid {
		h.KeyPath = &keyPath.String
	}
	if credSrcCol.Valid {
		h.CredentialSource = credSrcCol.String
	}
	if credRefCol.Valid {
		h.CredentialRef = credRefCol.String
	}
	if jumpHostID.Valid {
		h.JumpHostID = &jumpHostID.String
	}
	scanColorTags(&h, color, tags)
	scanReconnectFields(&h, reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed)
	return h, nil
}

// DeleteHost removes a saved host by ID and cleans up its keychain entries.
func (s *Store) DeleteHost(id string) error {
	s.credentials.DeleteSecret(id)                 //nolint:errcheck
	s.credentials.DeleteSecret(id + ":passphrase") //nolint:errcheck
	_, err := s.db.Exec(`DELETE FROM hosts WHERE id = ?`, id)
	return err
}

// GetHostForConnect returns the host and its secret (password or key passphrase) for use during connection.
// For password auth with inline source: reads from keychain, falling back to the DB column.
// For password auth with external PM source: fetches from the configured password manager.
// For key auth: reads the passphrase from keychain (empty string if unset).
// For agent auth: returns an empty secret.
func (s *Store) GetHostForConnect(id string) (Host, string, error) {
	var h Host
	var dbPassword, keyPath, credSrc, credRef, jumpHostID sql.NullString
	var reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed sql.NullInt64
	err := s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, password, key_path, credential_source, credential_ref, jump_host_id, reconnect_enabled, reconnect_max_retries, reconnect_initial_delay_seconds, reconnect_max_delay_seconds, keep_alive_interval_seconds, keep_alive_max_missed FROM hosts WHERE id = ?`, id,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &dbPassword, &keyPath, &credSrc, &credRef, &jumpHostID, &reconnectEnabled, &reconnectMaxRetries, &reconnectInitialDelay, &reconnectMaxDelay, &keepAliveInterval, &keepAliveMaxMissed)
	if err != nil {
		return Host{}, "", fmt.Errorf("host not found: %w", err)
	}
	if keyPath.Valid {
		h.KeyPath = &keyPath.String
	}
	if credSrc.Valid {
		h.CredentialSource = credSrc.String
	}
	if credRef.Valid {
		h.CredentialRef = credRef.String
	}
	if jumpHostID.Valid {
		h.JumpHostID = &jumpHostID.String
	}
	scanReconnectFields(&h, reconnectEnabled, reconnectMaxRetries, reconnectInitialDelay, reconnectMaxDelay, keepAliveInterval, keepAliveMaxMissed)

	switch h.AuthMethod {
	case AuthPassword:
		if h.CredentialSource == "inline" || h.CredentialSource == "" {
			if s.vaultKey != nil {
				key, err := s.vaultKey()
				if err != nil {
					return Host{}, "", fmt.Errorf("vault locked: %w", err)
				}
				nonce, ciphertext, err := s.GetEncryptedSecret(id, "password")
				if err != nil {
					return Host{}, "", err
				}
				if nonce != nil {
					plaintext, err := vault.Decrypt(key, nonce, ciphertext)
					if err != nil {
						return Host{}, "", err
					}
					return h, string(plaintext), nil
				}
				// No encrypted secret found — fall through to keychain/DB fallback.
				pw, err := s.credentials.InlineSecret(id, dbPassword.String)
				if err != nil {
					return h, dbPassword.String, nil
				}
				return h, pw, nil
			}
			pw, err := s.credentials.InlineSecret(id, dbPassword.String)
			if err != nil {
				return h, dbPassword.String, nil
			}
			return h, pw, nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		pw, err := s.credentials.Resolve(ctx, h.CredentialSource, h.CredentialRef)
		if err != nil {
			log.Warn().Err(err).Str("hostID", id).Msg("external credential fetch failed")
			return h, "", fmt.Errorf("credential fetch (%s): %w", h.CredentialSource, err)
		}
		return h, pw, nil
	case AuthKey:
		if s.vaultKey != nil {
			key, err := s.vaultKey()
			if err != nil {
				return Host{}, "", fmt.Errorf("vault locked: %w", err)
			}
			nonce, ciphertext, err := s.GetEncryptedSecret(id, "passphrase")
			if err != nil {
				return Host{}, "", err
			}
			if nonce != nil {
				plaintext, err := vault.Decrypt(key, nonce, ciphertext)
				if err != nil {
					return Host{}, "", err
				}
				return h, string(plaintext), nil
			}
			// No encrypted passphrase — fall through to keychain.
		}
		passphrase, _ := s.credentials.InlineSecret(id+":passphrase", "")
		return h, passphrase, nil
	default:
		return h, "", nil
	}
}

// MigratePasswordsToKeychain moves any plaintext passwords in the DB into the
// OS keychain. It is idempotent: rows with keychain_migrated=1 are skipped.
// Called once at startup; failures are logged but not fatal.
func (s *Store) MigratePasswordsToKeychain() error {
	rows, err := s.db.Query(
		`SELECT id, password FROM hosts WHERE keychain_migrated=0 AND password IS NOT NULL AND password != ''`,
	)
	if err != nil {
		return fmt.Errorf("migration query: %w", err)
	}
	defer rows.Close()

	type pending struct{ id, password string }
	var work []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.password); err != nil {
			return err
		}
		work = append(work, p)
	}
	rows.Close()

	for _, p := range work {
		if err := s.credentials.StoreSecret(p.id, p.password); err != nil {
			if errors.Is(err, ErrKeychainUnavailable) {
				log.Warn().Str("hostID", p.id).Msg("keychain unavailable during migration, password stays in DB")
				continue
			}
			log.Error().Err(err).Str("hostID", p.id).Msg("failed to migrate password to keychain")
			continue
		}
		s.db.Exec(`UPDATE hosts SET password=NULL, keychain_migrated=1 WHERE id=?`, p.id) //nolint:errcheck
		log.Info().Str("hostID", p.id).Msg("migrated password to keychain")
	}
	return nil
}

// TouchLastConnected updates last_connected_at to now (best-effort).
func (s *Store) TouchLastConnected(hostID string) {
	now := time.Now().UTC().Format(time.RFC3339)
	s.db.Exec(`UPDATE hosts SET last_connected_at = ? WHERE id = ?`, now, hostID) //nolint:errcheck
}

// HostExists returns true if a host with the given hostname, port, and username already exists.
func (s *Store) HostExists(hostname string, port int, username string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM hosts WHERE hostname=? AND port=? AND username=?)`,
		hostname, port, username,
	).Scan(&exists)
	return exists, err
}

// --- Group CRUD ---

// ListGroups returns all groups ordered by sort_order, created_at.
func (s *Store) ListGroups() ([]Group, error) {
	rows, err := s.db.Query(`SELECT id, name, sort_order, created_at, terminal_profile_id FROM groups ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		var g Group
		var profileID sql.NullString
		if err := rows.Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt, &profileID); err != nil {
			return nil, err
		}
		if profileID.Valid {
			g.TerminalProfileID = &profileID.String
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []Group{}
	}
	return groups, nil
}

// AddGroup creates a new group with sort_order = MAX(sort_order)+1.
func (s *Store) AddGroup(input CreateGroupInput) (Group, error) {
	var maxOrder int
	s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM groups`).Scan(&maxOrder) //nolint:errcheck

	g := Group{
		ID:        uuid.New().String(),
		Name:      input.Name,
		SortOrder: maxOrder + 1,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_, err := s.db.Exec(
		`INSERT INTO groups (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)`,
		g.ID, g.Name, g.SortOrder, g.CreatedAt,
	)
	if err != nil {
		return Group{}, err
	}
	return g, nil
}

// UpdateGroup updates a group's name, sort_order, and terminal profile.
func (s *Store) UpdateGroup(input UpdateGroupInput) (Group, error) {
	_, err := s.db.Exec(
		`UPDATE groups SET name=?, sort_order=?, terminal_profile_id=? WHERE id=?`,
		input.Name, input.SortOrder, nullStrPtr(input.TerminalProfileID), input.ID,
	)
	if err != nil {
		return Group{}, err
	}
	var g Group
	var profileID sql.NullString
	err = s.db.QueryRow(`SELECT id, name, sort_order, created_at, terminal_profile_id FROM groups WHERE id=?`, input.ID).
		Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt, &profileID)
	if err != nil {
		return Group{}, err
	}
	if profileID.Valid {
		g.TerminalProfileID = &profileID.String
	}
	return g, nil
}

// DeleteGroup removes a group by ID; hosts referencing it will have group_id set to NULL.
func (s *Store) DeleteGroup(id string) error {
	_, err := s.db.Exec(`DELETE FROM groups WHERE id = ?`, id)
	return err
}

// --- Workspace Template CRUD ---

// SaveWorkspaceTemplate creates or updates a workspace template.
func (s *Store) SaveWorkspaceTemplate(input CreateTemplateInput) (WorkspaceTemplate, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := input.ID
	if id == "" {
		id = uuid.New().String()
	}
	_, err := s.db.Exec(
		`INSERT INTO workspace_templates (id, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, layout=excluded.layout, updated_at=excluded.updated_at`,
		id, input.Name, string(input.Layout), now, now,
	)
	if err != nil {
		return WorkspaceTemplate{}, fmt.Errorf("save workspace template: %w", err)
	}
	return s.GetWorkspaceTemplate(id)
}

// ListWorkspaceTemplates returns all saved workspace templates ordered by most recent.
func (s *Store) ListWorkspaceTemplates() ([]WorkspaceTemplate, error) {
	rows, err := s.db.Query(`SELECT id, name, layout, created_at, updated_at FROM workspace_templates ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list workspace templates: %w", err)
	}
	defer rows.Close()
	var templates []WorkspaceTemplate
	for rows.Next() {
		var t WorkspaceTemplate
		var layout string
		if err := rows.Scan(&t.ID, &t.Name, &layout, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace template: %w", err)
		}
		t.Layout = json.RawMessage(layout)
		templates = append(templates, t)
	}
	return templates, rows.Err()
}

// GetWorkspaceTemplate returns a single workspace template by ID.
func (s *Store) GetWorkspaceTemplate(id string) (WorkspaceTemplate, error) {
	var t WorkspaceTemplate
	var layout string
	err := s.db.QueryRow(`SELECT id, name, layout, created_at, updated_at FROM workspace_templates WHERE id = ?`, id).
		Scan(&t.ID, &t.Name, &layout, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return WorkspaceTemplate{}, fmt.Errorf("get workspace template: %w", err)
	}
	t.Layout = json.RawMessage(layout)
	return t, nil
}

// DeleteWorkspaceTemplate removes a workspace template.
func (s *Store) DeleteWorkspaceTemplate(id string) error {
	_, err := s.db.Exec(`DELETE FROM workspace_templates WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete workspace template: %w", err)
	}
	return nil
}

// GetHostsByGroup returns all hosts belonging to the given group.
func (s *Store) GetHostsByGroup(groupID string) ([]Host, error) {
	rows, err := s.db.Query(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id FROM hosts WHERE group_id = ? ORDER BY created_at ASC`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, gid, color, tags, profileID sql.NullString
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags, &profileID); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		if gid.Valid {
			h.GroupID = &gid.String
		}
		if profileID.Valid {
			h.TerminalProfileID = &profileID.String
		}
		scanColorTags(&h, color, tags)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}

// GetVaultMeta returns the vault metadata, or nil if vault is not set up.
func (s *Store) GetVaultMeta() (*vault.VaultMeta, error) {
	row := s.db.QueryRow(`SELECT salt, nonce, verify_blob, argon2_time, argon2_memory, argon2_threads FROM vault_meta WHERE id = 1`)
	meta := &vault.VaultMeta{}
	err := row.Scan(&meta.Salt, &meta.Nonce, &meta.VerifyBlob, &meta.ArgonTime, &meta.ArgonMemory, &meta.ArgonThreads)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get vault meta: %w", err)
	}
	return meta, nil
}

// SaveVaultMeta inserts or replaces the vault metadata row.
func (s *Store) SaveVaultMeta(meta *vault.VaultMeta) error {
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO vault_meta (id, salt, nonce, verify_blob, argon2_time, argon2_memory, argon2_threads, created_at)
		 VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))`,
		meta.Salt, meta.Nonce, meta.VerifyBlob, meta.ArgonTime, meta.ArgonMemory, meta.ArgonThreads,
	)
	return err
}

// DeleteVaultMeta removes the vault metadata and all encrypted secrets.
func (s *Store) DeleteVaultMeta() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM secrets`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vault_meta`); err != nil {
		return err
	}
	return tx.Commit()
}

// StoreEncryptedSecret stores an encrypted secret for a host.
func (s *Store) StoreEncryptedSecret(hostID, kind string, nonce, ciphertext []byte) error {
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO secrets (host_id, kind, nonce, ciphertext) VALUES (?, ?, ?, ?)`,
		hostID, kind, nonce, ciphertext,
	)
	return err
}

// GetEncryptedSecret retrieves an encrypted secret for a host.
func (s *Store) GetEncryptedSecret(hostID, kind string) (nonce, ciphertext []byte, err error) {
	row := s.db.QueryRow(`SELECT nonce, ciphertext FROM secrets WHERE host_id = ? AND kind = ?`, hostID, kind)
	err = row.Scan(&nonce, &ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	return nonce, ciphertext, err
}

// ListEncryptedSecrets returns all encrypted secrets (for migration/re-encryption).
func (s *Store) ListEncryptedSecrets() ([]struct {
	HostID     string
	Kind       string
	Nonce      []byte
	Ciphertext []byte
}, error) {
	rows, err := s.db.Query(`SELECT host_id, kind, nonce, ciphertext FROM secrets`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []struct {
		HostID     string
		Kind       string
		Nonce      []byte
		Ciphertext []byte
	}
	for rows.Next() {
		var r struct {
			HostID     string
			Kind       string
			Nonce      []byte
			Ciphertext []byte
		}
		if err := rows.Scan(&r.HostID, &r.Kind, &r.Nonce, &r.Ciphertext); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// DeleteEncryptedSecret removes a specific encrypted secret.
func (s *Store) DeleteEncryptedSecret(hostID, kind string) error {
	_, err := s.db.Exec(`DELETE FROM secrets WHERE host_id = ? AND kind = ?`, hostID, kind)
	return err
}

// ClearHostPassword clears the plaintext password fallback column for a host.
func (s *Store) ClearHostPassword(hostID string) error {
	_, err := s.db.Exec(`UPDATE hosts SET password = NULL WHERE id = ?`, hostID)
	return err
}

// ListInlinePasswordHostIDs returns IDs of hosts using inline credential source.
func (s *Store) ListInlinePasswordHostIDs() ([]string, error) {
	rows, err := s.db.Query(
		`SELECT id FROM hosts WHERE auth_method IN ('password', 'key') AND (credential_source = 'inline' OR credential_source = '' OR credential_source IS NULL)`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetCredentials returns the credential resolver.
func (s *Store) GetCredentials() CredentialResolver {
	return s.credentials
}
