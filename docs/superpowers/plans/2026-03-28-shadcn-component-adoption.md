# shadcn Component Adoption Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing shadcn/ui components (Collapsible, Skeleton, Spinner, Progress, Card, Sheet, RadioGroup, ButtonGroup) and refactor existing hand-rolled patterns to use them.

**Architecture:** Each component is installed via `pnpm dlx shadcn@latest add <name>` from `frontend/`, which drops the source file into `src/components/ui/`. After installing, refactor existing code that hand-rolls the same pattern to use the new component. Components are independent — tasks can be executed in any order.

**Tech Stack:** React 19, Radix UI, Tailwind CSS v4, shadcn (radix-nova style), CVA, Lucide React

---

## File Map

**New files (created by `shadcn add`):**
- `frontend/src/components/ui/collapsible.tsx`
- `frontend/src/components/ui/skeleton.tsx`
- `frontend/src/components/ui/spinner.tsx`
- `frontend/src/components/ui/progress.tsx`
- `frontend/src/components/ui/card.tsx`
- `frontend/src/components/ui/sheet.tsx`
- `frontend/src/components/ui/radio-group.tsx`
- `frontend/src/components/ui/button-group.tsx`

**Files to modify (refactors):**
- `frontend/src/components/sidebar/HostGroupSection.tsx` — use Collapsible
- `frontend/src/components/sftp/SFTPPanel.tsx` — use Skeleton, Spinner
- `frontend/src/components/localfs/LocalFSPanel.tsx` — use Skeleton, Spinner
- `frontend/src/components/welcome/WelcomeScreen.tsx` — use Spinner
- `frontend/src/components/sidebar/HostListItem.tsx` — use Spinner
- `frontend/src/components/sidebar/HostGroupSection.tsx` — use Spinner
- `frontend/src/components/modals/AddHostModal.tsx` — use Spinner
- `frontend/src/components/modals/EditHostModal.tsx` — use Spinner
- `frontend/src/components/modals/QuickConnectModal.tsx` — use Spinner
- `frontend/src/components/modals/DeployKeyModal.tsx` — use Spinner
- `frontend/src/components/modals/HostFormTabs.tsx` — use Spinner
- `frontend/src/components/ui/sonner.tsx` — use Spinner
- `frontend/src/components/terminal/PaneHeader.tsx` — use ButtonGroup
- `frontend/src/components/terminal/TerminalSearch.tsx` — use ButtonGroup

---

## Task 1: Install & Wire Collapsible → Refactor HostGroupSection

**Files:**
- Create: `frontend/src/components/ui/collapsible.tsx` (via shadcn CLI)
- Modify: `frontend/src/components/sidebar/HostGroupSection.tsx`

- [ ] **Step 1: Install the Collapsible component**

```bash
cd frontend && pnpm dlx shadcn@latest add collapsible
```

- [ ] **Step 2: Read the generated `collapsible.tsx`**

Verify it exports `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`. Confirm it uses `radix-ui` (not the older `@radix-ui/react-collapsible` import).

- [ ] **Step 3: Refactor HostGroupSection to use Collapsible**

In `frontend/src/components/sidebar/HostGroupSection.tsx`:

Add imports:

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
```

Replace the outer wrapper `<div className="flex flex-col gap-1 bg-accent/40 rounded-lg">` (line 194) with a controlled `<Collapsible>`:

```tsx
<Collapsible
  open={isExpanded}
  onOpenChange={() => setExpanded((prev) => ({ ...prev, [group.id]: !isExpanded }))}
  className="flex flex-col gap-1 rounded-lg bg-accent/40"
>
```

Wrap the header `<Item>` (the `<a>` on line 199-308) with `<CollapsibleTrigger asChild>`. This replaces the manual `onClick={toggleExpand}` and `onKeyDown={handleKeyDownHeader}` handlers — Radix Collapsible handles Enter/Space and click automatically.

Remove from the `<a>`:
- `onClick={toggleExpand}`
- `onKeyDown={handleKeyDownHeader}`
- `role="button"`
- `tabIndex={0}`

The `<a>` becomes:

```tsx
<CollapsibleTrigger asChild>
  <Item asChild variant="outline" size="xs">
    <a>
      {/* ... same children ... */}
    </a>
  </Item>
</CollapsibleTrigger>
```

**Note:** The `CollapsibleTrigger` needs to wrap around the `<ContextMenuTrigger>` or be placed inside it carefully. Since the `<ContextMenu>` wraps the entire header, keep the structure as:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <CollapsibleTrigger asChild>
      <Item asChild variant="outline" size="xs">
        <a>...</a>
      </Item>
    </CollapsibleTrigger>
  </ContextMenuTrigger>
  <ContextMenuContent>...</ContextMenuContent>
</ContextMenu>
```

Replace the conditional render block (lines 331-363):

```tsx
{isExpanded && (
  <ItemGroup>
    {hosts.map(...)}
  </ItemGroup>
)}
```

with:

```tsx
<CollapsibleContent>
  <ItemGroup>
    {hosts.map(...)}
  </ItemGroup>
</CollapsibleContent>
```

Close the `</Collapsible>` instead of the outer `</div>`.

Remove the now-unused `toggleExpand` function (line 91-93) and `handleKeyDownHeader` function (lines 184-188).

- [ ] **Step 4: Verify the chevron rotation still works**

The `ChevronRight` icon on line 208-212 uses `isExpanded && 'rotate-90'`. This still works because `isExpanded` is derived from the atom, and `onOpenChange` updates the atom. No change needed.

- [ ] **Step 5: Test manually**

```bash
cd frontend && pnpm build
```

Verify: group sections expand/collapse, context menu still works, rename inline editing still works, animation on host items still plays.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/collapsible.tsx frontend/src/components/sidebar/HostGroupSection.tsx
git commit -m "refactor(sidebar): use shadcn Collapsible in HostGroupSection

Replaces hand-rolled expand/collapse with Radix Collapsible primitive.
Gains animated content transitions and built-in keyboard handling."
```

---

## Task 2: Install & Wire Spinner → Replace All Loader2 Patterns

**Files:**
- Create: `frontend/src/components/ui/spinner.tsx` (via shadcn CLI)
- Modify: 10 files (see list below)

- [ ] **Step 1: Install the Spinner component**

```bash
cd frontend && pnpm dlx shadcn@latest add spinner
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/spinner.tsx`. It should export a `Spinner` function component using `LoaderIcon` from lucide-react with `role="status"`, `aria-label="Loading"`, and `className="size-4 animate-spin"`.

- [ ] **Step 3: Replace Loader2 spinner patterns across the codebase**

For each file below, replace the `Loader2` import and inline usage with `Spinner`. The pattern to find in each file is `<Loader2 className="... animate-spin" />` (sometimes with extra classes).

**File: `frontend/src/components/sftp/SFTPPanel.tsx`**

Replace import:
```tsx
// Before
import { Folder, File, RefreshCw, Upload, FolderPlus, Loader2, HelpCircle } from 'lucide-react'
// After
import { Folder, File, RefreshCw, Upload, FolderPlus, HelpCircle } from 'lucide-react'
```

Add import:
```tsx
import { Spinner } from '../ui/spinner'
```

Replace at line 360:
```tsx
// Before
<Loader2 className="size-4 animate-spin" aria-hidden="true" />
// After
<Spinner className="size-4" aria-hidden="true" />
```

**File: `frontend/src/components/localfs/LocalFSPanel.tsx`**

Same pattern — remove `Loader2` from lucide import, add `Spinner` import, replace at line 279:
```tsx
// Before
<Loader2 className="size-4 animate-spin" aria-hidden="true" />
// After
<Spinner className="size-4" aria-hidden="true" />
```

**File: `frontend/src/components/welcome/WelcomeScreen.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 166:
```tsx
// Before
<Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />
// After
<Spinner className="text-muted-foreground size-3 shrink-0" />
```

**File: `frontend/src/components/sidebar/HostListItem.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 158:
```tsx
// Before
<Loader2 className="animate-spin" />
// After
<Spinner />
```

**File: `frontend/src/components/sidebar/HostGroupSection.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 259:
```tsx
// Before
<Loader2 className="size-3.5 animate-spin" />
// After
<Spinner className="size-3.5" />
```

**File: `frontend/src/components/modals/AddHostModal.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 172:
```tsx
// Before
{submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
// After
{submitting && <Spinner data-icon="inline-start" />}
```

**File: `frontend/src/components/modals/EditHostModal.tsx`**

Same pattern at line 195:
```tsx
// Before
{submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
// After
{submitting && <Spinner data-icon="inline-start" />}
```

**File: `frontend/src/components/modals/QuickConnectModal.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 261:
```tsx
// Before
{connecting && <Loader2 className="size-3.5 animate-spin" />}
// After
{connecting && <Spinner className="size-3.5" />}
```

**File: `frontend/src/components/modals/DeployKeyModal.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 150:
```tsx
// Before
{deploying && <Loader2 data-icon="inline-start" className="animate-spin" />}
// After
{deploying && <Spinner data-icon="inline-start" />}
```

**File: `frontend/src/components/modals/HostFormTabs.tsx`**

Remove `Loader2` from lucide import, add `Spinner` import, replace at line 259:
```tsx
// Before
{testing && <Loader2 data-icon="inline-start" className="animate-spin" />}
// After
{testing && <Spinner data-icon="inline-start" />}
```

**File: `frontend/src/components/ui/sonner.tsx`**

Replace `Loader2Icon` import from lucide-react with:
```tsx
import { Spinner } from '@/components/ui/spinner'
```

Replace in the icons config:
```tsx
// Before
loading: <Loader2Icon className="size-4 animate-spin" />,
// After
loading: <Spinner className="size-4" />,
```

- [ ] **Step 4: Verify no Loader2 animate-spin patterns remain**

```bash
cd frontend && grep -r "Loader2.*animate-spin\|animate-spin.*Loader2\|Loader2Icon" src/ --include="*.tsx"
```

This should return zero results.

- [ ] **Step 5: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/spinner.tsx frontend/src/components/sftp/SFTPPanel.tsx frontend/src/components/localfs/LocalFSPanel.tsx frontend/src/components/welcome/WelcomeScreen.tsx frontend/src/components/sidebar/HostListItem.tsx frontend/src/components/sidebar/HostGroupSection.tsx frontend/src/components/modals/AddHostModal.tsx frontend/src/components/modals/EditHostModal.tsx frontend/src/components/modals/QuickConnectModal.tsx frontend/src/components/modals/DeployKeyModal.tsx frontend/src/components/modals/HostFormTabs.tsx frontend/src/components/ui/sonner.tsx
git commit -m "refactor(ui): replace Loader2 spinners with shadcn Spinner component

Standardizes all loading indicators on the Spinner component which
provides consistent sizing, animation, and accessibility (role=status)."
```

---

## Task 3: Install & Wire Skeleton → Refactor File Browser Loading States

**Files:**
- Create: `frontend/src/components/ui/skeleton.tsx` (via shadcn CLI)
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx`
- Modify: `frontend/src/components/localfs/LocalFSPanel.tsx`

- [ ] **Step 1: Install the Skeleton component**

```bash
cd frontend && pnpm dlx shadcn@latest add skeleton
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/skeleton.tsx`. It should export a `Skeleton` component — a simple div with a pulsing background animation.

- [ ] **Step 3: Add skeleton loading to SFTPPanel**

In `frontend/src/components/sftp/SFTPPanel.tsx`, add import:

```tsx
import { Skeleton } from '../ui/skeleton'
```

Replace the loading block (around lines 358-363):

```tsx
// Before
{isLoading && (
  <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs">
    <Spinner className="size-4" aria-hidden="true" />
    <span>Loading…</span>
  </div>
)}

// After
{isLoading && (
  <div className="flex flex-col gap-1 p-2">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-center gap-2 px-2 py-1.5">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3.5 flex-1 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    ))}
  </div>
)}
```

This mimics the actual file row layout (icon + filename + size) with skeleton placeholders.

- [ ] **Step 4: Add skeleton loading to LocalFSPanel**

In `frontend/src/components/localfs/LocalFSPanel.tsx`, add import:

```tsx
import { Skeleton } from '../ui/skeleton'
```

Replace the loading block (around lines 277-281) with the same skeleton pattern:

```tsx
// Before
{isLoading && (
  <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs">
    <Spinner className="size-4" aria-hidden="true" />
    <span>Loading…</span>
  </div>
)}

// After
{isLoading && (
  <div className="flex flex-col gap-1 p-2">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-center gap-2 px-2 py-1.5">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3.5 flex-1 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/skeleton.tsx frontend/src/components/sftp/SFTPPanel.tsx frontend/src/components/localfs/LocalFSPanel.tsx
git commit -m "refactor(ui): use Skeleton loading states in file browser panels

Replaces centered spinner with skeleton rows that match the file list
layout for a more polished loading experience."
```

---

## Task 4: Install & Wire ButtonGroup → Refactor Toolbar Patterns

**Files:**
- Create: `frontend/src/components/ui/button-group.tsx` (via shadcn CLI)
- Modify: `frontend/src/components/terminal/PaneHeader.tsx`
- Modify: `frontend/src/components/terminal/TerminalSearch.tsx`

- [ ] **Step 1: Install the ButtonGroup component**

```bash
cd frontend && pnpm dlx shadcn@latest add button-group
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/button-group.tsx`. It should export `ButtonGroup`, `ButtonGroupSeparator`, and `ButtonGroupText`. Confirm it uses `data-slot="button-group"` — this is what the existing Button component's `in-data-[slot=button-group]` selectors target.

- [ ] **Step 3: Refactor PaneHeader toolbar**

In `frontend/src/components/terminal/PaneHeader.tsx`, add import:

```tsx
import { ButtonGroup } from '../ui/button-group'
```

Replace the button container (lines 123-163):

```tsx
// Before
<div className="flex items-center gap-0.5 opacity-40 transition-opacity group-hover/pane:opacity-100">
  {onToggle && (
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  )}
  <PaneTypeChooser ...>
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  </PaneTypeChooser>
  <PaneTypeChooser ...>
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  </PaneTypeChooser>
  {canClose && (
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  )}
</div>

// After
<ButtonGroup className="opacity-40 transition-opacity group-hover/pane:opacity-100">
  {onToggle && (
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  )}
  <PaneTypeChooser ...>
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  </PaneTypeChooser>
  <PaneTypeChooser ...>
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  </PaneTypeChooser>
  {canClose && (
    <Button variant="ghost" size="icon-xs" ...>...</Button>
  )}
</ButtonGroup>
```

The `ButtonGroup` provides `data-slot="button-group"` which triggers the existing `in-data-[slot=button-group]:rounded-lg` styles on the Button component, giving proper grouped border-radius.

- [ ] **Step 4: Refactor TerminalSearch toolbar**

In `frontend/src/components/terminal/TerminalSearch.tsx`, add import:

```tsx
import { ButtonGroup } from '@/components/ui/button-group'
```

Wrap the three navigation buttons (lines 71-106) in a ButtonGroup:

```tsx
// Before
<div className="bg-popover absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border p-1 shadow-md">
  <Input ... />
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="size-7" onClick={findPrev} disabled={!query}>
        <ChevronUp />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Previous (Shift+Enter)</TooltipContent>
  </Tooltip>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="size-7" onClick={findNext} disabled={!query}>
        <ChevronDown />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Next (Enter)</TooltipContent>
  </Tooltip>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
        <X />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Close (Esc)</TooltipContent>
  </Tooltip>
</div>

// After
<div className="bg-popover absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border p-1 shadow-md">
  <Input ... />
  <ButtonGroup>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" onClick={findPrev} disabled={!query}>
          <ChevronUp />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Previous (Shift+Enter)</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" onClick={findNext} disabled={!query}>
          <ChevronDown />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Next (Enter)</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close (Esc)</TooltipContent>
    </Tooltip>
  </ButtonGroup>
</div>
```

- [ ] **Step 5: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/button-group.tsx frontend/src/components/terminal/PaneHeader.tsx frontend/src/components/terminal/TerminalSearch.tsx
git commit -m "refactor(ui): use shadcn ButtonGroup for toolbar button clusters

Replaces ad-hoc flex containers with ButtonGroup component.
Buttons inside ButtonGroup get proper grouped border-radius via
the existing in-data-[slot=button-group] CSS selectors."
```

---

## Task 5: Install Progress Component

**Files:**
- Create: `frontend/src/components/ui/progress.tsx` (via shadcn CLI)

No refactoring needed — this is an install-only task. Transfer progress currently uses toast notifications which work well. The Progress component will be available for future use (e.g., inline transfer indicators in file rows).

- [ ] **Step 1: Install the Progress component**

```bash
cd frontend && pnpm dlx shadcn@latest add progress
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/progress.tsx`. Confirm it exports `Progress` with a `value` prop (0-100) and uses Radix Progress primitive.

- [ ] **Step 3: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/progress.tsx
git commit -m "chore(ui): add shadcn Progress component

Available for future use in inline transfer indicators."
```

---

## Task 6: Install Card Component

**Files:**
- Create: `frontend/src/components/ui/card.tsx` (via shadcn CLI)

Install-only. The Card component will be available for visual grouping in modals, the welcome screen, and future settings panels.

- [ ] **Step 1: Install the Card component**

```bash
cd frontend && pnpm dlx shadcn@latest add card
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/card.tsx`. Confirm it exports `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`.

- [ ] **Step 3: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/card.tsx
git commit -m "chore(ui): add shadcn Card component

Available for visual grouping in modals and settings."
```

---

## Task 7: Install Sheet Component

**Files:**
- Create: `frontend/src/components/ui/sheet.tsx` (via shadcn CLI)

Install-only. The Sheet (slide-in panel) component is useful as an alternative to centered dialogs for settings, terminal profiles, and debug panels.

- [ ] **Step 1: Install the Sheet component**

```bash
cd frontend && pnpm dlx shadcn@latest add sheet
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/sheet.tsx`. Confirm it exports `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `SheetClose`. Confirm `SheetContent` has a `side` prop (`"top" | "right" | "bottom" | "left"`).

- [ ] **Step 3: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/sheet.tsx
git commit -m "chore(ui): add shadcn Sheet component

Slide-in panel alternative to centered dialogs. Available for
settings, terminal profiles, and debug panels."
```

---

## Task 8: Install RadioGroup Component

**Files:**
- Create: `frontend/src/components/ui/radio-group.tsx` (via shadcn CLI)

Install-only. Currently radio selection only appears inside ContextMenu/DropdownMenu radio items. The standalone RadioGroup will be available for future form work.

- [ ] **Step 1: Install the RadioGroup component**

```bash
cd frontend && pnpm dlx shadcn@latest add radio-group
```

- [ ] **Step 2: Verify the generated component**

Read `frontend/src/components/ui/radio-group.tsx`. Confirm it exports `RadioGroup` and `RadioGroupItem`, uses Radix RadioGroup primitive.

- [ ] **Step 3: Build check**

```bash
cd frontend && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/radio-group.tsx
git commit -m "chore(ui): add shadcn RadioGroup component

Available for forms that need radio button selection."
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run the full frontend check suite**

```bash
cd frontend && pnpm build && pnpm lint && pnpm format:check
```

All three must pass.

- [ ] **Step 2: Run Go checks (ensure no backend breakage)**

```bash
go vet ./internal/...
go test ./internal/... -race -timeout 60s
```

- [ ] **Step 3: Verify all 8 new components exist**

```bash
ls frontend/src/components/ui/{collapsible,skeleton,spinner,progress,card,sheet,radio-group,button-group}.tsx
```

All 8 files must be present.

- [ ] **Step 4: Verify no stale Loader2 animate-spin patterns remain**

```bash
cd frontend && grep -r "Loader2.*animate-spin\|animate-spin.*Loader2" src/ --include="*.tsx"
```

Should return zero results. (Note: `Loader2` may still be imported in files that use it for non-spinner purposes — that's fine. Only the `animate-spin` pattern should be gone.)
