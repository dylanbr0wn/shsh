package main

import (
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
)

func TestNewAppCreatesFacades(t *testing.T) {
	cfg := config.Default()
	app := NewApp(cfg)
	if app.hosts == nil {
		t.Fatal("HostFacade not created")
	}
	if app.sessions == nil {
		t.Fatal("SessionFacade not created")
	}
	if app.keys == nil {
		t.Fatal("KeysFacade not created")
	}
	if app.tools == nil {
		t.Fatal("ToolsFacade not created")
	}
}

func TestFacadesShareDeps(t *testing.T) {
	cfg := config.Default()
	app := NewApp(cfg)
	if app.hosts.d != app.sessions.d {
		t.Fatal("HostFacade and SessionFacade do not share Deps")
	}
	if app.sessions.d != app.keys.d {
		t.Fatal("SessionFacade and KeysFacade do not share Deps")
	}
	if app.keys.d != app.tools.d {
		t.Fatal("KeysFacade and ToolsFacade do not share Deps")
	}
}
