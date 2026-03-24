package debuglog

import (
	"encoding/json"
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
	Fields       map[string]any `json:"fields,omitempty"`
}

const (
	batchMaxSize       = 50
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
	sessionID, sessionLabel, message string, fields map[string]any) {

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

// EmitDebug is a convenience method that accepts plain strings for use with interfaces
// that don't import the debuglog package.
func (s *DebugSink) EmitDebug(category string, level string,
	sessionID, sessionLabel, message string, fields map[string]any) {
	s.Emit(DebugCategory(category), level, sessionID, sessionLabel, message, fields)
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
