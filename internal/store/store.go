package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// AuthMethod represents the SSH authentication method.
type AuthMethod string

const (
	AuthPassword AuthMethod = "password"
	AuthKey      AuthMethod = "key"
	AuthAgent    AuthMethod = "agent"
)

// Group represents a named folder for organizing hosts.
type Group struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt"`
}

// CreateGroupInput is the payload for adding a new group.
type CreateGroupInput struct {
	Name string `json:"name"`
}

// UpdateGroupInput is the payload for editing a group.
type UpdateGroupInput struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
}

// Host represents a saved SSH host entry.
type Host struct {
	ID              string     `json:"id"`
	Label           string     `json:"label"`
	Hostname        string     `json:"hostname"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthMethod      AuthMethod `json:"authMethod"`
	CreatedAt       string     `json:"createdAt"`
	LastConnectedAt *string    `json:"lastConnectedAt,omitempty"`
	GroupID         *string    `json:"groupId,omitempty"`
	Color           string     `json:"color,omitempty"`
	Tags            []string   `json:"tags,omitempty"`
}

// CreateHostInput is the payload for adding a new host.
type CreateHostInput struct {
	Label      string     `json:"label"`
	Hostname   string     `json:"hostname"`
	Port       int        `json:"port"`
	Username   string     `json:"username"`
	AuthMethod AuthMethod `json:"authMethod"`
	Password   string     `json:"password,omitempty"`
	GroupID    *string    `json:"groupId,omitempty"`
	Color      string     `json:"color,omitempty"`
	Tags       []string   `json:"tags,omitempty"`
}

// UpdateHostInput is the payload for editing an existing host.
type UpdateHostInput struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Hostname   string     `json:"hostname"`
	Port       int        `json:"port"`
	Username   string     `json:"username"`
	AuthMethod AuthMethod `json:"authMethod"`
	Password   string     `json:"password,omitempty"`
	GroupID    *string    `json:"groupId,omitempty"`
	Color      string     `json:"color,omitempty"`
	Tags       []string   `json:"tags,omitempty"`
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

// scanColorTags fills h.Color and h.Tags from nullable DB columns.
func scanColorTags(h *Host, color, tags sql.NullString) {
	if color.Valid {
		h.Color = color.String
	}
	if tags.Valid {
		json.Unmarshal([]byte(tags.String), &h.Tags) //nolint:errcheck
	}
}

// ListHosts returns all saved hosts.
func (s *Store) ListHosts() ([]Host, error) {
	rows, err := s.db.Query(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags FROM hosts ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, groupID, color, tags sql.NullString
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &groupID, &color, &tags); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		if groupID.Valid {
			h.GroupID = &groupID.String
		}
		scanColorTags(&h, color, tags)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}

// AddHost saves a new SSH host to the database.
func (s *Store) AddHost(input CreateHostInput) (Host, error) {
	host := Host{
		ID:         uuid.New().String(),
		Label:      input.Label,
		Hostname:   input.Hostname,
		Port:       input.Port,
		Username:   input.Username,
		AuthMethod: input.AuthMethod,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		GroupID:    input.GroupID,
		Color:      input.Color,
		Tags:       input.Tags,
	}

	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`INSERT INTO hosts (id, label, hostname, port, username, auth_method, password, created_at, group_id, color, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Label, host.Hostname, host.Port, host.Username, host.AuthMethod, input.Password, host.CreatedAt, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)),
	)
	if err != nil {
		return Host{}, err
	}
	return host, nil
}

// UpdateHost updates an existing host record.
func (s *Store) UpdateHost(input UpdateHostInput) (Host, error) {
	groupID := sql.NullString{}
	if input.GroupID != nil {
		groupID = sql.NullString{String: *input.GroupID, Valid: true}
	}

	tagsJSON, _ := json.Marshal(input.Tags)

	_, err := s.db.Exec(
		`UPDATE hosts SET label=?, hostname=?, port=?, username=?, auth_method=?, password=?, group_id=?, color=?, tags=? WHERE id=?`,
		input.Label, input.Hostname, input.Port, input.Username, input.AuthMethod, input.Password, groupID,
		nullStr(input.Color), nullStr(string(tagsJSON)), input.ID,
	)
	if err != nil {
		return Host{}, err
	}
	var h Host
	var lastConn, gid, color, tags sql.NullString
	err = s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags FROM hosts WHERE id=?`, input.ID,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags)
	if err != nil {
		return Host{}, err
	}
	if lastConn.Valid {
		h.LastConnectedAt = &lastConn.String
	}
	if gid.Valid {
		h.GroupID = &gid.String
	}
	scanColorTags(&h, color, tags)
	return h, nil
}

// DeleteHost removes a saved host by ID.
func (s *Store) DeleteHost(id string) error {
	_, err := s.db.Exec(`DELETE FROM hosts WHERE id = ?`, id)
	return err
}

// GetHostForConnect returns the host and its plaintext password for use during connection.
func (s *Store) GetHostForConnect(id string) (Host, string, error) {
	var h Host
	var password string
	err := s.db.QueryRow(
		`SELECT id, label, hostname, port, username, auth_method, COALESCE(password,'') FROM hosts WHERE id = ?`, id,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &password)
	if err != nil {
		return Host{}, "", fmt.Errorf("host not found: %w", err)
	}
	return h, password, nil
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
	rows, err := s.db.Query(`SELECT id, name, sort_order, created_at FROM groups ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt); err != nil {
			return nil, err
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

// UpdateGroup updates a group's name and sort_order.
func (s *Store) UpdateGroup(input UpdateGroupInput) (Group, error) {
	_, err := s.db.Exec(
		`UPDATE groups SET name=?, sort_order=? WHERE id=?`,
		input.Name, input.SortOrder, input.ID,
	)
	if err != nil {
		return Group{}, err
	}
	var g Group
	err = s.db.QueryRow(`SELECT id, name, sort_order, created_at FROM groups WHERE id=?`, input.ID).
		Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt)
	if err != nil {
		return Group{}, err
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
		`SELECT id, label, hostname, port, username, auth_method, created_at, last_connected_at, group_id, color, tags FROM hosts WHERE group_id = ? ORDER BY created_at ASC`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var lastConn, gid, color, tags sql.NullString
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.Port, &h.Username, &h.AuthMethod, &h.CreatedAt, &lastConn, &gid, &color, &tags); err != nil {
			return nil, err
		}
		if lastConn.Valid {
			h.LastConnectedAt = &lastConn.String
		}
		if gid.Valid {
			h.GroupID = &gid.String
		}
		scanColorTags(&h, color, tags)
		hosts = append(hosts, h)
	}
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, nil
}
