package registry_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/registry"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestStore(t *testing.T) *registry.Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := registry.NewStore(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func newTestServer(t *testing.T) (*httptest.Server, *registry.Store) {
	t.Helper()
	store := newTestStore(t)
	srv := registry.NewServer(":0", store)
	// Use httptest to wrap the handler directly. We need to access the mux.
	// Instead, create a fresh server via the handlers.
	h := registry.NewHandlers(store)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles", h.ListBundles)
	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles/{name}/tags", h.ListTags)
	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles/{name}", h.Pull)
	mux.HandleFunc("PUT /v1/namespaces/{ns}/bundles/{name}", h.Push)
	mux.HandleFunc("DELETE /v1/namespaces/{ns}/bundles/{name}", h.Delete)
	_ = srv // only needed to verify NewServer doesn't panic
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, store
}

// --- Store tests ---

func TestStoreNamespaceCRUD(t *testing.T) {
	s := newTestStore(t)

	require.NoError(t, s.CreateNamespace("myteam", "key123"))

	ns, err := s.LookupNamespace("key123")
	require.NoError(t, err)
	assert.Equal(t, "myteam", ns)

	ns, err = s.LookupNamespace("badkey")
	require.NoError(t, err)
	assert.Equal(t, "", ns)

	names, err := s.ListNamespaces()
	require.NoError(t, err)
	assert.Equal(t, []string{"myteam"}, names)
}

func TestStoreRotateKey(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "old_key"))

	require.NoError(t, s.RotateKey("myteam", "new_key"))

	ns, err := s.LookupNamespace("old_key")
	require.NoError(t, err)
	assert.Equal(t, "", ns)

	ns, err = s.LookupNamespace("new_key")
	require.NoError(t, err)
	assert.Equal(t, "myteam", ns)
}

func TestStoreRotateKeyNotFound(t *testing.T) {
	s := newTestStore(t)
	err := s.RotateKey("nonexistent", "key")
	assert.Error(t, err)
}

func TestStorePushAndPull(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	hosts := []registry.HostItem{
		{Label: "web1", Hostname: "10.0.0.1", Port: 22, Username: "deploy", AuthMethod: "agent"},
		{Label: "web2", Hostname: "10.0.0.2", Port: 22, Username: "deploy", AuthMethod: "agent", Group: "Production"},
	}

	require.NoError(t, s.Push("myteam", "prod", "v1", hosts))

	bundle, err := s.Pull("myteam", "prod", "v1")
	require.NoError(t, err)
	require.NotNil(t, bundle)
	assert.Equal(t, "myteam/prod", bundle.Bundle)
	assert.Equal(t, "v1", bundle.Tag)
	assert.Len(t, bundle.Hosts, 2)
	assert.Equal(t, "web1", bundle.Hosts[0].Label)
	assert.Equal(t, "Production", bundle.Hosts[1].Group)
}

func TestStorePullLatest(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	hosts1 := []registry.HostItem{{Label: "v1-host", Hostname: "10.0.0.1", Port: 22, Username: "u", AuthMethod: "agent"}}
	hosts2 := []registry.HostItem{{Label: "v2-host", Hostname: "10.0.0.2", Port: 22, Username: "u", AuthMethod: "agent"}}

	require.NoError(t, s.Push("myteam", "prod", "v1", hosts1))
	require.NoError(t, s.Push("myteam", "prod", "v2", hosts2))

	bundle, err := s.Pull("myteam", "prod", "")
	require.NoError(t, err)
	require.NotNil(t, bundle)
	assert.Equal(t, "v2", bundle.Tag)
	assert.Equal(t, "v2-host", bundle.Hosts[0].Label)
}

func TestStorePullNotFound(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	bundle, err := s.Pull("myteam", "nonexistent", "")
	require.NoError(t, err)
	assert.Nil(t, bundle)
}

func TestStoreDuplicateTag(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, s.Push("myteam", "prod", "v1", hosts))
	err := s.Push("myteam", "prod", "v1", hosts)
	assert.Error(t, err, "duplicate tag should fail")
}

func TestStoreDeleteVersion(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, s.Push("myteam", "prod", "v1", hosts))

	require.NoError(t, s.DeleteVersion("myteam", "prod", "v1"))

	bundle, err := s.Pull("myteam", "prod", "v1")
	require.NoError(t, err)
	assert.Nil(t, bundle)
}

func TestStoreListTags(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, s.CreateNamespace("myteam", "key"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, s.Push("myteam", "prod", "v1", hosts))
	require.NoError(t, s.Push("myteam", "prod", "v2", hosts))

	tags, err := s.ListTags("myteam", "prod")
	require.NoError(t, err)
	assert.Len(t, tags, 2)
	// Latest first.
	assert.Equal(t, "v2", tags[0].Tag)
	assert.Equal(t, "v1", tags[1].Tag)
}

// --- HTTP handler tests ---

func TestHTTPPushAndPull(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	// Push.
	body := `{"tag":"v1","hosts":[{"label":"web","hostname":"10.0.0.1","port":22,"username":"deploy","authMethod":"agent"}]}`
	req, _ := http.NewRequest("PUT", ts.URL+"/v1/namespaces/myteam/bundles/prod", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Pull.
	req, _ = http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles/prod?tag=v1", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var bundle registry.Bundle
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&bundle))
	resp.Body.Close()
	assert.Equal(t, "myteam/prod", bundle.Bundle)
	assert.Equal(t, "v1", bundle.Tag)
	assert.Len(t, bundle.Hosts, 1)
	assert.Equal(t, "web", bundle.Hosts[0].Label)
}

func TestHTTPPullLatest(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	// Push two versions.
	for _, tag := range []string{"v1", "v2"} {
		body := `{"tag":"` + tag + `","hosts":[{"label":"` + tag + `-host","hostname":"h","port":22,"username":"u","authMethod":"agent"}]}`
		req, _ := http.NewRequest("PUT", ts.URL+"/v1/namespaces/myteam/bundles/prod", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer testkey")
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		assert.Equal(t, http.StatusCreated, resp.StatusCode)
		resp.Body.Close()
	}

	// Pull without tag (latest).
	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles/prod", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var bundle registry.Bundle
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&bundle))
	resp.Body.Close()
	assert.Equal(t, "v2", bundle.Tag)
}

func TestHTTPUnauthorized(t *testing.T) {
	ts, _ := newTestServer(t)

	// No auth header.
	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles", nil)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	resp.Body.Close()
}

func TestHTTPWrongNamespace(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	// Try to access a different namespace with myteam's key.
	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/otherteam/bundles", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	resp.Body.Close()
}

func TestHTTPListBundles(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, store.Push("myteam", "prod", "v1", hosts))
	require.NoError(t, store.Push("myteam", "staging", "v1", hosts))

	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var bundles []registry.BundleInfo
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&bundles))
	resp.Body.Close()
	assert.Len(t, bundles, 2)
}

func TestHTTPListTags(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, store.Push("myteam", "prod", "v1", hosts))
	require.NoError(t, store.Push("myteam", "prod", "v2", hosts))

	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles/prod/tags", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var tags []registry.TagInfo
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&tags))
	resp.Body.Close()
	assert.Len(t, tags, 2)
}

func TestHTTPDelete(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	hosts := []registry.HostItem{{Label: "h", Hostname: "h", Port: 22, Username: "u", AuthMethod: "agent"}}
	require.NoError(t, store.Push("myteam", "prod", "v1", hosts))

	req, _ := http.NewRequest("DELETE", ts.URL+"/v1/namespaces/myteam/bundles/prod?tag=v1", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	resp.Body.Close()

	// Verify it's gone.
	req, _ = http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles/prod?tag=v1", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

func TestHTTPPushMissingTag(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	body := `{"hosts":[{"label":"h","hostname":"h","port":22,"username":"u","authMethod":"agent"}]}`
	req, _ := http.NewRequest("PUT", ts.URL+"/v1/namespaces/myteam/bundles/prod", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

func TestHTTPPullNotFound(t *testing.T) {
	ts, store := newTestServer(t)
	require.NoError(t, store.CreateNamespace("myteam", "testkey"))

	req, _ := http.NewRequest("GET", ts.URL+"/v1/namespaces/myteam/bundles/nonexistent", nil)
	req.Header.Set("Authorization", "Bearer testkey")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}
