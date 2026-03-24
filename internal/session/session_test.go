package session_test

import (
	"context"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/melbahja/goph"
)

func TestSplitSession_UnknownSession(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg)
	_, err := m.SplitSession("nonexistent-session-id")
	if err == nil {
		t.Fatal("expected error for unknown session, got nil")
	}
}

func TestClientRefCounting(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg)

	// new(goph.Client) allocates a zero-value struct — valid non-nil pointer,
	// no connection made. Safe as a map key.
	c := new(goph.Client)

	// Retain twice under the lock (as callers of incrClientRefs must do).
	m.Mu().Lock()
	m.IncrClientRefs(c, nil)
	m.IncrClientRefs(c, nil)
	m.Mu().Unlock()

	// Release once — count should go from 2 to 1. client.Close() must NOT be called.
	m.ReleaseClient(c, nil)
	if got := m.ClientRefCount(c); got != 1 {
		t.Fatalf("expected ref count 1 after one release, got %d", got)
	}
}
