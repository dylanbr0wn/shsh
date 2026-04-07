package registry

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// Store provides CRUD operations for the registry's SQLite database.
type Store struct {
	db *sql.DB
}

// NewStore opens (or creates) the SQLite database at path and runs migrations.
func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(wal)&_pragma=foreign_keys(on)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS namespaces (
			name       TEXT PRIMARY KEY,
			api_key    TEXT NOT NULL UNIQUE,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS bundles (
			id         TEXT PRIMARY KEY,
			namespace  TEXT NOT NULL REFERENCES namespaces(name) ON DELETE CASCADE,
			name       TEXT NOT NULL,
			created_at TEXT NOT NULL,
			UNIQUE(namespace, name)
		);

		CREATE TABLE IF NOT EXISTS versions (
			id        TEXT PRIMARY KEY,
			bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
			tag       TEXT NOT NULL,
			payload   TEXT NOT NULL,
			pushed_at TEXT NOT NULL,
			UNIQUE(bundle_id, tag)
		);
	`)
	return err
}

// --- Namespace operations ---

// CreateNamespace creates a new namespace with the given name and API key.
func (s *Store) CreateNamespace(name, apiKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO namespaces (name, api_key, created_at) VALUES (?, ?, ?)`,
		name, apiKey, time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// LookupNamespace returns the namespace name associated with an API key, or empty string if not found.
func (s *Store) LookupNamespace(apiKey string) (string, error) {
	var name string
	err := s.db.QueryRow(`SELECT name FROM namespaces WHERE api_key = ?`, apiKey).Scan(&name)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return name, err
}

// ListNamespaces returns all namespace names.
func (s *Store) ListNamespaces() ([]string, error) {
	rows, err := s.db.Query(`SELECT name FROM namespaces ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// RotateKey replaces the API key for a namespace. Returns an error if the namespace doesn't exist.
func (s *Store) RotateKey(namespace, newKey string) error {
	res, err := s.db.Exec(`UPDATE namespaces SET api_key = ? WHERE name = ?`, newKey, namespace)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("namespace %q not found", namespace)
	}
	return nil
}

// --- Bundle operations ---

// ListBundles returns all bundles in a namespace.
func (s *Store) ListBundles(namespace string) ([]BundleInfo, error) {
	rows, err := s.db.Query(
		`SELECT name, created_at FROM bundles WHERE namespace = ? ORDER BY name`, namespace,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BundleInfo
	for rows.Next() {
		var b BundleInfo
		if err := rows.Scan(&b.Name, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// --- Tag/Version operations ---

// ListTags returns all tags for a bundle.
func (s *Store) ListTags(namespace, bundleName string) ([]TagInfo, error) {
	rows, err := s.db.Query(`
		SELECT v.tag, v.pushed_at
		FROM versions v
		JOIN bundles b ON v.bundle_id = b.id
		WHERE b.namespace = ? AND b.name = ?
		ORDER BY v.pushed_at DESC, v.rowid DESC
	`, namespace, bundleName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TagInfo
	for rows.Next() {
		var t TagInfo
		if err := rows.Scan(&t.Tag, &t.PushedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Pull retrieves a bundle version. If tag is empty, returns the latest (by pushed_at).
func (s *Store) Pull(namespace, bundleName, tag string) (*Bundle, error) {
	var payload, resolvedTag, pushedAt string
	var err error

	if tag == "" || tag == "latest" {
		err = s.db.QueryRow(`
			SELECT v.payload, v.tag, v.pushed_at
			FROM versions v
			JOIN bundles b ON v.bundle_id = b.id
			WHERE b.namespace = ? AND b.name = ?
			ORDER BY v.pushed_at DESC, v.rowid DESC
			LIMIT 1
		`, namespace, bundleName).Scan(&payload, &resolvedTag, &pushedAt)
	} else {
		err = s.db.QueryRow(`
			SELECT v.payload, v.tag, v.pushed_at
			FROM versions v
			JOIN bundles b ON v.bundle_id = b.id
			WHERE b.namespace = ? AND b.name = ? AND v.tag = ?
		`, namespace, bundleName, tag).Scan(&payload, &resolvedTag, &pushedAt)
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var hosts []HostItem
	if err := json.Unmarshal([]byte(payload), &hosts); err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}

	return &Bundle{
		Version:  1,
		Bundle:   namespace + "/" + bundleName,
		Tag:      resolvedTag,
		PushedAt: pushedAt,
		Hosts:    hosts,
	}, nil
}

// Push creates a new version of a bundle. The bundle is created if it doesn't exist.
// Returns an error if the tag already exists.
func (s *Store) Push(namespace, bundleName, tag string, hosts []HostItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Ensure bundle exists.
	var bundleID string
	err = tx.QueryRow(
		`SELECT id FROM bundles WHERE namespace = ? AND name = ?`, namespace, bundleName,
	).Scan(&bundleID)
	if err == sql.ErrNoRows {
		bundleID = uuid.NewString()
		_, err = tx.Exec(
			`INSERT INTO bundles (id, namespace, name, created_at) VALUES (?, ?, ?, ?)`,
			bundleID, namespace, bundleName, time.Now().UTC().Format(time.RFC3339),
		)
		if err != nil {
			return fmt.Errorf("create bundle: %w", err)
		}
	} else if err != nil {
		return err
	}

	payload, err := json.Marshal(hosts)
	if err != nil {
		return fmt.Errorf("encode payload: %w", err)
	}

	_, err = tx.Exec(
		`INSERT INTO versions (id, bundle_id, tag, payload, pushed_at) VALUES (?, ?, ?, ?, ?)`,
		uuid.NewString(), bundleID, tag, string(payload), time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("create version: %w", err)
	}

	return tx.Commit()
}

// DeleteVersion removes a specific tag from a bundle. Returns an error if not found.
func (s *Store) DeleteVersion(namespace, bundleName, tag string) error {
	res, err := s.db.Exec(`
		DELETE FROM versions
		WHERE tag = ? AND bundle_id = (
			SELECT id FROM bundles WHERE namespace = ? AND name = ?
		)
	`, tag, namespace, bundleName)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("version %s/%s:%s not found", namespace, bundleName, tag)
	}
	return nil
}
