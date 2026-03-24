# Universal Panes & Workspace Templates

## Problem

The current pane system only supports remote-backed leaves (terminal and SFTP), and workspaces are implicitly tied to a single host connection. Users need:

- Local file tree panes for drag-and-drop transfers to/from remote hosts
- Remote-to-remote file transfers between different hosts
- Multiple remote or local panes side by side in any combination
- Named, saveable workspaces that feel like a collection of related work, not just "the tabs for one host"

## Approach: Channel-First

Every pane — local or remote — gets a channelId. The local filesystem is modeled as a virtual channel in the Go backend, implementing the same `Channel` interface as terminal and SFTP channels. This keeps the entire frontend uniform: every pane has a channelId, every transfer is channel-to-channel, every progress event uses the same pattern.

## Backend

### LocalFSChannel

A new `Channel` implementation that operates on the local filesystem.

```
type LocalFSChannel struct {
    id string
}

func (c *LocalFSChannel) ID() string           { return c.id }
func (c *LocalFSChannel) Kind() ChannelKind    { return ChannelKindLocalFS }
func (c *LocalFSChannel) ConnectionID() string { return "local" }
func (c *LocalFSChannel) Close() error         { return nil }
```

Exposes local FS operations: `ListDir`, `ReadFile`, `WriteFile`, `Mkdir`, `Delete`, `Rename`, `Stat`. These mirror the existing SFTP method signatures so the frontend can call them uniformly.

### Virtual Connection

A singleton `Connection` entry in the manager with well-known ID `"local"`:

- No SSH client, no jump host — `client` and `jumpClient` are nil
- Created lazily on first `OpenLocalFSChannel()` call
- Stored in both `m.connections["local"]` and `m.connByIdent[connIdentity{hostID: "local"}]` (must be in `m.connections` so `CloseChannel` can look it up by the channelId's `ConnectionID()`)
- `channelRefs` tracks open local channels; hitting zero removes the channels but does NOT call `teardownConnection` — the virtual connection is a true singleton that persists for the app's lifetime once created. Add an early return guard in `teardownConnection` when `conn.id == "local"`

### New Manager Methods

- `OpenLocalFSChannel() string` — creates a `LocalFSChannel`, increments virtual connection refs, returns channelId
- `LocalListDir(channelId, path)`, `LocalMkdir(channelId, path)`, `LocalDelete(channelId, path)`, `LocalRename(channelId, oldPath, newPath)` — local FS operations routed through the channel

### Unified Transfers

`TransferBetweenHosts` is renamed to `TransferBetweenChannels(srcChannelId, srcPath, dstChannelId, dstPath)`:

- Looks up each channel, branches on kind:
  - SFTP channel: use SFTP client to read/write
  - LocalFS channel: use `os` package to read/write
- Chunked streaming (read chunk, write chunk) regardless of source/dest types
- Progress events emitted on the destination channel

Transfer matrix by source/dest combination:

| Source → Dest | Local FS | Remote SFTP (same host) | Remote SFTP (diff host) |
|---|---|---|---|
| **Local FS** | `os.Copy` | Upload (local read → SFTP write) | Upload (local read → SFTP write) |
| **Remote SFTP** | Download (SFTP read → local write) | SFTP rename (same filesystem) | Relay (SFTP read → chunked → SFTP write) |

Same-host optimization: when source and dest channels share the same `connectionId`, use SFTP rename instead of streaming. Note: SFTP rename only works within the same filesystem/mount on the remote host. If rename fails (cross-device error), fall back to chunked streaming.

Future enhancement: direct SCP between hosts when both can reach each other, falling back to relay when they can't.

## Frontend

### New Leaf Type

`LocalFSLeaf` joins the `PaneLeaf` union:

```
PaneLeaf = TerminalLeaf | SFTPLeaf | LocalFSLeaf
```

- `kind: 'local'`
- `paneId`, `channelId` — same as other leaves
- `connectionId: "local"` (sentinel), `hostId: "local"`, `hostLabel: "Local"`
- `status: SessionStatus` — included to keep the `PaneLeaf` union uniform; set to `"connected"` immediately on creation (local FS is always available)
- `currentPath: string` — directory being viewed, defaults to home directory

### Workspace Identity

`Workspace` gains:

- `name: string` — user-editable, shown in the tab
- `savedTemplateId?: string` — link to persisted template, if saved from one

`label` becomes a fallback: if `name` is set, use it; otherwise derive from first pane's host label (current behavior).

Tab rendering: shows workspace name, plus small colored dots representing each unique connection inside (one dot per host color).

### Workspace Templates

New type for persistence (stored in bbolt alongside hosts):

```
WorkspaceTemplate {
    id: string
    name: string
    layout: TemplateNode
}

TemplateLeaf =
    | { kind: 'terminal', hostId: string }
    | { kind: 'sftp', hostId: string }
    | { kind: 'local', defaultPath?: string }

TemplateNode = TemplateLeaf | TemplateSplitNode
TemplateSplitNode = { direction, ratio, left: TemplateNode, right: TemplateNode }
```

On open: walk the template tree, connect to each referenced host (reusing connections for same host), open channels, build live `PaneNode` tree. Each pane appears immediately in "connecting" state and resolves independently. Failed connections show error state with retry. If a referenced host has been deleted since the template was saved, that pane opens in an error state with a message indicating the host no longer exists — the rest of the workspace opens normally.

Templates capture: layout tree structure, split directions and ratios, pane types, host references, last-viewed directory paths.

Templates do NOT capture: live connection state, terminal scrollback, authentication tokens.

### Drag-and-Drop

Rename `application/x-shsh-sftp` to `application/x-shsh-transfer`. Payload remains `{channelId, paths[]}`. Drop target reads the source channelId and calls `TransferBetweenChannels`.

OS file drops from Finder/Explorer (via Wails `window:filedrop`) route directly to the destination pane's channel. If the drop target is an SFTP pane, upload via that SFTP channel. If it's a local pane, copy via the local channel. No intermediate local channel is needed for OS drops.

### Adding Panes

Two mechanisms for adding panes to an existing workspace:

1. **"+" button** inside the workspace — opens a menu with "Local file browser", "Terminal → pick host", "SFTP → pick host". New pane splits alongside the currently focused pane.

2. **Drag from sidebar** — drag a host from the sidebar into the workspace. Drop target highlights the pane being hovered; new pane splits alongside it. Default drag creates a terminal pane; holding Shift creates an SFTP pane.

### Workspace Tab Bar

- **Tab content**: workspace name + colored dots (one per unique connection)
- **Right-click context menu**: Rename workspace, Save as template, Close workspace, Close all workspaces
- **"+" tab button**: opens menu with "New empty workspace" and a list of saved templates (showing name + pane count)

## Go Store Changes

New bbolt bucket for workspace templates. CRUD operations:

- `SaveWorkspaceTemplate(template)` — upsert
- `ListWorkspaceTemplates() []WorkspaceTemplate`
- `GetWorkspaceTemplate(id) WorkspaceTemplate`
- `DeleteWorkspaceTemplate(id)`

New `ChannelKind` constant: `ChannelKindLocalFS = "local"`.

## Event Changes

- `channel:transfer-progress:{channelId}` — replaces `channel:sftp-progress:{channelId}` to reflect that transfers can be local or remote
- `channel:status` events work unchanged for local channels (connecting → connected is instant)
