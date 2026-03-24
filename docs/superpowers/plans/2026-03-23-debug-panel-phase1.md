# Debug Panel Phase 1 (Live Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible bottom panel with a real-time structured log stream, per-category level controls, and JSONL persistence.

**Architecture:** A Go `DebugSink` receives `Emit()` calls from subsystems, batches entries, and flushes them to the frontend via Wails events and to a JSONL file on disk. The React frontend stores entries in a mutable ring buffer and renders them in a virtualized, filterable log list inside a resizable bottom panel.

**Tech Stack:** Go (zerolog levels, lumberjack rotation), React/TypeScript (Jotai, react-resizable-panels, @tanstack/react-virtual), Wails v2 events

**Spec:** `docs/superpowers/specs/2026-03-23-debug-panel-design.md`

---

## File Map

### Go (create)

| File | Responsibility |
|------|---------------|
| `internal/debuglog/debuglog.go` | `DebugSink` struct, `Emit()`, `SetLevel()`, `Shutdown()`, batch flushing goroutine, JSONL writer |
| `internal/debuglog/debuglog_test.go` | Unit tests for sink: level filtering, batching, JSONL output, shutdown flush |

### Go (modify)

| File | Change |
|------|--------|
| `internal/config/config.go` | Add `DebugConfig` struct and `Debug` field to `Config` |
| `app.go` | Create `DebugSink` in `startup()`, shut it down in `shutdown()`, add `SetDebugLevel()` + `GetDebugConfig()` RPC methods |
| `internal/session/session.go` | Accept `DebugSink` in `NewManager()`, emit debug entries at connect/auth/channel/disconnect points |
| `internal/session/sftp.go` | Emit debug entries at SFTP open/readdir/upload/download/error points |
| `internal/session/portforward.go` | Emit debug entries at bind/dial/close/error points |

### Frontend (create)

| File | Responsibility |
|------|---------------|
| `frontend/src/types/debug.ts` | `DebugLogEntry`, `DebugCategory`, `DebugLevel` types |
| `frontend/src/store/debugStore.ts` | Ring buffer class, Jotai atoms for debug state (version, filters, panel open, level config) |
| `frontend/src/hooks/useDebugEvents.ts` | Wails event listener for `debug:log-batch`, pushes into ring buffer |
| `frontend/src/components/debug/DebugPanel.tsx` | Bottom panel container with filter bar and virtualized log list |
| `frontend/src/components/debug/DebugFilterBar.tsx` | Session selector, category pills, level display filter, search, gear icon |
| `frontend/src/components/debug/DebugLogRow.tsx` | Single log entry row with timestamp hover tooltip |
| `frontend/src/components/debug/LevelControlsPopover.tsx` | Per-category emission level controls popover |

### Frontend (modify)

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Wrap main content in vertical `ResizablePanelGroup`, add `DebugPanel` as bottom panel |
| `frontend/src/store/useAppInit.ts` | Register `debug:log-batch` event listener, register `Cmd+J` keyboard shortcut |
| `frontend/package.json` | Add `@tanstack/react-virtual` dependency |

---

## Task 1: Add DebugConfig to config package

**Files:**
- Modify: `internal/config/config.go:11-16` (Config struct), `internal/config/config.go:58-83` (Default func)

- [ ] **Step 1: Add DebugConfig struct and field**

In `internal/config/config.go`, add the `DebugConfig` struct after `LogConfig` (after line 28) and a `Debug` field to `Config`:

```go
// DebugConfig controls the debug panel and structured log emission.
type DebugConfig struct {
	// DefaultLevel is the global minimum level for the debug sink: trace, debug, info, warn, error.
	DefaultLevel string `json:"default_level"`
	// CategoryLevels holds per-category level overrides (e.g. {"ssh": "trace"}).
	CategoryLevels map[string]string `json:"category_levels"`
	// RingBufferSize is the max entries held in the frontend ring buffer.
	RingBufferSize int `json:"ring_buffer_size"`
	// PersistenceMaxSizeMB is the max size of debug.jsonl before rotation.
	PersistenceMaxSizeMB int `json:"persistence_max_size_mb"`
	// PersistenceMaxBackups is the number of rotated debug.jsonl files to retain.
	PersistenceMaxBackups int `json:"persistence_max_backups"`
	// PersistenceMaxAgeDays is the number of days to retain rotated debug log files.
	PersistenceMaxAgeDays int `json:"persistence_max_age_days"`
}
```

Add `Debug DebugConfig` to the `Config` struct (after the `Log` field):

```go
type Config struct {
	SSH    SSHConfig    `json:"ssh"`
	SFTP   SFTPConfig   `json:"sftp"`
	Window WindowConfig `json:"window"`
	Log    LogConfig    `json:"log"`
	Debug  DebugConfig  `json:"debug"`
}
```

Add defaults in `Default()`:

```go
Debug: DebugConfig{
	DefaultLevel:          "info",
	CategoryLevels:        map[string]string{},
	RingBufferSize:        10000,
	PersistenceMaxSizeMB:  10,
	PersistenceMaxBackups: 3,
	PersistenceMaxAgeDays: 30,
},
```

- [ ] **Step 2: Run tests**

Run: `go test ./internal/config/... -v`
Expected: PASS (no config tests currently, but verify compilation)

- [ ] **Step 3: Run full test suite**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add internal/config/config.go
git commit -m "feat(config): add DebugConfig for debug panel settings"
```

---

## Task 2: Create DebugSink with level filtering and JSONL persistence

**Files:**
- Create: `internal/debuglog/debuglog.go`
- Create: `internal/debuglog/debuglog_test.go`

- [ ] **Step 1: Write tests for DebugSink**

Create `internal/debuglog/debuglog_test.go`:

```go
package debuglog_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/debuglog"
)

type capturedEvent struct {
	Topic string
	Data  any
}

type testEmitter struct {
	events []capturedEvent
}

func (t *testEmitter) Emit(topic string, data any) {
	t.events = append(t.events, capturedEvent{Topic: topic, Data: data})
}

func TestEmit_RespectsCategoryLevel(t *testing.T) {
	dir := t.TempDir()
	emitter := &testEmitter{}
	cfg := config.DebugConfig{
		DefaultLevel:          "info",
		CategoryLevels:        map[string]string{"ssh": "trace"},
		PersistenceMaxSizeMB:  1,
		PersistenceMaxBackups: 1,
		PersistenceMaxAgeDays: 1,
	}
	sink := debuglog.NewDebugSink(emitter, cfg, dir)
	defer sink.Shutdown()

	// SSH at trace level should pass (category override = trace)
	sink.Emit(debuglog.CategorySSH, debuglog.LevelTrace, "s1", "root@host", "trace msg", nil)
	// App at trace level should be filtered (global = info)
	sink.Emit(debuglog.CategoryApp, debuglog.LevelTrace, "", "", "filtered msg", nil)
	// App at info level should pass
	sink.Emit(debuglog.CategoryApp, debuglog.LevelInfo, "", "", "info msg", nil)

	sink.Shutdown()

	// Check JSONL file
	data, err := os.ReadFile(filepath.Join(dir, "debug.jsonl"))
	if err != nil {
		t.Fatalf("read jsonl: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 JSONL lines, got %d: %s", len(lines), string(data))
	}

	var entry1 debuglog.DebugLogEntry
	if err := json.Unmarshal([]byte(lines[0]), &entry1); err != nil {
		t.Fatalf("unmarshal line 1: %v", err)
	}
	if entry1.Category != debuglog.CategorySSH || entry1.Message != "trace msg" {
		t.Errorf("unexpected first entry: %+v", entry1)
	}
}

func TestEmit_BatchFlush(t *testing.T) {
	dir := t.TempDir()
	emitter := &testEmitter{}
	cfg := config.DebugConfig{
		DefaultLevel:          "trace",
		CategoryLevels:        map[string]string{},
		PersistenceMaxSizeMB:  1,
		PersistenceMaxBackups: 1,
		PersistenceMaxAgeDays: 1,
	}
	sink := debuglog.NewDebugSink(emitter, cfg, dir)

	// Emit enough entries to trigger a size-based flush (50 entries)
	for i := 0; i < 50; i++ {
		sink.Emit(debuglog.CategoryApp, debuglog.LevelInfo, "", "", "msg", nil)
	}

	// Wait briefly for the batch to flush
	time.Sleep(200 * time.Millisecond)

	if len(emitter.events) == 0 {
		t.Fatal("expected at least one batch event after 50 entries")
	}
	if emitter.events[0].Topic != "debug:log-batch" {
		t.Errorf("expected topic debug:log-batch, got %s", emitter.events[0].Topic)
	}

	sink.Shutdown()
}

func TestSetLevel_ChangesFiltering(t *testing.T) {
	dir := t.TempDir()
	emitter := &testEmitter{}
	cfg := config.DebugConfig{
		DefaultLevel:          "info",
		CategoryLevels:        map[string]string{},
		PersistenceMaxSizeMB:  1,
		PersistenceMaxBackups: 1,
		PersistenceMaxAgeDays: 1,
	}
	sink := debuglog.NewDebugSink(emitter, cfg, dir)
	defer sink.Shutdown()

	// Debug should be filtered at info level
	sink.Emit(debuglog.CategorySSH, debuglog.LevelDebug, "s1", "root@host", "should be filtered", nil)

	// Change SSH to debug level
	sink.SetLevel(debuglog.CategorySSH, "debug")

	// Now debug should pass
	sink.Emit(debuglog.CategorySSH, debuglog.LevelDebug, "s1", "root@host", "should pass", nil)

	sink.Shutdown()

	data, err := os.ReadFile(filepath.Join(dir, "debug.jsonl"))
	if err != nil {
		t.Fatalf("read jsonl: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 JSONL line, got %d: %s", len(lines), string(data))
	}

	var entry debuglog.DebugLogEntry
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if entry.Message != "should pass" {
		t.Errorf("expected 'should pass', got '%s'", entry.Message)
	}
}

func TestShutdown_FlushesRemainingBatch(t *testing.T) {
	dir := t.TempDir()
	emitter := &testEmitter{}
	cfg := config.DebugConfig{
		DefaultLevel:          "info",
		CategoryLevels:        map[string]string{},
		PersistenceMaxSizeMB:  1,
		PersistenceMaxBackups: 1,
		PersistenceMaxAgeDays: 1,
	}
	sink := debuglog.NewDebugSink(emitter, cfg, dir)

	// Emit one entry (won't trigger size-based flush)
	sink.Emit(debuglog.CategoryApp, debuglog.LevelInfo, "", "", "final msg", nil)

	// Shutdown should flush
	sink.Shutdown()

	if len(emitter.events) == 0 {
		t.Fatal("expected shutdown to flush remaining batch")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/debuglog/... -v`
Expected: FAIL (package does not exist yet)

- [ ] **Step 3: Implement DebugSink**

Create `internal/debuglog/debuglog.go`:

```go
package debuglog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/dylanbr0wn/shsh/internal/session"
	"github.com/rs/zerolog/log"
	"gopkg.in/lumberjack.v2"
)

// DebugCategory identifies which subsystem produced a log entry.
type DebugCategory string

const (
	CategorySSH     DebugCategory = "ssh"
	CategorySFTP    DebugCategory = "sftp"
	CategoryPortFwd DebugCategory = "portfwd"
	CategoryNetwork DebugCategory = "network"
	CategoryApp     DebugCategory = "app"
)

// DebugLevel is a string log level for the debug sink.
type DebugLevel = string

const (
	LevelTrace DebugLevel = "trace"
	LevelDebug DebugLevel = "debug"
	LevelInfo  DebugLevel = "info"
	LevelWarn  DebugLevel = "warn"
	LevelError DebugLevel = "error"
)

// levelPriority maps level strings to numeric priority for comparison.
var levelPriority = map[string]int{
	LevelTrace: 0,
	LevelDebug: 1,
	LevelInfo:  2,
	LevelWarn:  3,
	LevelError: 4,
}

// DebugLogEntry is a single structured log entry emitted by the debug sink.
type DebugLogEntry struct {
	Timestamp    time.Time              `json:"timestamp"`
	Category     DebugCategory          `json:"category"`
	Level        string                 `json:"level"`
	SessionID    string                 `json:"sessionId"`
	SessionLabel string                 `json:"sessionLabel"`
	Message      string                 `json:"message"`
	Fields       map[string]interface{} `json:"fields,omitempty"`
}

const (
	batchMaxSize    = 50
	batchFlushInterval = 100 * time.Millisecond
)

// DebugSink collects structured log entries, batches them for frontend emission,
// and persists them to a JSONL file.
type DebugSink struct {
	mu             sync.RWMutex
	globalLevel    string
	categoryLevels map[DebugCategory]string

	emitter     session.EventEmitter
	jsonlWriter *lumberjack.Logger

	batchMu sync.Mutex
	batch   []DebugLogEntry

	done chan struct{}
	wg   sync.WaitGroup
}

// NewDebugSink creates and starts the debug sink. Call Shutdown() on app exit.
func NewDebugSink(emitter session.EventEmitter, cfg config.DebugConfig, dataDir string) *DebugSink {
	catLevels := make(map[DebugCategory]string, len(cfg.CategoryLevels))
	for k, v := range cfg.CategoryLevels {
		catLevels[DebugCategory(k)] = v
	}

	s := &DebugSink{
		globalLevel:    cfg.DefaultLevel,
		categoryLevels: catLevels,
		emitter:        emitter,
		jsonlWriter: &lumberjack.Logger{
			Filename:   filepath.Join(dataDir, "debug.jsonl"),
			MaxSize:    cfg.PersistenceMaxSizeMB,
			MaxBackups: cfg.PersistenceMaxBackups,
			MaxAge:     cfg.PersistenceMaxAgeDays,
		},
		batch: make([]DebugLogEntry, 0, batchMaxSize),
		done:  make(chan struct{}),
	}

	s.wg.Add(1)
	go s.flushLoop()
	return s
}

// Emit records a debug log entry if it passes the current level filter.
func (s *DebugSink) Emit(category DebugCategory, level string,
	sessionID, sessionLabel, message string, fields map[string]interface{}) {

	if !s.shouldEmit(category, level) {
		return
	}

	entry := DebugLogEntry{
		Timestamp:    time.Now(),
		Category:     category,
		Level:        level,
		SessionID:    sessionID,
		SessionLabel: sessionLabel,
		Message:      message,
		Fields:       fields,
	}

	// Write to JSONL file (append-only)
	if data, err := json.Marshal(entry); err == nil {
		data = append(data, '\n')
		if _, err := s.jsonlWriter.Write(data); err != nil {
			log.Error().Err(err).Msg("debuglog: failed to write to JSONL")
		}
	}

	// Add to batch
	s.batchMu.Lock()
	s.batch = append(s.batch, entry)
	shouldFlush := len(s.batch) >= batchMaxSize
	s.batchMu.Unlock()

	if shouldFlush {
		s.flush()
	}
}

// SetLevel updates the level for a category. Pass empty category to set global level.
func (s *DebugSink) SetLevel(category DebugCategory, level string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if category == "" {
		s.globalLevel = level
	} else {
		s.categoryLevels[category] = level
	}
}

// Shutdown flushes remaining entries and stops the background goroutine.
func (s *DebugSink) Shutdown() {
	select {
	case <-s.done:
		return // already shut down
	default:
		close(s.done)
	}
	s.wg.Wait()
	s.flush() // final flush
	s.jsonlWriter.Close()
}

func (s *DebugSink) shouldEmit(category DebugCategory, level string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	minLevel := s.globalLevel
	if catLevel, ok := s.categoryLevels[category]; ok {
		minLevel = catLevel
	}

	return levelPriority[level] >= levelPriority[minLevel]
}

func (s *DebugSink) flushLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(batchFlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.done:
			return
		}
	}
}

func (s *DebugSink) flush() {
	s.batchMu.Lock()
	if len(s.batch) == 0 {
		s.batchMu.Unlock()
		return
	}
	entries := s.batch
	s.batch = make([]DebugLogEntry, 0, batchMaxSize)
	s.batchMu.Unlock()

	s.emitter.Emit("debug:log-batch", entries)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/debuglog/... -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/debuglog/
git commit -m "feat(debuglog): add DebugSink with batched emission and JSONL persistence"
```

---

## Task 3: Wire DebugSink into App lifecycle

**Files:**
- Modify: `app.go:47-53` (App struct), `app.go:61-102` (startup), `app.go:105-112` (shutdown)

- [ ] **Step 1: Add debugSink field to App struct**

In `app.go`, add the import `"github.com/dylanbr0wn/shsh/internal/debuglog"` and a `debugSink` field to the `App` struct:

```go
type App struct {
	ctx       context.Context
	store     *store.Store
	manager   *session.Manager
	cfg       *config.Config
	cfgPath   string
	debugSink *debuglog.DebugSink
}
```

- [ ] **Step 2: Create DebugSink in startup()**

In `app.go` `startup()`, after the session manager is created (after line 95), add:

```go
a.debugSink = debuglog.NewDebugSink(
	&wailsEventEmitter{ctx: ctx},
	a.cfg.Debug,
	dbDir,
)
```

**Do NOT update the `NewManager` call yet** — the `DebugEmitter` interface and `EmitDebug` method don't exist until Task 4. The `debugSink` field is stored on `App` now but won't be passed to the manager until Task 4 wires it in.

- [ ] **Step 3: Shutdown DebugSink in shutdown()**

In `app.go` `shutdown()`, add before the store close:

```go
if a.debugSink != nil {
	a.debugSink.Shutdown()
}
```

- [ ] **Step 4: Add SetDebugLevel RPC method**

Add to `app.go`:

```go
// SetDebugLevel updates the debug sink's level for a category.
// Pass empty category to set the global level.
func (a *App) SetDebugLevel(category string, level string) {
	if a.debugSink != nil {
		a.debugSink.SetLevel(debuglog.DebugCategory(category), level)
	}
	// Persist to config
	a.cfg.Debug.CategoryLevels[category] = level
	if category == "" {
		a.cfg.Debug.DefaultLevel = level
		delete(a.cfg.Debug.CategoryLevels, "")
	}
	_ = a.cfg.Save(a.cfgPath)
}
```

- [ ] **Step 5: Run full test suite**

Run: `go test ./...`
Expected: PASS (NewManager signature hasn't changed yet — that happens in Task 4)

- [ ] **Step 6: Commit**

```bash
git add app.go
git commit -m "feat(app): wire DebugSink into startup/shutdown lifecycle"
```

---

## Task 4: Add DebugSink to session Manager and emit debug entries

**Important ordering note:** This task changes the `NewManager` signature, which means `session_test.go` and `app.go` must both be updated in the same compilation pass. Step 2 updates tests, then Step 3 (the signature change) and the `app.go` update happen together.

**Files:**
- Modify: `internal/session/session.go:28-31` (Manager struct, NewManager)
- Modify: `internal/session/sftp.go` (SFTP operations)
- Modify: `internal/session/portforward.go` (port forward operations)
- Modify: `internal/session/session_test.go` (update NewManager calls)

- [ ] **Step 1: Accept DebugSink in Manager**

The `DebugSink` type is in `internal/debuglog`, but importing it in `session` would create a coupling. Instead, define a minimal interface in the session package:

Add to `internal/session/session.go` after the `EventEmitter` interface:

```go
// DebugEmitter emits structured debug log entries. Optional — pass nil to disable.
type DebugEmitter interface {
	Emit(category string, level string, sessionID, sessionLabel, message string, fields map[string]interface{})
}
```

Note: This uses `string` for category (not `DebugCategory`) to avoid importing debuglog. The `DebugSink.Emit` method accepts `DebugCategory` which is a `string` type alias, so it satisfies this interface.

Wait — `DebugSink.Emit` takes `DebugCategory` not `string`. We need to make this work. Since `DebugCategory` is `type DebugCategory string`, we have two options:
1. Make the interface use `string` and add a wrapper method on `DebugSink`
2. Import debuglog in session

Option 1 is cleaner. Add a `EmitString` method to `DebugSink` or simply use a wrapper. Actually, since `DebugCategory` is `string` underneath, Go's type system means we need an adapter. The simplest approach: add a `DebugEmitter` interface in session that uses plain strings, and have DebugSink implement it via a wrapper or by adding an `EmitDebug(category string, ...)` method.

Add to `internal/debuglog/debuglog.go`:

```go
// EmitDebug is a convenience method that accepts plain strings for use with interfaces
// that don't import the debuglog package.
func (s *DebugSink) EmitDebug(category string, level string,
	sessionID, sessionLabel, message string, fields map[string]interface{}) {
	s.Emit(DebugCategory(category), level, sessionID, sessionLabel, message, fields)
}
```

Add the interface to `internal/session/session.go`:

```go
// DebugEmitter emits structured debug log entries. Optional — pass nil to disable.
type DebugEmitter interface {
	EmitDebug(category string, level string, sessionID, sessionLabel, message string, fields map[string]interface{})
}
```

Update the `Manager` struct to include a `debug` field and update `NewManager`:

Find the Manager struct (around line 100-120 in session.go) and add `debug DebugEmitter`. Update `NewManager` to accept it:

```go
func NewManager(ctx context.Context, cfg *config.Config, emitter EventEmitter, debug DebugEmitter) *Manager {
```

Store it on the manager: `debug: debug`

**Also update `app.go`** — now that `NewManager` takes the extra arg, update the call in `startup()`:

```go
a.manager = session.NewManager(ctx, a.cfg, &wailsEventEmitter{ctx: ctx}, a.debugSink)
```

Add a helper method on Manager for safe emission (handles nil):

```go
func (m *Manager) emitDebug(category string, level string, sessionID, sessionLabel, message string, fields map[string]interface{}) {
	if m.debug != nil {
		m.debug.EmitDebug(category, level, sessionID, sessionLabel, message, fields)
	}
}
```

- [ ] **Step 2: Update session_test.go to pass nil for DebugEmitter**

In `internal/session/session_test.go`, update both `NewManager` calls:

```go
m := session.NewManager(context.Background(), cfg, noopEmitter{}, nil)
```

- [ ] **Step 3: Add debug emissions to session.go Connect flow**

In the `Connect` method (around lines 250-400 in session.go), add `emitDebug` calls at key points:

- Before dial: `m.emitDebug("ssh", "info", sessionID, hostLabel, "connecting", map[string]interface{}{"host": hostname, "port": port})`
- After successful auth: `m.emitDebug("ssh", "info", sessionID, hostLabel, "authenticated", map[string]interface{}{"method": authMethod})`
- After session channel open: `m.emitDebug("ssh", "info", sessionID, hostLabel, "session channel opened", nil)`
- On disconnect: `m.emitDebug("ssh", "info", sessionID, hostLabel, "disconnected", nil)`
- On error (alongside existing emitErr): `m.emitDebug("ssh", "error", sessionID, hostLabel, err.Error(), nil)`

Use `"ssh"` as the category string (matches `debuglog.CategorySSH`).

- [ ] **Step 4: Add debug emissions to sftp.go**

At key SFTP operations, add emissions using `"sftp"` category:

- SFTP subsystem open: `m.emitDebug("sftp", "info", sessionID, hostLabel, "subsystem opened", nil)`
- Readdir: `m.emitDebug("sftp", "debug", sessionID, hostLabel, "readdir", map[string]interface{}{"path": path, "entries": len(entries)})`
- Upload start: `m.emitDebug("sftp", "info", sessionID, hostLabel, "upload started", map[string]interface{}{"path": remotePath})`
- Download start: `m.emitDebug("sftp", "info", sessionID, hostLabel, "download started", map[string]interface{}{"path": remotePath})`
- Errors: `m.emitDebug("sftp", "error", sessionID, hostLabel, err.Error(), nil)`

Note: You'll need to thread `sessionID` and `hostLabel` through SFTP methods. Check how the existing code accesses the session — the `sshSession` struct (stored in `m.sessions` map) has these fields.

- [ ] **Step 5: Add debug emissions to portforward.go**

At key port forward operations, add emissions using `"portfwd"` category:

- Bind: `m.emitDebug("portfwd", "info", sessionID, hostLabel, "listening", map[string]interface{}{"localPort": localPort, "remoteHost": remoteHost, "remotePort": remotePort})`
- Dial: `m.emitDebug("portfwd", "debug", sessionID, hostLabel, "dial remote", map[string]interface{}{"remoteHost": remoteHost, "remotePort": remotePort})`
- Close: `m.emitDebug("portfwd", "info", sessionID, hostLabel, "forward closed", map[string]interface{}{"localPort": localPort})`
- Errors: `m.emitDebug("portfwd", "error", sessionID, hostLabel, err.Error(), nil)`

- [ ] **Step 6: Run tests**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add internal/session/ internal/debuglog/debuglog.go
git commit -m "feat(session): emit structured debug entries from SSH, SFTP, and port forward subsystems"
```

---

## Task 5: Add frontend types and ring buffer

**Files:**
- Create: `frontend/src/types/debug.ts`
- Create: `frontend/src/store/debugStore.ts`

- [ ] **Step 1: Install @tanstack/react-virtual**

Run: `cd frontend && pnpm add @tanstack/react-virtual`

- [ ] **Step 2: Create debug types**

Create `frontend/src/types/debug.ts`:

```typescript
export type DebugCategory = 'ssh' | 'sftp' | 'portfwd' | 'network' | 'app'
export type DebugLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface DebugLogEntry {
  timestamp: string
  category: DebugCategory
  level: DebugLevel
  sessionId: string
  sessionLabel: string
  message: string
  fields?: Record<string, string | number>
}

export const LEVEL_PRIORITY: Record<DebugLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

export const CATEGORY_COLORS: Record<DebugCategory, string> = {
  ssh: '#58a6ff',
  sftp: '#3fb950',
  portfwd: '#d2a8ff',
  network: '#f0883e',
  app: '#8b949e',
}
```

- [ ] **Step 3: Create debug store with ring buffer and atoms**

Create `frontend/src/store/debugStore.ts`:

```typescript
import { atom } from 'jotai'
import type { DebugLogEntry, DebugCategory, DebugLevel } from '../types/debug'
import { LEVEL_PRIORITY } from '../types/debug'

// --- Ring Buffer ---

class RingBuffer {
  private buffer: DebugLogEntry[]
  private capacity: number
  private head = 0
  private count = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  push(entry: DebugLogEntry) {
    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  pushBatch(entries: DebugLogEntry[]) {
    for (const entry of entries) {
      this.push(entry)
    }
  }

  getAll(): DebugLogEntry[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count)
    }
    // Wrap around: entries from head to end, then 0 to head
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ]
  }

  clear() {
    this.head = 0
    this.count = 0
  }

  get size() {
    return this.count
  }
}

// Singleton ring buffer (mutable, not in React state)
export const debugRingBuffer = new RingBuffer(10000)

// --- Atoms ---

// Incremented when the ring buffer changes, triggers re-renders
export const debugVersionAtom = atom(0)

// Panel open/closed state
export const debugPanelOpenAtom = atom(false)

// Display filters (client-side only)
export const debugFilterCategoriesAtom = atom<Set<DebugCategory>>(
  new Set(['ssh', 'sftp', 'portfwd', 'network', 'app'])
)
export const debugFilterLevelAtom = atom<DebugLevel>('trace')
export const debugFilterSessionAtom = atom<string>('') // empty = all
export const debugFilterSearchAtom = atom<string>('')

// Derived: filtered entries from the ring buffer
export const debugFilteredEntriesAtom = atom((get) => {
  get(debugVersionAtom) // subscribe to changes
  const entries = debugRingBuffer.getAll()
  const categories = get(debugFilterCategoriesAtom)
  const minLevel = get(debugFilterLevelAtom)
  const sessionFilter = get(debugFilterSessionAtom)
  const search = get(debugFilterSearchAtom).toLowerCase()

  return entries.filter((e) => {
    if (!categories.has(e.category)) return false
    if (LEVEL_PRIORITY[e.level] < LEVEL_PRIORITY[minLevel]) return false
    if (sessionFilter && e.sessionId !== sessionFilter) return false
    if (search && !e.message.toLowerCase().includes(search)) return false
    return true
  })
})
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/debug.ts frontend/src/store/debugStore.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "feat(ui): add debug types, ring buffer, and Jotai atoms for debug panel"
```

---

## Task 6: Create debug event listener hook

**Files:**
- Create: `frontend/src/hooks/useDebugEvents.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useDebugEvents.ts`:

```typescript
import { useSetAtom } from 'jotai'
import { useWailsEvent } from './useWailsEvent'
import { debugRingBuffer, debugVersionAtom } from '../store/debugStore'
import type { DebugLogEntry } from '../types/debug'

/**
 * Listens for debug:log-batch events from the Go backend
 * and pushes entries into the ring buffer.
 */
export function useDebugEvents() {
  const bumpVersion = useSetAtom(debugVersionAtom)

  // useWailsEvent passes (...args: unknown[]) — Wails sends the array as the first arg
  useWailsEvent('debug:log-batch', (...args: unknown[]) => {
    const entries = args[0] as DebugLogEntry[]
    if (Array.isArray(entries)) {
      debugRingBuffer.pushBatch(entries)
      bumpVersion((v) => v + 1)
    }
  })
}
```

- [ ] **Step 2: Register in useAppInit**

In `frontend/src/store/useAppInit.ts`, import and call the hook:

```typescript
import { useDebugEvents } from '../hooks/useDebugEvents'
```

Add `useDebugEvents()` near the top of the `useAppInit` function body (alongside the other hook calls).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useDebugEvents.ts frontend/src/store/useAppInit.ts
git commit -m "feat(ui): add useDebugEvents hook to receive debug log batches"
```

---

## Task 7: Build DebugLogRow component

**Files:**
- Create: `frontend/src/components/debug/DebugLogRow.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/debug/DebugLogRow.tsx`:

```tsx
import { memo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip'
import type { DebugLogEntry } from '../../types/debug'
import { CATEGORY_COLORS } from '../../types/debug'

function formatCompactTime(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).charAt(0)
  return `${h}:${m}:${s}.${ms}`
}

const levelColors: Record<string, string> = {
  error: 'text-red-400 bg-red-500/10',
  warn: 'text-orange-400 bg-orange-500/5',
}

export const DebugLogRow = memo(function DebugLogRow({
  entry,
}: {
  entry: DebugLogEntry
}) {
  const levelStyle = levelColors[entry.level] ?? ''
  const catColor = CATEGORY_COLORS[entry.category]

  return (
    <div
      className={`flex gap-2 px-3 py-px font-mono text-xs leading-relaxed ${levelStyle}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-[72px] shrink-0 text-muted-foreground/50 cursor-default">
            {formatCompactTime(entry.timestamp)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-xs">
          {new Date(entry.timestamp).toISOString()}
        </TooltipContent>
      </Tooltip>
      <span
        className="min-w-[52px] shrink-0"
        style={{ color: catColor }}
      >
        {entry.category === 'portfwd' ? 'PortFwd' : entry.category.toUpperCase()}
      </span>
      <span className="min-w-[32px] shrink-0 text-muted-foreground">
        {entry.level.toUpperCase().slice(0, 3)}
      </span>
      <span className="min-w-[100px] shrink-0 text-muted-foreground/60 truncate">
        {entry.sessionLabel}
      </span>
      <span className="text-foreground truncate">{entry.message}</span>
    </div>
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/debug/DebugLogRow.tsx
git commit -m "feat(ui): add DebugLogRow component with timestamp hover tooltip"
```

---

## Task 8: Build DebugFilterBar component

**Files:**
- Create: `frontend/src/components/debug/DebugFilterBar.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/debug/DebugFilterBar.tsx`:

```tsx
import { useAtom, useSetAtom } from 'jotai'
import { Search, X } from 'lucide-react'
import { LevelControlsPopover } from './LevelControlsPopover'
import type { DebugLevel } from '../../types/debug'
import {
  debugFilterCategoriesAtom,
  debugFilterLevelAtom,
  debugFilterSearchAtom,
  debugFilterSessionAtom,
  debugRingBuffer,
  debugVersionAtom,
} from '../../store/debugStore'
import type { DebugCategory, DebugLevel } from '../../types/debug'
import { CATEGORY_COLORS } from '../../types/debug'

const ALL_CATEGORIES: { key: DebugCategory; label: string }[] = [
  { key: 'ssh', label: 'SSH' },
  { key: 'sftp', label: 'SFTP' },
  { key: 'portfwd', label: 'PortFwd' },
  { key: 'network', label: 'Network' },
  { key: 'app', label: 'App' },
]

const ALL_LEVELS: { key: DebugLevel; label: string }[] = [
  { key: 'trace', label: 'Trace' },
  { key: 'debug', label: 'Debug' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn+' },
  { key: 'error', label: 'Error' },
]

interface Props {
  globalLevel: DebugLevel
  categoryLevels: Record<string, string>
}

export function DebugFilterBar({ globalLevel, categoryLevels }: Props) {
  const [categories, setCategories] = useAtom(debugFilterCategoriesAtom)
  const [level, setLevel] = useAtom(debugFilterLevelAtom)
  const [search, setSearch] = useAtom(debugFilterSearchAtom)
  const [sessionFilter, setSessionFilter] = useAtom(debugFilterSessionAtom)
  const bumpVersion = useSetAtom(debugVersionAtom)

  const toggleCategory = (cat: DebugCategory) => {
    setCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleClear = () => {
    debugRingBuffer.clear()
    bumpVersion((v) => v + 1)
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Debug
      </span>

      {/* Session selector */}
      <select
        value={sessionFilter}
        onChange={(e) => setSessionFilter(e.target.value)}
        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
      >
        <option value="">All Sessions</option>
        {/* Sessions are derived from ring buffer entries */}
        {[...new Set(debugRingBuffer.getAll().map((e) => e.sessionId).filter(Boolean))].map((id) => {
          const label = debugRingBuffer.getAll().find((e) => e.sessionId === id)?.sessionLabel ?? id
          return <option key={id} value={id}>{label}</option>
        })}
      </select>

      {/* Category pills */}
      <div className="flex gap-1 ml-1">
        {ALL_CATEGORIES.map(({ key, label }) => {
          const active = categories.has(key)
          const color = CATEGORY_COLORS[key]
          return (
            <button
              key={key}
              onClick={() => toggleCategory(key)}
              className="rounded-full border px-2 py-px text-[10px] transition-opacity"
              style={{
                color: active ? color : undefined,
                borderColor: active ? `${color}55` : 'transparent',
                backgroundColor: active ? `${color}22` : undefined,
                opacity: active ? 1 : 0.4,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* Level display filter */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Level:</span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as DebugLevel)}
          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {ALL_LEVELS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-1.5 top-1 h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-28 rounded border border-border bg-muted pl-5 pr-1.5 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Gear icon with level controls popover */}
      <LevelControlsPopover
        globalLevel={globalLevel}
        categoryLevels={categoryLevels}
      />

      {/* Clear */}
      <button
        onClick={handleClear}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        title="Clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/debug/DebugFilterBar.tsx
git commit -m "feat(ui): add DebugFilterBar with category pills, level filter, and search"
```

---

## Task 9: Build LevelControlsPopover component

**Files:**
- Create: `frontend/src/components/debug/LevelControlsPopover.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/debug/LevelControlsPopover.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Settings } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import { SetDebugLevel } from '../../../wailsjs/go/main/App'
import type { DebugCategory, DebugLevel } from '../../types/debug'
import { CATEGORY_COLORS } from '../../types/debug'

const LEVELS: DebugLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
const LEVEL_LABELS = ['TRC', 'DBG', 'INF', 'WRN', 'ERR']

const CATEGORIES: { key: DebugCategory; label: string }[] = [
  { key: 'ssh', label: 'SSH' },
  { key: 'sftp', label: 'SFTP' },
  { key: 'portfwd', label: 'PortFwd' },
  { key: 'network', label: 'Network' },
  { key: 'app', label: 'App' },
]

interface Props {
  globalLevel: DebugLevel
  categoryLevels: Record<string, string>
}

export function LevelControlsPopover({
  globalLevel: initialGlobalLevel,
  categoryLevels: initialCategoryLevels,
}: Props) {
  const [globalLevel, setGlobalLevel] = useState<DebugLevel>(initialGlobalLevel)
  const [categoryLevels, setCategoryLevels] = useState<Record<string, DebugLevel>>(
    initialCategoryLevels as Record<string, DebugLevel>
  )

  useEffect(() => {
    setGlobalLevel(initialGlobalLevel)
    setCategoryLevels(initialCategoryLevels as Record<string, DebugLevel>)
  }, [initialGlobalLevel, initialCategoryLevels])

  const handleGlobalChange = (level: DebugLevel) => {
    setGlobalLevel(level)
    SetDebugLevel('', level)
  }

  const handleCategoryChange = (cat: DebugCategory, level: DebugLevel) => {
    setCategoryLevels((prev) => ({ ...prev, [cat]: level }))
    SetDebugLevel(cat, level)
  }

  const handleReset = () => {
    setCategoryLevels({})
    for (const { key } of CATEGORIES) {
      SetDebugLevel(key, '')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title="Per-category level controls"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3 font-mono text-xs"
      >
        {/* Global level */}
        <div className="mb-2 border-b border-border pb-2">
          <div className="mb-1 font-semibold">Global Level</div>
          <div className="text-[10px] text-muted-foreground mb-1.5">
            Default for all categories
          </div>
          <LevelSelector
            value={globalLevel}
            onChange={handleGlobalChange}
          />
        </div>

        {/* Category overrides */}
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Category Overrides
        </div>
        <div className="space-y-1.5">
          {CATEGORIES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[key] }}
                />
                <span>{label}</span>
              </div>
              <LevelSelector
                value={categoryLevels[key]}
                onChange={(level) => handleCategoryChange(key, level)}
                activeColor={CATEGORY_COLORS[key]}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-2 flex justify-between border-t border-border pt-2">
          <span className="text-[10px] text-muted-foreground">
            Unset inherits global
          </span>
          <button
            onClick={handleReset}
            className="text-[10px] text-primary hover:underline"
          >
            Reset All
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LevelSelector({
  value,
  onChange,
  activeColor,
}: {
  value?: DebugLevel
  onChange: (level: DebugLevel) => void
  activeColor?: string
}) {
  return (
    <div className="flex gap-px rounded bg-muted p-0.5">
      {LEVELS.map((level, i) => {
        const active = value === level
        return (
          <button
            key={level}
            onClick={() => onChange(level)}
            className="rounded px-1.5 py-0.5 text-[10px] transition-colors"
            style={{
              backgroundColor: active ? (activeColor ? `${activeColor}33` : 'hsl(var(--border))') : undefined,
              color: active ? (activeColor ?? 'hsl(var(--foreground))') : undefined,
            }}
          >
            {LEVEL_LABELS[i]}
          </button>
        )
      })}
    </div>
  )
}
```

Note: The `SetDebugLevel` import from wailsjs will be auto-generated after running `wails build` or `wails dev` (since we added the method to `App` in Task 3). You may need to run `wails build` before this component compiles.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/debug/LevelControlsPopover.tsx
git commit -m "feat(ui): add LevelControlsPopover for per-category emission level controls"
```

---

## Task 10: Build DebugPanel and integrate into App layout

**Files:**
- Create: `frontend/src/components/debug/DebugPanel.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create DebugPanel component**

Create `frontend/src/components/debug/DebugPanel.tsx`:

```tsx
import { useRef, useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debugFilteredEntriesAtom, debugPanelOpenAtom } from '../../store/debugStore'
import { DebugFilterBar } from './DebugFilterBar'
import { DebugLogRow } from './DebugLogRow'
import type { DebugLevel } from '../../types/debug'

export function DebugPanel() {
  const [panelOpen] = useAtom(debugPanelOpenAtom)
  const entries = useAtomValue(debugFilteredEntriesAtom)
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // TODO: load from config via GetConfig RPC in a future iteration
  const [globalLevel] = useState<DebugLevel>('info')
  const [categoryLevels] = useState<Record<string, string>>({})

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20,
  })

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
    }
  }, [entries.length, autoScroll, virtualizer])

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = () => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  if (!panelOpen) return null

  return (
    <div className="flex h-full flex-col bg-background">
      <DebugFilterBar
        globalLevel={globalLevel}
        categoryLevels={categoryLevels}
      />
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <DebugLogRow entry={entry} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Integrate into App.tsx layout**

Modify `frontend/src/App.tsx` to wrap the existing horizontal `ResizablePanelGroup` and `DebugPanel` in a vertical `ResizablePanelGroup`:

Replace the content inside the main `div` (lines 44-62) with:

```tsx
<TitleBar />
<ResizablePanelGroup orientation="vertical" className="flex-1">
  <ResizablePanel defaultSize="100%" minSize="30%">
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel
        panelRef={sidebarRef}
        defaultSize="20%"
        minSize="340px"
        maxSize="40%"
        collapsible
        collapsedSize="0%"
        onResize={(size) => setSidebarCollapsed(size.inPixels === 0)}
        className="flex flex-col"
      >
        <Sidebar />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="82%" className="flex flex-col">
        <MainArea />
      </ResizablePanel>
    </ResizablePanelGroup>
  </ResizablePanel>
  <ResizableHandle className={debugPanelOpen ? '' : 'hidden'} />
  <ResizablePanel
    defaultSize="0%"
    minSize={debugPanelOpen ? "15%" : "0%"}
    maxSize="60%"
    collapsible
    collapsedSize="0%"
    className={debugPanelOpen ? '' : 'hidden'}
  >
    <DebugPanel />
  </ResizablePanel>
</ResizablePanelGroup>
```

Add the necessary imports and atom usage:

```tsx
import { DebugPanel } from './components/debug/DebugPanel'
import { debugPanelOpenAtom } from './store/debugStore'
// In the component:
const debugPanelOpen = useAtomValue(debugPanelOpenAtom)
```

Add `useAtomValue` to the jotai import.

- [ ] **Step 3: Add Cmd+J keyboard shortcut**

In `frontend/src/store/useAppInit.ts`, add a keyboard listener for the panel toggle:

```typescript
import { debugPanelOpenAtom } from './debugStore'

// Inside useAppInit, add:
const setDebugPanelOpen = useSetAtom(debugPanelOpenAtom)

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
      e.preventDefault()
      setDebugPanelOpen((prev) => !prev)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [setDebugPanelOpen])
```

- [ ] **Step 4: Regenerate Wails bindings**

Run: `wails build`

This regenerates `frontend/wailsjs/go/main/App.js` to include the `SetDebugLevel` binding.

- [ ] **Step 5: Verify build**

Run: `cd frontend && pnpm build`
Expected: PASS (no TypeScript errors)

- [ ] **Step 6: Run Go tests**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 7: Run lint and format check**

Run: `cd frontend && pnpm lint && pnpm format:check`
Expected: PASS (fix any issues)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/debug/ frontend/src/App.tsx frontend/src/store/useAppInit.ts frontend/wailsjs/
git commit -m "feat(ui): add collapsible debug panel with virtualized log stream and Cmd+J toggle"
```

---

## Task 11: End-to-end verification

- [ ] **Step 1: Run full pre-PR checklist**

```bash
go test ./...
cd frontend && pnpm build
cd frontend && pnpm lint
cd frontend && pnpm format:check
```

All must pass.

- [ ] **Step 2: Manual smoke test**

Run: `wails dev`

Verify:
1. `Cmd+J` toggles the debug panel open/closed
2. When connecting to an SSH host, debug entries appear in the panel in real time
3. Category pills toggle visibility of entries
4. Level display filter works
5. Text search filters entries
6. Gear icon opens the level controls popover
7. Changing a category's emission level in the popover affects which entries arrive
8. Panel is resizable by dragging the handle
9. Auto-scroll follows new entries; scrolling up pauses it
10. Timestamp hover shows full ISO 8601

- [ ] **Step 3: Verify JSONL persistence**

Check that `~/.config/shsh/debug.jsonl` exists and contains valid JSON lines after connecting to a host.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(debug): address issues found in smoke testing"
```
