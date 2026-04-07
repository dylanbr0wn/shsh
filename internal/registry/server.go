package registry

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Server is the registry HTTP server.
type Server struct {
	httpServer *http.Server
	store      *Store
}

// NewServer creates a registry server listening on the given address, backed by the store.
func NewServer(addr string, store *Store) *Server {
	h := NewHandlers(store)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles", h.ListBundles)
	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles/{name}/tags", h.ListTags)
	mux.HandleFunc("GET /v1/namespaces/{ns}/bundles/{name}", h.Pull)
	mux.HandleFunc("PUT /v1/namespaces/{ns}/bundles/{name}", h.Push)
	mux.HandleFunc("DELETE /v1/namespaces/{ns}/bundles/{name}", h.Delete)

	// Health check (no auth).
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "ok")
	})

	return &Server{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      mux,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 10 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
		store: store,
	}
}

// ListenAndServe starts the server. It blocks until the server is shut down.
func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
