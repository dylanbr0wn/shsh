# Auto-Reconnect & Timeout Rationalization

**Date:** 2026-03-24
**Branch:** `feat/auto-reconnect`
**Approach:** Connection-level reconnect (Approach 1)

## Overview

Add automatic reconnection for dropped SSH connections with configurable delay, retry limits, and exponential backoff. Add SSH keep-alive for proactive dead-connection detection. Rationalize timeouts across the board so nothing runs unbounded.

## Configuration Model

### Global SSH Config (`SSHConfig` struct in `config.go`)

New fields with defaults:

| Field | Type | Default | Description |
|---|---|---|---|
| `ReconnectEnabled` | `bool` | `true` | Master toggle for auto-reconnect |
| `ReconnectMaxRetries` | `int` | `5` | Max retry attempts before giving up |
| `ReconnectInitialDelaySeconds` | `int` | `2` | Delay before first retry |
| `ReconnectMaxDelaySeconds` | `int` | `30` | Backoff cap |
| `KeepAliveIntervalSeconds` | `int` | `30` | Interval between SSH keep-alive pings |
| `KeepAliveMaxMissed` | `int` | `3` | Missed pings before declaring dead |

`ConnectionTimeoutSeconds` default changes from 30 to 15 (retries compensate).

### Per-Host Overrides

Each saved host gains nullable override fields on the `store.Host` struct (and corresponding `CreateHostInput`/`UpdateHostInput` types, plus the frontend `Host` interface):

```go
ReconnectEnabled             *bool  `json:"reconnectEnabled,omitempty"`
ReconnectMaxRetries          *int   `json:"reconnectMaxRetries,omitempty"`
ReconnectInitialDelaySeconds *int   `json:"reconnectInitialDelaySeconds,omitempty"`
ReconnectMaxDelaySeconds     *int   `json:"reconnectMaxDelaySeconds,omitempty"`
KeepAliveIntervalSeconds     *int   `json:"keepAliveIntervalSeconds,omitempty"`
KeepAliveMaxMissed           *int   `json:"keepAliveMaxMissed,omitempty"`
```

When unset, the global default applies. Resolved at connection time via a merge function: `resolveReconnectConfig(globalSSH, hostOverrides) → effectiveConfig`.

## Keep-Alive & Dead Connection Detection

### Keep-Alive Goroutine

Spawned per `Connection` after successful dial:

1. Sends SSH `keepalive@openssh.com` global request every `KeepAliveIntervalSeconds`
2. Tracks consecutive missed responses
3. After `KeepAliveMaxMissed` consecutive failures, calls `markDead()`
4. Exits when connection context is cancelled

### Detection Sources

All of these trigger `markDead()`:

1. Keep-alive missed threshold exceeded
2. Terminal stdout read returns error (existing path)
3. SFTP operation returns network error
4. `Manager.Write()` (in `session.go`) fails with I/O error

### `markDead()` Contract

- Idempotent — safe to call from multiple goroutines concurrently (guarded by `sync.Once` or equivalent)
- First call cancels the old connection context and initiates the reconnect loop
- Subsequent calls are no-ops

### New `Status` Constants

Add `StatusReconnecting` and `StatusFailed` to the `Status` enum in `session.go` (alongside existing `StatusConnecting`, `StatusConnected`, `StatusDisconnected`, `StatusError`).

## Reconnect Loop

### State Machine

```
connected → dead → reconnecting → connected
                 → reconnecting → failed (max retries exhausted)
```

### Flow

1. `markDead()` sets state to `dead`, emits `connection:status` with `status=reconnecting, attempt=0`
2. Retry loop:
   - Compute delay: `min(initialDelay * 2^attempt, maxDelay)`
   - Sleep for delay (cancellable — if connection is torn down during sleep, abort)
   - Attempt SSH dial with `ConnectionTimeoutSeconds` timeout, same auth and host/jump-host config as original
   - **Success:** replace `client` (and `jumpClient` if applicable), set state to `connected`, break
   - **Failure:** increment attempt, emit `connection:status` with `status=reconnecting, attempt=N`
3. Max retries exhausted: set state to `failed`, emit `connection:status` with `status=failed`

### Credential & Config Caching on `Connection`

The `Connection` struct currently discards host config and auth credentials after dial. For reconnect, the following must be stored on `Connection` at creation time:

```go
host       store.Host    // full host config (for dial params, jump host, etc.)
password   string        // password or key passphrase (resolved from credstore at first connect)
jumpHost   *store.Host   // nil for direct connections
jumpPass   string        // jump host password if applicable
reconnCfg ReconnectConfig // resolved effective config (global merged with per-host overrides)
```

These are set once during `ConnectOrReuse()` and reused by the reconnect loop.

### Post-Reconnect Restore

After successful reconnect, in order:

1. Restart keep-alive goroutine on new client
2. Re-open terminal channels via `TerminalChannel.reopen(newClient)` — creates a new `ssh.Session`, PTY, shell, stdin pipe, stdout reader goroutine, and a fresh channel context. The old channel context (cancelled by the reader goroutine on disconnect) is replaced. The channel ID stays the same so the frontend maps it correctly. Emit `channel:status` with `status=connected`.
3. Re-open SFTP channels: new SFTP subsystem session for each active `SFTPChannel`
4. Restore port forwards: close old TCP listeners first, then re-establish each tunnel from `portForwards` map independently; failures are warnings, not blockers

### `TerminalChannel.reopen()` Details

The `TerminalChannel` struct holds `sshSess`, `stdin`, and a `wg` for the reader goroutine. These cannot be atomically swapped in place. The `reopen()` method:

1. Waits for the old reader goroutine to finish (it will have exited on read error)
2. Creates a new `ssh.Session` from the reconnected client
3. Requests PTY, starts shell, obtains new stdin pipe
4. Creates a new cancellable context (replacing the old cancelled one)
5. Spawns a new stdout reader goroutine tracked by `wg`
6. Swaps `sshSess` and `stdin` under a channel-level mutex (`TerminalChannel.mu`). This is separate from `Connection.mu` — the connection lock guards the SSH client, the channel lock guards the session/pipes. `Manager.Write()` and `Manager.Resize()` (which access `tc.stdin` and `tc.sshSess`) must acquire `TerminalChannel.mu` to avoid races during reopen.

### Locking & Port Forward Safety

- `Connection.mu` is held when swapping the client reference, not during dial
- `Connection.SSHClient()` must acquire `Connection.mu` (read lock) to be safe for concurrent callers (port forward goroutines call this on each accepted TCP connection)
- Port forward TCP listeners are closed before client swap and re-opened after, preventing races where an accepted connection tries to dial on a dead client
- Consider upgrading `Connection.mu` to `sync.RWMutex` — reconnect takes a write lock for the swap, `SSHClient()` takes a read lock

## Frontend Changes

### Status Types

```typescript
type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'error'
```

### Event Payload Changes

`connection:status` needs a typed Go struct (analogous to the existing `ChannelStatusEvent` used by `channel:status`) to carry the new fields:

```go
type ConnectionStatusEvent struct {
    ConnectionID string `json:"connectionId"`
    Status       string `json:"status"`
    Attempt      int    `json:"attempt,omitempty"`
    MaxRetries   int    `json:"maxRetries,omitempty"`
    Error        string `json:"error,omitempty"`
}
```

Both `connection:status` and `channel:status` events gain the optional `attempt`, `maxRetries`, and `error` fields. The current raw `map[string]any` emission for `connection:status` (in `teardownConnection`) is replaced with this typed struct.

### Terminal Reconnect Banner

- On `reconnecting`: overlay banner at bottom of xterm viewport — `"Connection lost. Reconnecting (attempt 1/5)..."`
- Updates on each attempt
- On `connected`: brief `"Reconnected"` confirmation, fades after 2s
- On `failed`: persistent banner with `"Reconnection failed after 5 attempts"` and a `[Retry]` button
- Terminal input disabled while reconnecting

### Tab Status Indicator

- `reconnecting`: amber/yellow pulsing dot
- `failed`: same as `disconnected` with retry option in tab context menu

### No New Modals

All reconnect feedback is non-intrusive — in-terminal banner and tab dot color changes.

## Timeout Summary

| Timeout | Default | Configurable | Scope |
|---|---|---|---|
| Dial timeout (per attempt) | 15s | Global + per-host | Initial connect & reconnect |
| Reconnect max retries | 5 | Global + per-host | Reconnect only |
| Reconnect initial delay | 2s | Global + per-host | Reconnect only |
| Reconnect max delay (backoff cap) | 30s | Global + per-host | Reconnect only |
| Keep-alive interval | 30s | Global + per-host | Active connections |
| Keep-alive max missed | 3 | Global + per-host | Dead detection |
| Host key verification | 120s | Global | User prompt |
| TCP ping (sidebar health) | 5s | Global | UI indicator |

**Worst-case reconnect budget:** ~3.75 minutes (5 attempts × up to 30s delay + 15s timeout).

**Keep-alive detection time:** up to 90s (30s × 3 missed) for silently dead connections. Active I/O errors are detected immediately.

## Edge Cases

### Auth Credential Caching

- Password/key passphrase cached in memory on `Connection` after first successful auth
- Reconnect reuses cached credentials — no re-prompting
- Auth failures during reconnect count toward retry budget; if all retries fail with auth errors, the error message is surfaced in the `failed` banner

### Jump Host Reconnection

- If jump host dies, target connection detects via I/O errors or keep-alive
- Reconnect attempts the full chain: dial jump host first, then tunnel to target
- Jump host and target share one retry budget (5 total attempts at the full chain, not 5 × 2)

### Race Conditions

- `markDead()` idempotent — multiple callers safe, only first triggers reconnect
- User closes tab during reconnect: channel removed from tracking, post-reconnect restore skips it. If all channels closed, reconnect aborts and connection tears down
- User manually connects to same host during reconnect: `ConnectOrReuse()` must detect the `reconnecting` state on the existing `Connection` in `connByIdent` and block until reconnect completes (or fails), then return the reconnected connection or an error. It must NOT return the dead connection as "reused". Implementation: add a `state` field (`connected | reconnecting | failed`) and a `reconnectDone chan struct{}` on `Connection`. `ConnectOrReuse` checks `state`; if `reconnecting`, it waits on `reconnectDone` (with a select on context cancellation). When the reconnect loop finishes (success or failure), it closes `reconnectDone`.
- Terminal stdout reader calls `tc.cancel()` on read error: the reconnect flow creates a new context for the channel via `reopen()`, so the old cancelled context does not prevent re-use

### Host Key Verification During Reconnect

If the server's host key changes between disconnect and reconnect (e.g., server rebuilt), the existing `connHostKeyCallback` would block for up to 120s waiting for user interaction. During reconnect:

- If the host key matches `known_hosts`: proceed silently (common case)
- If the host key has changed: treat it as a reconnect failure for that attempt (do not prompt the user mid-reconnect). Surface the host key mismatch in the `failed` banner error message so the user can investigate.
- If the host is not in `known_hosts` (new host during reconnect — shouldn't happen, but defensive): also treat as failure for that attempt.

### SFTP Transfers

- Active transfers fail immediately on disconnect (no mid-transfer resume over SSH)
- After reconnect, SFTP channel is restored but interrupted transfers must be manually restarted
- Frontend surfaces interrupted transfer as toast notification

### Port Forward Restore

- Each port forward restored independently after reconnect
- Individual failures reported as warnings, don't block other restores
- Failed port forwards shown as errored entries in the UI

## Files to Modify

### Go Backend
- `internal/config/config.go` — new config fields and defaults
- `internal/session/connection.go` — keep-alive goroutine, `markDead()`, reconnect loop, client swap, post-reconnect restore
- `internal/session/channel.go` — terminal/SFTP channel re-open methods, feed I/O errors into `markDead()`
- `internal/session/session.go` — `resolveReconnectConfig()` merge function, credential caching on auth
- `app.go` — expose reconnect config in host model, manual retry endpoint

### Frontend
- `frontend/src/types/index.ts` — new status values (`reconnecting`, `failed`), event payload types
- `frontend/src/store/useAppInit.ts` — add `reconnecting` and `failed` branches to `connection:status` handler (currently only handles `disconnected`); update leaves via `updateLeafByChannelId`
- `frontend/src/store/workspaces.ts` — `PaneLeaf` types already use `SessionStatus` and will gain new values automatically
- `frontend/src/hooks/useTerminal.ts` — reconnect banner overlay, input disable during reconnect
- `frontend/src/components/sessions/TabItem.tsx` — amber pulsing dot for reconnecting, retry context menu
- Host settings UI — per-host reconnect/keep-alive overrides (if settings UI exists)
- `frontend/src/store/atoms.ts` — no changes needed (workspace atoms already handle arbitrary `SessionStatus`)
