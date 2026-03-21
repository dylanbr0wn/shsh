package main

import (
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func buildMenu(app *App) *menu.Menu {
	m := menu.NewMenu()
	if goruntime.GOOS == "darwin" {
		m.Append(menu.AppMenu())
	}

	file := m.AddSubmenu("File")
	file.AddText("Quick Connect...", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:new-connection")
	})
	file.AddText("Add Saved Host...", keys.Combo("n", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:add-host")
	})
	file.AddText("Import SSH Config...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:import-ssh-config")
	})
	file.AddSeparator()
	file.AddText("New Group...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:new-group")
	})
	file.AddText("Terminal Profiles...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:terminal-profiles")
	})
	file.AddSeparator()
	file.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:settings")
	})
	file.AddSeparator()
	file.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	session := m.AddSubmenu("Session")
	session.AddText("Disconnect", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:disconnect")
	})
	session.AddText("Disconnect All", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:disconnect-all")
	})
	session.AddSeparator()
	session.AddText("Add Port Forward...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:add-port-forward")
	})
	session.AddSeparator()
	session.AddText("Start Logging", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:start-log")
	})
	session.AddText("Stop Logging", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:stop-log")
	})
	session.AddText("View Logs...", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:view-logs")
	})
	session.AddText("Open Logs Folder", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:session:open-logs-folder")
	})

	if goruntime.GOOS == "darwin" {
		m.Append(menu.EditMenu())
	}
	return m
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "shsh",
		Width:     1280,
		Height:    800,
		Frameless: goruntime.GOOS != "darwin",
		Menu:      buildMenu(app),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []any{
			app,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHidden(),
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
