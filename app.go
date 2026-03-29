package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/credstore"
	"github.com/dylanbr0wn/shsh/internal/debuglog"
	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/lockstate"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/dylanbr0wn/shsh/internal/store"

	"github.com/rs/zerolog/log"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// wailsEventEmitter implements session.EventEmitter using the Wails runtime.
type wailsEventEmitter struct {
	ctx context.Context
}

func (w *wailsEventEmitter) Emit(topic string, data any) {
	wailsruntime.EventsEmit(w.ctx, topic, data)
}

// App is the Wails application coordinator.
type App struct {
	deps     *deps.Deps
	hosts    *HostFacade
	sessions *SessionFacade
	keys     *KeysFacade
	tools    *ToolsFacade
	keybinds *KeybindFacade
	vault    *VaultFacade
}

// NewApp creates a new App application struct.
func NewApp(cfg *config.Config) *App {
	d := &deps.Deps{Cfg: cfg}
	return &App{
		deps:     d,
		hosts:    NewHostFacade(d),
		sessions: NewSessionFacade(d),
		keys:     NewKeysFacade(d),
		tools:    NewToolsFacade(d),
		keybinds: NewKeybindFacade(d),
		vault:    NewVaultFacade(d),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.deps.Ctx = ctx

	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.TempDir()
	}
	dbDir := filepath.Join(configDir, "shsh")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create config dir: %v\n", err)
		return
	}

	a.deps.CfgPath = filepath.Join(dbDir, "config.json")
	if _, statErr := os.Stat(a.deps.CfgPath); os.IsNotExist(statErr) {
		// Write defaults so the user has a reference to all available settings.
		if saveErr := a.deps.Cfg.Save(a.deps.CfgPath); saveErr != nil {
			log.Warn().Err(saveErr).Msg("could not write default config file")
		}
	}

	dbPath := filepath.Join(dbDir, "shsh.db")

	s, err := store.New(dbPath, credstore.NewResolver())
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		return
	}
	a.deps.Store = s

	if err := s.MigratePasswordsToKeychain(); err != nil {
		log.Warn().Err(err).Msg("keychain migration encountered errors")
	}

	// Initialize lock state.
	onLock := func() {
		wailsruntime.EventsEmit(ctx, "vault:locked")
	}
	a.deps.LockState = lockstate.New(
		time.Duration(a.deps.Cfg.Vault.LockTimeoutMinutes)*time.Minute,
		onLock,
	)

	if a.deps.Cfg.Vault.Enabled {
		a.deps.Store.SetVaultKeyFunc(a.deps.LockState.GetKey)
	}

	a.deps.DebugSink = debuglog.NewDebugSink(
		&wailsEventEmitter{ctx: ctx},
		a.deps.Cfg.Debug,
		dbDir,
	)

	a.deps.Manager = session.NewManager(ctx, a.deps.Cfg, &wailsEventEmitter{ctx: ctx}, a.deps.DebugSink)

	wailsruntime.OnFileDrop(ctx, func(_ int, _ int, paths []string) {
		wailsruntime.EventsEmit(ctx, "window:filedrop", map[string]interface{}{
			"paths": paths,
		})
	})
}

// shutdown is called by Wails on window close.
func (a *App) shutdown(_ context.Context) {
	if a.deps.LockState != nil {
		a.deps.LockState.Shutdown()
	}
	if a.deps.Manager != nil {
		a.deps.Manager.Shutdown()
	}
	if a.deps.DebugSink != nil {
		a.deps.DebugSink.Shutdown()
	}
	if a.deps.Store != nil {
		a.deps.Store.Close()
	}
}

// SetDebugLevel updates the debug sink's level for a category.
// Pass empty category to set the global level.
func (a *App) SetDebugLevel(category string, level string) {
	if a.deps.DebugSink != nil {
		a.deps.DebugSink.SetLevel(debuglog.DebugCategory(category), level)
	}
	// Persist to config
	if category == "" {
		a.deps.Cfg.Debug.DefaultLevel = level
	} else {
		a.deps.Cfg.Debug.CategoryLevels[category] = level
	}
	_ = a.deps.Cfg.Save(a.deps.CfgPath)
}

// --- App Config ---

// GetConfig returns the current application configuration.
func (a *App) GetConfig() config.Config {
	return *a.deps.Cfg
}

// UpdateConfig replaces the current configuration and persists it to disk.
// Keybinding overrides are preserved — they are managed exclusively via KeybindFacade.
func (a *App) UpdateConfig(cfg config.Config) error {
	cfg.Keybindings = a.deps.Cfg.Keybindings
	*a.deps.Cfg = cfg
	if a.deps.CfgPath != "" {
		return cfg.Save(a.deps.CfgPath)
	}
	return nil
}
