# UI Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five visual bugs and one UX improvement: tooltip clipping, sidebar hover too dark, title bar redesign with sidebar toggle, drag handle overlap, and tabbed host add/edit modals.

**Architecture:** All changes are frontend-only React/TypeScript. No Go backend changes. Issues are ordered from smallest to largest blast radius. Tasks 3–5 are coupled (title bar redesign + resize handle cleanup) and must be done together. Task 6+ covers the modal tab split.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Jotai (state), shadcn/radix-ui, react-resizable-panels, Lucide icons

---

## File Map

| File | Action | Reason |
|------|--------|--------|
| `frontend/src/components/ui/tooltip.tsx` | Modify | Add `collisionPadding={8}` globally |
| `frontend/src/components/sidebar/HostListItem.tsx` | Modify | Fix hover color token |
| `frontend/src/store/atoms.ts` | Modify | Add `sidebarCollapsedAtom` |
| `frontend/src/components/layout/TitleBar.tsx` | Modify | Redesign with sidebar toggle + action buttons |
| `frontend/src/components/ui/resizable.tsx` | Modify | Remove `onToggle`/`isCollapsed` button |
| `frontend/src/App.tsx` | Modify | Wire `sidebarCollapsedAtom`, remove toggle props |
| `frontend/src/components/sidebar/AppHeader.tsx` | Delete | Dead code (not imported anywhere) |
| `frontend/src/components/ui/tabs.tsx` | Create | shadcn Tabs component (via CLI) |
| `frontend/src/components/modals/HostFormTabs.tsx` | Create | Shared tabbed form sections for host modals |
| `frontend/src/components/modals/AddHostModal.tsx` | Modify | Use `HostFormTabs`, remove inline field layout |
| `frontend/src/components/modals/EditHostModal.tsx` | Modify | Use `HostFormTabs`, remove inline field layout |

---

## Task 1: Fix Tooltip Collision Padding

**Files:**
- Modify: `frontend/src/components/ui/tooltip.tsx:27-49`

- [ ] **Step 1: Open tooltip.tsx and locate `TooltipContent`**

  In `TooltipContent`, the `TooltipPrimitive.Content` is rendered with `sideOffset={sideOffset}` but no `collisionPadding`. Radix defaults to `collisionPadding={0}`, letting tooltips render flush with the viewport edge.

- [ ] **Step 2: Add `collisionPadding={8}` to the inner Content**

  Change:
  ```tsx
  <TooltipPrimitive.Content
    data-slot="tooltip-content"
    sideOffset={sideOffset}
    className={cn(...)}
    {...props}
  >
  ```
  To:
  ```tsx
  <TooltipPrimitive.Content
    data-slot="tooltip-content"
    sideOffset={sideOffset}
    collisionPadding={8}
    className={cn(...)}
    {...props}
  >
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd frontend && pnpm build
  ```
  Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/ui/tooltip.tsx
  git commit -m "fix(ui): add collision padding to tooltips to prevent viewport clipping"
  ```

---

## Task 2: Fix Sidebar Hover Color

**Files:**
- Modify: `frontend/src/components/sidebar/HostListItem.tsx:88`

- [ ] **Step 1: Locate hover class in HostListItem.tsx**

  Line 88 in the outer `div` className:
  ```
  isConnected ? 'bg-sidebar-accent hover:bg-sidebar-accent/80' : 'hover:bg-accent/50'
  ```
  In dark mode, `--accent` is `oklch(0.2 0 0)` at 50% opacity over `--sidebar` (`oklch(0.13 0 0)`) — too visible, blends with selected state.

- [ ] **Step 2: Change `hover:bg-accent/50` to `hover:bg-sidebar-accent/30`**

  ```tsx
  isConnected ? 'bg-sidebar-accent hover:bg-sidebar-accent/80' : 'hover:bg-sidebar-accent/30'
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd frontend && pnpm build
  ```
  Expected: clean build.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/sidebar/HostListItem.tsx
  git commit -m "fix(sidebar): lighten host list hover background in dark mode"
  ```

---

## Task 3: Add sidebarCollapsedAtom

**Files:**
- Modify: `frontend/src/store/atoms.ts`

> Note: `isAddHostOpenAtom` and `isQuickConnectOpenAtom` already exist in this file — do not re-add them. Only `sidebarCollapsedAtom` is new.

- [ ] **Step 1: Add `sidebarCollapsedAtom` to atoms.ts**

  Open `frontend/src/store/atoms.ts`. At the end of the file (or near other boolean UI atoms like `isAddHostOpenAtom`), add:
  ```ts
  export const sidebarCollapsedAtom = atom<boolean>(false)
  ```

- [ ] **Step 2: Verify build**

  ```bash
  cd frontend && pnpm build
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/store/atoms.ts
  git commit -m "feat(store): add sidebarCollapsedAtom for title bar toggle"
  ```

---

## Task 4: Redesign TitleBar + Wire sidebarCollapsedAtom in App.tsx

**Files:**
- Modify: `frontend/src/components/layout/TitleBar.tsx`
- Modify: `frontend/src/App.tsx`

This task is the heart of the sidebar redesign. The title bar loses its logo and gains three action buttons. The sidebar collapse state moves into Jotai.

### 4a — Update App.tsx

- [ ] **Step 1: Replace local `sidebarCollapsed` state with the atom**

  In `App.tsx`, remove the `useState` for `sidebarCollapsed`:
  ```tsx
  // REMOVE:
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // ADD:
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  ```
  Add the import:
  ```tsx
  import { sidebarCollapsedAtom } from './store/atoms'
  ```

- [ ] **Step 2: Add a useEffect to sync atom → panel imperative calls**

  The `ResizablePanel`'s `onResize` callback already writes to the atom (via `setSidebarCollapsed`). We need the reverse: when the atom is set externally (by TitleBar), drive the panel.

  Add this after the atom declaration:
  ```tsx
  useEffect(() => {
    if (sidebarCollapsed) {
      sidebarRef.current?.collapse()
    } else {
      sidebarRef.current?.expand()
    }
  }, [sidebarCollapsed])
  ```

- [ ] **Step 3: Remove `onToggle` and `isCollapsed` props from `<ResizableHandle>`**

  Change:
  ```tsx
  <ResizableHandle
    withHandle
    onToggle={() => {
      if (sidebarCollapsed) sidebarRef.current?.expand()
      else sidebarRef.current?.collapse()
    }}
    isCollapsed={sidebarCollapsed}
  />
  ```
  To:
  ```tsx
  <ResizableHandle withHandle />
  ```

### 4b — Redesign TitleBar.tsx

- [ ] **Step 4: Replace TitleBar content with the new layout**

  The new TitleBar:
  - Removes the logo/name
  - Adds sidebar toggle (PanelLeftClose/PanelLeftOpen), New Host (+), Quick Connect (Zap) on the left side after any traffic-light spacer
  - Keeps Settings on the right
  - Keeps Windows min/max/close on the far right

  Full replacement for `TitleBar.tsx`:
  ```tsx
  import { useEffect, useState } from 'react'
  import { Minus, Square, X, Settings, PanelLeftClose, PanelLeftOpen, Plus, Zap } from 'lucide-react'
  import { useAtom, useSetAtom } from 'jotai'
  import {
    Environment,
    WindowMinimise,
    WindowToggleMaximise,
    Quit,
  } from '../../../wailsjs/runtime/runtime'
  import { cn } from '../../lib/utils'
  import { isSettingsOpenAtom, sidebarCollapsedAtom, isAddHostOpenAtom, isQuickConnectOpenAtom } from '../../store/atoms'
  import { Button } from '../ui/button'
  import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

  export function TitleBar() {
    const [isMac, setIsMac] = useState(false)
    const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
    const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
    const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)
    const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)

    useEffect(() => {
      Environment().then((env) => setIsMac(env.platform === 'darwin'))
    }, [])

    return (
      <div
        className="bg-sidebar border-border flex h-9 shrink-0 items-center border-b select-none"
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        onDoubleClick={WindowToggleMaximise}
      >
        {isMac && (
          <div
            className="h-full w-[88px] shrink-0"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          />
        )}

        {/* Left action buttons */}
        <div
          className={cn('flex items-center', !isMac && 'pl-1')}
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              >
                {sidebarCollapsed
                  ? <PanelLeftOpen className="size-4" />
                  : <PanelLeftClose className="size-4" />
                }
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => setIsAddHostOpen(true)}
                aria-label="New host"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New Host</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => setIsQuickConnectOpen(true)}
                aria-label="Quick connect"
              >
                <Zap className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Quick Connect</TooltipContent>
          </Tooltip>
        </div>

        {/* Drag region filler */}
        <div className="flex-1" />

        {/* Settings */}
        <div
          className="flex items-center"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9 rounded-none"
                onClick={() => setIsSettingsOpen(true)}
                aria-label="Settings"
              >
                <Settings className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Settings</TooltipContent>
          </Tooltip>
        </div>

        {!isMac && (
          <div
            className="flex items-center"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={WindowMinimise}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-11 items-center justify-center transition-colors"
              aria-label="Minimise"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              onClick={WindowToggleMaximise}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-11 items-center justify-center transition-colors"
              aria-label="Maximise"
            >
              <Square className="size-3" />
            </button>
            <button
              onClick={Quit}
              className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex h-9 w-11 items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 5: Verify build**

  ```bash
  cd frontend && pnpm build
  ```
  Expected: clean build, no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/App.tsx frontend/src/components/layout/TitleBar.tsx
  git commit -m "feat(ui): move sidebar toggle to title bar with new host and quick connect buttons"
  ```

---

## Task 5: Remove Toggle from ResizableHandle + Delete AppHeader

**Files:**
- Modify: `frontend/src/components/ui/resizable.tsx`
- Delete: `frontend/src/components/sidebar/AppHeader.tsx`

- [ ] **Step 1: Strip `onToggle`/`isCollapsed` from `ResizableHandle`**

  In `resizable.tsx`, the `ResizableHandle` function currently accepts `onToggle` and `isCollapsed` props and renders a circular toggle button. Remove these entirely.

  Replace the full `ResizableHandle` function with:
  ```tsx
  function ResizableHandle({
    withHandle,
    className,
    ...props
  }: ResizablePrimitive.SeparatorProps & {
    withHandle?: boolean
  }) {
    return (
      <ResizablePrimitive.Separator
        data-slot="resizable-handle"
        className={cn(
          'bg-border group relative flex w-px items-center justify-center outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-indigo-500/40 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 data-[separator=active]:bg-indigo-500 [&[aria-orientation=horizontal]>div]:rotate-90',
          className
        )}
        {...props}
      >
        {withHandle && (
          <div className="bg-border z-10 flex h-6 w-1 shrink-0 rounded-lg group-hover:bg-indigo-500/40 group-data-[separator=active]:bg-indigo-500" />
        )}
      </ResizablePrimitive.Separator>
    )
  }
  ```

- [ ] **Step 2: Delete AppHeader.tsx**

  `AppHeader.tsx` renders a duplicate logo (Terminal icon + "shsh" text). It is not imported anywhere in the codebase. Delete it:
  ```bash
  rm frontend/src/components/sidebar/AppHeader.tsx
  ```

- [ ] **Step 3: Verify build and lint**

  ```bash
  cd frontend && pnpm build && pnpm lint
  ```
  Expected: clean. If lint flags an unused import anywhere related to AppHeader, remove it.

- [ ] **Step 4: Commit**

  ```bash
  git add -A
  git commit -m "fix(ui): remove toggle button from resize handle, delete dead AppHeader component"
  ```

---

## Task 6: Install shadcn Tabs Component

**Files:**
- Create: `frontend/src/components/ui/tabs.tsx` (generated by CLI)

- [ ] **Step 1: Add the Tabs component via shadcn CLI**

  ```bash
  cd frontend && npx shadcn@latest add tabs
  ```
  When prompted about overwriting existing files, answer no (there are none). This creates `frontend/src/components/ui/tabs.tsx`.

- [ ] **Step 2: Verify the file exists and build passes**

  ```bash
  cd frontend && pnpm build
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/ui/tabs.tsx
  git commit -m "chore(ui): add shadcn Tabs component"
  ```

---

## Task 7: Create Shared HostFormTabs Component

**Files:**
- Create: `frontend/src/components/modals/HostFormTabs.tsx`

This component renders the three-tab layout used by both `AddHostModal` and `EditHostModal`. It accepts all form field values and callbacks as props. The form type is `CreateHostInput & { id?: string }` — this covers both create and update since `UpdateHostInput` is identical except for the required `id` field.

- [ ] **Step 1: Create `HostFormTabs.tsx`**

  ```tsx
  import { FolderOpen, Info, KeyRound, Loader2, Upload } from 'lucide-react'
  import type { CredentialSource, Group, Host, PasswordManagersStatus, TerminalProfile } from '../../types'
  import type { CreateHostInput } from '../../types'
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
  import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field'
  import { Input } from '../ui/input'
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
  import { Button } from '../ui/button'
  import { TagInput } from '../ui/tag-input'
  import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
  import { PMStatusBadge } from '../ui/pm-status-badge'
  import { HOST_COLOR_PALETTE } from '../../lib/hostColors'
  import { cn } from '../../lib/utils'

  // Covers both CreateHostInput and UpdateHostInput (id is optional — only present in edit mode)
  export type HostFormData = CreateHostInput & { id?: string }

  export interface HostFormTabsProps {
    form: HostFormData
    setForm: React.Dispatch<React.SetStateAction<HostFormData>>
    errors: { label?: string; hostname?: string; username?: string }
    hosts: Host[]
    groups: Group[]
    profiles: TerminalProfile[]
    activeTab: string
    onTabChange: (tab: string) => void
    pmStatus: PasswordManagersStatus | null
    testing: boolean
    browsingKey: boolean
    onTestCredential: () => void
    onBrowseKeyFile: () => void
    onOpenGenerateKeyModal: () => void
    onOpenDeployKeyModal?: () => void   // only provided in edit mode
    onOpenProfilesModal: () => void
    onCheckPasswordManagers: () => void
  }

  function FieldHint({ children }: { children: React.ReactNode }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="text-muted-foreground/60 size-3 shrink-0 cursor-help" />
        </TooltipTrigger>
        <TooltipContent className="max-w-56">{children}</TooltipContent>
      </Tooltip>
    )
  }

  export function HostFormTabs({
    form,
    setForm,
    errors,
    hosts,
    groups,
    profiles,
    activeTab,
    onTabChange,
    pmStatus,
    testing,
    browsingKey,
    onTestCredential,
    onBrowseKeyFile,
    onOpenGenerateKeyModal,
    onOpenDeployKeyModal,
    onOpenProfilesModal,
    onCheckPasswordManagers,
  }: HostFormTabsProps) {
    const credSrc = form.credentialSource ?? 'inline'

    function field(name: keyof HostFormData) {
      return (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [name]: e.target.value }))
    }

    // Hosts eligible as jump hosts: exclude self (if editing)
    const jumpHostOptions = form.id ? hosts.filter((h) => h.id !== form.id) : hosts

    return (
      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="connection" className="flex-1">Connection</TabsTrigger>
          <TabsTrigger value="organization" className="flex-1">Organization</TabsTrigger>
          <TabsTrigger value="advanced" className="flex-1">Advanced</TabsTrigger>
        </TabsList>

        {/* ── Connection tab ── */}
        <TabsContent value="connection">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hf-label">Label</FieldLabel>
              <Input
                id="hf-label"
                placeholder="My Server"
                value={form.label}
                onChange={field('label')}
              />
              {errors.label && <FieldError>{errors.label}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="hf-hostname">
                  Hostname
                  <FieldHint>IP address or domain name — e.g. 192.168.1.10 or myserver.example.com</FieldHint>
                </FieldLabel>
                <Input
                  id="hf-hostname"
                  placeholder="192.168.1.1"
                  value={form.hostname}
                  onChange={field('hostname')}
                />
                {errors.hostname && <FieldError>{errors.hostname}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="hf-port">
                  Port
                  <FieldHint>SSH normally runs on port 22.</FieldHint>
                </FieldLabel>
                <Input
                  id="hf-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={field('port')}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="hf-username">
                Username
                <FieldHint>The account to log in as — e.g. ubuntu, ec2-user, or root</FieldHint>
              </FieldLabel>
              <Input
                id="hf-username"
                placeholder="root"
                value={form.username}
                onChange={field('username')}
              />
              {errors.username && <FieldError>{errors.username}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="hf-auth-method">Auth Method</FieldLabel>
              <Select
                value={form.authMethod}
                onValueChange={(val) =>
                  setForm((f) => ({
                    ...f,
                    authMethod: val as typeof f.authMethod,
                    password: '',
                    keyPath: undefined,
                    keyPassphrase: '',
                    credentialSource: 'inline',
                    credentialRef: '',
                  }))
                }
              >
                <SelectTrigger id="hf-auth-method" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="key">SSH Key</SelectItem>
                  <SelectItem value="agent">SSH Agent</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {form.authMethod === 'password' && (
              <>
                <Field>
                  <FieldLabel htmlFor="hf-cred-source">
                    Credential Source
                    <FieldHint>
                      Where to fetch the password at connect time. Use a password manager to avoid
                      storing credentials in shsh.
                    </FieldHint>
                  </FieldLabel>
                  <Select
                    value={credSrc}
                    onValueChange={(val) => {
                      setForm((f) => ({
                        ...f,
                        credentialSource: val as CredentialSource,
                        password: '',
                        credentialRef: val === 'inline' ? '' : f.credentialRef,
                      }))
                      if (val !== 'inline') onCheckPasswordManagers()
                    }}
                  >
                    <SelectTrigger id="hf-cred-source" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inline">Inline (macOS Keychain)</SelectItem>
                      <SelectItem value="1password">1Password</SelectItem>
                      <SelectItem value="bitwarden">Bitwarden</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {credSrc === 'inline' && (
                  <Field>
                    <FieldLabel htmlFor="hf-password">
                      Password
                      <FieldHint>Stored securely in macOS Keychain, never in plain text.</FieldHint>
                    </FieldLabel>
                    <Input
                      id="hf-password"
                      type="password"
                      placeholder={form.id ? 'Leave blank to keep unchanged' : 'Leave blank if not required'}
                      value={form.password ?? ''}
                      onChange={field('password')}
                    />
                  </Field>
                )}

                {(credSrc === '1password' || credSrc === 'bitwarden') && (
                  <Field>
                    <FieldLabel htmlFor="hf-cred-ref">
                      {credSrc === '1password' ? '1Password Reference' : 'Bitwarden Item'}
                      <FieldHint>
                        {credSrc === '1password'
                          ? 'An op:// URI (e.g. op://vault/item/password), item UUID, or item name'
                          : 'The Bitwarden item name or UUID'}
                      </FieldHint>
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="hf-cred-ref"
                        placeholder={
                          credSrc === '1password' ? 'op://Personal/MyServer/password' : 'MyServer'
                        }
                        value={form.credentialRef ?? ''}
                        onChange={field('credentialRef')}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={testing || !form.credentialRef}
                        onClick={onTestCredential}
                      >
                        {testing && <Loader2 data-icon="inline-start" className="animate-spin" />}
                        Test
                      </Button>
                    </div>
                    <FieldDescription>
                      <PMStatusBadge status={pmStatus} source={credSrc} />
                    </FieldDescription>
                  </Field>
                )}
              </>
            )}

            {form.authMethod === 'key' && (
              <>
                <Field>
                  <FieldLabel htmlFor="hf-key-path">
                    Private Key File
                    <FieldHint>Path to your private key, e.g. ~/.ssh/id_ed25519</FieldHint>
                  </FieldLabel>
                  <div className="flex flex-col gap-2">
                    <Input
                      id="hf-key-path"
                      placeholder="~/.ssh/id_ed25519"
                      value={form.keyPath ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, keyPath: e.target.value || undefined }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={browsingKey}
                        onClick={onBrowseKeyFile}
                      >
                        <FolderOpen data-icon="inline-start" />
                        Browse
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenGenerateKeyModal}
                      >
                        <KeyRound data-icon="inline-start" />
                        Generate…
                      </Button>
                      {onOpenDeployKeyModal && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={onOpenDeployKeyModal}
                        >
                          <Upload data-icon="inline-start" />
                          Deploy…
                        </Button>
                      )}
                    </div>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="hf-passphrase">
                    Passphrase
                    <FieldHint>
                      {form.id
                        ? 'Leave blank to keep unchanged, or enter a new passphrase.'
                        : 'Only required if your key file is encrypted.'}
                    </FieldHint>
                  </FieldLabel>
                  <Input
                    id="hf-passphrase"
                    type="password"
                    placeholder={form.id ? 'Leave blank to keep unchanged' : 'Leave blank if key has no passphrase'}
                    value={form.keyPassphrase ?? ''}
                    onChange={field('keyPassphrase')}
                  />
                </Field>
              </>
            )}

            {form.authMethod === 'agent' && (
              <p className="text-muted-foreground text-xs">
                Will authenticate using your running SSH agent (e.g. ssh-agent or 1Password).
              </p>
            )}
          </FieldGroup>
        </TabsContent>

        {/* ── Organization tab ── */}
        <TabsContent value="organization">
          <FieldGroup>
            {groups.length > 0 && (
              <Field>
                <FieldLabel htmlFor="hf-group">Group</FieldLabel>
                <Select
                  value={form.groupId ?? '__none__'}
                  onValueChange={(val) =>
                    setForm((f) => ({ ...f, groupId: val === '__none__' ? undefined : val }))
                  }
                >
                  <SelectTrigger id="hf-group" className="h-9">
                    <SelectValue placeholder="No Group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No Group</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field>
              <FieldLabel>Color</FieldLabel>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn(
                    'bg-muted size-6 rounded-full border-2',
                    !form.color && 'ring-ring ring-2 ring-offset-1'
                  )}
                  onClick={() => setForm((f) => ({ ...f, color: undefined }))}
                />
                {HOST_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    style={{ background: c }}
                    className={cn(
                      'size-6 rounded-full',
                      form.color === c && 'ring-ring ring-2 ring-offset-1'
                    )}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </Field>

            <Field>
              <FieldLabel>Tags</FieldLabel>
              <TagInput
                tags={form.tags ?? []}
                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
              />
            </Field>
          </FieldGroup>
        </TabsContent>

        {/* ── Advanced tab ── */}
        <TabsContent value="advanced">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hf-profile">Terminal Profile</FieldLabel>
              <Select
                value={form.terminalProfileId ?? '__none__'}
                onValueChange={(val) => {
                  if (val === '__manage__') {
                    onOpenProfilesModal()
                    return
                  }
                  setForm((f) => ({
                    ...f,
                    terminalProfileId: val === '__none__' ? undefined : val,
                  }))
                }}
              >
                <SelectTrigger id="hf-profile" className="h-9">
                  <SelectValue placeholder="None (use defaults)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (use defaults)</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__manage__">Manage profiles…</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {jumpHostOptions.length > 0 && (
              <Field>
                <FieldLabel htmlFor="hf-jump-host">
                  Jump Host
                  <FieldHint>
                    Connect through this saved host first (ProxyJump / bastion server).
                  </FieldHint>
                </FieldLabel>
                <Select
                  value={form.jumpHostId ?? '__none__'}
                  onValueChange={(val) =>
                    setForm((f) => ({
                      ...f,
                      jumpHostId: val === '__none__' ? undefined : val,
                    }))
                  }
                >
                  <SelectTrigger id="hf-jump-host" className="h-9">
                    <SelectValue placeholder="None (direct connection)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (direct connection)</SelectItem>
                    {jumpHostOptions.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.label} ({h.hostname})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </FieldGroup>
        </TabsContent>
      </Tabs>
    )
  }
  ```

- [ ] **Step 2: Verify build**

  ```bash
  cd frontend && pnpm build
  ```
  Expected: clean build. Fix any TypeScript errors before proceeding.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/modals/HostFormTabs.tsx
  git commit -m "feat(modals): add shared HostFormTabs component with connection/organization/advanced tabs"
  ```

---

## Task 8: Update AddHostModal to Use HostFormTabs

**Files:**
- Modify: `frontend/src/components/modals/AddHostModal.tsx`

- [ ] **Step 1: Replace the inline field layout with HostFormTabs**

  The modal needs to:
  1. Add `activeTab` state (default `'connection'`)
  2. Switch to the first tab with errors on failed submit
  3. Wire `GenerateKeyModal` outside of `HostFormTabs` (sub-modal stays in parent)
  4. Remove all inline field JSX; replace with `<HostFormTabs .../>`

  Full replacement for `AddHostModal.tsx`:
  ```tsx
  import { useState, useEffect } from 'react'
  import { toast } from 'sonner'
  import { Loader2 } from 'lucide-react'
  import { useAtom, useAtomValue, useSetAtom } from 'jotai'
  import {
    isAddHostOpenAtom,
    hostsAtom,
    groupsAtom,
    terminalProfilesAtom,
    isTerminalProfilesOpenAtom,
  } from '../../store/atoms'
  import type { Host } from '../../types'
  import { AddHost, BrowseKeyFile, CheckPasswordManagers, TestCredentialRef } from '../../../wailsjs/go/main/App'
  import {
    Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  } from '../ui/dialog'
  import { Button } from '../ui/button'
  import { GenerateKeyModal } from './GenerateKeyModal'
  import { HostFormTabs, type HostFormData } from './HostFormTabs'
  import type { PasswordManagersStatus } from '../../types'

  const defaultForm: HostFormData = {
    label: '',
    hostname: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
    jumpHostId: undefined,
    credentialSource: 'inline',
  }

  interface FormErrors {
    label?: string
    hostname?: string
    username?: string
  }

  export function AddHostModal() {
    const [isAddHostOpen, setIsAddHostOpen] = useAtom(isAddHostOpenAtom)
    const setHosts = useSetAtom(hostsAtom)
    const hosts = useAtomValue(hostsAtom)
    const groups = useAtomValue(groupsAtom)
    const profiles = useAtomValue(terminalProfilesAtom)
    const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
    const [form, setForm] = useState<HostFormData>(defaultForm)
    const [errors, setErrors] = useState<FormErrors>({})
    const [submitting, setSubmitting] = useState(false)
    const [browsingKey, setBrowsingKey] = useState(false)
    const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
    const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
    const [testing, setTesting] = useState(false)
    const [activeTab, setActiveTab] = useState('connection')

    useEffect(() => {
      const credSrc = form.credentialSource ?? 'inline'
      if (credSrc === 'inline') { setPmStatus(null); return }
      if (isAddHostOpen && form.authMethod === 'password') {
        CheckPasswordManagers().then(setPmStatus).catch(() => {})
      }
    }, [isAddHostOpen, form.authMethod, form.credentialSource])

    function close() {
      setIsAddHostOpen(false)
      setForm(defaultForm)
      setErrors({})
      setPmStatus(null)
      setActiveTab('connection')
    }

    function validate(): FormErrors {
      const e: FormErrors = {}
      if (!form.label.trim()) e.label = 'Label is required'
      if (!form.hostname.trim()) e.hostname = 'Hostname is required'
      if (!form.username.trim()) e.username = 'Username is required'
      return e
    }

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      const errs = validate()
      if (Object.keys(errs).length > 0) {
        setErrors(errs)
        // All required fields are on the Connection tab — switch to it
        setActiveTab('connection')
        return
      }
      setSubmitting(true)
      try {
        const host = await AddHost({ ...form, port: Number(form.port) || 22 })
        setHosts((prev) => [...prev, host as unknown as Host])
        close()
      } catch (err) {
        toast.error('Failed to save host', { description: String(err) })
      } finally {
        setSubmitting(false)
      }
    }

    async function handleTestCredential() {
      setTesting(true)
      try {
        await TestCredentialRef(form.credentialSource ?? 'inline', form.credentialRef ?? '')
        toast.success('Credential fetched successfully')
      } catch (err) {
        toast.error('Credential test failed', { description: String(err) })
      } finally {
        setTesting(false)
      }
    }

    async function handleBrowseKeyFile() {
      setBrowsingKey(true)
      try {
        const path = await BrowseKeyFile()
        if (path) setForm((f) => ({ ...f, keyPath: path }))
      } catch { /* user cancelled */ }
      finally { setBrowsingKey(false) }
    }

    return (
      <Dialog open={isAddHostOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add SSH Host</DialogTitle>
            <DialogDescription>
              Save a host you frequently connect to for easy access later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="ah-form" onSubmit={handleSubmit}>
              <HostFormTabs
                form={form}
                setForm={setForm}
                errors={errors}
                hosts={hosts}
                groups={groups}
                profiles={profiles}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                pmStatus={pmStatus}
                testing={testing}
                browsingKey={browsingKey}
                onTestCredential={handleTestCredential}
                onBrowseKeyFile={handleBrowseKeyFile}
                onOpenGenerateKeyModal={() => setGenerateKeyOpen(true)}
                onOpenProfilesModal={() => setProfilesOpen(true)}
                onCheckPasswordManagers={() =>
                  CheckPasswordManagers().then(setPmStatus).catch(() => {})
                }
              />
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="ah-form" disabled={submitting}>
              {submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {submitting ? 'Adding…' : 'Add Host'}
            </Button>
          </DialogFooter>
        </DialogContent>
        <GenerateKeyModal
          open={generateKeyOpen}
          onClose={() => setGenerateKeyOpen(false)}
          onGenerated={(path) => {
            setForm((f) => ({ ...f, keyPath: path }))
            setGenerateKeyOpen(false)
          }}
        />
      </Dialog>
    )
  }
  ```

- [ ] **Step 2: Verify build**

  ```bash
  cd frontend && pnpm build
  ```
  Fix any TypeScript errors before proceeding.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/modals/AddHostModal.tsx
  git commit -m "refactor(modals): migrate AddHostModal to tabbed layout"
  ```

---

## Task 9: Update EditHostModal to Use HostFormTabs

**Files:**
- Modify: `frontend/src/components/modals/EditHostModal.tsx`

- [ ] **Step 1: Replace the inline field layout with HostFormTabs**

  Edit modal differences vs Add modal:
  - `form.id` is always set (used by `HostFormTabs` to filter self from jump host list and show "Deploy…" button)
  - Has an inline `DeployKeyModal` sub-modal
  - Initial form populated from `editingHost` atom
  - Submit calls `UpdateHost` not `AddHost`

  Full replacement for `EditHostModal.tsx`:
  ```tsx
  import { useEffect, useState } from 'react'
  import { toast } from 'sonner'
  import { Loader2 } from 'lucide-react'
  import { useAtom, useAtomValue, useSetAtom } from 'jotai'
  import {
    isEditHostOpenAtom, editingHostAtom, hostsAtom, groupsAtom,
    terminalProfilesAtom, isTerminalProfilesOpenAtom,
  } from '../../store/atoms'
  import type { Host } from '../../types'
  import { UpdateHost, BrowseKeyFile, CheckPasswordManagers, TestCredentialRef } from '../../../wailsjs/go/main/App'
  import {
    Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  } from '../ui/dialog'
  import { Button } from '../ui/button'
  import { GenerateKeyModal } from './GenerateKeyModal'
  import { DeployKeyModal } from './DeployKeyModal'
  import { HostFormTabs, type HostFormData } from './HostFormTabs'
  import type { PasswordManagersStatus } from '../../types'

  interface FormErrors {
    label?: string
    hostname?: string
    username?: string
  }

  export function EditHostModal() {
    const [isOpen, setIsOpen] = useAtom(isEditHostOpenAtom)
    const editingHost = useAtomValue(editingHostAtom)
    const setHosts = useSetAtom(hostsAtom)
    const hosts = useAtomValue(hostsAtom)
    const groups = useAtomValue(groupsAtom)
    const profiles = useAtomValue(terminalProfilesAtom)
    const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)
    const [form, setForm] = useState<HostFormData>({
      id: '', label: '', hostname: '', port: 22, username: '',
      authMethod: 'password', password: '', credentialSource: 'inline',
    })
    const [errors, setErrors] = useState<FormErrors>({})
    const [submitting, setSubmitting] = useState(false)
    const [browsingKey, setBrowsingKey] = useState(false)
    const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
    const [deployKeyOpen, setDeployKeyOpen] = useState(false)
    const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
    const [testing, setTesting] = useState(false)
    const [activeTab, setActiveTab] = useState('connection')

    useEffect(() => {
      if (editingHost) {
        setForm({
          id: editingHost.id,
          label: editingHost.label,
          hostname: editingHost.hostname,
          port: editingHost.port,
          username: editingHost.username,
          authMethod: editingHost.authMethod,
          password: '',
          keyPath: editingHost.keyPath,
          keyPassphrase: '',
          groupId: editingHost.groupId,
          color: editingHost.color,
          tags: editingHost.tags,
          terminalProfileId: editingHost.terminalProfileId,
          jumpHostId: editingHost.jumpHostId,
          credentialSource: editingHost.credentialSource ?? 'inline',
          credentialRef: editingHost.credentialRef ?? '',
        })
        setErrors({})
        setPmStatus(null)
        setActiveTab('connection')
      }
    }, [editingHost])

    useEffect(() => {
      const credSrc = form.credentialSource ?? 'inline'
      if (credSrc === 'inline') { setPmStatus(null); return }
      if (isOpen && form.authMethod === 'password') {
        CheckPasswordManagers().then(setPmStatus).catch(() => {})
      }
    }, [isOpen, form.authMethod, form.credentialSource])

    function close() {
      setIsOpen(false)
      setErrors({})
    }

    function validate(): FormErrors {
      const e: FormErrors = {}
      if (!form.label.trim()) e.label = 'Label is required'
      if (!form.hostname.trim()) e.hostname = 'Hostname is required'
      if (!form.username.trim()) e.username = 'Username is required'
      return e
    }

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      const errs = validate()
      if (Object.keys(errs).length > 0) {
        setErrors(errs)
        setActiveTab('connection')
        return
      }
      setSubmitting(true)
      try {
        const updated = await UpdateHost({ ...form, id: form.id!, port: Number(form.port) || 22 })
        setHosts((prev) => prev.map((h) => (h.id === updated.id ? (updated as unknown as Host) : h)))
        close()
      } catch (err) {
        toast.error('Failed to update host', { description: String(err) })
      } finally {
        setSubmitting(false)
      }
    }

    async function handleTestCredential() {
      setTesting(true)
      try {
        await TestCredentialRef(form.credentialSource ?? 'inline', form.credentialRef ?? '')
        toast.success('Credential fetched successfully')
      } catch (err) {
        toast.error('Credential test failed', { description: String(err) })
      } finally {
        setTesting(false)
      }
    }

    async function handleBrowseKeyFile() {
      setBrowsingKey(true)
      try {
        const path = await BrowseKeyFile()
        if (path) setForm((f) => ({ ...f, keyPath: path }))
      } catch { /* user cancelled */ }
      finally { setBrowsingKey(false) }
    }

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit SSH Host</DialogTitle>
            <DialogDescription>Update the details of your SSH host.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="eh-form" onSubmit={handleSubmit}>
              <HostFormTabs
                form={form}
                setForm={setForm}
                errors={errors}
                hosts={hosts}
                groups={groups}
                profiles={profiles}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                pmStatus={pmStatus}
                testing={testing}
                browsingKey={browsingKey}
                onTestCredential={handleTestCredential}
                onBrowseKeyFile={handleBrowseKeyFile}
                onOpenGenerateKeyModal={() => setGenerateKeyOpen(true)}
                onOpenDeployKeyModal={() => setDeployKeyOpen(true)}
                onOpenProfilesModal={() => setProfilesOpen(true)}
                onCheckPasswordManagers={() =>
                  CheckPasswordManagers().then(setPmStatus).catch(() => {})
                }
              />
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="eh-form" disabled={submitting}>
              {submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {submitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
        <GenerateKeyModal
          open={generateKeyOpen}
          onClose={() => setGenerateKeyOpen(false)}
          onGenerated={(path) => {
            setForm((f) => ({ ...f, keyPath: path }))
            setGenerateKeyOpen(false)
          }}
        />
        <DeployKeyModal
          open={deployKeyOpen}
          onClose={() => setDeployKeyOpen(false)}
          hostId={form.id ?? ''}
          hostLabel={form.label}
        />
      </Dialog>
    )
  }
  ```

- [ ] **Step 2: Verify full build and lint**

  ```bash
  cd frontend && pnpm build && pnpm lint && pnpm format:check
  ```
  Expected: all pass. Fix any issues.

- [ ] **Step 3: Final Go tests**

  ```bash
  go test ./...
  ```
  Expected: pass (no Go changes were made, but confirm nothing is broken).

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/modals/EditHostModal.tsx
  git commit -m "refactor(modals): migrate EditHostModal to tabbed layout

  Closes #<issue>"
  ```

  > Note: Replace `<issue>` with the GitHub issue number for this bugfix branch if one exists.
