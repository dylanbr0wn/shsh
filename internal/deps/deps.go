package deps

import (
	"context"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/debuglog"
	"github.com/dylanbr0wn/shsh/internal/lockstate"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"
)

// Deps holds all shared runtime state for the facade structs.
//
// Safety: Wails guarantees that startup() completes before any bound method
// is invoked, so the fields populated during startup (Store, Manager, Ctx,
// CfgPath, DebugSink) are safely visible to all facade goroutines.
// Cfg is set at construction and mutated only by UpdateConfig, which runs
// on the Wails main-thread dispatch — concurrent facade reads of Cfg fields
// are safe as long as Wails serialises bound method calls (which it does).
type Deps struct {
	Ctx       context.Context
	Store     *store.Store
	Manager   *session.Manager
	Cfg       *config.Config
	CfgPath   string
	DebugSink *debuglog.DebugSink
	LockState *lockstate.State
}
