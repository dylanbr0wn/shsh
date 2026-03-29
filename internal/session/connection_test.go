package session

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// heapString returns a heap-allocated copy of s so that clearString (which
// overwrites the backing array via unsafe) does not fault on read-only memory.
func heapString(s string) string {
	return strings.Clone(s)
}

func TestConnectOrReuse_ReusesExistingConnection(t *testing.T) {
	ks := newKillableSSHServer(t, "pass1")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, _ := hostFromKillable(t, ks)

	// Accept host keys automatically in background.
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case <-done:
				return
			default:
			}
			for _, ev := range tm.Emitter.EventsByTopic("connection:hostkey") {
				hk, ok := ev.Data.(ConnHostKeyEvent)
				if ok {
					m.RespondConnHostKey(hk.ConnectionID, true)
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()

	r1, err := m.ConnectOrReuse(host, heapString("pass1"), nil, heapString(""), nil)
	if err != nil {
		t.Fatalf("first ConnectOrReuse: %v", err)
	}
	if r1.Reused {
		t.Fatal("first call should not be reused")
	}

	r2, err := m.ConnectOrReuse(host, heapString("pass1"), nil, heapString(""), nil)
	if err != nil {
		t.Fatalf("second ConnectOrReuse: %v", err)
	}
	if !r2.Reused {
		t.Fatal("second call should be reused")
	}
	if r1.ConnectionID != r2.ConnectionID {
		t.Fatalf("expected same connection ID, got %q and %q", r1.ConnectionID, r2.ConnectionID)
	}
}

func TestConnectOrReuse_InFlightDedup(t *testing.T) {
	ks := newKillableSSHServer(t, "pass2")
	tm := newRecordingTestManager(t)
	m := tm.Manager

	host, _ := hostFromKillable(t, ks)

	// Accept host keys automatically in background.
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case <-done:
				return
			default:
			}
			for _, ev := range tm.Emitter.EventsByTopic("connection:hostkey") {
				hk, ok := ev.Data.(ConnHostKeyEvent)
				if ok {
					m.RespondConnHostKey(hk.ConnectionID, true)
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()

	var wg sync.WaitGroup
	type result struct {
		cr  ConnectResult
		err error
	}
	results := make([]result, 2)

	wg.Add(2)
	for i := range 2 {
		go func(idx int) {
			defer wg.Done()
			cr, err := m.ConnectOrReuse(host, heapString("pass2"), nil, heapString(""), nil)
			results[idx] = result{cr, err}
		}(i)
	}
	wg.Wait()

	for i, r := range results {
		if r.err != nil {
			t.Fatalf("goroutine %d: %v", i, r.err)
		}
	}

	if results[0].cr.ConnectionID != results[1].cr.ConnectionID {
		t.Fatalf("expected same connection ID, got %q and %q",
			results[0].cr.ConnectionID, results[1].cr.ConnectionID)
	}
}
