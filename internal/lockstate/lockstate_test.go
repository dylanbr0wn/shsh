package lockstate

import (
	"testing"
	"time"
)

func TestNewState_StartsLocked(t *testing.T) {
	s := New(5*time.Minute, nil)
	if !s.IsLocked() {
		t.Fatal("new state should be locked")
	}
}

func TestUnlock_StoresKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")

	s.Unlock(key)

	if s.IsLocked() {
		t.Fatal("should be unlocked after Unlock()")
	}

	got, err := s.GetKey()
	if err != nil {
		t.Fatalf("GetKey: %v", err)
	}
	if string(got) != string(key) {
		t.Fatal("GetKey returned wrong key")
	}
}

func TestLock_ZeroesKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")
	keyCopy := make([]byte, len(key))
	copy(keyCopy, key)

	s.Unlock(key)
	s.Lock()

	if !s.IsLocked() {
		t.Fatal("should be locked after Lock()")
	}

	_, err := s.GetKey()
	if err != ErrLocked {
		t.Fatalf("GetKey should return ErrLocked, got %v", err)
	}

	// Original key slice should be zeroed
	for i, b := range key {
		if b != 0 {
			t.Fatalf("key byte %d not zeroed: %d", i, b)
		}
	}
}

func TestTouch_ResetsTimer(t *testing.T) {
	locked := make(chan struct{}, 1)
	s := New(100*time.Millisecond, func() { locked <- struct{}{} })
	s.Unlock([]byte("test-key-32-bytes-long-xxxxxxxx"))

	// Touch before timeout
	time.Sleep(60 * time.Millisecond)
	s.Touch()

	// Should not have locked yet (timer was reset)
	select {
	case <-locked:
		t.Fatal("should not have locked yet after Touch()")
	case <-time.After(60 * time.Millisecond):
		// Good — still unlocked
	}

	// Wait for full timeout after last touch
	select {
	case <-locked:
		// Good — locked after idle
	case <-time.After(200 * time.Millisecond):
		t.Fatal("should have locked after idle timeout")
	}
}

func TestIdleTimeout_LocksAutomatically(t *testing.T) {
	locked := make(chan struct{}, 1)
	s := New(50*time.Millisecond, func() { locked <- struct{}{} })
	s.Unlock([]byte("test-key-32-bytes-long-xxxxxxxx"))

	select {
	case <-locked:
		if !s.IsLocked() {
			t.Fatal("should be locked after timeout")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("idle timeout did not fire")
	}
}

func TestSetTimeout_UpdatesDuration(t *testing.T) {
	s := New(5*time.Minute, nil)
	s.SetTimeout(10 * time.Minute)
	// No panic, timeout updated
}

func TestShutdown_ZeroesKey(t *testing.T) {
	s := New(5*time.Minute, nil)
	key := []byte("test-key-32-bytes-long-xxxxxxxx")
	s.Unlock(key)
	s.Shutdown()

	if !s.IsLocked() {
		t.Fatal("should be locked after Shutdown()")
	}
	for _, b := range key {
		if b != 0 {
			t.Fatal("key not zeroed after Shutdown()")
		}
	}
}
