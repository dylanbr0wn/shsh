package lockstate

import (
	"errors"
	"sync"
	"time"
)

var ErrLocked = errors.New("vault is locked")

// State manages the in-memory vault unlock state and idle timer.
type State struct {
	mu       sync.RWMutex
	locked   bool
	key      []byte
	timeout  time.Duration
	timer    *time.Timer
	onLock   func()
	shutdown bool
}

// New creates a locked State with the given idle timeout.
// onLock is called (in a goroutine) when the vault auto-locks.
func New(timeout time.Duration, onLock func()) *State {
	return &State{
		locked:  true,
		timeout: timeout,
		onLock:  onLock,
	}
}

// IsLocked returns whether the vault is currently locked.
func (s *State) IsLocked() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.locked
}

// Unlock stores the derived key and starts the idle timer.
func (s *State) Unlock(key []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.key = key
	s.locked = false
	s.resetTimerLocked()
}

// Lock zeroes the key and stops the idle timer.
func (s *State) Lock() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lockLocked()
}

// GetKey returns the derived key if unlocked, or ErrLocked.
func (s *State) GetKey() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.locked {
		return nil, ErrLocked
	}
	return s.key, nil
}

// Touch resets the idle timer. Call on every credential access.
func (s *State) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.locked {
		s.resetTimerLocked()
	}
}

// SetTimeout updates the idle timeout duration.
func (s *State) SetTimeout(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeout = d
	if !s.locked {
		s.resetTimerLocked()
	}
}

// Shutdown zeroes the key and prevents further unlocks.
func (s *State) Shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shutdown = true
	s.lockLocked()
}

func (s *State) lockLocked() {
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.key != nil {
		for i := range s.key {
			s.key[i] = 0
		}
		s.key = nil
	}
	s.locked = true
}

func (s *State) resetTimerLocked() {
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(s.timeout, func() {
		s.Lock()
		if s.onLock != nil {
			s.onLock()
		}
	})
}
