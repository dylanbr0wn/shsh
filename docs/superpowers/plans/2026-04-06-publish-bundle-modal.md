# Publish Bundle Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI for publishing local host bundles to a connected registry, triggered from host/group context menus and the command palette.

**Architecture:** A new `PublishBundleModal` component with a stacked form (registry/namespace/name/tag fields) above a grouped host checkbox picker. Entry points added to `HostListItem` and `HostGroupSection` context menus, plus the command palette. State managed via a Jotai atom that carries pre-selected host IDs.

**Tech Stack:** React, Jotai, shadcn/ui components (Dialog, Select, Input, Checkbox, Badge), Wails bindings (`PushBundle`, `GetRegistries`)

---

### Task 1: Add the `publishBundleAtom` to the store

**Files:**
- Modify: `frontend/src/store/atoms.ts`

- [ ] **Step 1: Add the atom**

At the end of `frontend/src/store/atoms.ts`, add:

```ts
export const publishBundleAtom = atom<{ open: boolean; preSelectedHostIds: string[] }>({
  open: false,
  preSelectedHostIds: [],
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/store/atoms.ts
git commit -m "feat: add publishBundleAtom to store"
```

---

### Task 2: Create the `PublishBundleModal` component

**Files:**
- Create: `frontend/src/components/modals/PublishBundleModal.tsx`

- [ ] **Step 1: Create the modal file**

Create `frontend/src/components/modals/PublishBundleModal.tsx` with the full implementation:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue } from 'jotai'
import { publishBundleAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import type { Host, RegistryStatus } from '../../types'
import { PushBundle } from '@wailsjs/go/main/RegistryFacade'
import { GetRegistries } from '@wailsjs/go/main/RegistryFacade'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { FieldGroup, Field, FieldLabel, FieldSeparator } from '../ui/field'

export function PublishBundleModal() {
  const [state, setState] = useAtom(publishBundleAtom)
  const allHosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  // Only show local hosts (not imported from registries)
  const hosts = useMemo(() => allHosts.filter((h) => h.origin === 'local'), [allHosts])

  const [registries, setRegistries] = useState<RegistryStatus[]>([])
  const [registryName, setRegistryName] = useState('')
  const [namespace, setNamespace] = useState('')
  const [bundleName, setBundleName] = useState('')
  const [tag, setTag] = useState('')
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)

  // Load registries and seed selection when modal opens
  useEffect(() => {
    if (!state.open) return
    GetRegistries()
      .then((regs) => setRegistries(regs ?? []))
      .catch(() => setRegistries([]))
    setSelectedHostIds(new Set(state.preSelectedHostIds))
  }, [state.open, state.preSelectedHostIds])

  function close() {
    setState({ open: false, preSelectedHostIds: [] })
    setRegistryName('')
    setNamespace('')
    setBundleName('')
    setTag('')
    setSelectedHostIds(new Set())
    setRegistries([])
  }

  // Group hosts by their groupId for the picker
  const localGroups = useMemo(() => {
    return groups.filter((g) => g.origin === 'local')
  }, [groups])

  const hostsByGroup = useMemo(() => {
    const map = new Map<string | null, Host[]>()
    for (const host of hosts) {
      const key = host.groupId ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(host)
    }
    return map
  }, [hosts])

  function toggleHost(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(groupId: string | null) {
    const groupHosts = hostsByGroup.get(groupId) ?? []
    const allSelected = groupHosts.every((h) => selectedHostIds.has(h.id))
    setSelectedHostIds((prev) => {
      const next = new Set(prev)
      for (const h of groupHosts) {
        if (allSelected) next.delete(h.id)
        else next.add(h.id)
      }
      return next
    })
  }

  function toggleAll() {
    if (selectedHostIds.size === hosts.length) {
      setSelectedHostIds(new Set())
    } else {
      setSelectedHostIds(new Set(hosts.map((h) => h.id)))
    }
  }

  function groupCheckState(groupId: string | null): boolean | 'indeterminate' {
    const groupHosts = hostsByGroup.get(groupId) ?? []
    if (groupHosts.length === 0) return false
    const count = groupHosts.filter((h) => selectedHostIds.has(h.id)).length
    if (count === 0) return false
    if (count === groupHosts.length) return true
    return 'indeterminate'
  }

  const allSelected = hosts.length > 0 && selectedHostIds.size === hosts.length
  const someSelected = selectedHostIds.size > 0 && !allSelected

  const canPublish =
    registryName && namespace.trim() && bundleName.trim() && tag.trim() && selectedHostIds.size > 0

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true)
    try {
      await PushBundle({
        registryName,
        namespace: namespace.trim(),
        name: bundleName.trim(),
        tag: tag.trim(),
        hostIds: Array.from(selectedHostIds),
      })
      toast.success(
        `Published ${selectedHostIds.size} host${selectedHostIds.size === 1 ? '' : 's'} to ${namespace.trim()}/${bundleName.trim()}`
      )
      close()
    } catch (err) {
      toast.error('Failed to publish', { description: String(err) })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish to Registry</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Registry</FieldLabel>
                <Select value={registryName} onValueChange={setRegistryName}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select registry…" />
                  </SelectTrigger>
                  <SelectContent>
                    {registries.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Namespace</FieldLabel>
                <Input
                  placeholder="e.g. infra"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Bundle Name</FieldLabel>
                <Input
                  placeholder="e.g. prod-servers"
                  value={bundleName}
                  onChange={(e) => setBundleName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Tag</FieldLabel>
                <Input
                  placeholder="e.g. v1"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>

          <FieldSeparator />

          <FieldGroup>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Select Hosts</FieldLabel>
                <span className="text-muted-foreground text-xs">
                  {selectedHostIds.size} of {hosts.length} selected
                </span>
              </div>
              <div className="border-foreground/15 overflow-hidden rounded-md border">
                {/* Header with select all */}
                <div className="border-foreground/15 flex items-center gap-2 border-b px-3 py-2">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                  <span className="text-muted-foreground text-xs font-medium">Select all</span>
                </div>
                {/* Scrollable host list */}
                <div className="h-56 overflow-y-auto">
                  {hosts.length === 0 ? (
                    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                      No local hosts
                    </div>
                  ) : (
                    <>
                      {localGroups.map((group) => {
                        const groupHosts = hostsByGroup.get(group.id) ?? []
                        if (groupHosts.length === 0) return null
                        return (
                          <div key={group.id}>
                            <div
                              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5"
                              onClick={() => toggleGroup(group.id)}
                            >
                              <Checkbox
                                checked={groupCheckState(group.id)}
                                onCheckedChange={() => toggleGroup(group.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select all in ${group.name}`}
                              />
                              <span className="text-xs font-semibold">{group.name}</span>
                              <span className="text-muted-foreground text-xs">
                                {groupHosts.length}
                              </span>
                            </div>
                            {groupHosts.map((host) => (
                              <div
                                key={host.id}
                                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 py-1.5 pr-3 pl-8"
                                onClick={() => toggleHost(host.id)}
                              >
                                <Checkbox
                                  checked={selectedHostIds.has(host.id)}
                                  onCheckedChange={() => toggleHost(host.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select ${host.label}`}
                                />
                                <span className="flex-1 truncate text-xs">{host.label}</span>
                                <span className="text-muted-foreground truncate font-mono text-xs">
                                  {host.hostname}:{host.port}
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                      {/* Ungrouped hosts */}
                      {hostsByGroup.get(null) && hostsByGroup.get(null)!.length > 0 && (
                        <div>
                          {localGroups.length > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <Checkbox
                                checked={groupCheckState(null)}
                                onCheckedChange={() => {
                                  const ungrouped = hostsByGroup.get(null) ?? []
                                  const allSel = ungrouped.every((h) => selectedHostIds.has(h.id))
                                  setSelectedHostIds((prev) => {
                                    const next = new Set(prev)
                                    for (const h of ungrouped) {
                                      if (allSel) next.delete(h.id)
                                      else next.add(h.id)
                                    }
                                    return next
                                  })
                                }}
                                aria-label="Select all ungrouped"
                              />
                              <span className="text-xs font-semibold">Ungrouped</span>
                              <span className="text-muted-foreground text-xs">
                                {hostsByGroup.get(null)!.length}
                              </span>
                            </div>
                          )}
                          {hostsByGroup.get(null)!.map((host) => (
                            <div
                              key={host.id}
                              className={`hover:bg-muted/50 flex cursor-pointer items-center gap-2 py-1.5 pr-3 ${localGroups.length > 0 ? 'pl-8' : 'pl-3'}`}
                              onClick={() => toggleHost(host.id)}
                            >
                              <Checkbox
                                checked={selectedHostIds.has(host.id)}
                                onCheckedChange={() => toggleHost(host.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${host.label}`}
                              />
                              <span className="flex-1 truncate text-xs">{host.label}</span>
                              <span className="text-muted-foreground truncate font-mono text-xs">
                                {host.hostname}:{host.port}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Field>
          </FieldGroup>

          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
            <Badge variant="secondary">{selectedHostIds.size}</Badge>
            {selectedHostIds.size === 1 ? 'host' : 'hosts'} will be published. Credentials are never
            sent.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handlePublish} disabled={publishing || !canPublish}>
            {publishing
              ? 'Publishing…'
              : `Publish ${selectedHostIds.size} host${selectedHostIds.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (or only pre-existing ones unrelated to this file)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/modals/PublishBundleModal.tsx
git commit -m "feat: add PublishBundleModal component"
```

---

### Task 3: Mount the modal in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the import**

Add this import alongside the other modal imports near the top of `App.tsx`:

```ts
import { PublishBundleModal } from './components/modals/PublishBundleModal'
```

- [ ] **Step 2: Mount the modal**

Add the following block after the `<ExportHostsModal />` ErrorBoundary block (after line 276):

```tsx
          <ErrorBoundary
            fallback="inline"
            zone="modal-publish-bundle"
            onError={(e, i) => reportUIError(e, i, 'modal-publish-bundle')}
          >
            <PublishBundleModal />
          </ErrorBoundary>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: mount PublishBundleModal in App"
```

---

### Task 4: Add "Publish to Registry..." to host context menu and dropdown

**Files:**
- Modify: `frontend/src/components/sidebar/HostListItem.tsx`

- [ ] **Step 1: Add the import and atom access**

Add to the imports at the top of `HostListItem.tsx`:

```ts
import { groupsAtom, hostHealthAtom, publishBundleAtom } from '../../store/atoms'
```

Replace the existing import line:
```ts
import { groupsAtom, hostHealthAtom } from '../../store/atoms'
```

Change `useAtomValue` import to also include `useSetAtom`:
```ts
import { useAtomValue, useSetAtom } from 'jotai'
```

Inside the `HostListItem` function body, after the existing `useAtomValue` calls, add:

```ts
const setPublishBundle = useSetAtom(publishBundleAtom)
```

- [ ] **Step 2: Add to the dropdown menu**

In the `<DropdownMenuContent>` block, add a new item after the "Deploy Public Key…" item (before the separator + Delete), inside the `{!readOnly && (` block:

```tsx
<DropdownMenuItem
  onClick={() =>
    setPublishBundle({ open: true, preSelectedHostIds: [host.id] })
  }
>
  Publish to Registry…
</DropdownMenuItem>
```

- [ ] **Step 3: Add to the context menu**

In the `<ContextMenuContent>` block, add a new item in the same position — after "Deploy Public Key…", before the separator + Delete, inside the `{!readOnly && (` block:

```tsx
<ContextMenuItem
  onClick={() =>
    setPublishBundle({ open: true, preSelectedHostIds: [host.id] })
  }
>
  Publish to Registry…
</ContextMenuItem>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/HostListItem.tsx
git commit -m "feat: add 'Publish to Registry' to host context menu"
```

---

### Task 5: Add "Publish to Registry..." to group context menu and dropdown

**Files:**
- Modify: `frontend/src/components/sidebar/HostGroupSection.tsx`

- [ ] **Step 1: Add the import and atom access**

Add `publishBundleAtom` to the atoms import:

```ts
import { groupExpandedAtom, groupsAtom, hostsAtom, UNGROUPED_GROUP_ID, publishBundleAtom } from '../../store/atoms'
```

Inside the `HostGroupSection` function body, add after the existing atom hooks:

```ts
const setPublishBundle = useSetAtom(publishBundleAtom)
```

- [ ] **Step 2: Add to the dropdown menu**

In the `<DropdownMenuContent>` block, add a new item before the separator + Delete:

```tsx
<DropdownMenuItem
  onClick={(e) => {
    e.stopPropagation()
    setPublishBundle({
      open: true,
      preSelectedHostIds: hosts.filter((h) => h.origin === 'local').map((h) => h.id),
    })
  }}
>
  Publish to Registry…
</DropdownMenuItem>
```

- [ ] **Step 3: Add to the context menu**

In the `<ContextMenuContent>` block, add a new item before the separator + Delete:

```tsx
<ContextMenuItem
  onClick={() =>
    setPublishBundle({
      open: true,
      preSelectedHostIds: hosts.filter((h) => h.origin === 'local').map((h) => h.id),
    })
  }
>
  Publish to Registry…
</ContextMenuItem>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/HostGroupSection.tsx
git commit -m "feat: add 'Publish to Registry' to group context menu"
```

---

### Task 6: Add "Publish to Registry" to the command palette

**Files:**
- Modify: `frontend/src/components/CommandPalette.tsx`

- [ ] **Step 1: Add the import and atom access**

Add `publishBundleAtom` to the atoms import:

```ts
import {
  hostsAtom,
  isCommandPaletteOpenAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isSettingsOpenAtom,
  isImportHostsOpenAtom,
  isExportHostsOpenAtom,
  connectingHostIdsAtom,
  publishBundleAtom,
} from '../store/atoms'
```

Add `Globe` to the lucide-react import:

```ts
import { Settings, Plus, Download, Upload, Zap, Globe } from 'lucide-react'
```

Inside the `CommandPalette` function body, add after the existing `useSetAtom` calls:

```ts
const setPublishBundle = useSetAtom(publishBundleAtom)
```

- [ ] **Step 2: Add the command item**

In the `<CommandGroup heading="Actions">` block, add a new item after the "Export Hosts" item:

```tsx
<CommandItem
  onSelect={() =>
    runAction(() => setPublishBundle({ open: true, preSelectedHostIds: [] }))
  }
>
  <Globe />
  Publish to Registry
</CommandItem>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CommandPalette.tsx
git commit -m "feat: add 'Publish to Registry' to command palette"
```

---

### Task 7: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm run dev` (or however the Wails dev mode starts)

- [ ] **Step 2: Test command palette entry**

Open the command palette, type "Publish", select the action. Verify the modal opens with no hosts pre-selected, all form fields empty, and the host picker shows local hosts grouped correctly.

- [ ] **Step 3: Test host context menu entry**

Right-click a host in the sidebar → "Publish to Registry…". Verify the modal opens with that host pre-checked.

- [ ] **Step 4: Test group context menu entry**

Right-click a group header → "Publish to Registry…". Verify the modal opens with all hosts in that group pre-checked.

- [ ] **Step 5: Test group checkbox toggling**

In the host picker, click a group row. Verify all hosts in the group toggle. Click again to deselect. Verify indeterminate state when only some hosts are selected.

- [ ] **Step 6: Test publish flow**

Fill all fields, select hosts, click Publish. Verify success toast or error toast depending on registry availability.

- [ ] **Step 7: Test validation**

Verify the Publish button is disabled when: no registry selected, namespace empty, bundle name empty, tag empty, or no hosts selected.
