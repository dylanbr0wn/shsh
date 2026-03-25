# Debug Panel Design

A collapsible bottom panel providing real-time structured log streaming and historical post-mortem investigation for all shsh subsystems.

## Problem

When SSH sessions misbehave, users need immediate visibility into what shsh is doing under the hood. Currently, errors surface as transient toasts that disappear quickly, and investigating past failures requires reading raw log files on disk. For a developer/homelabber audience, this isn't enough — they want the full picture, live and after the fact.

## Design Summary

A bottom panel (collapsed by default, toggled with `Cmd+J` / `Ctrl+J`) that displays a unified structured log stream from all subsystems. The same panel supports two modes — **Live** (real-time stream) and **History** (post-mortem from persisted logs) — with identical filtering controls. Users can adjust log verbosity globally and per-category without restarting sessions.

## Log Categories

| Category  | Color   | What it captures |
|-----------|---------|-----------------|
| SSH       | Blue    | Key exchange, auth attempts, channel opens/closes, rekeying, keepalives |
| SFTP      | Green   | Subsystem lifecycle, directory reads, file transfers, permission errors |
| PortFwd   | Purple  | Listener bind/unbind, dial attempts, connection counts, failures |
| Network   | Orange  | Keepalive RTT, latency degradation/recovery, connection drops |
| App       | Gray    | Config loading, store operations, credential resolution, general lifecycle |

## Log Levels

Five levels in order of verbosity: **Trace**, **Debug**, **Info**, **Warn**, **Error**.

### Level Control

- **Global level**: a single control that sets the baseline for all categories (default: Info)
- **Per-category overrides**: each category can be independently set to a different level, overriding the global. Unset categories inherit the global level.
- **Live toggling**: level changes are sent from the frontend to the Go backend via a Wails event (`debug:set-level`). The backend updates its per-category filter map immediately — no reconnect or restart required.
- **Reset All**: clears all per-category overrides, returning everything to the global level.

## Log Entry Structure

Each log entry is a structured object:

```typescript
interface DebugLogEntry {
  timestamp: string    // ISO 8601 with millisecond precision
  category: "ssh" | "sftp" | "portfwd" | "network" | "app"
  level: "trace" | "debug" | "info" | "warn" | "error"
  sessionId: string    // which session this relates to (empty for app-level)
  sessionLabel: string // human-readable label, e.g. "root@proxmox"
  message: string      // the log message
  fields?: Record<string, string | number>  // structured key-value data (rtt, path, bytes, etc.)
}
```

## Go-Side Architecture

### Debug Log Entry (Go struct)

```go
type DebugCategory string

const (
    CategorySSH     DebugCategory = "ssh"
    CategorySFTP    DebugCategory = "sftp"
    CategoryPortFwd DebugCategory = "portfwd"
    CategoryNetwork DebugCategory = "network"
    CategoryApp     DebugCategory = "app"
)

type DebugLogEntry struct {
    Timestamp    time.Time              `json:"timestamp"`
    Category     DebugCategory          `json:"category"`
    Level        string                 `json:"level"`
    SessionID    string                 `json:"sessionId"`
    SessionLabel string                 `json:"sessionLabel"`
    Message      string                 `json:"message"`
    Fields       map[string]interface{} `json:"fields,omitempty"`
}
```

### Debug Sink Design

A **dedicated debug emitter** (not a zerolog hook) that subsystems call directly. Rationale: zerolog hooks only see what's already logged — they can't add `category` or `sessionLabel` without those already being in the zerolog call. A direct API is clearer and avoids coupling to zerolog's internal format.

```go
type DebugSink struct {
    mu             sync.RWMutex
    globalLevel    zerolog.Level
    categoryLevels map[DebugCategory]zerolog.Level
    emitter        session.EventEmitter  // decoupled from Wails runtime (same pattern as session package)
    jsonlWriter    *lumberjack.Logger    // rotated JSONL file
    batchMu        sync.Mutex
    batch          []DebugLogEntry
    flushTicker    *time.Ticker          // 100ms flush interval
}

// NewDebugSink creates and starts the sink. Must call Shutdown() on app exit.
func NewDebugSink(emitter session.EventEmitter, config DebugConfig) *DebugSink

// Emit is the primary API called by subsystems
func (s *DebugSink) Emit(category DebugCategory, level zerolog.Level,
    sessionID, sessionLabel, message string, fields map[string]interface{})

// SetLevel updates a category's level (or global if category is empty)
func (s *DebugSink) SetLevel(category DebugCategory, level zerolog.Level)

// Shutdown flushes the remaining batch and stops the background goroutine.
// Called from App.shutdown().
func (s *DebugSink) Shutdown()

// QueryLogs reads from the JSONL file with server-side filtering.
// Lives on DebugSink (co-located with the writer); App delegates to it.
func (s *DebugSink) QueryLogs(params DebugLogQuery) (DebugLogQueryResult, error)
```

The sink accepts an `EventEmitter` interface (same pattern used by the session package) rather than a raw Wails context. This keeps it unit-testable and decoupled from the Wails runtime.

**Lifecycle:** `NewDebugSink()` is called during `App.startup()`. `Shutdown()` is called from `App.shutdown()` — it flushes any remaining batch entries, stops the ticker, and closes the lumberjack writer. Without this, the last batch before exit would be silently lost.

Subsystems call `debugSink.Emit(...)` at relevant points. The existing zerolog logging continues unchanged for the app log file and console — these are independent concerns. The debug sink handles its own level filtering, batching, and emission.

### Event Batching (Throughput)

At trace level, subsystems can generate hundreds of entries per second. To avoid saturating the Wails Go-to-JS bridge:

- The sink collects entries into a batch buffer.
- A background goroutine flushes the batch every **100ms** (or when the batch reaches 50 entries, whichever comes first).
- Each flush emits a single `debug:log-batch` Wails event containing an array of entries.
- JSONL persistence writes happen inline in `Emit()` (append-only, no batching needed — the OS handles buffering).

### History Mode API

```go
// QueryDebugLogs delegates to DebugSink.QueryLogs (Wails-bound wrapper).
func (a *App) QueryDebugLogs(params DebugLogQuery) (DebugLogQueryResult, error)

type DebugLogQuery struct {
    StartTime  *time.Time      `json:"startTime"`
    EndTime    *time.Time      `json:"endTime"`
    Categories []DebugCategory `json:"categories"` // empty = all
    MinLevel   string          `json:"minLevel"`   // empty = all
    SessionID  string          `json:"sessionId"`  // empty = all
    Search     string          `json:"search"`     // substring match on message
    Limit      int             `json:"limit"`      // max entries to return (default 1000)
    Offset     int             `json:"offset"`     // for pagination
}

type DebugLogQueryResult struct {
    Entries  []DebugLogEntry      `json:"entries"`
    Total    int                  `json:"total"`    // total matching (before limit/offset)
    Sessions []DebugSessionSummary `json:"sessions"` // aggregated session cards
}

type DebugSessionSummary struct {
    SessionID    string    `json:"sessionId"`
    SessionLabel string    `json:"sessionLabel"`
    FirstSeen    time.Time `json:"firstSeen"`
    LastSeen     time.Time `json:"lastSeen"`
    EventCount   int       `json:"eventCount"`
    WarnCount    int       `json:"warnCount"`
    ErrorCount   int       `json:"errorCount"`
}
```

The query logic lives on `DebugSink` (co-located with the JSONL writer) and performs a single pass over the file, building both the filtered entry list and session summaries in one scan. Pagination via `limit`/`offset` keeps response sizes bounded. The reader skips malformed JSON lines gracefully (log + continue). Concurrent read/write is safe on macOS/Linux since writes are append-only; the reader handles a partial last line by ignoring it. On Windows, the reader must open the file with `os.O_RDONLY` and shared-read mode to avoid exclusive lock conflicts with the writer.

**Scaling note:** A single-pass scan of up to 40MB of JSONL (10MB x 4 rotated files) is acceptable for Phase 2 MVP. If query latency becomes a problem, an offset-by-timestamp index can be added later without changing the API contract.

## Data Flow

### Backend

1. Subsystems call `debugSink.Emit(category, level, sessionID, sessionLabel, message, fields)` at relevant points alongside their existing zerolog calls.
2. The debug sink checks the entry against the per-category level filter. If it passes:
   - Appends the entry as a JSON line to `~/.config/shsh/debug.jsonl` (rotated by lumberjack).
   - Adds the entry to the current batch buffer.
3. Every 100ms (or 50 entries), the batch is flushed as a single `debug:log-batch` Wails event.
4. The existing zerolog console + file logging continues unchanged. `config.log.level` controls zerolog; `config.debug.defaultLevel` controls the debug sink. These are independent.
5. Level change requests arrive from the frontend via `debug:set-level` events and update the sink's filter map.

### Frontend

1. A **mutable ring buffer** (plain array behind a ref) holds entries. A separate Jotai **version atom** (incrementing counter) triggers re-renders when the buffer changes. This avoids copying the entire array into React state on every batch.
2. Incoming `debug:log-batch` events push entries into the ring buffer and bump the version atom. Oldest entries drop off when capacity (default 10,000) is reached.
3. The log list renders with **virtualization** (`@tanstack/virtual`, new dependency to add) for smooth scrolling at high entry counts.
4. **Display filtering** (by category, level, session, text search) is applied client-side on the ring buffer contents. This is purely visual — it does not affect what the backend emits or what the buffer stores. The buffer is always unfiltered; eviction is FIFO regardless of display filters.

### Persistence (Post-Mortem)

- `~/.config/shsh/debug.jsonl` is the structured log file. One JSON object per line.
- Managed with lumberjack rotation (configurable max size, backups, age).
- In History mode, the frontend calls `QueryDebugLogs()` with filter parameters. Results are paginated (default 1000 per page). Session summary cards are computed server-side in the same scan.
- Existing per-session terminal I/O logs (`~/.config/shsh/logs/`) remain separate and unchanged.

### Error Handling

- **Malformed JSONL lines**: the history reader logs a warning and skips the line. Partial last lines (from concurrent writes) are silently ignored.
- **Event throughput saturation**: batching (100ms / 50 entries) caps the Wails event rate. If the frontend falls behind, it simply processes the next batch — no backpressure needed since the JSONL file is the durable record.
- **JSONL file too large**: lumberjack rotation handles this automatically. The query API's `limit`/`offset` prevents loading the entire file into memory.
- **Clear button**: in both Live and History mode, Clear resets the display only (empties the ring buffer or clears the query results). It does not delete persisted data.

## Panel UI

### Layout

- **Position**: bottom of the app window, below the terminal/pane area.
- **Integration**: the debug panel wraps the existing content area in a vertical `ResizablePanelGroup` (using the existing `react-resizable-panels` dependency). The main content (sidebar + panes) is one panel, the debug panel is the other. This is independent of the horizontal pane/tab system and won't conflict with future pane rework.
- **Resize handle**: `ResizableHandle` from the same library, consistent with other resize handles in the app.
- **Collapsed state**: fully hidden (panel size 0), no visual footprint. Toggle with `Cmd+J` / `Ctrl+J`.
- **Default state**: collapsed.

### Filter Bar

Left to right:
1. **"Debug" label** — panel title
2. **Live / History toggle** — segmented control switching data source
3. **Session selector** — dropdown to filter by session or show all
4. **Category pills** — colored, clickable to toggle each category on/off
5. **Spacer**
6. **Level display filter** — filters which entries are *shown* from the buffer/query results (client-side only, does not affect what the backend emits). In Live mode this is in addition to the emission-level controls in the gear popover. In History mode this filters the query results.
7. **Text search** — filter entries by message content
8. **Gear icon** (Live mode only) — opens per-category **emission-level** controls popover. This controls what the backend sends over the event channel and persists to JSONL. Distinct from the display filter (#6).
9. **Clear button** — clears the current display (empties ring buffer in Live mode, clears query results in History mode). Does not delete persisted data.

### Log Entries

- Monospace font, single line per entry.
- Columns: timestamp (compact `HH:MM:SS.s`, hover for full ISO 8601), category (color-coded), level, session label, message.
- **Warnings**: subtle amber background tint on the row.
- **Errors**: subtle red background tint on the row.
- Auto-scroll to bottom when new entries arrive (with a "pinned" behavior — if the user has scrolled up to inspect something, auto-scroll pauses until they scroll back to bottom).

### History Mode Additions

- **Session summary cards**: horizontal scrollable row showing sessions in the selected time range. Each card shows: session label, duration, event count, error/warning badges. Sessions with errors get a red border. Click to filter.
- **Time range selector**: replaces the level selector position. Options: last hour, 6 hours, 24 hours, 7 days, custom range.
- **Time gap indicators**: when gaps exist in the visible log stream (due to time gaps or filters hiding entries), a divider line shows the gap duration and count of hidden events.
- **Bottom stats bar**: total events vs filtered count, export to JSONL, open raw file in external editor.

### Per-Category Level Controls Popover

- Triggered by the gear icon in Live mode.
- **Global level**: segmented control (TRC / DBG / INF / WRN / ERR) at the top.
- **Per-category rows**: each category with its color dot, name, and its own segmented level control.
- Overridden categories highlight their active level in the category's color. Non-overridden categories show neutral gray (inheriting global).
- **Reset All** link at the bottom clears all overrides.

### Timestamp Hover

- Compact display: `HH:MM:SS.s` (e.g., `09:12:31.4`)
- Hover tooltip: full ISO 8601 with milliseconds (e.g., `2026-03-23T09:12:31.412Z`)

## Configuration

Added to the existing config structure (`~/.config/shsh/config.json`):

```json
{
  "debug": {
    "defaultLevel": "info",
    "categoryLevels": {},
    "ringBufferSize": 10000,
    "persistenceMaxSizeMB": 10,
    "persistenceMaxBackups": 3,
    "persistenceMaxAgeDays": 30
  }
}
```

- `defaultLevel`: global minimum log level (persisted across restarts)
- `categoryLevels`: per-category overrides (e.g., `{"ssh": "trace"}`) — persisted so your debugging setup survives restarts
- `ringBufferSize`: max entries held in the frontend ring buffer (configurable in UI later)
- Persistence rotation settings mirror the existing app log defaults.

## Keyboard Shortcuts

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Cmd+J` / `Ctrl+J` | Toggle debug panel open/closed | Global, works from anywhere |

Additional shortcuts (search, clear) can be added later once the panel's focus management is established. The terminal and its existing `TerminalSearch` component capture `Cmd+F` and `Cmd+K`, so panel-specific shortcuts need careful focus scoping that is better addressed during implementation.

## Implementation Phases

### Phase 1: Live Mode (MVP)

Delivers the core value — real-time visibility into what shsh is doing.

- Go-side `DebugSink` with batched Wails event emission
- JSONL persistence with lumberjack rotation
- `DebugLogEntry` Go struct and TypeScript type
- `debugSink.Emit()` calls added to session, SFTP, port forward, and network subsystems
- Per-category level control with live toggling (`debug:set-level`)
- Bottom panel UI: filter bar, virtualized log stream, category pills, level display filter
- Gear icon popover for emission-level controls
- Ring buffer with ref-based storage and version atom
- `Cmd+J` toggle
- Config structure (`debug` section in `config.json`)

### Phase 2: History Mode

Builds on Phase 1's data infrastructure to enable post-mortem investigation.

- `QueryDebugLogs()` Go method with server-side filtering and pagination
- `DebugSessionSummary` aggregation in the query scan
- Live/History toggle in the filter bar
- Session summary cards (horizontal scrollable row)
- Time range selector
- Time gap indicators
- Bottom stats bar with export to JSONL and "open in editor"

### Out of scope (future enhancements)

- Network tab with sparkline graphs / latency charts (can layer on top of this data infrastructure later)
- Ring buffer size configuration in the UI (start with config file, add UI later)
- Log entry detail expansion / structured fields display (click to expand a row)
- Correlation with terminal I/O session logs
