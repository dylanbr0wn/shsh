package session_test

import (
	"context"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
)

type noopEmitter struct{}

func (noopEmitter) Emit(_ string, _ any) {}

func TestCloseChannel_UnknownChannel(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg, noopEmitter{})
	err := m.CloseChannel("nonexistent-channel-id")
	if err == nil {
		t.Fatal("expected error for unknown channel, got nil")
	}
}

func TestOpenTerminal_UnknownConnection(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg, noopEmitter{})
	_, err := m.OpenTerminal("nonexistent-connection-id")
	if err == nil {
		t.Fatal("expected error for unknown connection, got nil")
	}
}

func TestOpenSFTPChannel_UnknownConnection(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg, noopEmitter{})
	_, err := m.OpenSFTPChannel("nonexistent-connection-id")
	if err == nil {
		t.Fatal("expected error for unknown connection, got nil")
	}
}

func TestWrite_UnknownChannel(t *testing.T) {
	cfg := config.Default()
	m := session.NewManager(context.Background(), cfg, noopEmitter{})
	err := m.Write("nonexistent-channel-id", "hello")
	if err == nil {
		t.Fatal("expected error for unknown channel, got nil")
	}
}
