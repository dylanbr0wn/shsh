# Shared Language (Canonical Terms)

This document is the **canonical vocabulary** for core entities and architectural concepts in this repository.

It exists to prevent naming drift (e.g. two places referring to the same thing with different words), and to make drift easy to spot during review.

## Rules

- **Prefer these canonical terms** in code, docs, logs, and event payloads.
- **Term IDs are stable**. If wording changes, keep the Term ID and update the definition.
- **UI labels are intentionally out of scope**. UI copy should *derive* from these canonical terms, not define new ones.

## Architecture boundaries

### `wails_rpc`
- **Canonical**: Wails RPC boundary
- **Definition**: The boundary where the React frontend calls exported Go methods (on `App`) via generated Wails bindings, and where Go emits events back to the frontend.
- **Owned by**: `app.go`, generated bindings in `frontend/wailsjs/`, docs in `website/src/content/docs/contributing/architecture.mdx`
- **Avoid**: “API”, “backend API” (too generic), “IPC” (not how we describe it here)

### `event`
- **Canonical**: event
- **Definition**: A one-way notification emitted from the Go backend to the frontend (topic + payload).
- **Owned by**: `internal/session` (`EventEmitter`), other emitters as used by `App`
- **Avoid**: “message” (ambiguous), “signal” (overloaded)

### `debug_event`
- **Canonical**: debug event
- **Definition**: A structured debug log entry emitted through the optional debug sink (category, level, message, fields).
- **Owned by**: `internal/session` (`DebugEmitter`), `internal/debuglog`
- **Avoid**: “telemetry” (implies external reporting), “analytics”

## Persistent data and configuration

### `config`
- **Canonical**: config
- **Definition**: Application-level settings stored in the config file (not per-host DB state).
- **Owned by**: `internal/config`
- **Avoid**: “settings” when referring to the file-backed struct (use “settings” only for the product concept)

### `store`
- **Canonical**: store (SQLite store)
- **Definition**: The local SQLite persistence layer for user data (hosts, groups, terminal profiles, workspace templates, vault metadata, encrypted secrets).
- **Owned by**: `internal/store`
- **Avoid**: “database layer” (too broad), “repo” (conflicts with git repository)

### `vault`
- **Canonical**: vault
- **Definition**: Optional encrypted-at-rest storage for secrets inside the local SQLite store, gated by a vault key (unlock/lock state).
- **Owned by**: `internal/vault`, `internal/store` (`vault_meta`, `secrets`)
- **Avoid**: “keychain” (different thing), “encryption” (too broad)

### `keychain`
- **Canonical**: OS keychain
- **Definition**: Operating-system credential store used for **inline secrets** when vault is disabled (or as fallback).
- **Owned by**: `internal/credstore` (keychain functions), `internal/store` (integration points)
- **Avoid**: “vault” (different storage path), “password manager” (external tools)

### `credential_source`
- **Canonical**: credential source
- **Definition**: Where a host’s password credential comes from: inline (locally stored) or an external password manager reference.
- **Owned by**: `internal/credstore` (`Source`), `internal/store` (`Host.CredentialSource`, `Host.CredentialRef`)
- **Allowed values**: `inline`, `1password`, `bitwarden`
- **Avoid**: “secret source”, “auth source”

### `credential_ref`
- **Canonical**: credential ref
- **Definition**: An identifier used by an external password manager to resolve the credential at connect time (format depends on the source).
- **Owned by**: `internal/credstore`, `internal/store`
- **Avoid**: “credential id” (implies internal ID), “token”

## Core entities (local app)

### `host`
- **Canonical**: host
- **Definition**: A saved SSH target (hostname, port, username, auth method, plus metadata like label, tags, group, and connection behavior).
- **Owned by**: `internal/store` (`type Host`), `frontend/src/types/index.ts` (`interface Host`)
- **Avoid**: “server” (not always accurate), “machine” (too vague)

### `group`
- **Canonical**: group
- **Definition**: A named folder for organizing hosts.
- **Owned by**: `internal/store` (`type Group`), `frontend/src/types/index.ts` (`interface Group`)
- **Avoid**: “folder” in code/data models (OK as a UI metaphor only), “host group” as the primary noun (redundant)

### `terminal_profile`
- **Canonical**: terminal profile
- **Definition**: A saved set of terminal appearance/behavior settings that can be referenced by hosts and groups.
- **Owned by**: `internal/store` (`type TerminalProfile`), `frontend/src/types/index.ts` (`interface TerminalProfile`)
- **Avoid**: “theme” (a subset), “terminal config” (conflicts with `config`)

### `workspace`
- **Canonical**: workspace
- **Definition**: A running set of panes/layout in the frontend, with a focused pane and a derived label/name.
- **Owned by**: `frontend/src/store/workspaces.ts` (`interface Workspace`)
- **Avoid**: “window” (different concept), “tab” (different concept)

### `pane`
- **Canonical**: pane
- **Definition**: A node in a workspace layout tree: either a leaf (terminal/SFTP/local) or a split node (horizontal/vertical).
- **Owned by**: `frontend/src/store/workspaces.ts` (`PaneLeaf`, `SplitNode`)
- **Avoid**: “panel” as the primary noun (ambiguous with other UI), “view” (too generic)

### `workspace_template`
- **Canonical**: workspace template
- **Definition**: A persisted workspace layout that can be saved and later reopened to recreate a workspace.
- **Owned by**: `internal/store` (`type WorkspaceTemplate`), `frontend/src/types/index.ts` (`interface WorkspaceTemplate`)
- **Avoid**: “layout preset” (not used elsewhere), “workspace preset”

### `origin`
- **Canonical**: origin
- **Definition**: A string describing where an entity came from: either local or imported from a registry bundle.
- **Owned by**: `internal/store` (`Host.Origin`, `Group.Origin`), `frontend/src/types/index.ts`
- **Canonical formats**:
  - `local`
  - `registry:<registry>/<ns>/<bundle>`
- **Avoid**: “source” for this field (conflicts with credential source)

## Connection model (runtime)

### `connection`
- **Canonical**: connection
- **Definition**: An SSH transport to a single host. Multiple channels share one connection.
- **Owned by**: `internal/session` (`type Connection`)
- **Identifiers**:
  - `connectionId`: runtime ID for a connection
  - `hostId`: persistent ID of the host used to establish the connection
- **Avoid**: “session” to mean transport; in this repo, transport is “connection”

### `channel`
- **Canonical**: channel
- **Definition**: A multiplexed runtime stream that runs over a connection (terminal, SFTP, etc).
- **Owned by**: `internal/session` (`channels map[string]Channel`)
- **Identifiers**:
  - `channelId`: runtime ID for a channel
- **Avoid**: “tab”, “terminal session” (ambiguous with connection/session status)

### `session_status`
- **Canonical**: session status
- **Definition**: The lifecycle state string for a terminal/SFTP leaf in the frontend (`connecting`, `connected`, `disconnected`, `reconnecting`, `failed`, `error`).
- **Owned by**: `internal/session` (`type Status`), `frontend/src/types/index.ts` (`type SessionStatus`)
- **Avoid**: “connection status” when referring to leaf state (connection can be reused across leaves)

## SSH and related capabilities

### `auth_method`
- **Canonical**: auth method
- **Definition**: The SSH authentication method used by a host.
- **Owned by**: `internal/store` (`type AuthMethod`), `frontend/src/types/index.ts` (`type AuthMethod`)
- **Allowed values**: `password`, `key`, `agent`
- **Avoid**: “login method”, “credential type”

### `jump_host`
- **Canonical**: jump host
- **Definition**: An optional intermediate host used for ProxyJump-style access; referenced by `jumpHostId` on a host.
- **Owned by**: `internal/store` (`Host.JumpHostID`), `frontend/src/types/index.ts`
- **Avoid**: “bastion” unless we explicitly adopt it as a synonym later

### `port_forward`
- **Canonical**: port forward
- **Definition**: A local TCP listener that forwards traffic to a remote host:port through an SSH connection.
- **Owned by**: `internal/session/portforward.go` (`PortForwardInfo`), `frontend/src/types/index.ts` (`interface PortForward`)
- **Avoid**: “tunnel” as the primary noun (can be used informally, but “port forward” is canonical)

### `sftp`
- **Canonical**: SFTP
- **Definition**: File operations and transfers over SSH using an SFTP channel.
- **Owned by**: `internal/session/sftp.go`, `frontend/src/components/sftp/`
- **Avoid**: “file browser” (UI concept), “scp” (different protocol)

### `ssh_config`
- **Canonical**: SSH config
- **Definition**: The user’s OpenSSH config file format (e.g. `~/.ssh/config`) that can be parsed/imported into shsh host entries.
- **Owned by**: `internal/sshconfig`
- **Avoid**: “ssh profile” (conflicts with terminal profile)

## Registry (remote host configuration distribution)

### `registry`
- **Canonical**: registry
- **Definition**: A remote service that stores and serves host-configuration bundles (publish/pull/subscribe).
- **Owned by**: `internal/registry`, `internal/config` (`RegistryConfig`)
- **Avoid**: “repo” (conflicts with git), “catalog” (not used elsewhere)

### `namespace`
- **Canonical**: namespace
- **Definition**: A registry-scoped grouping that owns bundles and has an associated API key.
- **Owned by**: `internal/registry/store.go` (table `namespaces`)
- **Avoid**: “org”, “team” unless we formally adopt them

### `bundle`
- **Canonical**: bundle
- **Definition**: A versioned payload representing a host/group configuration set distributed via a registry (wire format includes `namespace/name` + `tag`).
- **Owned by**: `internal/registry/types.go` (`type Bundle`)
- **Avoid**: “package”, “artifact”

### `tag`
- **Canonical**: tag
- **Definition**: A version label for a bundle within the registry (e.g. `v1`, `latest`).
- **Owned by**: `internal/registry/store.go` (table `versions.tag`)
- **Avoid**: “version” as the user-facing identifier (internally versions exist, but the identifier is a tag)

### `subscription`
- **Canonical**: registry bundle subscription
- **Definition**: A configured list of bundles a client “subscribes” to for syncing into the local store.
- **Owned by**: `internal/config` (`RegistryConfig.Bundles`)
- **Avoid**: “watch”, “follow”

