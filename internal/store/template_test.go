package store

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := New(dbPath)
	require.NoError(t, err)
	return s
}

func TestWorkspaceTemplateCRUD(t *testing.T) {
	s := setupTestStore(t)
	defer s.Close()

	layout := json.RawMessage(`{"kind":"terminal","hostId":"abc"}`)

	// Create
	tmpl, err := s.SaveWorkspaceTemplate(CreateTemplateInput{
		Name:   "Test Template",
		Layout: layout,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, tmpl.ID)
	assert.Equal(t, "Test Template", tmpl.Name)
	assert.JSONEq(t, `{"kind":"terminal","hostId":"abc"}`, string(tmpl.Layout))

	// List
	templates, err := s.ListWorkspaceTemplates()
	require.NoError(t, err)
	assert.Len(t, templates, 1)

	// Update
	updated, err := s.SaveWorkspaceTemplate(CreateTemplateInput{
		ID:     tmpl.ID,
		Name:   "Updated",
		Layout: layout,
	})
	require.NoError(t, err)
	assert.Equal(t, "Updated", updated.Name)
	assert.Equal(t, tmpl.ID, updated.ID) // same ID

	// List after update should still be 1
	templates, err = s.ListWorkspaceTemplates()
	require.NoError(t, err)
	assert.Len(t, templates, 1)

	// Delete
	err = s.DeleteWorkspaceTemplate(tmpl.ID)
	require.NoError(t, err)
	templates, err = s.ListWorkspaceTemplates()
	require.NoError(t, err)
	assert.Len(t, templates, 0)
}
