package registry

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

// Handlers holds the HTTP handler methods for the registry REST API.
type Handlers struct {
	store *Store
}

// NewHandlers creates a new Handlers backed by the given store.
func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

// ListBundles handles GET /v1/namespaces/{ns}/bundles
func (h *Handlers) ListBundles(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("ns")
	if !h.authorize(w, r, ns) {
		return
	}
	bundles, err := h.store.ListBundles(ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if bundles == nil {
		bundles = []BundleInfo{}
	}
	writeJSON(w, http.StatusOK, bundles)
}

// ListTags handles GET /v1/namespaces/{ns}/bundles/{name}/tags
func (h *Handlers) ListTags(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("ns")
	if !h.authorize(w, r, ns) {
		return
	}
	name := r.PathValue("name")
	if !validateBundleName(w, name) {
		return
	}
	tags, err := h.store.ListTags(ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tags == nil {
		tags = []TagInfo{}
	}
	writeJSON(w, http.StatusOK, tags)
}

// Pull handles GET /v1/namespaces/{ns}/bundles/{name}
func (h *Handlers) Pull(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("ns")
	if !h.authorize(w, r, ns) {
		return
	}
	name := r.PathValue("name")
	if !validateBundleName(w, name) {
		return
	}
	tag := r.URL.Query().Get("tag")

	bundle, err := h.store.Pull(ns, name, tag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if bundle == nil {
		writeError(w, http.StatusNotFound, "bundle not found")
		return
	}
	writeJSON(w, http.StatusOK, bundle)
}

// Push handles PUT /v1/namespaces/{ns}/bundles/{name}
func (h *Handlers) Push(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("ns")
	if !h.authorize(w, r, ns) {
		return
	}
	name := r.PathValue("name")
	if !validateBundleName(w, name) {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MB limit
	var req PushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Tag == "" {
		writeError(w, http.StatusBadRequest, "tag is required")
		return
	}

	if err := h.store.Push(ns, name, req.Tag, req.Hosts); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeError(w, http.StatusConflict, "tag already exists")
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{
		"bundle": ns + "/" + name,
		"tag":    req.Tag,
	})
}

// Delete handles DELETE /v1/namespaces/{ns}/bundles/{name}
func (h *Handlers) Delete(w http.ResponseWriter, r *http.Request) {
	ns := r.PathValue("ns")
	if !h.authorize(w, r, ns) {
		return
	}
	name := r.PathValue("name")
	if !validateBundleName(w, name) {
		return
	}
	tag := r.URL.Query().Get("tag")
	if tag == "" {
		writeError(w, http.StatusBadRequest, "tag query parameter is required")
		return
	}

	if err := h.store.DeleteVersion(ns, name, tag); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// authorize checks that the request's Bearer token maps to the given namespace.
func (h *Handlers) authorize(w http.ResponseWriter, r *http.Request, namespace string) bool {
	if !validName.MatchString(namespace) {
		writeError(w, http.StatusBadRequest, "invalid namespace name")
		return false
	}
	token := extractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing authorization header")
		return false
	}
	ns, err := h.store.LookupNamespace(token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "auth lookup failed")
		return false
	}
	if ns != namespace {
		writeError(w, http.StatusForbidden, "api key not authorized for this namespace")
		return false
	}
	return true
}

// validateBundleName checks the bundle name from the URL path.
func validateBundleName(w http.ResponseWriter, name string) bool {
	if !validName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid bundle name")
		return false
	}
	return true
}

func extractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && h[:7] == "Bearer " {
		return h[7:]
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, ErrorResponse{Error: msg})
}

var validName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)
