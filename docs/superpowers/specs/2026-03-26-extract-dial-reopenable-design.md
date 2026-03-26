# Extract Dial Function and Add Reopenable Interface

**Issue:** #47
**Date:** 2026-03-26

## Problem

The `session` package has two structural problems:

1. **Duplicated dial logic.** `ConnectOrReuse` (`connection.go:190-265`) and `attemptReconnect` (`reconnect.go:283-348`) contain ~120 lines of near-identical SSH dial code. The only difference is which `ssh.HostKeyCallback` is passed.

2. **Hard-coded type switch.** `onReconnected` (`reconnect.go:408-449`) switches over `*TerminalChannel` / `*SFTPChannel` to reopen channels after reconnect. Adding a new channel type requires modifying the reconnect path.

Both paths have 0% test coverage.

## Design

### Part 1: Extract `Dial` function

Create `internal/session/dial.go` with a stateless, package-level function:

```go
type DialRequest struct {
    Host            store.Host
    Password        string
    JumpHost        *store.Host
    JumpPassword    string
    Timeout         time.Duration
    HostKeyCallback ssh.HostKeyCallback
}

type DialResult struct {
    Client     *goph.Client
    JumpClient *ssh.Client // nil for direct connections
}

func Dial(req DialRequest) (DialResult, error)
```

**Behavior:**

- If `JumpHost != nil`: TCP dial to jump host, establish SSH, dial target through tunnel, wrap in `goph.Client`
- If `JumpHost == nil`: direct dial via `goph.NewConn`
- Calls `ResolveAuth` for each hop
- Cleans up intermediate resources (TCP conn, jump client, tunnel conn) on any failure

**What `Dial` does NOT do:**

- No dedup/gate logic (stays in `ConnectOrReuse`)
- No `clearString` — caller owns secret lifecycle
- No Connection struct creation or manager map updates
- No host key callback creation — caller passes it in

**Callers after extraction:**

`ConnectOrReuse` (~10 lines):
```go
result, err := Dial(DialRequest{
    Host:            host,
    Password:        password,
    JumpHost:        jumpHost,
    JumpPassword:    jumpPassword,
    Timeout:         timeout,
    HostKeyCallback: m.connHostKeyCallback(connectionID),
})
if err != nil {
    cleanup()
    return ConnectResult{}, err
}
client = result.Client
jumpSSHClient = result.JumpClient
```

`attemptReconnect` (~10 lines):
```go
result, err := Dial(DialRequest{
    Host:            conn.host,
    Password:        conn.password,
    JumpHost:        conn.jumpHost,
    JumpPassword:    conn.jumpPass,
    Timeout:         timeout,
    HostKeyCallback: m.reconnectHostKeyCallback(),
})
if err != nil {
    return err
}
client = result.Client
jumpSSHClient = result.JumpClient
```

### Part 2: `Reopenable` interface

Add to `internal/session/channel.go`:

```go
type Reopenable interface {
    Channel
    Reopen(client *ssh.Client, cfg ReopenConfig) (postHook func(), err error)
}

type ReopenConfig struct {
    TerminalType string
    MarkDead     func()
    Emitter      EventEmitter
}
```

**TerminalChannel.Reopen** (renamed from lowercase `reopen`, new signature):

1. `tc.wg.Wait()` — ensure old reader goroutine is done
2. Create SSH session, request PTY, get stdin/stdout pipes, start shell
3. Set `tc.markDeadFn = cfg.MarkDead` (caller constructs `MarkDead` closure after reading `conn.generation`, preserving the generation counter protocol)
4. Swap internal state under `tc.mu`
5. Return postHook closure: `func() { tc.startReader(stdout, cfg.Emitter) }`

**SFTPChannel.Reopen** (renamed from lowercase `reopen`, new signature):

1. Create new SFTP client from `*ssh.Client`
2. Swap `sc.client` under lock
3. Return `nil` postHook

**LocalFSChannel** does NOT implement `Reopenable`. Skipped naturally by the type assertion.

**`onReconnected` after refactoring:**

```go
for _, ch := range channels {
    r, ok := ch.(Reopenable)
    if !ok {
        continue
    }
    hook, err := r.Reopen(sshClient, ReopenConfig{
        TerminalType: m.cfg.SSH.TerminalType,
        MarkDead:     func() { m.markDead(conn, gen) },
        Emitter:      m.emitter,
    })
    if err != nil {
        log.Error().Err(err).Str("channelId", ch.ID()).Msg("failed to reopen channel")
        m.emitter.Emit("channel:status", ChannelStatusEvent{
            ChannelID:    ch.ID(),
            ConnectionID: conn.id,
            Kind:         ch.Kind(),
            Status:       StatusFailed,
            Error:        err.Error(),
        })
        continue
    }
    if hook != nil {
        hook()
    }
    m.emitter.Emit("channel:status", ChannelStatusEvent{
        ChannelID:    ch.ID(),
        ConnectionID: conn.id,
        Kind:         ch.Kind(),
        Status:       StatusConnected,
    })
}
```

### Part 3: Testing

**File:** `internal/session/dial_test.go`

Table-driven tests using in-process SSH servers (`ssh.NewServerConn` on localhost listeners).

| Test | Setup | Assertion |
|---|---|---|
| Direct connect success | Local SSH server on random port | `Client` non-nil, `JumpClient` nil |
| Direct connect auth failure | Server rejects all auth | Error contains auth/handshake message |
| Jump-host connect success | Two local servers, first proxies to second | Both `Client` and `JumpClient` non-nil |
| Jump-host TCP failure | No server on jump-host address | Error contains "dial jump host" |
| Jump-host SSH failure | TCP listener that doesn't speak SSH | Error contains "ssh to jump host" |
| Target-via-jump failure | Jump server up, target unreachable | Error contains "dial target through jump" |

## Files

**New:**
- `internal/session/dial.go` — `DialRequest`, `DialResult`, `Dial`
- `internal/session/dial_test.go` — table-driven tests

**Modified:**
- `internal/session/channel.go` — add `Reopenable` interface, `ReopenConfig` struct; rename `reopen` to `Reopen` on `TerminalChannel` and `SFTPChannel` with updated signatures
- `internal/session/connection.go` — replace ~75-line dial block in `ConnectOrReuse` with `Dial()` call
- `internal/session/reconnect.go` — replace ~70-line dial block in `attemptReconnect` with `Dial()` call; replace type switch in `onReconnected` with `Reopenable` dispatch loop

## Preserved Invariants

- `clearString` lifecycle — callers still defer-zero passwords
- Dedup gate in `ConnectOrReuse` — untouched
- Generation counter protocol — gen read after `conn.generation++`, before `MarkDead` closure construction
- Port forward restore logic in `onReconnected` — untouched
- `startKeepAlive` placement — still called after channels are restored
- No frontend impact — no changes to App struct or exposed methods
