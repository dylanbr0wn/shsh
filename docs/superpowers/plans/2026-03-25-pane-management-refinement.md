# Pane Management Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine pane management UX with always-visible headers, unified type+host chooser on split, pane drag-and-drop with cross-workspace moves, and custom drag previews.

**Architecture:** Frontend-only changes. The pane tree (binary tree of `PaneLeaf | SplitNode` in Jotai state) gains new manipulation utilities (`insertLeaf`, `moveLeaf`). A new `PaneTypeChooser` popover replaces both the `AddPaneMenu` and the hardcoded terminal-on-split behavior. Native HTML5 DnD powers pane rearrangement with edge-strip drop zones.

**Tech Stack:** React 18, TypeScript, Jotai (state), shadcn/ui (DropdownMenu), Tailwind CSS, native HTML5 Drag and Drop API, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-25-pane-management-refinement-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `frontend/src/lib/paneTree.ts` (modify) | Add `insertLeaf` and `moveLeaf` utilities |
| `frontend/src/components/workspace/PaneTypeChooser.tsx` | Popover menu: Terminal (→ host list) / SFTP (→ host list) / Local. Current host pre-selected. |
| `frontend/src/components/workspace/DropZoneOverlay.tsx` | Renders the 4px glowing edge strip + arrow during drag hover |
| `frontend/src/components/workspace/DragPreview.tsx` | Offscreen-rendered drag images (host pill, pane mini-header) |
| `frontend/src/hooks/useDropZone.ts` | Drop target hook: nearest-edge detection, MIME type checking, zone state |
| `frontend/src/hooks/usePaneDrag.ts` | Drag source hook: onDragStart, preview ref, opacity dimming |

### Modified Files
| File | Summary of Changes |
|------|-------------------|
| `frontend/src/components/terminal/PaneHeader.tsx` | Full rewrite → always-visible bar with drag grip, color border, type badge, dim-on-hover buttons |
| `frontend/src/components/terminal/PaneTree.tsx` | Integrate useDropZone + DropZoneOverlay, update onSplit prop signature, remove inline DnD handlers |
| `frontend/src/components/terminal/WorkspaceView.tsx` | Extend handleSplit with kind/hostId params, add handleMovePane, keep keyboard shortcut fast paths |
| `frontend/src/components/sidebar/HostListItem.tsx` | Add DragPreview ref for custom host drag image |
| `frontend/src/components/sessions/TabItem.tsx` | Add onDragOver with 300ms hover timer, onDrop for pane moves |
| `frontend/src/components/sessions/TabBar.tsx` | Thread new onMovePane/onSwitchWorkspace props to TabItem |

### Removed Files
| File | Reason |
|------|--------|
| `frontend/src/components/workspace/AddPaneMenu.tsx` | Replaced by PaneTypeChooser |

---

## Task 1: Add `insertLeaf` and `moveLeaf` to paneTree utilities

**Files:**
- Modify: `frontend/src/lib/paneTree.ts`

- [ ] **Step 1: Add `insertLeaf` function**

Add after the existing `splitLeaf` function. `insertLeaf` generalizes `splitLeaf` by supporting a `position` parameter that controls whether the new leaf goes on the left/top (`'before'`) or right/bottom (`'after'`) of the split.

```typescript
/**
 * Insert newLeaf next to the leaf with targetPaneId.
 * position 'before' puts newLeaf on the left/top, 'after' on the right/bottom.
 */
export function insertLeaf(
  node: PaneNode,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: PaneLeaf,
  position: 'before' | 'after'
): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId !== targetPaneId) return node
    return position === 'before'
      ? { type: 'split', direction, ratio: 0.5, left: newLeaf, right: node }
      : { type: 'split', direction, ratio: 0.5, left: node, right: newLeaf }
  }
  return {
    ...node,
    left: insertLeaf(node.left, targetPaneId, direction, newLeaf, position),
    right: insertLeaf(node.right, targetPaneId, direction, newLeaf, position),
  }
}
```

- [ ] **Step 2: Refactor `splitLeaf` to delegate to `insertLeaf`**

Replace the body of the existing `splitLeaf` function:

```typescript
export function splitLeaf(
  node: PaneNode,
  paneId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: PaneLeaf
): PaneNode {
  return insertLeaf(node, paneId, direction, newLeaf, 'after')
}
```

- [ ] **Step 3: Add `moveLeaf` function**

Add after `insertLeaf`. This atomically removes a leaf and inserts it at a new position. Must handle the case where removing the source leaf changes the tree shape before insertion.

```typescript
/**
 * Move a leaf from its current position to a new position next to targetPaneId.
 * Returns null if the source leaf is not found or the tree collapses to nothing.
 */
export function moveLeaf(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after'
): PaneNode | null {
  // Find the source leaf before removal
  const sourceLeaf = collectLeaves(node).find((l) => l.paneId === sourcePaneId)
  if (!sourceLeaf) return node

  // Don't move onto yourself
  if (sourcePaneId === targetPaneId) return node

  // Remove source, then insert at target
  const afterRemoval = removeLeaf(node, sourcePaneId)
  if (afterRemoval === null) return null
  return insertLeaf(afterRemoval, targetPaneId, direction, sourceLeaf, position)
}
```

- [ ] **Step 4: Verify the build passes**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no TypeScript errors. Existing callers of `splitLeaf` are unaffected since its signature is unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/paneTree.ts
git commit -m "feat(ui): add insertLeaf and moveLeaf pane tree utilities"
```

---

## Task 2: Create `PaneTypeChooser` component

**Files:**
- Create: `frontend/src/components/workspace/PaneTypeChooser.tsx`

- [ ] **Step 1: Create the PaneTypeChooser component**

This is a `DropdownMenu` (from shadcn) that shows Terminal (with host submenu), SFTP (with host submenu), and Local Files. It receives the current pane's hostId so it can pre-select it at the top of host submenus.

```typescript
import { Terminal, FolderOpen, HardDrive } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { hostsAtom } from '../../store/atoms'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface Props {
  /** The trigger element (split button) */
  children: React.ReactNode
  /** Current pane's hostId — pre-selected at top of host submenus */
  currentHostId: string
  onSelectTerminal: (hostId: string) => void
  onSelectSFTP: (hostId: string) => void
  onSelectLocal: () => void
}

export function PaneTypeChooser({
  children,
  currentHostId,
  onSelectTerminal,
  onSelectSFTP,
  onSelectLocal,
}: Props) {
  const hosts = useAtomValue(hostsAtom)
  const currentHost = hosts.find((h) => h.id === currentHostId)
  const otherHosts = hosts.filter((h) => h.id !== currentHostId)

  function HostList({ onSelect }: { onSelect: (hostId: string) => void }) {
    return (
      <>
        {currentHost && (
          <>
            <DropdownMenuItem onSelect={() => onSelect(currentHost.id)}>
              {currentHost.color && (
                <span
                  className="mr-2 inline-block size-2 rounded-full"
                  style={{ backgroundColor: currentHost.color }}
                />
              )}
              Current: {currentHost.label}
            </DropdownMenuItem>
            {otherHosts.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {otherHosts.map((host) => (
          <DropdownMenuItem key={host.id} onSelect={() => onSelect(host.id)}>
            {host.color && (
              <span
                className="mr-2 inline-block size-2 rounded-full"
                style={{ backgroundColor: host.color }}
              />
            )}
            {host.label}
          </DropdownMenuItem>
        ))}
        {hosts.length === 0 && (
          <DropdownMenuItem disabled>No hosts configured</DropdownMenuItem>
        )}
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Terminal className="mr-2 size-4" />
            Terminal
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <HostList onSelect={onSelectTerminal} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen className="mr-2 size-4" />
            SFTP
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <HostList onSelect={onSelectSFTP} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSelectLocal}>
          <HardDrive className="mr-2 size-4" />
          Local Files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Verify the build passes**

Run: `cd frontend && pnpm build`
Expected: Build succeeds. Component is created but not yet used.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/workspace/PaneTypeChooser.tsx
git commit -m "feat(ui): add PaneTypeChooser component for split type+host selection"
```

---

## Task 3: Rewrite `PaneHeader` as always-visible bar

**Files:**
- Modify: `frontend/src/components/terminal/PaneHeader.tsx`

- [ ] **Step 1: Read current PaneHeader**

Read `frontend/src/components/terminal/PaneHeader.tsx` to confirm current implementation before rewriting.

- [ ] **Step 2: Rewrite PaneHeader**

Replace the entire component. Key changes:
- Remove `absolute top-0 right-0 opacity-0 group-hover/pane:opacity-100` — now in normal flow
- Add drag grip (`GripVertical`), host label always visible, type badge pill
- Host-color bottom border via `borderBottom: 2px solid ${hostColor}`
- Action buttons: toggle (terminal↔SFTP, hidden on local), split V (via PaneTypeChooser), split H (via PaneTypeChooser), close
- Buttons are `opacity-40` by default, `group-hover/pane:opacity-100`
- Replace `AddPaneMenu` import with `PaneTypeChooser`
- Update Props: add `hostId` (for PaneTypeChooser's currentHostId), replace `onSplitVertical`/`onSplitHorizontal` with `onSplit(direction, kind, hostId)`, add `onToggle` callback

New Props interface:
```typescript
interface Props {
  hostLabel: string
  hostColor?: string
  hostId: string
  kind: 'terminal' | 'sftp' | 'local'
  onSplit: (direction: 'horizontal' | 'vertical', kind: 'terminal' | 'sftp' | 'local', hostId: string) => void
  onClose: () => void
  canClose: boolean
  onToggle?: () => void  // terminal↔SFTP toggle, undefined for local
}
```

The component renders:
```tsx
<div
  className="group/pane-header bg-muted flex h-5 items-center gap-1 px-1.5"
  style={{ borderBottom: `2px solid ${hostColor ?? 'hsl(var(--border))'}` }}
>
  {/* Drag grip */}
  <GripVertical className="text-muted-foreground size-3 shrink-0 cursor-grab" />

  {/* Host label */}
  <span className="truncate text-[11px] font-medium" style={hostColor ? { color: hostColor } : undefined}>
    {hostLabel}
  </span>

  {/* Type badge */}
  <span
    className="shrink-0 rounded px-1 text-[9px]"
    style={{
      backgroundColor: hostColor ? `${hostColor}20` : 'hsl(var(--muted))',
      color: hostColor ?? 'hsl(var(--muted-foreground))',
    }}
  >
    {kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'}
  </span>

  {/* Spacer */}
  <div className="flex-1" />

  {/* Action buttons - dim until hover */}
  <div className="flex items-center gap-0.5 opacity-40 transition-opacity group-hover/pane:opacity-100">
    {onToggle && (
      <Button variant="ghost" size="icon-xs" title={kind === 'terminal' ? 'Open SFTP' : 'Open Terminal'} onClick={onToggle}>
        {kind === 'terminal' ? <FolderOpen className="size-3" /> : <Terminal className="size-3" />}
      </Button>
    )}
    <PaneTypeChooser
      currentHostId={hostId}
      onSelectTerminal={(hId) => onSplit('vertical', 'terminal', hId)}
      onSelectSFTP={(hId) => onSplit('vertical', 'sftp', hId)}
      onSelectLocal={() => onSplit('vertical', 'local', 'local')}
    >
      <Button variant="ghost" size="icon-xs" title="Split vertically (⌘D)">
        <SplitSquareVertical className="size-3" />
      </Button>
    </PaneTypeChooser>
    <PaneTypeChooser
      currentHostId={hostId}
      onSelectTerminal={(hId) => onSplit('horizontal', 'terminal', hId)}
      onSelectSFTP={(hId) => onSplit('horizontal', 'sftp', hId)}
      onSelectLocal={() => onSplit('horizontal', 'local', 'local')}
    >
      <Button variant="ghost" size="icon-xs" title="Split horizontally (⌘⇧D)">
        <SplitSquareHorizontal className="size-3" />
      </Button>
    </PaneTypeChooser>
    {canClose && (
      <Button variant="ghost" size="icon-xs" title="Close pane" onClick={onClose}>
        <X className="size-3" />
      </Button>
    )}
  </div>
</div>
```

- [ ] **Step 3: Update PaneTree to use new PaneHeader props**

In `frontend/src/components/terminal/PaneTree.tsx`:

Update the `PaneTreeProps` interface — change `onSplit` to:
```typescript
onSplit: (paneId: string, direction: 'horizontal' | 'vertical', kind?: string, hostId?: string) => void
```

Remove `onOpenFiles`, `onAddLocal`, `onAddTerminal`, `onAddSFTP` from props — these are now handled through the PaneHeader's `onSplit` callback with kind/hostId params.

Update the `PaneHeader` usage in the leaf rendering:
```tsx
<PaneHeader
  hostLabel={leaf.hostLabel}
  hostColor={host?.color}
  hostId={leaf.hostId}
  kind={leaf.kind}
  onSplit={(direction, kind, hostId) => onSplit(leaf.paneId, direction, kind, hostId)}
  onClose={() => onClose(leaf.paneId)}
  canClose={canClose}
  onToggle={leaf.kind !== 'local' ? () => onSplit(leaf.paneId, 'horizontal', leaf.kind === 'terminal' ? 'sftp' : 'terminal', leaf.hostId) : undefined}
/>
```

Remove the `onDragOver` and `onDrop` inline handlers from the leaf container div (these will be replaced by `useDropZone` in Task 5).

- [ ] **Step 4: Update WorkspaceView to handle extended handleSplit**

In `frontend/src/components/terminal/WorkspaceView.tsx`:

Extend `handleSplit` signature to accept optional `kind` and `hostId`:
```typescript
const handleSplit = useCallback(
  async (workspaceId: string, paneId: string, direction: 'horizontal' | 'vertical', kind?: string, hostId?: string) => {
```

When `kind` and `hostId` are provided, create the appropriate leaf type instead of always creating a terminal. The logic branches:
- `kind === 'terminal'` with `hostId`: call `ConnectHost(hostId)` → create TerminalLeaf
- `kind === 'sftp'` with `hostId`: call `ConnectHost(hostId)` then `OpenSFTPChannel(connectionId)` → create SFTPLeaf
- `kind === 'local'`: call `OpenLocalFSChannel()` → create LocalFSLeaf
- No kind/hostId (keyboard shortcut path): existing behavior — `OpenTerminal(leaf.connectionId)` → TerminalLeaf on same connection

Remove `handleOpenFiles`, `handleAddLocal`, `handleAddTerminal`, `handleAddSFTP` callbacks — their logic is now inside the extended `handleSplit`.

Update the `PaneTree` usage — remove the removed callback props, update `onSplit`:
```tsx
<PaneTree
  node={workspace.layout}
  workspace={workspace}
  isWorkspaceActive={isWorkspaceActive}
  onSplit={(paneId, direction, kind, hostId) => handleSplit(workspace.id, paneId, direction, kind, hostId)}
  onClose={(paneId) => handleClose(workspace.id, paneId)}
/>
```

- [ ] **Step 5: Delete AddPaneMenu**

Delete `frontend/src/components/workspace/AddPaneMenu.tsx`. Remove any remaining imports of it.

- [ ] **Step 6: Trigger xterm.js refit**

Since the header is now in normal flow (taking ~20px), terminals may need a refit. After the header renders, dispatch `window.dispatchEvent(new Event('resize'))`. The existing `ResizeObserver` on xterm containers should handle this, but verify by running `wails dev` and checking that terminals render at the correct size. If the `InitialFitTrigger` in PaneTree needs adjustment, update it.

- [ ] **Step 7: Verify the build passes and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify:
- Pane header is always visible with host label, color border, type badge
- Split buttons open the PaneTypeChooser dropdown
- Keyboard shortcuts (Cmd+D, Cmd+Shift+D) still create terminals on same host
- Toggle button switches between terminal↔SFTP
- Close button works
- Terminal content renders at correct size (no clipping)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/terminal/PaneHeader.tsx \
       frontend/src/components/terminal/PaneTree.tsx \
       frontend/src/components/terminal/WorkspaceView.tsx
git rm frontend/src/components/workspace/AddPaneMenu.tsx
git commit -m "feat(ui): rewrite PaneHeader as always-visible bar with PaneTypeChooser

Replace ghost-button overlay with persistent header bar. Split buttons
now open a type+host chooser. Remove AddPaneMenu component.

Closes #TBD"
```

---

## Task 4: Create `useDropZone` hook and `DropZoneOverlay`

**Files:**
- Create: `frontend/src/hooks/useDropZone.ts`
- Create: `frontend/src/components/workspace/DropZoneOverlay.tsx`

- [ ] **Step 1: Create the `useDropZone` hook**

This hook tracks drag state over a pane container. It determines which edge the cursor is nearest to and what MIME types are being dragged.

```typescript
import { useState, useCallback, useRef } from 'react'

export type DropEdge = 'top' | 'bottom' | 'left' | 'right'
export type DropMime = 'application/x-shsh-host' | 'application/x-shsh-pane'

interface DropZoneState {
  /** Which edge is active, or null if not hovering */
  edge: DropEdge | null
  /** Which MIME type is being dragged */
  mime: DropMime | null
}

interface UseDropZoneOptions {
  onDrop: (edge: DropEdge, mime: DropMime, data: string) => void
}

export function useDropZone({ onDrop }: UseDropZoneOptions) {
  const [state, setState] = useState<DropZoneState>({ edge: null, mime: null })
  const dragCountRef = useRef(0)

  function detectMime(types: readonly string[]): DropMime | null {
    if (types.includes('application/x-shsh-pane')) return 'application/x-shsh-pane'
    if (types.includes('application/x-shsh-host')) return 'application/x-shsh-host'
    return null
  }

  function nearestEdge(rect: DOMRect, clientX: number, clientY: number): DropEdge {
    const top = clientY - rect.top
    const bottom = rect.bottom - clientY
    const left = clientX - rect.left
    const right = rect.right - clientX
    const min = Math.min(top, bottom, left, right)
    if (min === top) return 'top'
    if (min === bottom) return 'bottom'
    if (min === left) return 'left'
    return 'right'
  }

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const mime = detectMime(e.dataTransfer.types)
    if (!mime) return
    e.preventDefault()
    e.dataTransfer.dropEffect = mime === 'application/x-shsh-host' ? 'copy' : 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = nearestEdge(rect, e.clientX, e.clientY)
    setState({ edge, mime })
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const mime = detectMime(e.dataTransfer.types)
    if (!mime) return
    e.preventDefault()
    dragCountRef.current++
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setState({ edge: null, mime: null })
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    dragCountRef.current = 0
    const mime = detectMime(e.dataTransfer.types)
    if (!mime || !state.edge) {
      setState({ edge: null, mime: null })
      return
    }
    e.preventDefault()
    const data = e.dataTransfer.getData(mime)
    const edge = state.edge
    setState({ edge: null, mime: null })
    onDrop(edge, mime, data)
  }, [state.edge, onDrop])

  return {
    state,
    handlers: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
}
```

- [ ] **Step 2: Create `DropZoneOverlay`**

A purely visual component that renders the edge strip indicator.

```typescript
import type { DropEdge } from '../../hooks/useDropZone'

interface Props {
  edge: DropEdge
  color?: string  // host color tint, or undefined for neutral
}

const edgeStyles: Record<DropEdge, React.CSSProperties> = {
  top: { top: 0, left: 0, right: 0, height: 4 },
  bottom: { bottom: 0, left: 0, right: 0, height: 4 },
  left: { top: 0, left: 0, bottom: 0, width: 4 },
  right: { top: 0, right: 0, bottom: 0, width: 4 },
}

const arrowChar: Record<DropEdge, string> = {
  top: '↑',
  bottom: '↓',
  left: '←',
  right: '→',
}

const arrowPosition: Record<DropEdge, React.CSSProperties> = {
  top: { top: 12, left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: 12, left: '50%', transform: 'translateX(-50%)' },
  left: { left: 12, top: '50%', transform: 'translateY(-50%)' },
  right: { right: 12, top: '50%', transform: 'translateY(-50%)' },
}

export function DropZoneOverlay({ edge, color }: Props) {
  const accentColor = color ?? 'hsl(var(--primary))'
  return (
    <>
      {/* Glowing edge strip */}
      <div
        className="pointer-events-none absolute z-20"
        style={{
          ...edgeStyles[edge],
          backgroundColor: accentColor,
          boxShadow: `0 0 12px ${accentColor}80`,
        }}
      />
      {/* Arrow indicator */}
      <div
        className="pointer-events-none absolute z-20 rounded bg-black/50 px-1.5 py-0.5 text-xs"
        style={{
          ...arrowPosition[edge],
          color: accentColor,
        }}
      >
        {arrowChar[edge]}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Verify the build passes**

Run: `cd frontend && pnpm build`
Expected: Build succeeds. Components created but not yet integrated.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useDropZone.ts \
       frontend/src/components/workspace/DropZoneOverlay.tsx
git commit -m "feat(ui): add useDropZone hook and DropZoneOverlay component"
```

---

## Task 5: Integrate drop zones into PaneTree

**Files:**
- Modify: `frontend/src/components/terminal/PaneTree.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Read current PaneTree and WorkspaceView**

Read both files to confirm current state after Task 3 changes.

- [ ] **Step 2: Add `useDropZone` to PaneTree leaf container**

In `PaneTree.tsx`, import `useDropZone` and `DropZoneOverlay`. In the leaf rendering section:

Add `onDrop` and `onMovePane` to `PaneTreeProps`:
```typescript
onDrop: (paneId: string, edge: DropEdge, mime: DropMime, data: string) => void
```

In the leaf component, call `useDropZone`:
```typescript
const { state: dropState, handlers: dropHandlers } = useDropZone({
  onDrop: (edge, mime, data) => onDrop(leaf.paneId, edge, mime, data),
})
```

Spread `dropHandlers` onto the leaf container div. Render `DropZoneOverlay` when `dropState.edge` is non-null:
```tsx
<div
  className="group/pane relative h-full w-full"
  {...dropHandlers}
  onMouseDown={() => setFocused(leaf.paneId)}
  style={isFocused ? { boxShadow: `inset 0 0 0 1px ${host?.color ?? 'hsl(var(--border))'}` } : undefined}
>
  <PaneHeader ... />
  {dropState.edge && (
    <DropZoneOverlay
      edge={dropState.edge}
      color={dropState.mime === 'application/x-shsh-host' ? host?.color : undefined}
    />
  )}
  {/* ... terminal/sftp/local content ... */}
</div>
```

- [ ] **Step 3: Handle drops in WorkspaceView**

Add a `handleDrop` callback in `WorkspaceView` that receives `(workspaceId, paneId, edge, mime, data)`:

- Map edge to direction + position: top→(horizontal, before), bottom→(horizontal, after), left→(vertical, before), right→(vertical, after)
- If `mime === 'application/x-shsh-host'`: parse `{ hostId }` from data. For now, default to terminal (the PaneTypeChooser popover on drop will be added in Task 6). Call the extended `handleSplit` with the hostId.
- If `mime === 'application/x-shsh-pane'`: parse `{ paneId: sourcePaneId, workspaceId: sourceWorkspaceId }` from data. Call `handleMovePane`.

Add `handleMovePane` callback:
```typescript
const handleMovePane = useCallback(
  (sourceWorkspaceId: string, sourcePaneId: string, targetWorkspaceId: string, targetPaneId: string, direction: 'horizontal' | 'vertical', position: 'before' | 'after') => {
    setWorkspaces((prev) => {
      // Same workspace move
      if (sourceWorkspaceId === targetWorkspaceId) {
        return prev.map((w) => {
          if (w.id !== sourceWorkspaceId) return w
          const newLayout = moveLeaf(w.layout, sourcePaneId, targetPaneId, direction, position)
          if (!newLayout) return w
          return { ...w, layout: newLayout, focusedPaneId: sourcePaneId }
        })
      }
      // Cross-workspace move
      const sourceWs = prev.find((w) => w.id === sourceWorkspaceId)
      const targetWs = prev.find((w) => w.id === targetWorkspaceId)
      if (!sourceWs || !targetWs) return prev

      const sourceLeaf = collectLeaves(sourceWs.layout).find((l) => l.paneId === sourcePaneId)
      if (!sourceLeaf) return prev

      const newSourceLayout = removeLeaf(sourceWs.layout, sourcePaneId)
      const newTargetLayout = insertLeaf(targetWs.layout, targetPaneId, direction, sourceLeaf, position)

      return prev
        .map((w) => {
          if (w.id === sourceWorkspaceId) {
            if (newSourceLayout === null) return null // workspace empty → remove
            const newFocused = w.focusedPaneId === sourcePaneId ? firstLeaf(newSourceLayout).paneId : w.focusedPaneId
            return { ...w, layout: newSourceLayout, focusedPaneId: newFocused }
          }
          if (w.id === targetWorkspaceId) {
            return { ...w, layout: newTargetLayout, focusedPaneId: sourcePaneId }
          }
          return w
        })
        .filter((w): w is Workspace => w !== null)
    })
  },
  [setWorkspaces]
)
```

Thread the new `onDrop` prop through to `PaneTree`.

- [ ] **Step 4: Verify build and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify that the edge strip appears when dragging a host from the sidebar over a pane, and the correct edge highlights based on cursor position.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/terminal/PaneTree.tsx \
       frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): integrate drop zones into pane tree with edge detection"
```

---

## Task 6: Add PaneTypeChooser popover on host drop

**Files:**
- Modify: `frontend/src/components/terminal/PaneTree.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Add pending drop state to WorkspaceView**

When a host is dropped, instead of immediately creating a terminal, store the drop context in state and show the PaneTypeChooser at the drop location.

Add state:
```typescript
const [pendingHostDrop, setPendingHostDrop] = useState<{
  workspaceId: string
  paneId: string
  hostId: string
  direction: 'horizontal' | 'vertical'
  position: 'before' | 'after'
  x: number
  y: number
} | null>(null)
```

Update the host drop handler to set this state instead of immediately calling `handleSplit`. The PaneTypeChooser popover is rendered when `pendingHostDrop` is non-null.

- [ ] **Step 2: Render a positioned PaneTypeChooser for host drops**

When `pendingHostDrop` is set, render a small absolutely-positioned popover at the drop coordinates. This uses the same `PaneTypeChooser` component but triggered programmatically (open by default). When the user selects a type, call `handleSplit` with the pending drop's context and clear `pendingHostDrop`.

Since `PaneTypeChooser` wraps a `DropdownMenu`, we need a variant that can be opened programmatically. Add an `open`/`onOpenChange` prop to `PaneTypeChooser` and use `DropdownMenu`'s controlled mode. When the menu is dismissed (Escape or click outside), clear `pendingHostDrop`.

- [ ] **Step 3: Preserve Shift+drag fast path**

In the drop handler, check if `shiftKey` was held (from the drop event). If so, skip the popover and directly create an SFTP pane. Thread the `shiftKey` from the drop event through the `onDrop` callback.

Update `useDropZone` to include `shiftKey` in the `onDrop` callback:
```typescript
onDrop: (edge: DropEdge, mime: DropMime, data: string, shiftKey: boolean) => void
```

- [ ] **Step 4: Verify build and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify:
- Dragging a host and dropping shows the type chooser popover
- Selecting Terminal/SFTP/Local creates the correct pane type
- Shift+drag skips the chooser and creates SFTP directly
- Pressing Escape dismisses the chooser without creating a pane

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/PaneTypeChooser.tsx \
       frontend/src/components/terminal/PaneTree.tsx \
       frontend/src/components/terminal/WorkspaceView.tsx \
       frontend/src/hooks/useDropZone.ts
git commit -m "feat(ui): show PaneTypeChooser popover on host drop with Shift fast path"
```

---

## Task 7: Add pane drag source via `usePaneDrag` hook

**Files:**
- Create: `frontend/src/hooks/usePaneDrag.ts`
- Modify: `frontend/src/components/terminal/PaneHeader.tsx`

- [ ] **Step 1: Create the `usePaneDrag` hook**

```typescript
import { useCallback, useRef, useState } from 'react'

interface UsePaneDragOptions {
  paneId: string
  workspaceId: string
}

export function usePaneDrag({ paneId, workspaceId }: UsePaneDragOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const gripRef = useRef<HTMLDivElement>(null)

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(
        'application/x-shsh-pane',
        JSON.stringify({ paneId, workspaceId })
      )
      setIsDragging(true)
    },
    [paneId, workspaceId]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  return {
    isDragging,
    gripRef,
    gripProps: {
      draggable: true,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    },
  }
}
```

- [ ] **Step 2: Integrate `usePaneDrag` into PaneHeader**

Add `paneId` and `workspaceId` to PaneHeader props. Call `usePaneDrag` in the component. Apply `gripProps` to the `GripVertical` icon wrapper. Apply `isDragging ? 'opacity-30' : ''` to the outer pane container (this needs to be coordinated with PaneTree — pass `isDragging` state up or apply it at the PaneTree leaf container level).

For the opacity dimming: add an `isDragging` prop to PaneTree leaf container styling, or have PaneHeader accept a className callback. Simplest approach: have `usePaneDrag` return `isDragging` and have PaneTree read it from a ref/state passed down.

Alternative simpler approach: make the grip `draggable` directly on the grip element in PaneHeader, and use CSS `:has(.dragging)` or a parent state. For now, the cleanest path is:
1. `usePaneDrag` in PaneHeader returns `isDragging`
2. PaneHeader renders with `data-dragging={isDragging}` on its root
3. PaneTree's leaf container checks `data-dragging` on its child PaneHeader via a shared state/ref

Simplest: lift `isDragging` to PaneTree leaf level. Add `onDragStateChange?: (dragging: boolean) => void` to PaneHeader. PaneTree maintains a `draggingPaneId` state and applies `opacity-30` to the leaf container when it matches.

- [ ] **Step 3: Verify build and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify:
- Dragging the grip icon starts a drag with the correct MIME type
- The source pane dims during drag
- Dropping onto another pane's edge moves the pane (via the drop handler from Task 5)
- Dropping onto the same pane does nothing

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/usePaneDrag.ts \
       frontend/src/components/terminal/PaneHeader.tsx \
       frontend/src/components/terminal/PaneTree.tsx
git commit -m "feat(ui): add pane drag via grip handle with opacity dimming"
```

---

## Task 8: Add cross-workspace pane moves via tab hover

**Files:**
- Modify: `frontend/src/components/sessions/TabItem.tsx`
- Modify: `frontend/src/components/sessions/TabBar.tsx`
- Modify: `frontend/src/components/terminal/WorkspaceView.tsx`

- [ ] **Step 1: Add drag handlers to TabItem**

In `TabItem.tsx`, add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` to the tab's root `div[role="tab"]`.

Add a 300ms hover timer: on `onDragEnter`, start a timer. If still hovering after 300ms, call a new `onDragHover` prop to switch the active workspace. On `onDragLeave`, clear the timer.

On `onDrop`, accept `application/x-shsh-pane` drops — call `onPaneDrop` prop with the parsed pane data. The pane is inserted as a split right of the root in the target workspace.

New props to add:
```typescript
onDragHover?: () => void     // Called after 300ms hover — switches to this workspace
onPaneDrop?: (sourcePaneId: string, sourceWorkspaceId: string) => void
```

- [ ] **Step 2: Thread new props through TabBar**

In `TabBar.tsx`, pass `onDragHover` and `onPaneDrop` to each `TabItem`:
- `onDragHover`: calls `setActiveWorkspaceId(ws.id)`
- `onPaneDrop`: calls a new prop `onMoveToWorkspace(sourceWorkspaceId, sourcePaneId, ws.id)`

Add `onMoveToWorkspace` prop to `TabBar` (passed from the parent that renders both TabBar and WorkspaceView).

- [ ] **Step 3: Handle tab drops in WorkspaceView (or parent)**

In the component that renders both `TabBar` and `WorkspaceView` (check where they're co-located), handle `onMoveToWorkspace` by:
1. Finding the target workspace's root layout
2. Getting the first leaf of the root as the target pane
3. Calling `handleMovePane` with direction 'horizontal', position 'after'

This inserts the dragged pane as a horizontal split to the right of the workspace's root.

- [ ] **Step 4: Verify build and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify:
- Dragging a pane grip over a tab highlights it
- Hovering 300ms switches to that workspace
- Dropping onto a tab moves the pane into that workspace
- Source workspace is cleaned up (removed if empty, focus updated if not)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sessions/TabItem.tsx \
       frontend/src/components/sessions/TabBar.tsx \
       frontend/src/components/terminal/WorkspaceView.tsx
git commit -m "feat(ui): add cross-workspace pane moves via tab hover and drop"
```

---

## Task 9: Add custom drag previews

**Files:**
- Create: `frontend/src/components/workspace/DragPreview.tsx`
- Modify: `frontend/src/components/sidebar/HostListItem.tsx`
- Modify: `frontend/src/hooks/usePaneDrag.ts`

- [ ] **Step 1: Create the DragPreview component**

This component renders offscreen elements that serve as drag images. It provides refs that drag sources use with `setDragImage`.

```typescript
import { forwardRef, useImperativeHandle, useRef } from 'react'

interface HostPreviewProps {
  label: string
  color?: string
}

export function HostDragPreview({ label, color }: HostPreviewProps) {
  return (
    <div
      className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
      style={{ position: 'fixed', left: -9999, top: -9999 }}
    >
      {color && (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {label}
    </div>
  )
}

interface PanePreviewProps {
  label: string
  kind: 'terminal' | 'sftp' | 'local'
  color?: string
}

export function PaneDragPreview({ label, kind, color }: PanePreviewProps) {
  const badge = kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'
  return (
    <div
      className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
      style={{
        position: 'fixed',
        left: -9999,
        top: -9999,
        borderBottom: `2px solid ${color ?? 'hsl(var(--border))'}`,
      }}
    >
      <span
        className="rounded px-1 text-[9px]"
        style={{
          backgroundColor: color ? `${color}20` : 'hsl(var(--muted))',
          color: color ?? 'hsl(var(--muted-foreground))',
        }}
      >
        {badge}
      </span>
      {label}
    </div>
  )
}
```

- [ ] **Step 2: Add host drag preview to HostListItem**

In `HostListItem.tsx`:
1. Import `HostDragPreview`
2. Add a ref for the preview element
3. Render `<HostDragPreview ref={previewRef} label={host.label} color={host.color} />` inside the component
4. In `onDragStart`, call `e.dataTransfer.setDragImage(previewRef.current, 0, 0)` before setting data

**WebKit caveat:** Test in `wails dev` (which uses WebKit on macOS). If the preview doesn't show, try briefly setting the element to `left: 0` before `setDragImage` and restoring after via `requestAnimationFrame`.

- [ ] **Step 3: Add pane drag preview to usePaneDrag**

In `usePaneDrag.ts`:
1. Accept `previewRef: React.RefObject<HTMLDivElement | null>` in options
2. In `handleDragStart`, call `e.dataTransfer.setDragImage(previewRef.current, 0, 0)` if the ref is available
3. In PaneHeader, render `<PaneDragPreview>` with a ref and pass it to `usePaneDrag`

- [ ] **Step 4: Verify build and test visually**

Run: `cd frontend && pnpm build`
Run: `wails dev` — verify:
- Dragging a host from the sidebar shows a compact pill preview (not the full list item)
- Dragging a pane grip shows a mini pane header preview
- Previews render correctly in WebKit (Wails webview)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/DragPreview.tsx \
       frontend/src/components/sidebar/HostListItem.tsx \
       frontend/src/hooks/usePaneDrag.ts \
       frontend/src/components/terminal/PaneHeader.tsx
git commit -m "feat(ui): add custom drag previews for hosts and panes"
```

---

## Task 10: Final cleanup and lint pass

**Files:**
- All modified files

- [ ] **Step 1: Run lint and format checks**

```bash
cd frontend && pnpm lint
cd frontend && pnpm format:check
```

Fix any lint errors or formatting issues.

- [ ] **Step 2: Run the full build**

```bash
cd frontend && pnpm build
```

- [ ] **Step 3: Visual smoke test**

Run `wails dev` and verify the full flow end-to-end:
1. Pane headers are always visible with correct styling
2. Split buttons open type+host chooser
3. Keyboard shortcuts (Cmd+D, Cmd+Shift+D) still work as fast paths
4. Dragging a host from sidebar shows edge strips, drops show type chooser
5. Shift+drag a host → SFTP without chooser
6. Drag a pane grip → move within workspace
7. Drag a pane grip over a tab → workspace switches after 300ms, drop into new workspace
8. Custom drag previews for both hosts and panes
9. Terminal content renders at correct size (no clipping from header)
10. Toggle button switches terminal↔SFTP (hidden on local panes)

- [ ] **Step 4: Fix any formatting issues and commit**

```bash
cd frontend && pnpm format
git add -A
git commit -m "chore(ui): lint and format pass for pane management refinement"
```
