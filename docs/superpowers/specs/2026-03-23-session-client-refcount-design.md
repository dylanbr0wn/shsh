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

Both maps are initialised in `NewManager()`.

Two helpers:

```go
// retainClient increments ref counts for client (and jumpClient if non-nil).
// Must be called before the session is registered.
func (m *Manager) retainClient(client *goph.Client, jumpClient *ssh.Client) {
    m.mu.Lock()
    m.clientRefs[client]++
    if jumpClient != nil {
        m.jumpRefs[jumpClient]++
    }
    m.mu.Unlock()
}

// releaseClient decrements ref counts and closes resources whose count hits zero.
// Closes are performed outside mu to avoid holding the lock during I/O.
func (m *Manager) releaseClient(client *goph.Client, jumpClient *ssh.Client) {
    m.mu.Lock()
    m.clientRefs[client]--
    clientCount := m.clientRefs[client]
    if clientCount == 0 {
        delete(m.clientRefs, client)
    }
    var jumpCount int
    if jumpClient != nil {
        m.jumpRefs[jumpClient]--
        jumpCount = m.jumpRefs[jumpClient]
        if jumpCount == 0 {
            delete(m.jumpRefs, jumpClient)
        }
    }
    m.mu.Unlock()

    if clientCount == 0 {
        client.Close()
    }
    if jumpClient != nil && jumpCount == 0 {
        jumpClient.Close()
    }
}
```

**`Connect()` changes:**
- Call `m.retainClient(client, jumpSSHClient)` after the client is created, before the session is registered.
- Remove `ownsClient: true` from the `sshSession` struct literal.
- Replace `if sess.ownsClient { client.Close(); jumpClient.Close() }` in the cleanup goroutine with `m.releaseClient(client, sess.jumpClient)`.

**`SplitSession()` changes:**
- Call `m.retainClient(parent.client, parent.jumpClient)` before registering the new session.
- Remove `ownsClient: false` from the struct literal.
- Add `m.releaseClient(sess.client, sess.jumpClient)` in the cleanup goroutine (currently has no client close at all).

### Frontend — Remove sibling propagation

`useAppInit.ts` currently finds sibling leaves and marks them all `disconnected` when any session in a shared-client group disconnects. With ref counting this is no longer needed:

- **User closes parent pane:** only the parent PTY ends; no `disconnected` event fires for siblings (client stays alive); frontend just removes that pane.
- **Remote disconnect:** each session's `stdout.Read` fails independently; each emits its own `session:status disconnected`; the frontend handles them one at a time.

Simplify the `disconnected` handler to update only the single session:

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

Remove the `findSiblingLeaves` call, the `allToDisconnect` loop, and the "Connection lost — all panes on this host disconnected" toast.

Remove the `findSiblingLeaves` import from `useAppInit.ts` if it is no longer used elsewhere.

### Testing

- Keep `TestSplitSession_UnknownSession`.
- Add `TestClientRefCounting`: construct a `Manager`, call `retainClient` twice with the same client pointer, verify `releaseClient` once does not close (count = 1), verify `releaseClient` again closes (count = 0). Use a nil or sentinel `*goph.Client` value as the map key; no real SSH connection needed.

---

## Files

**Modify:**
- `internal/session/session.go` — add `clientRefs`/`jumpRefs` to Manager, add `retainClient`/`releaseClient`, update `Connect()` and `SplitSession()` and their cleanup goroutines, remove `ownsClient` field
- `internal/session/session_test.go` — add `TestClientRefCounting`
- `frontend/src/store/useAppInit.ts` — simplify `disconnected` handler, remove sibling propagation

---

## Invariants

- `clientRefs[c]` is incremented before the session that uses `c` becomes visible (i.e. before `m.sessions[id] = sess`).
- `releaseClient` is called exactly once per session, in the session's cleanup goroutine.
- No close is performed while holding `mu`.
