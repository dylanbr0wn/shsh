package session_test

import (
	"context"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
)

func TestSplitSession_UnknownSession(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg)
	_, err := m.SplitSession("nonexistent-session-id")
	if err == nil {
		t.Fatal("expected error for unknown session, got nil")
	}
}
