# Deploy Public Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Deploy Public Key…" workflow to install a local SSH public key onto a remote host's `~/.ssh/authorized_keys`, surfaced in both the Edit Host modal and the sidebar host menus.

**Architecture:** Two new methods on `App` in `app.go` (`ReadPublicKeyText` and `DeployPublicKey`); a new `DeployKeyModal` component driven by two Jotai atoms; `HostListItem`, `HostList`, `HostGroupSection`, and `EditHostModal` each receive minor additions. The backend uses `goph.NewConn` + SFTP to avoid shell injection when writing the key.

**Tech Stack:** Go 1.25, `github.com/melbahja/goph v1.5.0`, `github.com/pkg/sftp`, `golang.org/x/crypto/ssh`, React 18, Jotai, shadcn/ui, Sonner toasts, Wails v2 RPC bindings.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `app.go` | Add `ReadPublicKeyText`, `DeployPublicKey`, `buildGophAuth` |
| Create | `app_test.go` | Unit tests for `ReadPublicKeyText` and `DeployPublicKey` error paths |
| Modify | `frontend/src/store/atoms.ts` | Add `isDeployKeyOpenAtom`, `deployKeyHostAtom` |
| Create | `frontend/src/components/modals/DeployKeyModal.tsx` | New modal component |
| Modify | `frontend/src/App.tsx` | Render `<DeployKeyModal>` at root |
| Modify | `frontend/src/components/sidebar/HostListItem.tsx` | Add `onDeployKey` prop + menu items |
| Modify | `frontend/src/components/sidebar/HostList.tsx` | Wire `onDeployKey` handler + atoms |
| Modify | `frontend/src/components/sidebar/HostGroupSection.tsx` | Add `onDeployKey` prop + thread through |
| Modify | `frontend/src/components/modals/EditHostModal.tsx` | Add Deploy button in key auth section |

---

## Task 1: `ReadPublicKeyText` — tests first

**Files:**
- Create: `app_test.go`
- Modify: `app.go`

- [ ] **Step 1: Create `app_test.go` with failing tests**

  ```go
  package main

  import (
      "os"
      "path/filepath"
      "testing"
  )

  func TestReadPublicKeyText(t *testing.T) {
      content := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest test@machine\n"

      t.Run("reads .pub file directly", func(t *testing.T) {
          dir := t.TempDir()
          pubPath := filepath.Join(dir, "id_ed25519.pub")
          if err := os.WriteFile(pubPath, []byte(content), 0600); err != nil {
              t.Fatal(err)
          }
          app := &App{}
          got, err := app.ReadPublicKeyText(pubPath)
          if err != nil {
              t.Fatalf("unexpected error: %v", err)
          }
          if got != content[:len(content)-1] { // trimmed newline
              t.Fatalf("got %q, want %q", got, content[:len(content)-1])
          }
      })

      t.Run("derives .pub from private key path", func(t *testing.T) {
          dir := t.TempDir()
          pubPath := filepath.Join(dir, "id_ed25519.pub")
          if err := os.WriteFile(pubPath, []byte(content), 0600); err != nil {
              t.Fatal(err)
          }
          app := &App{}
          privPath := filepath.Join(dir, "id_ed25519")
          got, err := app.ReadPublicKeyText(privPath)
          if err != nil {
              t.Fatalf("unexpected error: %v", err)
          }
          if got == "" {
              t.Fatal("expected non-empty key text")
          }
      })

      t.Run("returns error for missing file", func(t *testing.T) {
          app := &App{}
          _, err := app.ReadPublicKeyText("/nonexistent/path/id_ed25519")
          if err == nil {
              t.Fatal("expected error, got nil")
          }
      })
  }
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  go test ./... -run TestReadPublicKeyText -v
  ```

  Expected: FAIL — `app.ReadPublicKeyText undefined`

- [ ] **Step 3: Implement `ReadPublicKeyText` in `app.go`**

  Add after the `BrowseKeyFile` method (around line 733):

  ```go
  // ReadPublicKeyText reads a public key file and returns its first line.
  // If path does not end in ".pub", ".pub" is appended before reading.
  // Used by the frontend to preview the key in the Deploy Public Key dialog.
  func (a *App) ReadPublicKeyText(path string) (string, error) {
      pubPath := path
      if !strings.HasSuffix(pubPath, ".pub") {
          pubPath = path + ".pub"
      }
      data, err := os.ReadFile(pubPath)
      if err != nil {
          return "", fmt.Errorf("read public key: %w", err)
      }
      line := strings.SplitN(strings.TrimRight(string(data), "\n"), "\n", 2)[0]
      return line, nil
  }
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  go test ./... -run TestReadPublicKeyText -v
  ```

  Expected: PASS (3 subtests)

- [ ] **Step 5: Commit**

  ```bash
  git add app.go app_test.go
  git commit -m "feat(keygen): add ReadPublicKeyText RPC method"
  ```

---

## Task 2: `DeployPublicKey` — tests first

**Files:**
- Modify: `app_test.go`
- Modify: `app.go`

- [ ] **Step 1: Add failing tests for error paths in `app_test.go`**

  Append after the existing `TestReadPublicKeyText`:

  ```go
  func TestDeployPublicKeyErrors(t *testing.T) {
      t.Run("missing public key file returns error", func(t *testing.T) {
          app := &App{}
          _, err := app.DeployPublicKey("any-id", "/nonexistent/id_ed25519")
          if err == nil {
              t.Fatal("expected error for missing pub key file, got nil")
          }
      })

      t.Run("invalid pub key content returns error", func(t *testing.T) {
          dir := t.TempDir()
          pubPath := filepath.Join(dir, "bad.pub")
          os.WriteFile(pubPath, []byte("not a valid key\n"), 0600)
          app := &App{}
          _, err := app.DeployPublicKey("any-id", pubPath)
          if err == nil {
              t.Fatal("expected error for invalid key content, got nil")
          }
      })
  }
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  go test ./... -run TestDeployPublicKeyErrors -v
  ```

  Expected: FAIL — `app.DeployPublicKey undefined`

- [ ] **Step 3: Add `buildGophAuth` helper to `app.go`**

  Add just before the `validateLogPath` method (near the bottom of `app.go`):

  ```go
  // buildGophAuth constructs a goph.Auth value for the given host and secret.
  // Mirrors the resolveAuth logic in internal/session but operates on App-level
  // code without importing the session package's unexported helper.
  func buildGophAuth(host store.Host, secret string) (goph.Auth, error) {
      switch host.AuthMethod {
      case store.AuthPassword:
          return goph.Password(secret), nil
      case store.AuthKey:
          if host.KeyPath == nil || *host.KeyPath == "" {
              return nil, fmt.Errorf("no key file configured for this host")
          }
          return goph.Key(*host.KeyPath, secret)
      case store.AuthAgent:
          return goph.UseAgent()
      default:
          ag, err := goph.UseAgent()
          if err != nil {
              return goph.Password(secret), nil
          }
          return ag, nil
      }
  }
  ```

- [ ] **Step 4: Add `DeployPublicKey` to `app.go`**

  Add new imports to the import block at the top:
  - `"bytes"`
  - `"io"`

  (Both are in the standard library and not yet imported. `"net"`, `"strings"`, `"os"`, `"fmt"`, `"time"` are already present.)

  Also add `"github.com/melbahja/goph"` to the import block. `goph` is already a direct dependency in `go.mod` (used by `internal/session`), so no `go.mod` or `go get` changes are needed — just add the import path to this file.

  Add the method after `ReadPublicKeyText`:

  ```go
  // DeployPublicKey installs a public key on the remote host's ~/.ssh/authorized_keys,
  // equivalent to running ssh-copy-id. The operation is idempotent.
  // publicKeyPath may be the private key path; ".pub" is appended if missing.
  // Returns the SHA256 fingerprint of the deployed key on success.
  func (a *App) DeployPublicKey(hostID string, publicKeyPath string) (string, error) {
      // 1. Derive and read the public key file.
      pubPath := publicKeyPath
      if !strings.HasSuffix(pubPath, ".pub") {
          pubPath = publicKeyPath + ".pub"
      }
      pubKeyBytes, err := os.ReadFile(pubPath)
      if err != nil {
          return "", fmt.Errorf("read public key file: %w", err)
      }

      // 2. Parse for fingerprint and canonical form (type + base64, no comment).
      parsed, _, _, _, err := ssh.ParseAuthorizedKey(pubKeyBytes)
      if err != nil {
          return "", fmt.Errorf("parse public key: %w", err)
      }
      fingerprint := ssh.FingerprintSHA256(parsed)
      canonical := strings.TrimRight(string(ssh.MarshalAuthorizedKey(parsed)), "\n")

      // 3. Resolve credentials — error if no saved credential.
      host, secret, err := a.store.GetHostForConnect(hostID)
      if err != nil {
          return "", fmt.Errorf("get credentials: %w", err)
      }

      // 4. Build known-hosts callback.
      hostKeyCallback, err := goph.DefaultKnownHosts()
      if err != nil {
          return "", fmt.Errorf("load known_hosts: %w", err)
      }

      const dialTimeout = 30 * time.Second

      // 5. Dial SSH (direct or via jump host).
      var client *goph.Client

      if host.JumpHostID != nil {
          jh, jp, err := a.store.GetHostForConnect(*host.JumpHostID)
          if err != nil {
              return "", fmt.Errorf("get jump host credentials: %w", err)
          }
          jumpAuth, err := buildGophAuth(jh, jp)
          if err != nil {
              return "", fmt.Errorf("jump host auth: %w", err)
          }
          jumpSSHCfg := &ssh.ClientConfig{
              User:            jh.Username,
              Auth:            jumpAuth,
              HostKeyCallback: hostKeyCallback,
              Timeout:         dialTimeout,
          }
          jumpConn, err := net.DialTimeout("tcp",
              net.JoinHostPort(jh.Hostname, fmt.Sprintf("%d", jh.Port)), dialTimeout)
          if err != nil {
              return "", fmt.Errorf("dial jump host: %w", err)
          }
          ncc, chans, reqs, err := ssh.NewClientConn(jumpConn, jh.Hostname, jumpSSHCfg)
          if err != nil {
              jumpConn.Close()
              return "", fmt.Errorf("connect jump host: %w", err)
          }
          jumpClient := ssh.NewClient(ncc, chans, reqs)
          defer jumpClient.Close()

          targetAuth, err := buildGophAuth(host, secret)
          if err != nil {
              return "", fmt.Errorf("target host auth: %w", err)
          }
          targetSSHCfg := &ssh.ClientConfig{
              User:            host.Username,
              Auth:            targetAuth,
              HostKeyCallback: hostKeyCallback,
              Timeout:         dialTimeout,
          }
          tunnelConn, err := jumpClient.Dial("tcp",
              net.JoinHostPort(host.Hostname, fmt.Sprintf("%d", host.Port)))
          if err != nil {
              return "", fmt.Errorf("dial target through jump host: %w", err)
          }
          targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(
              tunnelConn, host.Hostname, targetSSHCfg)
          if err != nil {
              tunnelConn.Close()
              return "", fmt.Errorf("connect target via jump host: %w", err)
          }
          client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
      } else {
          auth, err := buildGophAuth(host, secret)
          if err != nil {
              return "", fmt.Errorf("host auth: %w", err)
          }
          client, err = goph.NewConn(&goph.Config{
              User:     host.Username,
              Addr:     host.Hostname,
              Port:     uint(host.Port),
              Auth:     auth,
              Timeout:  dialTimeout,
              Callback: hostKeyCallback,
          })
          if err != nil {
              return "", fmt.Errorf(
                  "connect to host (host key unknown? connect via terminal first): %w", err)
          }
      }
      defer client.Close()

      // 6. Ensure ~/.ssh exists with correct permissions.
      if _, err := client.Run("mkdir -p ~/.ssh && chmod 700 ~/.ssh"); err != nil {
          return "", fmt.Errorf("create ~/.ssh on remote: %w", err)
      }

      // 7. Idempotent append via SFTP (avoids shell injection from key comment field).
      sftpClient, err := client.NewSftp()
      if err != nil {
          return "", fmt.Errorf("open sftp: %w", err)
      }
      defer sftpClient.Close()

      const akPath = ".ssh/authorized_keys"
      existing, err := func() ([]byte, error) {
          f, err := sftpClient.Open(akPath)
          if err != nil {
              if os.IsNotExist(err) {
                  return nil, nil
              }
              return nil, err
          }
          defer f.Close()
          return io.ReadAll(f)
      }()
      if err != nil {
          return "", fmt.Errorf("read authorized_keys: %w", err)
      }

      if !bytes.Contains(existing, []byte(canonical)) {
          newContent := append(existing, []byte(canonical+"\n")...)
          f, err := sftpClient.OpenFile(akPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
          if err != nil {
              return "", fmt.Errorf("open authorized_keys for writing: %w", err)
          }
          if _, writeErr := f.Write(newContent); writeErr != nil {
              f.Close()
              return "", fmt.Errorf("write authorized_keys: %w", writeErr)
          }
          f.Close()
      }

      // 8. Fix permissions on authorized_keys.
      if _, err := client.Run("chmod 600 ~/.ssh/authorized_keys"); err != nil {
          return "", fmt.Errorf("chmod authorized_keys: %w", err)
      }

      return fingerprint, nil
  }
  ```

- [ ] **Step 5: Run tests — verify they pass**

  ```bash
  go test ./... -run TestDeployPublicKeyErrors -v
  ```

  Expected: PASS (2 subtests)

- [ ] **Step 6: Run all Go tests**

  ```bash
  go test ./...
  ```

  Expected: all pass

- [ ] **Step 7: Commit**

  ```bash
  git add app.go app_test.go
  git commit -m "feat(keydeploy): add DeployPublicKey and ReadPublicKeyText backend methods"
  ```

---

## Task 3: Rebuild Wails bindings

After adding new `App` methods, the TypeScript bindings must be regenerated.

- [ ] **Step 1: Build to regenerate `frontend/wailsjs/go/`**

  ```bash
  wails build
  ```

  This regenerates `frontend/wailsjs/go/main/App.js` and the TypeScript model files. Do **not** edit these generated files manually.

- [ ] **Step 2: Verify new bindings exist**

  ```bash
  grep -n "DeployPublicKey\|ReadPublicKeyText" frontend/wailsjs/go/main/App.js
  ```

  Expected: both function names appear in the output.

- [ ] **Step 3: Commit generated bindings**

  ```bash
  git add frontend/wailsjs/
  git commit -m "chore(build): regenerate Wails bindings for DeployPublicKey"
  ```

---

## Task 4: Add Jotai atoms

**Files:**
- Modify: `frontend/src/store/atoms.ts`

- [ ] **Step 1: Add atoms at the end of `frontend/src/store/atoms.ts`**

  Append these two lines (after the `hostHealthAtom` declaration on line 66):

  ```ts
  export const isDeployKeyOpenAtom = atom<boolean>(false)
  export const deployKeyHostAtom = atom<Host | null>(null)
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: build succeeds (or errors only from unwritten imports — fix those in subsequent tasks).

  > Note: build will error if any file already imports these atoms before they exist. Since no files import them yet, it will succeed.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/store/atoms.ts
  git commit -m "feat(keydeploy): add deploy key modal atoms"
  ```

---

## Task 5: Create `DeployKeyModal`

**Files:**
- Create: `frontend/src/components/modals/DeployKeyModal.tsx`

- [ ] **Step 1: Create the component**

  ```tsx
  import { useEffect, useState } from 'react'
  import { toast } from 'sonner'
  import { FolderOpen, KeyRound, Loader2 } from 'lucide-react'
  import { BrowseKeyFile, DeployPublicKey, ReadPublicKeyText } from '../../../wailsjs/go/main/App'
  import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
  } from '../ui/dialog'
  import { Input } from '../ui/input'
  import { Button } from '../ui/button'
  import { Field, FieldGroup, FieldLabel } from '../ui/field'
  import { GenerateKeyModal } from './GenerateKeyModal'

  interface Props {
    open: boolean
    onClose: () => void
    hostId: string
    hostLabel: string
  }

  export function DeployKeyModal({ open, onClose, hostId, hostLabel }: Props) {
    const [keyPath, setKeyPath] = useState('')
    const [pubKeyText, setPubKeyText] = useState<string | null>(null)
    const [browsing, setBrowsing] = useState(false)
    const [deploying, setDeploying] = useState(false)
    const [generateKeyOpen, setGenerateKeyOpen] = useState(false)

    // Reset state when dialog opens.
    useEffect(() => {
      if (open) {
        setKeyPath('')
        setPubKeyText(null)
      }
    }, [open])

    // Load public key text preview whenever keyPath changes.
    useEffect(() => {
      if (!keyPath) {
        setPubKeyText(null)
        return
      }
      ReadPublicKeyText(keyPath)
        .then(setPubKeyText)
        .catch(() => setPubKeyText(null))
    }, [keyPath])

    async function handleBrowse() {
      setBrowsing(true)
      try {
        const path = await BrowseKeyFile()
        if (path) setKeyPath(path)
      } catch {
        // user cancelled
      } finally {
        setBrowsing(false)
      }
    }

    async function handleDeploy() {
      setDeploying(true)
      try {
        const fingerprint = await DeployPublicKey(hostId, keyPath)
        toast.success('Public key deployed', { description: fingerprint })
        onClose()
      } catch (err) {
        toast.error('Deploy failed', { description: String(err) })
      } finally {
        setDeploying(false)
      }
    }

    // Show a truncated preview: first 20 chars + last 10 chars.
    const keyPreview = pubKeyText
      ? pubKeyText.slice(0, 20) + '…' + pubKeyText.slice(-10).trim()
      : null

    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deploy Public Key</DialogTitle>
            <DialogDescription>Install a public key on {hostLabel}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="dk-key-path">Public Key</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="dk-key-path"
                    placeholder="~/.ssh/id_ed25519"
                    value={keyPath}
                    onChange={(e) => setKeyPath(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={browsing}
                    onClick={handleBrowse}
                  >
                    <FolderOpen data-icon="inline-start" />
                    Browse
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGenerateKeyOpen(true)}
                  >
                    <KeyRound data-icon="inline-start" />
                    Generate…
                  </Button>
                </div>
              </Field>
            </FieldGroup>

            <GenerateKeyModal
              open={generateKeyOpen}
              onClose={() => setGenerateKeyOpen(false)}
              onGenerated={(path) => {
                setKeyPath(path)
                setGenerateKeyOpen(false)
              }}
            />

            {/* Transparency block */}
            <div className="bg-muted/50 text-muted-foreground mt-4 space-y-1 rounded-md p-3 text-xs">
              <p className="text-foreground font-medium">
                This will connect to {hostLabel} and:
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>Ensure ~/.ssh exists with permissions 700</li>
                <li>
                  Append your public key to ~/.ssh/authorized_keys (if not already present)
                </li>
                <li>Set permissions 600 on ~/.ssh/authorized_keys</li>
              </ul>
              <p className="mt-2 break-all font-mono text-[10px]">
                {keyPreview ? (
                  <>Key: {keyPreview}</>
                ) : (
                  <span className="opacity-60 italic">Select a key above to preview</span>
                )}
              </p>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDeploy} disabled={!keyPath || deploying}>
              {deploying && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  ```

- [ ] **Step 2: Verify it compiles**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: build succeeds (component is not yet imported anywhere, so no dead-import errors).

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/modals/DeployKeyModal.tsx
  git commit -m "feat(keydeploy): add DeployKeyModal component"
  ```

---

## Task 6: Wire `DeployKeyModal` into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add import and render `<DeployKeyModal>` in `App.tsx`**

  Add import at the top (after the last modal import, around line 18):

  ```ts
  import { DeployKeyModal } from './components/modals/DeployKeyModal'
  ```

  Inside the `App` function, add the atoms:

  ```ts
  const [isDeployKeyOpen, setIsDeployKeyOpen] = useAtom(isDeployKeyOpenAtom)
  const [deployKeyHost] = useAtom(deployKeyHostAtom)
  ```

  Add the required import at the top:

  ```ts
  import { useAtom } from 'jotai'
  import { isDeployKeyOpenAtom, deployKeyHostAtom } from './store/atoms'
  ```

  Add `<DeployKeyModal>` to the JSX, after `<TerminalProfilesModal />` (line 66):

  ```tsx
  <DeployKeyModal
    open={isDeployKeyOpen}
    onClose={() => setIsDeployKeyOpen(false)}
    hostId={deployKeyHost?.id ?? ''}
    hostLabel={deployKeyHost?.label ?? ''}
  />
  ```

- [ ] **Step 2: Verify build**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: build succeeds.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/App.tsx
  git commit -m "feat(keydeploy): wire DeployKeyModal into App root"
  ```

---

## Task 7: Update `HostListItem`

**Files:**
- Modify: `frontend/src/components/sidebar/HostListItem.tsx`

- [ ] **Step 1: Add `onDeployKey` to the Props interface and component signature**

  In `HostListItem.tsx`, update the `Props` interface (around line 32):

  ```ts
  interface Props {
    host: Host
    isConnected: boolean
    isConnecting: boolean
    onConnect: () => void
    onDelete: () => void
    onEdit: () => void
    onDeployKey: () => void          // ← add this
    onMoveToGroup?: (hostId: string, groupId: string | null) => void
  }
  ```

  Update the destructure (around line 66):

  ```ts
  export function HostListItem({
    host,
    isConnected,
    isConnecting,
    onConnect,
    onDelete,
    onEdit,
    onDeployKey,          // ← add this
    onMoveToGroup,
  }: Props) {
  ```

- [ ] **Step 2: Add "Deploy Public Key…" to the `DropdownMenuContent`**

  After `<DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>` (around line 212), add:

  ```tsx
  <DropdownMenuItem onClick={onDeployKey}>Deploy Public Key…</DropdownMenuItem>
  ```

- [ ] **Step 3: Add "Deploy Public Key…" to the `ContextMenuContent`**

  After `<ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>` (around line 247), add:

  ```tsx
  <ContextMenuItem onClick={onDeployKey}>Deploy Public Key…</ContextMenuItem>
  ```

- [ ] **Step 4: Verify build (will fail — callers need updating)**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: TypeScript errors in `HostList.tsx` and `HostGroupSection.tsx` — `onDeployKey` is now required.

- [ ] **Step 5: Commit the HostListItem changes (pre-fix, safe since it compiles as a module change)**

  ```bash
  git add frontend/src/components/sidebar/HostListItem.tsx
  git commit -m "feat(keydeploy): add Deploy Public Key menu item to HostListItem"
  ```

---

## Task 8: Wire `onDeployKey` in `HostList` and `HostGroupSection`

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx`
- Modify: `frontend/src/components/sidebar/HostGroupSection.tsx`

### HostList.tsx

- [ ] **Step 1: Add atom imports and handler**

  Add to the existing `jotai` import block at the top of `HostList.tsx`:

  ```ts
  import { isDeployKeyOpenAtom, deployKeyHostAtom } from '../../store/atoms'
  ```

  Inside `HostList()`, add atom setters:

  ```ts
  const setIsDeployKeyOpen = useSetAtom(isDeployKeyOpenAtom)
  const setDeployKeyHost = useSetAtom(deployKeyHostAtom)
  ```

  Add handler function (after `handleEdit`):

  ```ts
  function handleDeployKey(host: Host) {
    setDeployKeyHost(host)
    setIsDeployKeyOpen(true)
  }
  ```

- [ ] **Step 2: Pass `onDeployKey` to every `<HostListItem>` in `HostList.tsx`**

  There are three places that render `<HostListItem>` in `HostList.tsx`:

  1. **Search results** (around line 333):

     ```tsx
     <HostListItem
       host={host}
       isConnected={connectedHostIds.has(host.id)}
       isConnecting={connectingHostIds.has(host.id)}
       onConnect={() => handleConnect(host.id, host.label)}
       onDelete={() => handleDelete(host.id)}
       onEdit={() => handleEdit(host)}
       onDeployKey={() => handleDeployKey(host)}   // ← add
       onMoveToGroup={handleMoveToGroup}
     />
     ```

  2. **Ungrouped hosts** (around line 373):

     ```tsx
     <HostListItem
       key={host.id}
       host={host}
       isConnected={connectedHostIds.has(host.id)}
       isConnecting={connectingHostIds.has(host.id)}
       onConnect={() => handleConnect(host.id, host.label)}
       onDelete={() => handleDelete(host.id)}
       onEdit={() => handleEdit(host)}
       onDeployKey={() => handleDeployKey(host)}   // ← add
       onMoveToGroup={handleMoveToGroup}
     />
     ```

  3. **`<HostGroupSection>`** (around line 350): pass the handler as a prop (see HostGroupSection changes below):

     ```tsx
     <HostGroupSection
       ...existing props...
       onDeployKey={handleDeployKey}   // ← add
     />
     ```

### HostGroupSection.tsx

- [ ] **Step 3: Add `onDeployKey` to `HostGroupSection` Props and thread through**

  Update the `Props` interface (around line 40):

  ```ts
  interface Props {
    group: Group
    hosts: Host[]
    connectedHostIds: Set<string>
    connectingHostIds: Set<string>
    onConnect: (hostId: string, hostLabel: string) => void
    onDelete: (hostId: string) => void
    onEdit: (host: Host) => void
    onMoveToGroup: (hostId: string, groupId: string | null) => void
    onDeployKey: (host: Host) => void    // ← add
    onGroupDeleted?: () => void
  }
  ```

  Update the destructure (around line 52):

  ```ts
  export function HostGroupSection({
    group,
    hosts,
    connectedHostIds,
    connectingHostIds,
    onConnect,
    onDelete,
    onEdit,
    onMoveToGroup,
    onDeployKey,          // ← add
    onGroupDeleted,
  }: Props) {
  ```

  Find where `<HostListItem>` is rendered inside `HostGroupSection` (search for `<HostListItem` — it will be inside the expanded section) and add the prop:

  ```tsx
  onDeployKey={() => onDeployKey(host)}
  ```

- [ ] **Step 4: Verify build**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: build succeeds.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/sidebar/HostList.tsx \
          frontend/src/components/sidebar/HostGroupSection.tsx
  git commit -m "feat(keydeploy): wire onDeployKey through HostList and HostGroupSection"
  ```

---

## Task 9: Update `EditHostModal`

**Files:**
- Modify: `frontend/src/components/modals/EditHostModal.tsx`

- [ ] **Step 1: Add local state and import**

  Add `DeployKeyModal` import at the top of `EditHostModal.tsx` (after the `GenerateKeyModal` import, around line 38):

  ```ts
  import { DeployKeyModal } from './DeployKeyModal'
  ```

  Inside `EditHostModal()`, add local state (after `generateKeyOpen`, around line 87):

  ```ts
  const [deployKeyOpen, setDeployKeyOpen] = useState(false)
  ```

- [ ] **Step 2: Add Deploy button and modal to the key auth section**

  In the `form.authMethod === 'key'` block, find the button row that contains Browse and Generate (around line 379–414). Add a third button **after** the Generate button:

  ```tsx
  <Button
    type="button"
    variant="outline"
    onClick={() => setDeployKeyOpen(true)}
  >
    <Upload data-icon="inline-start" />
    Deploy…
  </Button>
  ```

  Add the `Upload` icon import to the lucide import line at the top:

  ```ts
  import { Info, FolderOpen, KeyRound, Loader2, Upload } from 'lucide-react'
  ```

  Place `<DeployKeyModal>` **after** the existing `<GenerateKeyModal>` (around line 424):

  ```tsx
  <DeployKeyModal
    open={deployKeyOpen}
    onClose={() => setDeployKeyOpen(false)}
    hostId={form.id}
    hostLabel={form.label}
  />
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/modals/EditHostModal.tsx
  git commit -m "feat(keydeploy): add Deploy Public Key button to EditHostModal"
  ```

---

## Task 10: Final verification

- [ ] **Step 1: Run all Go tests**

  ```bash
  go test ./...
  ```

  Expected: all pass.

- [ ] **Step 2: TypeScript build**

  ```bash
  cd frontend && pnpm build
  ```

  Expected: exits 0 with no errors.

- [ ] **Step 3: Lint**

  ```bash
  cd frontend && pnpm lint
  ```

  Expected: exits 0 with no errors.

- [ ] **Step 4: Format check**

  ```bash
  cd frontend && pnpm format:check
  ```

  Expected: exits 0. If it fails, run `pnpm format` and commit the diff:

  ```bash
  cd frontend && pnpm format
  git add frontend/src
  git commit -m "chore(ui): format deploy key modal files"
  ```

- [ ] **Step 5: Final commit message (if any outstanding changes)**

  ```bash
  git add -A
  git commit -m "feat(keydeploy): deploy public key to host (ssh-copy-id equivalent)

  Closes #4"
  ```
