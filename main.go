package main

import (
	"os"
	"path/filepath"
	goruntime "runtime"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/keybind"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/lumberjack.v2"
)

const docsBaseURL = "https://dylanbr0wn.github.io/shsh"

func buildMenu(app *App) *menu.Menu {
	m := menu.NewMenu()
	if goruntime.GOOS == "darwin" {
		m.Append(menu.AppMenu())
	}

	resolved := keybind.Resolve(keybind.Defaults(), app.deps.Cfg.Keybindings)
	shortcutMap := make(map[string]string, len(resolved))
	for _, r := range resolved {
		shortcutMap[r.ActionID] = r.Shortcut
	}
	shortcutLabel := func(actionID string) string {
		s := shortcutMap[actionID]
		if s == "" {
			return ""
		}
		return "  " + keybind.FormatForDisplay(s)
	}

	file := m.AddSubmenu("File")
	file.AddText("Quick Connect..."+shortcutLabel("quick_connect"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:new-connection")
	})
	file.AddText("Add Saved Host..."+shortcutLabel("add_host"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:add-host")
	})
	file.AddText("Import SSH Config..."+shortcutLabel("import_ssh_config"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:import-ssh-config")
	})
	file.AddText("Export Hosts...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:export-hosts")
	})
	file.AddSeparator()
	file.AddText("New Group...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:new-group")
	})
	file.AddText("Terminal Profiles...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:terminal-profiles")
	})
	file.AddSeparator()
	file.AddText("Settings..."+shortcutLabel("settings"), nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:settings")
	})
	file.AddSeparator()
	file.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.deps.Ctx)
	})

	session := m.AddSubmenu("Session")
	session.AddText("Disconnect", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:disconnect")
	})
	session.AddText("Disconnect All", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:disconnect-all")
	})
	session.AddSeparator()
	session.AddText("Add Port Forward...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:add-port-forward")
	})
	session.AddSeparator()
	session.AddText("Start Logging", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:start-log")
	})
	session.AddText("Stop Logging", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:stop-log")
	})
	session.AddText("View Logs...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:view-logs")
	})
	session.AddText("Open Logs Folder", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.deps.Ctx, "menu:session:open-logs-folder")
	})

	if goruntime.GOOS == "darwin" {
		m.Append(menu.EditMenu())
	}

	help := m.AddSubmenu("Help")
	help.AddText("Documentation", nil, func(_ *menu.CallbackData) {
		runtime.BrowserOpenURL(app.deps.Ctx, docsBaseURL)
	})

	return m
}

func setupLogger(cfg *config.Config) {
	level, err := zerolog.ParseLevel(cfg.Log.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = time.RFC3339

	configDir, _ := os.UserConfigDir()
	logPath := filepath.Join(configDir, "shsh", "shsh.log")

	roller := &lumberjack.Logger{
		Filename:   logPath,
		MaxSize:    cfg.Log.MaxSizeMB,
		MaxBackups: cfg.Log.MaxBackups,
		MaxAge:     cfg.Log.MaxAgeDays,
		Compress:   true,
	}

	multi := zerolog.MultiLevelWriter(
		zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339},
		roller,
	)
	log.Logger = zerolog.New(multi).With().Timestamp().Caller().Logger()
}

func main() {
	cfg, _ := config.Load(config.DefaultConfigPath())
	setupLogger(cfg)
	app := NewApp(cfg)

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "shsh",
		Width:     cfg.Window.Width,
		Height:    cfg.Window.Height,
		Frameless: goruntime.GOOS != "darwin",
		Menu:      buildMenu(app),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		DragAndDrop:      &options.DragAndDrop{EnableFileDrop: true},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []any{
			app,
			app.hosts,
			app.sessions,
			app.keys,
			app.tools,
			app.keybinds,
			app.vault,
			app.registry,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHidden(),
		},
	})

	if err != nil {
		log.Fatal().Err(err).Msg("Error starting application")
	}
}
