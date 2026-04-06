# Sidebar Panel Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify sidebar panel structure so both HostList and SessionList are self-contained components with their own footer, wrapped in ErrorBoundary.

**Architecture:** Move SidebarFooter content into HostList, update SessionList's footer separator to use `<Separator />`, simplify Sidebar.tsx composition, delete SidebarFooter.

**Tech Stack:** React, Jotai, shadcn/ui

---

### Task 1: Absorb SidebarFooter into HostList

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx`

- [ ] **Step 1: Add new imports to HostList**

Add these imports at the top of `HostList.tsx` (some atoms are already imported, only add what's missing):

```tsx
import { FileInput, FolderPlus } from 'lucide-react'
// Add to existing jotai import:
import { useAtom } from 'jotai'
// Add to existing atoms import:
import { isImportHostsOpenAtom, isNewGroupOpenAtom } from '../../store/atoms'
// Add new imports:
import { AddGroup } from '@wailsjs/go/main/HostFacade'
import { Separator } from '../ui/separator'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from '../ui/popover'
import { Input } from '../ui/input'
```

Note: `HostList` already imports `useSetAtom`, `Plus`, `Button`, `Tooltip`, `TooltipContent`, `TooltipTrigger`, `ButtonGroup`, `groupsAtom`, and `isAddHostOpenAtom`.

- [ ] **Step 2: Add footer state and handler inside the HostList component**

Add these lines at the top of the `HostList` function body, alongside the existing state:

```tsx
const setIsImportHostsOpen = useSetAtom(isImportHostsOpenAtom)
const [newGroupOpen, setNewGroupOpen] = useAtom(isNewGroupOpenAtom)
const [newGroupName, setNewGroupName] = useState('')
const [creatingGroup, setCreatingGroup] = useState(false)
const newGroupInputRef = useRef<HTMLInputElement>(null)

async function handleCreateGroup() {
  const name = newGroupName.trim()
  if (!name) return
  setCreatingGroup(true)
  try {
    const group = await AddGroup({ name })
    setGroups((prev) => [...prev, group as unknown as Group])
    setNewGroupName('')
    setNewGroupOpen(false)
  } catch (err) {
    toast.error('Failed to create group', { description: String(err) })
  } finally {
    setCreatingGroup(false)
  }
}
```

This requires adding `useRef` and `useState` to the existing React import (already imported), and `setGroups` needs to use `useSetAtom(groupsAtom)` — which is already declared in the component as `const setGroups = useSetAtom(groupsAtom)` — wait, it's not. HostList uses `useAtomValue(groupsAtom)`. We need to also change that:

Replace:
```tsx
const groups = useAtomValue(groupsAtom)
```
With:
```tsx
const [groups, setGroups] = useAtom(groupsAtom)
```

And add `Group` to the existing type import from `../../types`.

- [ ] **Step 3: Add footer JSX to the empty state branch**

In the empty state return (the `if (hosts.length === 0)` block), wrap the existing content in the same flex container pattern and add the footer. Replace the entire empty state return with:

```tsx
if (hosts.length === 0) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <Server className="text-muted-foreground/40 size-8" />
        <p className="text-muted-foreground text-center text-xs">No saved hosts yet</p>
        <Button size="sm" variant="outline" onClick={() => setIsAddHostOpen(true)}>
          <Plus data-icon="inline-start" /> Add Host
        </Button>
      </div>
      <Separator />
      <div className="p-1">
        <ButtonGroup className="w-full">
          <ButtonGroup className="grow">
            <Button variant="default" className="flex-1" onClick={() => setIsAddHostOpen(true)}>
              <Plus data-icon="inline-start" />
              Add Host
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setIsImportHostsOpen(true)}
                >
                  <FileInput />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Import Hosts</TooltipContent>
            </Tooltip>
            <Popover
              open={newGroupOpen}
              onOpenChange={(open) => {
                setNewGroupOpen(open)
                if (open) setTimeout(() => newGroupInputRef.current?.focus(), 0)
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon">
                      <FolderPlus />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">New Group</TooltipContent>
              </Tooltip>
              <PopoverContent side="bottom" align="end">
                <PopoverHeader>
                  <PopoverTitle>New Group</PopoverTitle>
                  <PopoverDescription>Enter a name for the new group</PopoverDescription>
                </PopoverHeader>
                <Input
                  ref={newGroupInputRef}
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateGroup()
                    if (e.key === 'Escape') setNewGroupOpen(false)
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleCreateGroup}
                  disabled={creatingGroup || !newGroupName.trim()}
                >
                  <Plus data-icon="inline-start" />
                  Create
                </Button>
              </PopoverContent>
            </Popover>
          </ButtonGroup>
        </ButtonGroup>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add footer JSX to the populated state**

In the main return, add `<Separator />` and the same footer block after the closing `</ScrollArea>` tag, before the closing `</div>`. The footer JSX is identical to Step 3's footer (everything from `<Separator />` through the closing `</div>` of `p-1`).

Also update the outer container's className from `"flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"` to `"flex min-h-0 flex-1 flex-col overflow-hidden"`, and wrap the search + scroll area in a div with `"flex min-h-0 flex-1 flex-col gap-2 p-2"` so the footer sits outside the padding:

```tsx
return (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      {/* Search */}
      <ButtonGroup className="w-full">
        {/* ... existing search controls ... */}
      </ButtonGroup>
      <ScrollArea className="min-h-0 flex-1 select-none">
        {/* ... existing scroll content ... */}
      </ScrollArea>
    </div>
    <Separator />
    <div className="p-1">
      {/* ... same footer ButtonGroup as Step 3 ... */}
    </div>
  </div>
)
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to HostList

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sidebar/HostList.tsx
git commit -m "feat: absorb sidebar footer into HostList component"
```

---

### Task 2: Update SessionList to use Separator

**Files:**
- Modify: `frontend/src/components/sidebar/SessionList.tsx`

- [ ] **Step 1: Add Separator import**

```tsx
import { Separator } from '../ui/separator'
```

- [ ] **Step 2: Replace border div with Separator + div**

Replace:
```tsx
<div className="border-sidebar-border border-t p-2">
```

With:
```tsx
<Separator />
<div className="p-2">
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/SessionList.tsx
git commit -m "refactor: use Separator in SessionList footer for consistency"
```

---

### Task 3: Simplify Sidebar.tsx and delete SidebarFooter

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Delete: `frontend/src/components/sidebar/SidebarFooter.tsx`

- [ ] **Step 1: Update Sidebar.tsx**

Remove these imports:
```tsx
import { SidebarFooter } from '../sidebar/SidebarFooter'
import { Separator } from '../ui/separator'
```

Add ErrorBoundary-related import (already imported):
```tsx
// Already present: import { ErrorBoundary } from '../ErrorBoundary'
// Already present: import { reportUIError } from '../../lib/reportUIError'
```

Replace the hosts branch:
```tsx
{view === 'hosts' ? (
  <>
    <HostList />
    <Separator />
    <SidebarFooter />
  </>
) : (
```

With:
```tsx
{view === 'hosts' ? (
  <ErrorBoundary
    fallback="inline"
    zone="host-list"
    onError={(e, i) => reportUIError(e, i, 'host-list')}
  >
    <HostList />
  </ErrorBoundary>
) : (
```

- [ ] **Step 2: Delete SidebarFooter.tsx**

```bash
rm frontend/src/components/sidebar/SidebarFooter.tsx
```

- [ ] **Step 3: Verify no remaining references to SidebarFooter**

Run: `grep -r "SidebarFooter" frontend/src/`
Expected: No matches

- [ ] **Step 4: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git rm frontend/src/components/sidebar/SidebarFooter.tsx
git commit -m "refactor: remove SidebarFooter, add ErrorBoundary around HostList"
```
