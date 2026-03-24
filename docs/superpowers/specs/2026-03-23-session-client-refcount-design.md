# Session Client Reference Counting

**Date:** 2026-03-23
**Status:** Approved
**Branch:** feat/split-panes

---

## Problem

When a split pane is created via `SplitSession`, the new session shares the parent's `*goph.Client` (the SSH transport). The original session holds `ownsClient: true` and closes the client when its PTY ends. If the user closes the parent pane first, `client.Close()` fires immediately — killing every child session even though those panes are still open.

---

## Goal

When the user closes the parent pane and child panes are still open, the SSH connection stays alive. The client closes only when the last session using it is cleaned up.

**Out of scope:** remote disconnect recovery (if the SSH server drops the connection, all panes on that transport disconnect naturally and show their overlays independently).

---

## Design

### Go — Replace `ownsClient` with reference counting

Remove `ownsClient bool` from `sshSession`. Add two ref-count maps to `Manager` (protected by the existing `mu`):

```go
clientRefs map[*goph.Client]int
jumpRefs   map[*ssh.Client]int
```

Initialise both in `NewManager()`:

```go
return &Manager{
    // ... existing fields ...
    clientRefs: make(map[*goph.Client]int),
    jumpRefs:   make(map[*ssh.Client]int),
}
```

#### Helpers

Two helpers with different locking contracts:

```go
// incrClientRefs increments ref counts. Caller MUST hold m.mu.
func (m *Manager) incrClientRefs(client *goph.Client, jumpClient *ssh.Client) {
    m.clientRefs[client]++
    if jumpClient != nil {
        m.jumpRefs[jumpClient]++
    }
}

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

The split between `incrClientRefs` (lock-assuming) and `releaseClient` (lock-acquiring) is intentional. It lets callers atomically retain and register a session under a single lock acquisition, closing the TOCTOU window described in the `SplitSession` section below.

#### `Connect()` changes

Call `m.incrClientRefs` inside the same `m.mu.Lock()` block that registers the session:

```go
m.mu.Lock()
m.incrClientRefs(client, jumpSSHClient)
m.sessions[sessionID] = sess
m.mu.Unlock()
// existing onConnected() call and StatusConnected emit go here, unchanged
```

All error-returning code paths in `Connect()` occur before this lock block (during auth and SSH session setup), so there is no error path that could increment `clientRefs` without subsequently launching the cleanup goroutine that calls `releaseClient`.

Remove `ownsClient: true` from the `sshSession` struct literal.

Replace the cleanup goroutine's client-close block:

```go
// before
if sess.ownsClient {
    client.Close()
    if sess.jumpClient != nil {
        sess.jumpClient.Close()
    }
}

// after
m.releaseClient(client, sess.jumpClient)
```

#### `SplitSession()` changes

**TOCTOU fix:** Call `m.incrClientRefs` in the **first** lock block (parent lookup), before releasing the lock. The SSH session setup (`targetClient.NewSession`, `RequestPty`, etc.) then happens after the retain is already in place, so a concurrent `Disconnect` on the parent cannot drive the ref count to zero and close the client underneath those calls:

```go
// Step 1: look up parent and retain the client — single lock acquisition
m.mu.Lock()
parent, ok := m.sessions[existingSessionID]
if !ok {
    m.mu.Unlock()
    return SplitSessionResult{}, fmt.Errorf("session %s not found", existingSessionID)
}
m.incrClientRefs(parent.client, parent.jumpClient)
// capture what we need before releasing the lock
parentClient := parent.client
parentJumpClient := parent.jumpClient
parentHostID := parent.hostID
parentHostLabel := parent.hostLabel
m.mu.Unlock()

// Step 2: SSH session setup — safe because client is now retained
targetClient := parentClient.Client
sshSess, err := targetClient.NewSession()
// ... RequestPty, StdinPipe, StdoutPipe, Shell ...

// Step 3: register the new session
// jumpClient is a new field being added to the split session struct literal
// (it was previously absent). It must be set so that releaseClient in the
// cleanup goroutine correctly releases the jump client reference.
newSess := &sshSession{
    // ...
    client:     parentClient,
    jumpClient: parentJumpClient, // NEW — was absent before; required for releaseClient
    hostID:     parentHostID,
    hostLabel:  parentHostLabel,
    // ownsClient field is removed entirely — omit it
    // ...
}
m.mu.Lock()
m.sessions[newID] = newSess
m.mu.Unlock()
```

In the split cleanup goroutine, add `m.releaseClient(newSess.client, newSess.jumpClient)` and remove the stale comment `// Do NOT close parent.client — parent session owns it.`

#### `Shutdown()`

No change required. `Shutdown()` cancels all session contexts, causing each cleanup goroutine to call `releaseClient`. `m.wg.Wait()` in `Shutdown()` blocks until all goroutines complete, so all ref counts are drained and all clients closed before `Shutdown()` returns.

### Frontend — Remove sibling propagation

`useAppInit.ts` currently finds sibling leaves and marks them all `disconnected` when any session in a shared-client group disconnects. With ref counting this is no longer needed:

- **User closes parent pane:** only the parent PTY ends; no `disconnected` event fires for siblings (client stays alive).
- **Remote disconnect:** when the SSH server closes the connection, all `ssh.Session` objects on that `*ssh.Client` have their stdout pipes closed simultaneously. Each `start()` goroutine exits and emits its own `session:status disconnected`. The frontend handles them one at a time.

Simplify the `disconnected` handler — replace everything from `const allLeaves` through the siblings toast with:

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

Remove: the `const allLeaves` line, the `const siblings` line, the `allToDisconnect` array, the multi-session layout loop, the siblings toast, and the multi-id `setPortForwards` loop.

Remove the `findSiblingLeaves` import from `useAppInit.ts`. Also remove `findSiblingLeaves` from `paneTree.ts` — it has no other callers.

### Testing

Keep `TestSplitSession_UnknownSession`.

Add `TestClientRefCounting`: construct a `Manager`, use a non-nil `*goph.Client` pointer (`new(goph.Client)` — allocates a zero-value struct without calling any constructor) as a map key. Call `incrClientRefs` twice (holding mu). Call `releaseClient` once and verify `clientRefs[c] == 1` (count not yet zero, no close). This exercises the retain/release accounting without triggering the `client.Close()` path.

> Testing the close-on-zero path requires a real or mock SSH client and is covered by integration smoke-testing via `wails dev`.

---

## Files

**Modify:**
- `internal/session/session.go` — add `clientRefs`/`jumpRefs` to Manager + `NewManager`, add `incrClientRefs`/`releaseClient`, update `Connect()` and `SplitSession()` and their cleanup goroutines, copy `jumpClient` into split session struct, remove `ownsClient` field and all stale `ownsClient` comments
- `internal/session/session_test.go` — add `TestClientRefCounting`
- `frontend/src/store/useAppInit.ts` — simplify `disconnected` handler, remove sibling propagation, remove `findSiblingLeaves` import
- `frontend/src/lib/paneTree.ts` — remove `findSiblingLeaves` function (no other callers)

---

## Invariants

- `incrClientRefs(c)` is called while holding `mu`, atomically with (or before) session registration — no window for a concurrent disconnect to drive the count to zero before the new session is visible.
- `releaseClient` is called exactly once per session, in the session's cleanup goroutine, outside `mu`.
- No close is performed while holding `mu`.
- `releaseClient` panics if called for an unregistered client — misuse is a programming error, not a silent leak.
