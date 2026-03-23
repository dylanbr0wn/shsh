# Deploy Public Key (ssh-copy-id equivalent) — Design Spec

**Issue:** [#4](https://github.com/dylanbr0wn/shsh/issues/4)
**Date:** 2026-03-23
**Branch:** `feat/deploy-pub-key`

## Summary

Add a one-click workflow to install a local public key onto a remote host's `~/.ssh/authorized_keys` — the equivalent of running `ssh-copy-id`. The operation is idempotent and transparent: the user sees a description of what will happen on the remote before confirming.

## Entry Points

The action is surfaced in two places:

1. **Edit Host modal** — a "Deploy Public Key…" button in the SSH Key auth section, alongside the existing Browse and Generate buttons.
2. **Sidebar host item** — a "Deploy Public Key…" item in both the `DropdownMenu` (…button) and the `ContextMenu` (right-click), positioned between Edit and Delete.

Both entry points open the same dedicated `DeployKeyModal` sub-dialog.

## Backend

### New method: `App.DeployPublicKey`

```go
func (a *App) DeployPublicKey(hostID string, publicKeyPath string) (string, error)
```

Returns the SHA256 fingerprint of the deployed key on success, or an error.

**Steps:**

1. **Derive the public key path** — if `publicKeyPath` does not end in `.pub`, append `.pub`. Read the file; return a clear error if it does not exist.
2. **Resolve credentials** — call `a.store.GetHostForConnect(hostID)`. Return an error if the host has no saved credential (password or key). No interactive password prompts.
3. **Resolve jump host** — if the host has a `JumpHostID`, call `GetHostForConnect` on it and dial via jump, matching the logic in `ConnectHost`.
4. **Dial SSH** — call `goph.New(...)` to create a fresh `*goph.Client` (not the persistent session manager). Use `goph.DefaultKnownHosts()` for host key verification. If the host is not yet in `known_hosts`, return a clear error asking the user to connect via the terminal first (which adds it). Defer `client.Close()`.
5. **Ensure remote directory** — call `client.Run("mkdir -p ~/.ssh && chmod 700 ~/.ssh")`. No user input is interpolated; this is safe.
6. **Idempotent key append via SFTP** — open an SFTP client with `client.NewSftp()` to avoid shell injection from user-controlled key comment fields:
   - Attempt to read `~/.ssh/authorized_keys`; treat a not-found error as an empty file.
   - In Go, check if the public key line is already present using `bytes.Contains`. If present, skip.
   - If not present, append the public key line and write the file back via SFTP.
7. **Fix permissions** — call `client.Run("chmod 600 ~/.ssh/authorized_keys")`. Safe; no user input interpolated.
8. **Return fingerprint** — parse the public key line with `ssh.ParseAuthorizedKey(pubKeyBytes)` (not `ssh.ParsePublicKey`, which expects binary wire format — the `.pub` file is authorized_keys text format as written by `ssh.MarshalAuthorizedKey`). Return `ssh.FingerprintSHA256(key)`.

**Why SFTP for the key append:** embedding the raw public key text into a shell command is a command injection risk — the comment field is user-controlled and may contain shell metacharacters. The SFTP read/modify/write approach keeps all user data in Go and never passes it through a shell.

### Location

`app.go` — consistent with all other host-level operations (`ConnectHost`, `GenerateSSHKey`, `ExportHosts`, etc.).

## Frontend

### New component: `DeployKeyModal`

**File:** `frontend/src/components/modals/DeployKeyModal.tsx`

**Props:**
```ts
interface Props {
  open: boolean
  onClose: () => void
  hostId: string
  hostLabel: string
}
```

**State:**
- `keyPath: string` — selected key path (private key; backend derives `.pub`)
- `browsing: boolean` — BrowseKeyFile in-flight
- `deploying: boolean` — DeployPublicKey RPC in-flight
- `generateKeyOpen: boolean` — nested GenerateKeyModal open

**UI layout (top to bottom):**

1. **Dialog header** — title: "Deploy Public Key to {hostLabel}"
2. **Key picker field** — label "Public Key", input + Browse… button (calls `BrowseKeyFile`) + Generate… button (opens nested `GenerateKeyModal`). On generate, auto-fills `keyPath` with the new private key path.
3. **Transparency block** — a muted info panel describing what will happen on the remote host:
   ```
   This will connect to <hostLabel> and:
   • Ensure ~/.ssh exists with permissions 700
   • Append your public key to ~/.ssh/authorized_keys (if not already present)
   • Set permissions 600 on ~/.ssh/authorized_keys

   Key: <truncated-pubkey-fingerprint>
   ```
   Once a key file is selected, the fingerprint is populated by calling a new `App.ReadPublicKeyText(path string) (string, error)` RPC method (reads the `.pub` file and returns the first line). Before a key is selected, the key line shows a placeholder. Note: the implementation uses SFTP for the key append — no shell interpolation of key data occurs.
4. **Footer** — Cancel (ghost) + Deploy button. Deploy is disabled when `keyPath` is empty or `deploying` is true; shows spinner when in-flight.

**On success:** `toast.success('Public key deployed', { description: fingerprint })`, close modal.
**On error:** `toast.error('Deploy failed', { description: String(err) })`.

### New atoms

```ts
// frontend/src/store/atoms.ts
export const isDeployKeyOpenAtom = atom(false)
export const deployKeyHostAtom = atom<Host | null>(null)
```

### `EditHostModal` changes

In the `authMethod === 'key'` section, add a **Deploy Public Key…** button in the same button row as Browse and Generate:

```tsx
<Button type="button" variant="outline" onClick={() => setDeployKeyOpen(true)}>
  <Upload data-icon="inline-start" />
  Deploy…
</Button>
<DeployKeyModal
  open={deployKeyOpen}
  onClose={() => setDeployKeyOpen(false)}
  hostId={form.id}
  hostLabel={form.label}
/>
```

Local `deployKeyOpen` state — no atom needed here since the modal is scoped to the Edit Host modal lifecycle.

### `HostListItem` changes

Add `onDeployKey: () => void` prop. Add menu items in both `DropdownMenuContent` and `ContextMenuContent`, positioned after Edit and before the Delete separator:

```tsx
<DropdownMenuItem onClick={onDeployKey}>Deploy Public Key…</DropdownMenuItem>
```

### New RPC method: `App.ReadPublicKeyText`

```go
func (a *App) ReadPublicKeyText(path string) (string, error)
```

Reads a `.pub` file (appending `.pub` if the path doesn't end in it) and returns its first line. Used by `DeployKeyModal` to populate the transparency block live as the user picks a key.

### Top-level wiring

Render one `<DeployKeyModal>` instance at the app root (alongside `<EditHostModal>`, etc.), driven by `isDeployKeyOpenAtom` / `deployKeyHostAtom`. The atom holds a full `Host` object; the root component passes `deployKeyHost?.id` and `deployKeyHost?.label` as props.

Both `HostList.tsx` (ungrouped / search results) and `HostGroupSection.tsx` (grouped hosts) render `<HostListItem>` independently. Both must receive and thread through an `onDeployKey: (host: Host) => void` prop that writes the host to `deployKeyHostAtom` and sets `isDeployKeyOpenAtom` to `true`. Omitting either will cause the Deploy option to be silently absent for that subset of hosts.

## Acceptance Criteria

- [ ] User can deploy any saved public key to a host via the Edit Host modal
- [ ] User can deploy via the sidebar context menu / dropdown
- [ ] User can generate a new key and deploy it in one flow
- [ ] Operation is idempotent — deploying the same key twice does not duplicate it
- [ ] `~/.ssh/` and `authorized_keys` are created with correct permissions if missing
- [ ] Hosts reachable only via jump host are supported
- [ ] Hosts with no saved credential show a clear error; no interactive prompt
- [ ] Success toast shows the deployed key's SHA256 fingerprint
- [ ] Transparency block shows live-updated commands before the user confirms
- [ ] `go test ./...`, `pnpm build`, `pnpm lint`, `pnpm format:check` all pass

## Out of Scope

- Deploying to multiple hosts at once
- Removing / revoking keys from `authorized_keys`
- Hosts using ad-hoc (QuickConnect) credentials
