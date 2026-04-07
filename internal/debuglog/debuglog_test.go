package debuglog_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	mu     sync.Mutex
	events []capturedEvent
}

func (t *testEmitter) Emit(topic string, data any) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, capturedEvent{Topic: topic, Data: data})
}

func (t *testEmitter) Len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.events)
}

func (t *testEmitter) FirstTopic() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.events) == 0 {
		return ""
	}
	return t.events[0].Topic
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
	for range 50 {
		sink.Emit(debuglog.CategoryApp, debuglog.LevelInfo, "", "", "msg", nil)
	}

	// Wait briefly for the batch to flush
	time.Sleep(200 * time.Millisecond)

	if emitter.Len() == 0 {
		t.Fatal("expected at least one batch event after 50 entries")
	}
	if emitter.FirstTopic() != "debug:log-batch" {
		t.Errorf("expected topic debug:log-batch, got %s", emitter.FirstTopic())
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

	if emitter.Len() == 0 {
		t.Fatal("expected shutdown to flush remaining batch")
	}
}
