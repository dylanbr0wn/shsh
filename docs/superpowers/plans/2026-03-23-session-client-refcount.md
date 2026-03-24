# Session Client Reference Counting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ownsClient bool` ownership model with reference counting so closing the parent split pane does not kill sibling panes that share the same SSH transport.

**Architecture:** Two ref-count maps (`clientRefs`, `jumpRefs`) are added to `Manager` and kept consistent by `incrClientRefs` (lock-assuming, called at session registration) and `releaseClient` (lock-acquiring, called in cleanup goroutines). The frontend's sibling-propagation logic in `useAppInit.ts` is removed; each session now independently emits its own `disconnected` event.

**Tech Stack:** Go, Wails v2, React/TypeScript, Jotai

---

## File Map

**Modify:**
- `internal/session/session.go` — add maps + helpers, update `Connect()` and `SplitSession()` and their cleanup goroutines, remove `ownsClient`
- `internal/session/session_test.go` — add `TestClientRefCounting`
- `frontend/src/store/useAppInit.ts` — simplify `disconnected` handler
- `frontend/src/lib/paneTree.ts` — remove `findSiblingLeaves`

---

## Task 1: Go — Replace `ownsClient` with reference counting

**Files:**
- Modify: `internal/session/session.go`
- Modify: `internal/session/session_test.go`

Read `internal/session/session.go` in full before starting. Key landmarks:
- `sshSession` struct: lines 88–107 (`ownsClient bool` is line 106)
- `Manager` struct: lines 145–152
- `NewManager`: lines 155–162
- `Connect()` registration block: lines 355–357; cleanup block: lines 383–388
- `SplitSession()` parent lookup: lines 437–439; struct literal: lines 475–488; cleanup goroutine: lines 500–521

- [ ] **Step 1: Add `clientRefs` and `jumpRefs` to `Manager` struct**

In `Manager` (lines 145–152), add two fields after `mu`:

```go
type Manager struct {
	ctx         context.Context
	cfg         *config.Config
	sessions    map[string]*sshSession
	pendingKeys map[string]chan bool
	mu          sync.Mutex
	wg          sync.WaitGroup
	clientRefs  map[*goph.Client]int
	jumpRefs    map[*ssh.Client]int
}
```

- [ ] **Step 2: Initialise both maps in `NewManager`**

```go
func NewManager(ctx context.Context, cfg *config.Config) *Manager {
	return &Manager{
		ctx:         ctx,
		cfg:         cfg,
		sessions:    make(map[string]*sshSession),
		pendingKeys: make(map[string]chan bool),
		clientRefs:  make(map[*goph.Client]int),
		jumpRefs:    make(map[*ssh.Client]int),
	}
}
```

- [ ] **Step 3: Add `incrClientRefs` helper**

Insert after `NewManager`:

```go
// incrClientRefs increments ref counts for client and jumpClient (if non-nil).
// Caller MUST hold m.mu.
func (m *Manager) incrClientRefs(client *goph.Client, jumpClient *ssh.Client) {
	m.clientRefs[client]++
	if jumpClient != nil {
		m.jumpRefs[jumpClient]++
	}
}
```

- [ ] **Step 4: Add `releaseClient` helper**

Insert immediately after `incrClientRefs`:

```go
// releaseClient decrements ref counts and closes resources whose count hits zero.
// Caller must NOT hold m.mu. Closes are performed outside mu.
// Panics if called for a client that was never retained (programming error).
func (m *Manager) releaseClient(client *goph.Client, jumpClient *ssh.Client) {
	m.mu.Lock()
	count, ok := m.clientRefs[client]
	if !ok {
		m.mu.Unlock()
		panic(fmt.Sprintf("releaseClient: client %p was never retained", client))
	}
	count--
	if count == 0 {
		delete(m.clientRefs, client)
	} else {
		m.clientRefs[client] = count
	}
	var jumpCount int
	if jumpClient != nil {
		jCount, jOk := m.jumpRefs[jumpClient]
		if !jOk {
			m.mu.Unlock()
			panic(fmt.Sprintf("releaseClient: jumpClient %p was never retained", jumpClient))
		}
		jumpCount = jCount - 1
		if jumpCount == 0 {
			delete(m.jumpRefs, jumpClient)
		} else {
			m.jumpRefs[jumpClient] = jumpCount
		}
	}
	m.mu.Unlock()

	if count == 0 {
		client.Close()
	}
	if jumpClient != nil && jumpCount == 0 {
		jumpClient.Close()
	}
}
```

- [ ] **Step 5: Remove `ownsClient` from `sshSession` struct**

Delete line 106:
```go
ownsClient bool // true = this session owns the SSH client and must close it on disconnect
```

- [ ] **Step 6: Update `Connect()` — remove `ownsClient: true` from struct literal**

In the `sshSession` struct literal (~line 341), remove the `ownsClient: true` line. The literal should no longer mention `ownsClient`.

- [ ] **Step 7: Update `Connect()` — call `incrClientRefs` in the registration lock block**

The current registration block (lines 355–357) is:

```go
m.mu.Lock()
m.sessions[sessionID] = sess
m.mu.Unlock()
```

Replace with:

```go
m.mu.Lock()
m.incrClientRefs(client, jumpSSHClient)
m.sessions[sessionID] = sess
m.mu.Unlock()
```

The `onConnected()` call and `StatusConnected` emit that follow remain unchanged.

- [ ] **Step 8: Update `Connect()` cleanup goroutine — replace `ownsClient` block with `releaseClient`**

The current cleanup block (after `sshSess.Close()`, around lines 383–388) is:

```go
if sess.ownsClient {
    client.Close()
    if sess.jumpClient != nil {
        sess.jumpClient.Close()
    }
}
```

Replace with:

```go
m.releaseClient(client, sess.jumpClient)
```

- [ ] **Step 9: Update `SplitSession()` — atomically look up parent, retain, and capture fields**

The current parent lookup (lines 437–439) is:

```go
m.mu.Lock()
parent, ok := m.sessions[existingSessionID]
m.mu.Unlock()
if !ok {
    return SplitSessionResult{}, fmt.Errorf("session %s not found", existingSessionID)
}
```

Replace with:

```go
m.mu.Lock()
parent, ok := m.sessions[existingSessionID]
if !ok {
    m.mu.Unlock()
    return SplitSessionResult{}, fmt.Errorf("session %s not found", existingSessionID)
}
m.incrClientRefs(parent.client, parent.jumpClient)
parentClient := parent.client
parentJumpClient := parent.jumpClient
parentHostID := parent.hostID
parentHostLabel := parent.hostLabel
m.mu.Unlock()
```

Then update the rest of `SplitSession` to use the captured locals (`parentClient`, `parentJumpClient`, `parentHostID`, `parentHostLabel`) instead of `parent.*` fields — since the lock has been released before the SSH setup.

Specifically, change:
- `targetClient := parent.client.Client` → `targetClient := parentClient.Client`

The second registration block (lines 490–492) that registers `newSess` into `m.sessions[newID]` remains unchanged — only the first lock block (parent lookup) is modified by this step.

- [ ] **Step 10: Update `SplitSession()` struct literal — add `jumpClient`, remove `ownsClient`**

The current struct literal (lines 475–488) lacks `jumpClient` and has `ownsClient: false`. Replace:

```go
newSess := &sshSession{
    id:           newID,
    hostID:       parent.hostID,
    hostLabel:    parent.hostLabel,
    client:       parent.client,
    sshSess:      sshSess,
    stdin:        stdin,
    ctx:          sessCtx,
    cancel:       cancel,
    portForwards: make(map[string]*portForward),
    ownsClient:   false, // parent owns the client
}
```

With:

```go
newSess := &sshSession{
    id:           newID,
    hostID:       parentHostID,
    hostLabel:    parentHostLabel,
    client:       parentClient,
    jumpClient:   parentJumpClient, // required: shared transport; released by releaseClient
    sshSess:      sshSess,
    stdin:        stdin,
    ctx:          sessCtx,
    cancel:       cancel,
    portForwards: make(map[string]*portForward),
}
```

- [ ] **Step 11: Update `SplitSession()` cleanup goroutine — add `releaseClient`, remove stale comment**

In the cleanup goroutine (lines ~508–520), after `sshSess.Close()`, replace:

```go
// Do NOT close parent.client — parent session owns it.
```

With:

```go
m.releaseClient(newSess.client, newSess.jumpClient)
```

- [ ] **Step 12: Write the failing test**

In `internal/session/session_test.go`, add after `TestSplitSession_UnknownSession`:

```go
func TestClientRefCounting(t *testing.T) {
    cfg := config.Default()
    m := session.NewManager(context.Background(), cfg)

    // Use a non-nil sentinel pointer. new(goph.Client) allocates a zero-value
    // struct — no constructor called, no connection made.
    c := new(goph.Client)

    m.Mu().Lock()
    m.IncrClientRefs(c, nil)
    m.IncrClientRefs(c, nil)
    m.Mu().Unlock()

    // After one release, count should be 1 — client must NOT be closed.
    m.ReleaseClient(c, nil)
    if got := m.ClientRefCount(c); got != 1 {
        t.Fatalf("expected ref count 1 after one release, got %d", got)
    }
}
```

> **Note:** This test requires exporting three test helpers on `Manager`. See Step 13.

- [ ] **Step 13: Expose test helpers via a `_test.go` export file**

Create `internal/session/export_test.go` (Go test-only export file — compiled only during `go test`):

```go
package session

import (
	"sync"

	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
)

// Test-only exports for white-box testing of ref count internals.

func (m *Manager) Mu() *sync.Mutex                               { return &m.mu }
func (m *Manager) IncrClientRefs(c *goph.Client, j *ssh.Client) { m.incrClientRefs(c, j) }
func (m *Manager) ReleaseClient(c *goph.Client, j *ssh.Client)  { m.releaseClient(c, j) }
func (m *Manager) ClientRefCount(c *goph.Client) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.clientRefs[c]
}
```

- [ ] **Step 14: Run the test to verify it compiles and passes**

```bash
go test ./internal/session/... -run TestClientRefCounting -v
```

Expected: `PASS`

- [ ] **Step 15: Run the full test suite**

```bash
go test ./...
```

Expected: all PASS

- [ ] **Step 16: Commit**

```bash
git add internal/session/session.go internal/session/session_test.go internal/session/export_test.go
git commit -m "feat(session): replace ownsClient with client reference counting

Closing the parent split pane no longer kills sibling panes. The SSH
client is now closed only when the last session using it is cleaned up.
incrClientRefs is called atomically with session registration (under mu)
to close the TOCTOU window where a concurrent Disconnect could close the
client before the new session was retained."
```

---

## Task 2: Frontend — Remove sibling disconnect propagation

**Files:**
- Modify: `frontend/src/store/useAppInit.ts`
- Modify: `frontend/src/lib/paneTree.ts`

Read both files in full before starting. In `useAppInit.ts`, the `disconnected` handler is inside the `session:status` `useEffect` — locate the `if (status === 'disconnected')` block (~lines 129–156). In `paneTree.ts`, `findSiblingLeaves` is near the bottom of the file.

- [ ] **Step 1: Simplify the `disconnected` handler in `useAppInit.ts`**

Replace the entire `if (status === 'disconnected') { ... }` block with:

```typescript
if (status === 'disconnected') {
  setWorkspaces((prev) =>
    prev.map((w) => ({
      ...w,
      layout: updateLeafBySessionId(w.layout, sessionId, { status: 'disconnected' }),
    }))
  )
  setPortForwards((prev) => {
    const next = { ...prev }
    delete next[sessionId]
    return next
  })
}
```

This removes: `const allLeaves`, `const siblings`, `const allToDisconnect`, the multi-session layout loop, the siblings toast, and the multi-id `setPortForwards` loop.

- [ ] **Step 2: Remove `findSiblingLeaves` import from `useAppInit.ts`**

Find the import line (near the top of the file):

```typescript
import { updateLeafBySessionId, collectLeaves, findSiblingLeaves } from '../lib/paneTree'
```

Remove `findSiblingLeaves` from this import. If `collectLeaves` is also no longer used after the handler change, remove it too — check the full file for other usages first.

- [ ] **Step 3: Remove `findSiblingLeaves` from `paneTree.ts`**

Delete the entire `findSiblingLeaves` function from `frontend/src/lib/paneTree.ts`. It has no callers outside `useAppInit.ts` (confirm with a grep before deleting):

```bash
grep -r "findSiblingLeaves" frontend/src/
```

Expected: zero matches after removal (the function and its import are both gone).

- [ ] **Step 4: Build and lint**

```bash
cd frontend && pnpm build
```

Expected: no TypeScript errors.

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Format check**

```bash
pnpm format:check
```

If it fails, run `pnpm format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/useAppInit.ts frontend/src/lib/paneTree.ts
git commit -m "refactor(ui): remove sibling disconnect propagation

With client ref counting in the backend, closing the parent pane no
longer kills siblings — no disconnected event fires for them. Remote
disconnects cause each session to independently emit its own event.
The frontend now handles each disconnected event individually."
```

---

## Final verification

After both tasks are committed:

```bash
go test ./...
cd frontend && pnpm build && pnpm lint && pnpm format:check
```

All must pass.
