package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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
	ID                string     `json:"id"`
	Label             string     `json:"label"`
	Hostname          string     `json:"hostname"`
	Port              int        `json:"port"`
	Username          string     `json:"username"`
	AuthMethod        AuthMethod `json:"authMethod"`
	CreatedAt         string     `json:"createdAt"`
	LastConnectedAt   *string    `json:"lastConnectedAt,omitempty"`
	GroupID           *string    `json:"groupId,omitempty"`
	Color             string     `json:"color,omitempty"`
	Tags              []string   `json:"tags,omitempty"`
	TerminalProfileID *string    `json:"terminalProfileId,omitempty"`
	KeyPath           *string    `json:"keyPath,omitempty"`
	JumpHostID        *string    `json:"jumpHostId,omitempty"`
}

// CreateHostInput is the payload for adding a new host.
type CreateHostInput struct {
	Label             string     `json:"label"`
	Hostname          string     `json:"hostname"`
	Port              int        `json:"port"`
	Username          string     `json:"username"`
	AuthMethod        AuthMethod `json:"authMethod"`
	Password          string     `json:"password,omitempty"`
	KeyPath           *string    `json:"keyPath,omitempty"`
	KeyPassphrase     string     `json:"keyPassphrase,omitempty"`
	GroupID           *string    `json:"groupId,omitempty"`
	Color             string     `json:"color,omitempty"`
	Tags              []string   `json:"tags,omitempty"`
	TerminalProfileID *string    `json:"terminalProfileId,omitempty"`
	JumpHostID        *string    `json:"jumpHostId,omitempty"`
}

// UpdateHostInput is the payload for editing an existing host.
type UpdateHostInput struct {
	ID                string     `json:"id"`
	Label             string     `json:"label"`
	Hostname          string     `json:"hostname"`
	Port              int        `json:"port"`
	Username          string     `json:"username"`
	AuthMethod        AuthMethod `json:"authMethod"`
	Password          string     `json:"password,omitempty"`
	KeyPath           *string    `json:"keyPath,omitempty"`
	KeyPassphrase     string     `json:"keyPassphrase,omitempty"`
	GroupID           *string    `json:"groupId,omitempty"`
	Color             string     `json:"color,omitempty"`
	Tags              []string   `json:"tags,omitempty"`
	TerminalProfileID *string    `json:"terminalProfileId,omitempty"`
	JumpHostID        *string    `json:"jumpHostId,omitempty"`
}

// Store manages persistent host data in SQLite.
type Store struct {
	db *sql.DB
}

// New opens the SQLite database at dbPath, runs migrations, and enables WAL mode.
func New(dbPath string) (*Store, error) {
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
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN jump_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL`)

	return &Store{db: db}, nil
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

// scanColorTags fills h.Color and h.Tags from nullable DB columns.
func scanColorTags(h *Host, color, tags sql.NullString) {
	if color.Valid {
		h.Color = color.String
	}
	if tags.Valid {
		json.Unmarshal([]byte(tags.String), &h.Tags) //nolint:errcheck
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
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id, key_path, jump_host_id FROM hosts ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, groupID, color, tags, profileID, keyPath, jumpHostID sql.NullString
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &groupID, &color, &tags, &profileID, &keyPath, &jumpHostID); err != nil {
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
		if jumpHostID.Valid {
			h.JumpHostID = &jumpHostID.String
		}
		scanColorTags(&h, color, tags)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}

// AddHost saves a new SSH host to the database and stores its password in the OS keychain.
func (s *Store) AddHost(input CreateHostInput) (Host, error) {
	host := Host{
		ID:                uuid.New().String(),
		Label:             input.Label,
		Hostname:          input.Hostname,
		Port:              input.Port,
		Username:          input.Username,
		AuthMethod:        input.AuthMethod,
		CreatedAt:         time.Now().UTC().Format(time.RFC3339),
		GroupID:           input.GroupID,
		Color:             input.Color,
		Tags:              input.Tags,
		TerminalProfileID: input.TerminalProfileID,
		KeyPath:           input.KeyPath,
		JumpHostID:        input.JumpHostID,
	}

	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`INSERT INTO hosts (id, label, hostname, port, username, auth_method, created_at, group_id, color, tags, terminal_profile_id, key_path, jump_host_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Label, host.Hostname, host.Port, host.Username, host.AuthMethod, host.CreatedAt, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)), nullStrPtr(input.TerminalProfileID), nullStrPtr(input.KeyPath), nullStrPtr(input.JumpHostID),
	)
	if err != nil {
		return Host{}, err
	}

	if input.Password != "" && input.AuthMethod == AuthPassword {
		if err := keychainSet(host.ID, input.Password); err != nil {
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

	if input.AuthMethod == AuthKey && input.KeyPassphrase != "" {
		keychainSet(host.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
	}

	return host, nil
}

// UpdateHost updates an existing host record and manages its keychain password entry.
func (s *Store) UpdateHost(input UpdateHostInput) (Host, error) {
	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`UPDATE hosts SET label=?, hostname=?, port=?, username=?, auth_method=?, group_id=?, color=?, tags=?, terminal_profile_id=?, key_path=?, jump_host_id=? WHERE id=?`,
		input.Label, input.Hostname, input.Port, input.Username, input.AuthMethod, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)), nullStrPtr(input.TerminalProfileID), nullStrPtr(input.KeyPath), nullStrPtr(input.JumpHostID), input.ID,
	)
	if err != nil {
		return Host{}, err
	}

	if input.AuthMethod == AuthPassword && input.Password != "" {
		if err := keychainSet(input.ID, input.Password); err != nil {
			if errors.Is(err, ErrKeychainUnavailable) {
				log.Warn().Str("hostID", input.ID).Msg("keychain unavailable, storing password in DB as fallback")
				s.db.Exec(`UPDATE hosts SET password=? WHERE id=?`, input.Password, input.ID) //nolint:errcheck
			} else {
				return Host{}, fmt.Errorf("update password in keychain: %w", err)
			}
		} else {
			s.db.Exec(`UPDATE hosts SET keychain_migrated=1, password=NULL WHERE id=?`, input.ID) //nolint:errcheck
		}
	} else if input.AuthMethod != AuthPassword {
		keychainDelete(input.ID) //nolint:errcheck
		s.db.Exec(`UPDATE hosts SET password=NULL WHERE id=?`, input.ID) //nolint:errcheck
	}

	if input.AuthMethod == AuthKey && input.KeyPassphrase != "" {
		keychainSet(input.ID+":passphrase", input.KeyPassphrase) //nolint:errcheck
	} else if input.AuthMethod != AuthKey {
		keychainDelete(input.ID + ":passphrase") //nolint:errcheck
	}

	var h Host
	var lastConn, gid, color, tags, profileID, keyPath, jumpHostID sql.NullString
	err = s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags, terminal_profile_id, key_path, jump_host_id FROM hosts WHERE id=?`, input.ID,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags, &profileID, &keyPath, &jumpHostID)
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
	if jumpHostID.Valid {
		h.JumpHostID = &jumpHostID.String
	}
	scanColorTags(&h, color, tags)
	return h, nil
}

// DeleteHost removes a saved host by ID and cleans up its keychain entries.
func (s *Store) DeleteHost(id string) error {
	keychainDelete(id)                  //nolint:errcheck
	keychainDelete(id + ":passphrase")  //nolint:errcheck
	_, err := s.db.Exec(`DELETE FROM hosts WHERE id = ?`, id)
	return err
}

// GetHostForConnect returns the host and its secret (password or key passphrase) for use during connection.
// For password auth: reads from keychain, falling back to the DB column.
// For key auth: reads the passphrase from keychain (empty string if unset).
// For agent auth: returns an empty secret.
func (s *Store) GetHostForConnect(id string) (Host, string, error) {
	var h Host
	var dbPassword, keyPath, jumpHostID sql.NullString
	err := s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, password, key_path, jump_host_id FROM hosts WHERE id = ?`, id,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &dbPassword, &keyPath, &jumpHostID)
	if err != nil {
		return Host{}, "", fmt.Errorf("host not found: %w", err)
	}
	if keyPath.Valid {
		h.KeyPath = &keyPath.String
	}
	if jumpHostID.Valid {
		h.JumpHostID = &jumpHostID.String
	}

	switch h.AuthMethod {
	case AuthPassword:
		pw, err := keychainGet(id)
		if err == nil && pw != "" {
			return h, pw, nil
		}
		// Keychain unavailable or no entry — fall back to DB column.
		return h, dbPassword.String, nil
	case AuthKey:
		passphrase, _ := keychainGet(id + ":passphrase")
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
		if err := keychainSet(p.id, p.password); err != nil {
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
