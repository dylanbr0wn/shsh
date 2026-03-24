# Connection Layer and Pane Types

## Problem

The current architecture conflates SSH transport, terminal sessions, and auxiliary tools (SFTP, port forwarding) into a single `sshSession` struct on the backend and a terminal-only `LeafNode` on the frontend. This creates friction as we move toward a workspace model with split panes:

- SFTP and port forwards are keyed by `sessionId`, tying them to a specific terminal pane
- SFTP panels follow the focused pane, which feels fragile in multi-pane workspaces
- There is no way to open an SFTP browser without first opening a terminal
- Cross-host file transfer (drag between two SFTP views) is not possible
- Port forwards are presented as a panel that competes for space with SFTP, despite being set-and-forget configuration

## Design

### Core concept: Connection + Channel

Split the monolithic `sshSession` into two layers:

**Connection** — the SSH transport. Owns the `*goph.Client`, optional `*ssh.Client` (jump host), and reference counting. Keyed by `connectionId`. Created once per `Connect()` call. Multiple channels share a single connection. When the last channel on a connection closes, the connection tears down.

**Channel** — a subsystem opened on a connection. Three variants:

- **TerminalChannel** — owns an `*ssh.Session` with PTY, stdin pipe, stdout reader goroutine. Equivalent to what `sshSession` does today minus client ownership.
- **SFTPChannel** — owns an `*sftp.Client`. Equivalent to today's `OpenSFTP` flow, but as a standalone entity with its own ID.
- **PortForwardChannel** — owns a `net.Listener` and relay goroutines. Equivalent to today's `AddPortForward`.

### Backend: Manager restructure

The `Manager` struct changes from:

```go
sessions map[string]*sshSession  // sessionId → sshSession
```

To:

```go
connections map[string]*Connection  // connectionId → Connection
channels    map[string]Channel      // channelId → Channel
```

**Connection struct:**

```go
type Connection struct {
    id         string
    hostID     string
    hostLabel  string
    client     *goph.Client
    jumpClient *ssh.Client
    ctx        context.Context
    cancel     context.CancelFunc
    channelRefs int  // number of open channels; connection closes when this hits 0
}
```

**Channel interface:**

```go
type Channel interface {
    ID() string
    ConnectionID() string
    Close() error
}
```

With concrete types `TerminalChannel`, `SFTPChannel`, `PortForwardChannel` implementing it.

**Key methods on Manager:**

- `Connect(host, password, jumpHost, jumpPassword) → connectionId` — dials SSH, creates a Connection. If a Connection to the same host already exists, reuses it (increments ref count).
- `OpenTerminal(connectionId) → channelId` — opens a new PTY shell on the connection.
- `OpenSFTP(connectionId) → channelId` — opens an SFTP subsystem on the connection.
- `AddPortForward(connectionId, localPort, remoteHost, remotePort) → channelId` — starts a port forward on the connection.
- `CloseChannel(channelId)` — closes the channel, decrements connection ref count.
- `TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath)` — streams a file from one SFTP channel to another through the app process. Enables cross-host drag-and-drop.

**Connection identity, reuse, and in-flight dedup:** A connection is uniquely identified by `hostID + jumpHostID` (where `jumpHostID` is empty for direct connections). When the frontend requests a connection and one with matching identity already exists, the manager returns the existing `connectionId` rather than dialing again. Two hosts with different usernames pointing at the same hostname are different `hostID`s in the store, so they get separate connections. A direct connection and a jump-host connection to the same target are also separate (different `jumpHostID`). This matches today's `SplitSession` behavior (which reuses `*goph.Client` with ref counting) but generalized to any channel type. To prevent duplicate dials and duplicate host-key prompts, the manager tracks in-flight connection attempts in a `pending` map keyed by the same identity. If `Connect()` is called while a dial for the same identity is already in progress, the second caller waits for the first to complete (or fail) and then either reuses the resulting connection or returns the error. This is a `sync.Cond` or channel-based gate — not a second dial.

**Port forward ref counting:** Port forward channels are **not** counted in `channelRefs`. Only interactive channels (terminal, SFTP) keep a connection alive. When the last interactive channel closes, the connection tears down and all port forwards on it are stopped. Port forwards are configuration that piggybacks on a connection, not a reason to keep one open. If a user wants port forwards without an interactive pane, they must keep at least one terminal or SFTP pane open.

### Backend: Event protocol

The current event topics keyed by `sessionId` are replaced with a connection/channel scheme:

| Current event | New event | Scope | Payload change |
|---|---|---|---|
| `session:status` | `channel:status` | Per channel | `sessionId` → `channelId` + `connectionId` + `kind` (`"terminal"` / `"sftp"`) |
| `session:output:<sessionId>` | `channel:output:<channelId>` | Per terminal channel | Same payload (string chunk) |
| `sftp:progress:<sessionId>` | `channel:sftp-progress:<channelId>` | Per SFTP channel | Same payload |
| `session:hostkey` | `connection:hostkey` | Per connection | `sessionId` → `connectionId` |
| *(new)* | `connection:status` | Per connection | `{ connectionId, status: "connected" \| "disconnected" \| "error", error? }` |

**Connection death propagation:** When a connection dies (network drop, server shutdown), the backend emits `connection:status` with `status: "disconnected"`, then emits `channel:status` with `status: "disconnected"` for every channel on that connection. The frontend updates all leaves referencing that `connectionId`.

**Host key verification** is a connection-level concern. The `connection:hostkey` event carries `connectionId`. The frontend shows the host-key dialog once per connection, not per channel. `RespondHostKey` takes `connectionId` instead of `sessionId`.

### Backend: Cross-host transfer

`TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath)` streams a file between two SFTP channels through the app process:

- Opens a reader on the source SFTP client, a writer on the destination SFTP client, and copies with a buffer.
- Progress is emitted on **both** channels' progress topics (`channel:sftp-progress:<srcChannelId>` and `channel:sftp-progress:<dstChannelId>`).
- File-only for now — directory transfers are out of scope (the user can tar/download/upload as a workaround).
- On destination write failure, the partial remote file is deleted (best-effort cleanup).
- Cancellation: the method accepts a context (tied to either channel's connection context), so closing either pane cancels the transfer.

### Frontend: Typed pane leaves

The `LeafNode` type gains a `kind` discriminator and replaces `sessionId` with `connectionId` + `channelId`:

```typescript
type TerminalLeaf = {
  type: 'leaf'
  kind: 'terminal'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
}

type SFTPLeaf = {
  type: 'leaf'
  kind: 'sftp'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus  // same type as terminal: connecting | connected | disconnected | error
}

type PaneLeaf = TerminalLeaf | SFTPLeaf
type SplitNode = {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  ratio: number
  left: PaneNode
  right: PaneNode
}
type PaneNode = PaneLeaf | SplitNode
```

**What stays structurally unchanged:** `SplitNode`, `splitLeaf()`, `removeLeaf()`, `firstLeaf()`, `collectLeaves()` — all operate on `PaneNode` and are kind-agnostic. Their signatures update to use the new types (`PaneLeaf` instead of `LeafNode`), and `updateLeafBySessionId` is renamed to `updateLeafByChannelId` (searching by `channelId` instead of `sessionId`), but the tree-walking logic is identical.

**PaneTree rendering:** Checks `leaf.kind` to render either `TerminalPane` or `SFTPPanel`.

**PaneHeader:** Shows host label and an icon indicating terminal vs file browser. Split actions from a terminal pane offer "Split Terminal" (new terminal channel) or "Open Files" (new SFTP channel). Both use `splitLeaf()` to insert a new leaf.

### Frontend: SFTP as a first-class pane

The existing `SFTPPanel` component moves from being a side panel in `WorkspaceView` to being rendered inline in the pane tree. Its props change from `{ sessionId: string }` to `{ channelId: string; connectionId: string }`.

**Cross-pane drag-and-drop:** Two SFTP leaves in the same workspace are both visible. The existing `application/x-shsh-sftp` drag data type is extended to include the source `channelId`. When a drop lands on a different SFTP pane, the frontend calls `TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath)` on the backend, which streams the file between the two SFTP channels.

**Standalone SFTP from sidebar:** Right-clicking a host in the sidebar shows a context menu:
- **Connect** (default / double-click) — creates a workspace with a terminal leaf
- **Open Files** — creates a workspace with a single SFTP leaf (no terminal)

Both trigger: connect to host (or reuse existing connection) → open channel → create workspace with leaf.

**Workspace labels:** Terminal-only workspace: "prod-server". SFTP-only workspace: "prod-server (Files)". Mixed workspaces after splitting: just the host label.

**Tab bar:** Tab items gain a subtle icon (terminal or folder) to distinguish workspace types.

### Frontend: Port forwards as connection-scoped config

Port forwards are **not panes**. They are connection-level configuration managed through a popover.

**State:** `portForwardsAtom` changes from `Record<sessionId, PortForwardPanelState>` to `Record<connectionId, PortForwardPanelState>`.

**UI:** The `PortForwardsPanel` side panel and its `TerminalSidebar` toggle are removed. Port forwards are managed via:
- A **popover** accessible from a network icon in any pane header — shows forwards for that pane's connection, with add/remove controls
- A **badge** on the pane header network icon when the connection has active forwards

**Lifecycle:** Port forwards live as long as their connection. When the last terminal/SFTP channel on a connection closes, the connection tears down and its port forwards stop.

### Frontend: Simplified sidebar rail

With SFTP moved into the pane tree and port forwards into a popover, the `TerminalSidebar` icon rail simplifies to:
- Terminal settings (font, theme)
- Logging toggle and log viewer

These could potentially fold into pane headers in a follow-up, but that is out of scope for this spec.

### Derived atoms

- `sessionsAtom` (derived from workspace leaves) is replaced or renamed to reflect the new model. Components that need "all active terminal channels" or "all active connections" get new derived atoms.
- `sftpStateAtom` is rekeyed from `sessionId` to `channelId`. SFTP state (current path, entries, loading, error) is kept in this atom rather than component-local state, so that switching workspaces and back preserves the directory listing. The atom is cleaned up when a channel closes.
- `focusedSessionIdAtom` becomes `focusedChannelIdAtom` — returns the `channelId` of the focused leaf in the active workspace.
- `searchAddonsAtom` and `sessionProfileOverridesAtom` are rekeyed from `sessionId` to `channelId` (straightforward rename, same semantics).
- `leafToSession()` helper and the `Session` type are removed — consumers use `PaneLeaf` directly or derive what they need from `collectLeaves()`.

## Migration

Sessions and workspaces are ephemeral (in-memory atoms, not persisted to disk). There is no stored state to migrate. On upgrade, all active sessions are lost — the user starts fresh. This is the same behavior as today when the app restarts.

The `OpenSFTP` backend method is a complete rewrite (not a refactor of the existing one). The current method lazily creates a single `*sftp.Client` on an existing `sshSession`. The new method creates a standalone `SFTPChannel` with its own ID on a `Connection`. The call signature, return type, and lifecycle are all different.

## Out of scope

- Remote-to-remote file transfer (SCP between two hosts without streaming through the app)
- Tabbed SFTP (multiple tabs within a single SFTP pane)
- SFTP-only connections that persist after the pane closes
- Folding the sidebar rail into pane headers
- Drag-and-drop reordering of panes within the split tree
