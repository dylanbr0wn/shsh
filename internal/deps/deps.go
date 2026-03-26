package deps

import (
	"context"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/debuglog"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// Deps holds all shared runtime state for the facade structs.
// App.startup() fills these fields once; all facades see them immediately via pointer.
type Deps struct {
	Ctx       context.Context
	Store     *store.Store
	Manager   *session.Manager
	Cfg       *config.Config
	CfgPath   string
	DebugSink *debuglog.DebugSink
}
