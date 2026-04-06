# Pragmatic Drag-and-Drop Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~2,400 lines of custom HTML5 Drag API code with pragmatic-drag-and-drop (pdnd), removing three hand-rolled drag systems and consolidating SFTPPanel's duplicated file list rendering.

**Architecture:** Two-phase migration. Phase 1 migrates pane and host drag (edge detection, MIME routing, drag previews) to pdnd's `draggable()`, `dropTargetForElements()`, and `attachClosestEdge()`. Phase 2 migrates file drag to a new shared `useFileDrag` hook built on pdnd, and consolidates SFTPPanel to use the shared `FileList` component. OS file drops remain on the Wails `window:filedrop` event; pdnd's `dropTargetForExternal()` handles only visual feedback.

**Tech Stack:** `@atlaskit/pragmatic-drag-and-drop`, `@atlaskit/pragmatic-drag-and-drop-hitbox`, React 19, TypeScript, Jotai, Wails

**Spec:** `docs/superpowers/specs/2026-04-05-pragmatic-dnd-migration-design.md`

---

> **Phase 1 atomic migration note:** Tasks 2-5 migrate drag sources and drop targets that communicate via pdnd's internal data store. TypeScript compiles after each task, but drag interactions only work once all four are complete. Do not attempt manual drag testing until after Task 6.

> **Phase 2 atomic migration note:** Same applies to Tasks 7-10. File drag interactions only work after all four are complete. Test after Task 11.

---

## Phase 1: Pane + Host Drag

### Task 1: Install packages and create drag types module

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/dragTypes.ts`

- [ ] **Step 1: Install pdnd packages**

```bash
cd frontend && pnpm add @atlaskit/pragmatic-drag-and-drop @atlaskit/pragmatic-drag-and-drop-hitbox
```

- [ ] **Step 2: Create the drag types module**

Create `frontend/src/lib/dragTypes.ts`:

```ts
export type PaneDragData = {
  type: 'pane'
  paneId: string
  workspaceId: string
}

export type HostDragData = {
  type: 'host'
  hostId: string
}

export type FileTransferDragData = {
  type: 'file-transfer'
  channelId: string
  path: string
}

export type DragData = PaneDragData | HostDragData | FileTransferDragData

export function isPaneDrag(data: Record<string, unknown>): data is PaneDragData {
  return data.type === 'pane'
}

export function isHostDrag(data: Record<string, unknown>): data is HostDragData {
  return data.type === 'host'
}

export function isFileTransferDrag(
  data: Record<string, unknown>
): data is FileTransferDragData {
  return data.type === 'file-transfer'
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/lib/dragTypes.ts
git commit -m "feat: install pragmatic-drag-and-drop and create drag types"
```

---

### Task 2: Migrate PaneHeader (pane drag source)

**Files:**
- Modify: `frontend/src/components/workspace/PaneHeader.tsx`

The grip handle becomes a pdnd `draggable()` via a ref + `useEffect`. The `usePaneDrag` hook import is removed. The offscreen preview div is removed — pdnd's `setCustomNativeDragPreview` renders the preview inline.

- [ ] **Step 1: Replace imports**

In `frontend/src/components/workspace/PaneHeader.tsx`, replace:

```ts
import { usePaneDrag } from '../../hooks/usePaneDrag'
```

with:

```ts
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import type { PaneDragData } from '../../lib/dragTypes'
```

- [ ] **Step 2: Replace hook usage with pdnd draggable**

In the `PaneHeader` component body, replace:

```ts
const previewRef = useRef<HTMLDivElement>(null)
const { isDragging, gripProps } = usePaneDrag({ paneId, workspaceId, previewRef })
```

with:

```ts
const gripRef = useRef<HTMLSpanElement>(null)
const [isDragging, setIsDragging] = useState(false)

useEffect(() => {
  const el = gripRef.current
  if (!el) return
  return draggable({
    element: el,
    getInitialData: (): PaneDragData => ({ type: 'pane', paneId, workspaceId }),
    onGenerateDragPreview: ({ nativeSetDragImage }) => {
      setCustomNativeDragPreview({
        nativeSetDragImage,
        render: ({ container }) => {
          const wrapper = document.createElement('div')
          wrapper.className =
            'bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md'
          wrapper.style.borderLeft = `2px solid ${hostColor ?? 'hsl(var(--border))'}`
          const badge = document.createElement('span')
          badge.className =
            'rounded px-1 text-[9px] font-semibold tracking-wide uppercase'
          badge.style.backgroundColor = typeStyle.bg
          badge.style.color = typeStyle.text
          badge.textContent = kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'
          wrapper.appendChild(badge)
          wrapper.appendChild(document.createTextNode(hostLabel))
          container.appendChild(wrapper)
        },
      })
    },
    onDragStart: () => setIsDragging(true),
    onDrop: () => setIsDragging(false),
  })
}, [paneId, workspaceId, hostColor, hostLabel, kind, typeStyle.bg, typeStyle.text])
```

Add `useState` to the react import if not already present.

- [ ] **Step 3: Replace grip props spread with ref**

Replace:

```tsx
<span {...gripProps} className="cursor-grab active:cursor-grabbing">
```

with:

```tsx
<span ref={gripRef} className="cursor-grab active:cursor-grabbing">
```

- [ ] **Step 4: Remove offscreen preview div**

Delete the entire block (currently lines 131-152):

```tsx
{/* Custom drag preview — hidden off-screen until setDragImage captures it */}
<div
  ref={previewRef}
  className="pointer-events-none fixed"
  style={{ left: '-9999px', top: '-9999px' }}
>
  <div
    className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md"
    style={{ borderLeft: `2px solid ${hostColor ?? 'hsl(var(--border))'}` }}
  >
    <span
      className="rounded px-1 text-[9px] font-semibold tracking-wide uppercase"
      style={{
        backgroundColor: typeStyle.bg,
        color: typeStyle.text,
      }}
    >
      {kind === 'terminal' ? 'SSH' : kind === 'sftp' ? 'SFTP' : 'Local'}
    </span>
    {hostLabel}
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/PaneHeader.tsx
git commit -m "refactor: migrate PaneHeader to pragmatic-drag-and-drop draggable"
```

---

### Task 3: Migrate PaneLeafView drop target + update callback chain

**Files:**
- Modify: `frontend/src/components/workspace/DropZoneOverlay.tsx`
- Modify: `frontend/src/components/workspace/PaneTree.tsx`
- Modify: `frontend/src/components/workspace/WorkspaceView.tsx`

PaneLeafView switches from `useDropZone` to pdnd `dropTargetForElements` + `attachClosestEdge`. The `onDrop` callback signature changes throughout the chain: `DropMime` + `data: string` becomes `DragData`. All three files are updated together because they share the callback type.

- [ ] **Step 1: Update DropZoneOverlay to use pdnd Edge type**

In `frontend/src/components/workspace/DropZoneOverlay.tsx`, replace:

```ts
import type { DropEdge } from '../../hooks/useDropZone'
```

with:

```ts
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
```

Then replace every occurrence of `DropEdge` in the file with `Edge`:

```ts
interface Props {
  edge: Edge
  color?: string
}

const edgeStyles: Record<Edge, React.CSSProperties> = {
```

and `arrowChar: Record<Edge, string>`, `arrowPosition: Record<Edge, React.CSSProperties>`.

No logic changes — `Edge` is the same `'top' | 'bottom' | 'left' | 'right'` union.

- [ ] **Step 2: Rewrite PaneTree.tsx**

In `frontend/src/components/workspace/PaneTree.tsx`:

Replace imports:

```ts
import { useDropZone } from '../../hooks/useDropZone'
import type { DropEdge, DropMime } from '../../hooks/useDropZone'
```

with:

```ts
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { isPaneDrag, isHostDrag } from '../../lib/dragTypes'
import type { PaneDragData, HostDragData } from '../../lib/dragTypes'
```

Update the `PaneTreeProps` and `PaneLeafViewProps` `onDrop` signature — replace:

```ts
onDrop: (
  paneId: string,
  edge: DropEdge,
  mime: DropMime,
  data: string,
  shiftKey: boolean,
  clientX: number,
  clientY: number
) => void
```

with:

```ts
onDrop: (
  paneId: string,
  edge: Edge,
  data: PaneDragData | HostDragData,
  shiftKey: boolean,
  clientX: number,
  clientY: number,
) => void
```

This applies to both `PaneTreeProps` (lines 29-39) and `PaneLeafViewProps` (lines 116-125).

- [ ] **Step 3: Rewrite PaneLeafView drop target implementation**

In the `PaneLeafView` function body, replace:

```ts
const [isDragging, setIsDragging] = useState(false)
```

(keep this — it's for the pane's own drag opacity)

Replace:

```ts
const handleDrop = useCallback(
  (
    edge: DropEdge,
    mime: DropMime,
    data: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number
  ) => onDrop(leaf.paneId, edge, mime, data, shiftKey, clientX, clientY),
  [onDrop, leaf.paneId]
)

const { state: dropState, handlers: dropHandlers } = useDropZone({
  onDrop: handleDrop,
})
```

with:

```ts
const dropRef = useRef<HTMLDivElement>(null)
const [dropEdge, setDropEdge] = useState<Edge | null>(null)
const [dropType, setDropType] = useState<'pane' | 'host' | null>(null)

useEffect(() => {
  const el = dropRef.current
  if (!el) return
  return dropTargetForElements({
    element: el,
    canDrop: ({ source }) => isPaneDrag(source.data) || isHostDrag(source.data),
    getData: ({ input, element }) =>
      attachClosestEdge({}, {
        element,
        input,
        allowedEdges: ['top', 'bottom', 'left', 'right'],
      }),
    onDragEnter: ({ source, self }) => {
      setDropEdge(extractClosestEdge(self.data))
      setDropType(source.data.type as 'pane' | 'host')
    },
    onDrag: ({ self }) => {
      setDropEdge(extractClosestEdge(self.data))
    },
    onDragLeave: () => {
      setDropEdge(null)
      setDropType(null)
    },
    onDrop: ({ source, self, location }) => {
      const edge = extractClosestEdge(self.data)
      setDropEdge(null)
      setDropType(null)
      if (!edge) return
      const data = source.data
      if (isPaneDrag(data) || isHostDrag(data)) {
        const { shiftKey, clientX, clientY } = location.current.input
        onDrop(leaf.paneId, edge, data, shiftKey, clientX, clientY)
      }
    },
  })
}, [leaf.paneId, onDrop])
```

Add `useRef` to the react import.

- [ ] **Step 4: Update PaneLeafView JSX**

Replace the wrapping div:

```tsx
<div
  className={cn('group/pane relative flex h-full w-full flex-col', isDragging && 'opacity-30')}
  {...dropHandlers}
  onMouseDown={() => setFocused(leaf.paneId)}
>
```

with:

```tsx
<div
  ref={dropRef}
  className={cn('group/pane relative flex h-full w-full flex-col', isDragging && 'opacity-30')}
  onMouseDown={() => setFocused(leaf.paneId)}
>
```

Replace the DropZoneOverlay usage:

```tsx
{dropState.edge && (
  <DropZoneOverlay
    edge={dropState.edge}
    color={dropState.mime === 'application/x-shsh-host' ? host?.color : undefined}
  />
)}
```

with:

```tsx
{dropEdge && (
  <DropZoneOverlay
    edge={dropEdge}
    color={dropType === 'host' ? host?.color : undefined}
  />
)}
```

- [ ] **Step 5: Update WorkspaceView.tsx**

In `frontend/src/components/workspace/WorkspaceView.tsx`, replace imports:

```ts
import type { DropEdge, DropMime } from '../../hooks/useDropZone'
```

with:

```ts
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { PaneDragData, HostDragData } from '../../lib/dragTypes'
```

Replace the `handleDrop` callback (currently lines 282-330):

```ts
const handleDrop = useCallback(
  (
    workspaceId: string,
    paneId: string,
    edge: DropEdge,
    mime: DropMime,
    data: string,
    shiftKey: boolean,
    clientX: number,
    clientY: number
  ) => {
    const edgeToSplit: Record<
      DropEdge,
      { direction: 'horizontal' | 'vertical'; position: 'before' | 'after' }
    > = {
      top: { direction: 'vertical', position: 'before' },
      bottom: { direction: 'vertical', position: 'after' },
      left: { direction: 'horizontal', position: 'before' },
      right: { direction: 'horizontal', position: 'after' },
    }
    const { direction, position } = edgeToSplit[edge]

    if (mime === 'application/x-shsh-host') {
      const { hostId } = JSON.parse(data) as { hostId: string }
      if (shiftKey) {
        handleSplit(workspaceId, paneId, direction, 'sftp', hostId, position)
      } else {
        setPendingHostDrop({
          workspaceId,
          paneId,
          hostId,
          direction,
          position,
          x: clientX,
          y: clientY,
        })
      }
    } else if (mime === 'application/x-shsh-pane') {
      const { paneId: sourcePaneId, workspaceId: sourceWorkspaceId } = JSON.parse(data) as {
        paneId: string
        workspaceId: string
      }
      handleMovePane(sourceWorkspaceId, sourcePaneId, workspaceId, paneId, direction, position)
    }
  },
  [handleSplit, handleMovePane]
)
```

with:

```ts
const handleDrop = useCallback(
  (
    workspaceId: string,
    paneId: string,
    edge: Edge,
    data: PaneDragData | HostDragData,
    shiftKey: boolean,
    clientX: number,
    clientY: number,
  ) => {
    const edgeToSplit: Record<
      Edge,
      { direction: 'horizontal' | 'vertical'; position: 'before' | 'after' }
    > = {
      top: { direction: 'vertical', position: 'before' },
      bottom: { direction: 'vertical', position: 'after' },
      left: { direction: 'horizontal', position: 'before' },
      right: { direction: 'horizontal', position: 'after' },
    }
    const { direction, position } = edgeToSplit[edge]

    if (data.type === 'host') {
      if (shiftKey) {
        handleSplit(workspaceId, paneId, direction, 'sftp', data.hostId, position)
      } else {
        setPendingHostDrop({
          workspaceId,
          paneId,
          hostId: data.hostId,
          direction,
          position,
          x: clientX,
          y: clientY,
        })
      }
    } else if (data.type === 'pane') {
      handleMovePane(data.workspaceId, data.paneId, workspaceId, paneId, direction, position)
    }
  },
  [handleSplit, handleMovePane]
)
```

Update the `onDrop` prop passed to `PaneTree` (currently lines 400-402):

```tsx
onDrop={(paneId, edge, mime, data, shiftKey, clientX, clientY) =>
  handleDrop(workspace.id, paneId, edge, mime, data, shiftKey, clientX, clientY)
}
```

becomes:

```tsx
onDrop={(paneId, edge, data, shiftKey, clientX, clientY) =>
  handleDrop(workspace.id, paneId, edge, data, shiftKey, clientX, clientY)
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/workspace/DropZoneOverlay.tsx frontend/src/components/workspace/PaneTree.tsx frontend/src/components/workspace/WorkspaceView.tsx
git commit -m "refactor: migrate pane/host drop targets to pragmatic-drag-and-drop"
```

---

### Task 4: Migrate HostListItem (host drag source)

**Files:**
- Modify: `frontend/src/components/sidebar/HostListItem.tsx`

The inline `draggable` attribute, `onDragStart` handler, `previewRef`, and offscreen preview div are replaced by a pdnd `draggable()` attached via ref + `useEffect`.

- [ ] **Step 1: Add pdnd imports**

Add to the imports in `frontend/src/components/sidebar/HostListItem.tsx`:

```ts
import { useEffect } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import type { HostDragData } from '../../lib/dragTypes'
```

Update the react import — `useRef` is already imported; add `useEffect`.

- [ ] **Step 2: Replace drag setup in component body**

Replace:

```ts
const previewRef = useRef<HTMLDivElement>(null)
```

with:

```ts
const dragRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  const el = dragRef.current
  if (!el) return
  return draggable({
    element: el,
    getInitialData: (): HostDragData => ({ type: 'host', hostId: host.id }),
    onGenerateDragPreview: ({ nativeSetDragImage }) => {
      setCustomNativeDragPreview({
        nativeSetDragImage,
        render: ({ container }) => {
          const wrapper = document.createElement('div')
          wrapper.className =
            'bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md'
          if (host.color) {
            const dot = document.createElement('span')
            dot.className = 'size-2 rounded-full'
            dot.style.backgroundColor = host.color
            wrapper.appendChild(dot)
          }
          wrapper.appendChild(document.createTextNode(host.label))
          container.appendChild(wrapper)
        },
      })
    },
  })
}, [host.id, host.color, host.label])
```

- [ ] **Step 3: Update the draggable div element**

Replace:

```tsx
<div
  role="button"
  draggable
  onDragStart={(e) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-shsh-host', JSON.stringify({ hostId: host.id }))
    if (previewRef.current) {
      previewRef.current.style.left = '0px'
      previewRef.current.style.top = '0px'
      e.dataTransfer.setDragImage(previewRef.current, 0, 0)
      requestAnimationFrame(() => {
        if (previewRef.current) {
          previewRef.current.style.left = '-9999px'
          previewRef.current.style.top = '-9999px'
        }
      })
    }
  }}
  onDoubleClick={onConnect}
  className={cn(isConnecting && 'animate-pulse')}
  tabIndex={0}
>
```

with:

```tsx
<div
  ref={dragRef}
  role="button"
  onDoubleClick={onConnect}
  className={cn(isConnecting && 'animate-pulse')}
  tabIndex={0}
>
```

- [ ] **Step 4: Remove the offscreen preview div**

Delete the block after `</ContextMenuTrigger>` (currently lines 232-244):

```tsx
{/* Custom drag preview — hidden off-screen until setDragImage captures it */}
<div
  ref={previewRef}
  className="pointer-events-none fixed"
  style={{ left: '-9999px', top: '-9999px' }}
>
  <div className="bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-md">
    {host.color && (
      <span className="size-2 rounded-full" style={{ backgroundColor: host.color }} />
    )}
    {host.label}
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sidebar/HostListItem.tsx
git commit -m "refactor: migrate HostListItem to pragmatic-drag-and-drop draggable"
```

---

### Task 5: Migrate WorkspaceCard (pane drop target)

**Files:**
- Modify: `frontend/src/components/sidebar/WorkspaceCard.tsx`

The four inline drag handler functions (`handleDragEnter`, `handleDragLeave`, `handleDragOver`, `handleDrop`) and corresponding JSX event props are replaced by a single pdnd `dropTargetForElements()` call.

- [ ] **Step 1: Add pdnd imports**

Add to imports in `frontend/src/components/sidebar/WorkspaceCard.tsx`:

```ts
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { isPaneDrag } from '../../lib/dragTypes'
```

- [ ] **Step 2: Replace inline handlers with pdnd useEffect**

Delete the four handler functions (`handleDragEnter`, `handleDragLeave`, `handleDragOver`, `handleDrop` — currently lines 84-122).

Add a ref and useEffect in their place:

```ts
const cardRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  const el = cardRef.current
  if (!el) return
  return dropTargetForElements({
    element: el,
    canDrop: ({ source }) => isPaneDrag(source.data),
    onDragEnter: () => {
      if (hoverTimerRef.current !== null) return
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null
        onActivate()
      }, 300)
    },
    onDragLeave: () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
    },
    onDrop: ({ source }) => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      if (isPaneDrag(source.data)) {
        onPaneDrop?.(source.data.paneId, source.data.workspaceId)
      }
    },
  })
}, [onActivate, onPaneDrop])
```

- [ ] **Step 3: Update the card div element**

Replace:

```tsx
<div
  role="button"
  onClick={onActivate}
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
>
```

with:

```tsx
<div
  ref={cardRef}
  role="button"
  onClick={onActivate}
>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/WorkspaceCard.tsx
git commit -m "refactor: migrate WorkspaceCard to pragmatic-drag-and-drop drop target"
```

---

### Task 6: Phase 1 cleanup and verification

**Files:**
- Delete: `frontend/src/hooks/useDropZone.ts`
- Delete: `frontend/src/hooks/usePaneDrag.ts`

- [ ] **Step 1: Delete old hook files**

```bash
cd frontend && rm src/hooks/useDropZone.ts src/hooks/usePaneDrag.ts
```

- [ ] **Step 2: Grep for any remaining references**

```bash
cd frontend && grep -r "useDropZone\|usePaneDrag\|DropMime\|application/x-shsh-pane\|application/x-shsh-host" src/ --include="*.ts" --include="*.tsx" || echo "Clean — no references found"
```

Expected: "Clean — no references found"

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass. Key files: `paneTree.test.ts` and `workspaceActions.test.ts` should pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/hooks/useDropZone.ts frontend/src/hooks/usePaneDrag.ts
git commit -m "refactor: delete old drag hooks, phase 1 complete"
```

---

## Phase 2: File Drag + SFTPPanel Consolidation

### Task 7: Create useFileDrag hook

**Files:**
- Create: `frontend/src/hooks/useFileDrag.ts`

This hook handles panel-level drop target setup (for dropping files onto the panel background) and provides a callback for row-level file drops. Row-level pdnd attachment is handled by `FileEntryRow` itself (Task 8).

- [ ] **Step 1: Write the useFileDrag hook**

Create `frontend/src/hooks/useFileDrag.ts`:

```ts
import { useEffect, useRef, useState, useCallback } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { dropTargetForExternal } from '@atlaskit/pragmatic-drag-and-drop/external/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { toast } from 'sonner'
import { isFileTransferDrag } from '../lib/dragTypes'
import type { FileTransferDragData } from '../lib/dragTypes'
import { TransferBetweenChannels } from '@wailsjs/go/main/SessionFacade'

export interface UseFileDragOptions {
  channelId: string
  currentPath: string
  listDir: (path: string) => Promise<void>
  renameFn: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  acceptOSDrops?: boolean
}

export function useFileDrag(options: UseFileDragOptions) {
  const { channelId, currentPath, listDir, renameFn, acceptOSDrops } = options
  const panelRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const isDragOverRef = useRef(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)

  // Panel-level drop target
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const cleanups: (() => void)[] = [
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => isFileTransferDrag(source.data),
        onDragEnter: () => {
          isDragOverRef.current = true
          setIsDragOver(true)
        },
        onDragLeave: () => {
          isDragOverRef.current = false
          setIsDragOver(false)
        },
        onDrop: async ({ source }) => {
          isDragOverRef.current = false
          setIsDragOver(false)
          if (!isFileTransferDrag(source.data)) return
          await handleFileDrop(source.data, currentPath)
        },
      }),
    ]
    if (acceptOSDrops) {
      cleanups.push(
        dropTargetForExternal({
          element: el,
          onDragEnter: () => {
            isDragOverRef.current = true
            setIsDragOver(true)
          },
          onDragLeave: () => {
            isDragOverRef.current = false
            setIsDragOver(false)
          },
          onDrop: () => {
            // Actual OS file upload handled by Wails window:filedrop event.
            // Just reset visual state here.
            isDragOverRef.current = false
            setIsDragOver(false)
          },
        })
      )
    }
    return combine(...cleanups)
  }, [channelId, currentPath, listDir, renameFn, acceptOSDrops])

  const handleFileDrop = useCallback(
    async (source: FileTransferDragData, targetPath: string) => {
      const draggedName = source.path.split('/').pop() ?? source.path

      if (targetPath.startsWith(source.path + '/')) {
        toast.error('Cannot move a folder into itself.')
        return
      }

      try {
        if (source.channelId === channelId) {
          await renameFn(channelId, source.path, targetPath + '/' + draggedName)
        } else {
          await TransferBetweenChannels(
            source.channelId,
            source.path,
            channelId,
            targetPath + '/' + draggedName
          )
        }
        await listDir(currentPath)
      } catch (err) {
        toast.error(String(err))
      }
    },
    [channelId, currentPath, listDir, renameFn]
  )

  return {
    panelRef,
    isDragOver,
    isDragOverRef,
    dragTargetPath,
    setDragTargetPath,
    handleFileDrop,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useFileDrag.ts
git commit -m "feat: add useFileDrag hook built on pragmatic-drag-and-drop"
```

---

### Task 8: Update FileEntryRow and FileList interfaces

**Files:**
- Modify: `frontend/src/components/filepanel/FileEntryRow.tsx`
- Modify: `frontend/src/components/filepanel/FileList.tsx`

FileEntryRow manages its own pdnd setup via a `useEffect` + ref. It receives `channelId`, `onSetDragTarget`, and `onFileDrop` callbacks instead of the `dragHandlers` event handler bag. FileList passes these through.

- [ ] **Step 1: Rewrite FileEntryRow**

Replace the entire contents of `frontend/src/components/filepanel/FileEntryRow.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Folder, File } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { isFileTransferDrag } from '../../lib/dragTypes'
import type { FileTransferDragData } from '../../lib/dragTypes'
import type { FSEntry } from '../../types'
import { cn } from '../../lib/utils'
import { formatSize, formatDate } from './fileUtils'

interface FileEntryRowProps {
  entry: FSEntry
  isSelected: boolean
  isDragTarget: boolean
  channelId: string
  onSetDragTarget: (path: string | null) => void
  onFileDrop: (source: FileTransferDragData, targetPath: string) => void
  onClick: () => void
  onDoubleClick: () => void
}

export function FileEntryRow({
  entry,
  isSelected,
  isDragTarget,
  channelId,
  onSetDragTarget,
  onFileDrop,
  onClick,
  onDoubleClick,
}: FileEntryRowProps) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cleanups: (() => void)[] = [
      draggable({
        element: el,
        getInitialData: (): FileTransferDragData => ({
          type: 'file-transfer',
          channelId,
          path: entry.path,
        }),
      }),
    ]
    if (entry.isDir) {
      cleanups.push(
        dropTargetForElements({
          element: el,
          canDrop: ({ source }) =>
            isFileTransferDrag(source.data) && source.data.path !== entry.path,
          onDragEnter: () => onSetDragTarget(entry.path),
          onDragLeave: () => onSetDragTarget(null),
          onDrop: ({ source }) => {
            onSetDragTarget(null)
            if (isFileTransferDrag(source.data)) {
              onFileDrop(source.data, entry.path)
            }
          },
        })
      )
    }
    return combine(...cleanups)
  }, [channelId, entry.path, entry.isDir, onSetDragTarget, onFileDrop])

  return (
    <button
      ref={ref}
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left transition-colors select-none',
        'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
        isSelected && 'bg-accent text-accent-foreground',
        isDragTarget && 'ring-primary bg-primary/10 ring-1 ring-inset'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {entry.isDir ? (
        <Folder className="text-primary/70 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <File className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      <span className="text-muted-foreground hidden w-16 shrink-0 text-right text-xs tabular-nums @sm:block">
        {formatSize(entry.size, entry.isDir)}
      </span>
      <span className="text-muted-foreground hidden w-24 shrink-0 text-right text-xs tabular-nums @md:block">
        {formatDate(entry.modTime)}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Rewrite FileList**

Replace the entire contents of `frontend/src/components/filepanel/FileList.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { FSEntry } from '../../types'
import type { FileTransferDragData } from '../../lib/dragTypes'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '../ui/context-menu'
import { FileEntryRow } from './FileEntryRow'

interface FileListProps {
  entries: FSEntry[]
  isLoading: boolean
  error: string | null
  selected: string | null
  channelId: string
  dragTargetPath: string | null
  onSetDragTarget: (path: string | null) => void
  onFileDrop: (source: FileTransferDragData, targetPath: string) => void
  onSelect: (path: string) => void
  onDoubleClick: (entry: FSEntry) => void
  contextMenuContent: (entry: FSEntry) => ReactNode
}

export function FileList({
  entries,
  isLoading,
  error,
  selected,
  channelId,
  dragTargetPath,
  onSetDragTarget,
  onFileDrop,
  onSelect,
  onDoubleClick,
  contextMenuContent,
}: FileListProps) {
  return (
    <ScrollArea className="@container min-h-0 w-full flex-1">
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
      {error && !isLoading && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {!isLoading && !error && entries.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-xs">
          <Folder className="size-6 opacity-25" />
          <span>Empty directory</span>
        </div>
      )}
      {!isLoading && !error && (
        <>
          {entries.map((entry) => (
            <ContextMenu key={entry.path}>
              <ContextMenuTrigger asChild>
                <FileEntryRow
                  entry={entry}
                  isSelected={selected === entry.path}
                  isDragTarget={dragTargetPath === entry.path}
                  channelId={channelId}
                  onSetDragTarget={onSetDragTarget}
                  onFileDrop={onFileDrop}
                  onClick={() => onSelect(entry.path)}
                  onDoubleClick={() => onDoubleClick(entry)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>{contextMenuContent(entry)}</ContextMenuContent>
            </ContextMenu>
          ))}
        </>
      )}
    </ScrollArea>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: errors in `LocalFSPanel.tsx` (still passing old props to FileList). This is expected and fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/filepanel/FileEntryRow.tsx frontend/src/components/filepanel/FileList.tsx
git commit -m "refactor: update FileEntryRow and FileList for pragmatic-drag-and-drop"
```

---

### Task 9: Migrate LocalFSPanel

**Files:**
- Modify: `frontend/src/components/localfs/LocalFSPanel.tsx`

Switch from `useFilePanelDrag` to `useFileDrag` and update `FileList` props.

- [ ] **Step 1: Replace imports**

In `frontend/src/components/localfs/LocalFSPanel.tsx`, replace:

```ts
import { useFilePanelDrag } from '../filepanel/useFilePanelDrag'
```

with:

```ts
import { useFileDrag } from '../../hooks/useFileDrag'
```

- [ ] **Step 2: Replace hook usage**

Replace:

```ts
const drag = useFilePanelDrag({
  channelId,
  currentPath: panel.currentPath,
  listDir: panel.listDir,
  renameFn: LocalRename,
  acceptMimeTypes: ['application/x-shsh-transfer'],
})
```

with:

```ts
const drag = useFileDrag({
  channelId,
  currentPath: panel.currentPath,
  listDir: panel.listDir,
  renameFn: LocalRename,
})
```

- [ ] **Step 3: Update the panel wrapper div**

Replace:

```tsx
<div
  className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
  {...drag.panelDragHandlers}
>
```

with:

```tsx
<div
  ref={drag.panelRef}
  className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
>
```

- [ ] **Step 4: Update FileList props**

Replace the `FileList` usage:

```tsx
<FileList
  entries={panel.entries}
  isLoading={panel.isLoading}
  error={panel.error}
  selected={panel.selected}
  dragTargetPath={drag.dragTargetPath}
  onSelect={panel.setSelected}
  onDoubleClick={panel.handleRowDoubleClick}
  makeRowDragHandlers={drag.makeRowDragHandlers}
  contextMenuContent={(entry) => (
```

with:

```tsx
<FileList
  entries={panel.entries}
  isLoading={panel.isLoading}
  error={panel.error}
  selected={panel.selected}
  channelId={channelId}
  dragTargetPath={drag.dragTargetPath}
  onSetDragTarget={drag.setDragTargetPath}
  onFileDrop={drag.handleFileDrop}
  onSelect={panel.setSelected}
  onDoubleClick={panel.handleRowDoubleClick}
  contextMenuContent={(entry) => (
```

- [ ] **Step 5: Update isDragOver overlay**

Replace:

```tsx
{drag.isDragOver && (
```

No change needed — `drag.isDragOver` still exists on the new hook. This line stays as-is.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/localfs/LocalFSPanel.tsx
git commit -m "refactor: migrate LocalFSPanel to useFileDrag"
```

---

### Task 10: Migrate SFTPPanel (consolidation)

**Files:**
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx`

This is the biggest single task. SFTPPanel currently has ~130 lines of inline drag handlers and duplicates the file list rendering that `FileList` + `FileEntryRow` already provide. We replace all of that with `useFileDrag` + `FileList`.

- [ ] **Step 1: Update imports**

In `frontend/src/components/sftp/SFTPPanel.tsx`:

Remove these imports (no longer needed after consolidation):

```ts
import { Folder, File, RefreshCw, Upload, FolderPlus, HelpCircle } from 'lucide-react'
```

Replace with (keep only icons used in toolbar):

```ts
import { RefreshCw, Upload, FolderPlus } from 'lucide-react'
```

Remove:

```ts
import { cn } from '../../lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu'
```

Add:

```ts
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { useFileDrag } from '../../hooks/useFileDrag'
import { FileList } from '../filepanel/FileList'
```

Remove `Skeleton` import — now handled by `FileList`.

Keep all existing SFTP operation imports (`SFTPListDir`, `SFTPDownload`, etc.) and the `TransferBetweenChannels` import (still used by useFileDrag indirectly, but the direct import in SFTPPanel can be removed since the hook handles it). Actually, keep `SFTPDownload`, `SFTPDownloadDir` for the context menu. Remove `TransferBetweenChannels` from SFTPPanel imports since it's now in the hook. Also remove `SFTPRename` from the imports since it's only used as the rename function passed to the hook — actually wait, `SFTPRename` is still needed for the rename modal. Keep it.

The import cleanup depends on what's actually used after the changes. The key additions are `useFileDrag` and `FileList`.

- [ ] **Step 2: Remove inline drag state**

Delete these lines from the component body:

```ts
const [isDragOver, setIsDragOver] = useState(false)
const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
const draggedEntryRef = useRef<FSEntry | null>(null)
const dragCounterRef = useRef(0)
const isDragOverRef = useRef(false)
```

- [ ] **Step 3: Add useFileDrag hook**

Add after the existing state declarations:

```ts
const drag = useFileDrag({
  channelId,
  currentPath,
  listDir,
  renameFn: SFTPRename,
  acceptOSDrops: true,
})
```

- [ ] **Step 4: Update Wails filedrop handler**

In the `window:filedrop` useEffect, replace references to the old `isDragOverRef` with `drag.isDragOverRef`:

```ts
useEffect(() => {
  EventsOn('window:filedrop', async (data: { paths: string[] }) => {
    if (!drag.isDragOverRef.current) return
    drag.isDragOverRef.current = false
```

Remove the old `dragCounterRef.current = 0` and `setIsDragOver(false)` lines from this handler — the hook manages that state now.

- [ ] **Step 5: Remove inline drag handlers from the panel wrapper div**

Replace the entire panel wrapper div opening tag (which has inline `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop` handlers spanning ~60 lines):

```tsx
<div
  className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
  onDragEnter={(e) => {
    ...
  }}
  onDragOver={(e) => {
    ...
  }}
  onDragLeave={() => {
    ...
  }}
  onDrop={async (e) => {
    ...
  }}
>
```

with:

```tsx
<div
  ref={drag.panelRef}
  className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
>
```

- [ ] **Step 6: Replace inline file list with FileList component**

Replace the entire `<ScrollArea>` block and its contents (the loading skeletons, error display, empty state, and the `entries.map(...)` with inline rows — roughly lines 339-487) with:

```tsx
<FileList
  entries={entries}
  isLoading={isLoading}
  error={error}
  selected={selected}
  channelId={channelId}
  dragTargetPath={drag.dragTargetPath}
  onSetDragTarget={drag.setDragTargetPath}
  onFileDrop={drag.handleFileDrop}
  onSelect={setSelected}
  onDoubleClick={handleRowDoubleClick}
  contextMenuContent={(entry) => (
    <>
      {!entry.isDir && (
        <ContextMenuItem onSelect={() => setPreviewPath(entry.path)}>
          Preview
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onSelect={() => {
          const fn = entry.isDir ? SFTPDownloadDir : SFTPDownload
          fn(channelId, entry.path).catch((err) => toast.error(String(err)))
        }}
      >
        Download
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => setModal({ type: 'rename', entry, value: entry.name })}
      >
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => setModal({ type: 'delete', entry })}
      >
        Delete
      </ContextMenuItem>
    </>
  )}
/>
```

- [ ] **Step 7: Update isDragOver overlay**

Replace:

```tsx
{isDragOver && (
```

with:

```tsx
{drag.isDragOver && (
```

- [ ] **Step 8: Delete duplicated formatSize and formatDate functions**

Delete the local `formatSize` and `formatDate` function definitions (currently lines 216-233). These are already in `frontend/src/components/filepanel/fileUtils.ts` and used by `FileEntryRow`.

- [ ] **Step 9: Clean up unused imports**

After all changes, remove any imports that are no longer referenced. This includes:
- `ScrollArea` (now inside FileList)
- `Skeleton` (now inside FileList)
- `Folder`, `File` icons (now inside FileEntryRow)
- `cn` (if no longer used)
- `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent` (now inside FileList)
- `TransferBetweenChannels` (now in useFileDrag)
- `useRef` from react (if no longer needed — check if `draggedEntryRef`, `dragCounterRef`, `isDragOverRef` were the only refs)

Keep: `useEffect`, `useCallback`, `useState` from react. Keep `SFTPRename` (used in modal). Keep `SFTPDownload`, `SFTPDownloadDir` (used in context menu).

- [ ] **Step 10: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/sftp/SFTPPanel.tsx
git commit -m "refactor: consolidate SFTPPanel to use FileList + useFileDrag"
```

---

### Task 11: Phase 2 cleanup and full audit

**Files:**
- Delete: `frontend/src/components/filepanel/useFilePanelDrag.ts`

- [ ] **Step 1: Delete old file drag hook**

```bash
cd frontend && rm src/components/filepanel/useFilePanelDrag.ts
```

- [ ] **Step 2: Run full audit grep for orphaned drag patterns**

```bash
cd frontend && echo "=== React drag event handlers ===" && grep -rn "onDragStart\|onDragEnd\|onDragOver\|onDragEnter\|onDragLeave\|onDrop" src/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v "\.test\." || echo "None"
```

Expected: zero matches. If App.tsx shows `onDragStart` — that's the debug panel resize (mouse-based, not drag-and-drop). Verify it uses `React.MouseEvent`, not `React.DragEvent`. This is a false positive.

```bash
cd frontend && echo "=== draggable HTML attribute ===" && grep -rn 'draggable' src/ --include="*.tsx" | grep -v node_modules || echo "None"
```

Expected: zero matches.

```bash
cd frontend && echo "=== Old MIME types ===" && grep -rn "application/x-shsh-pane\|application/x-shsh-host\|application/x-shsh-transfer" src/ --include="*.ts" --include="*.tsx" || echo "None"
```

Expected: zero matches.

```bash
cd frontend && echo "=== Old drag refs ===" && grep -rn "dragCounterRef\|draggedEntryRef\|setDragImage" src/ --include="*.ts" --include="*.tsx" || echo "None"
```

Expected: zero matches.

```bash
cd frontend && echo "=== Old hook imports ===" && grep -rn "useDropZone\|usePaneDrag\|useFilePanelDrag\|DropMime" src/ --include="*.ts" --include="*.tsx" || echo "None"
```

Expected: zero matches.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/filepanel/useFilePanelDrag.ts
git commit -m "refactor: delete old useFilePanelDrag, migration complete"
```

---

## Notes

- **Deviation from spec:** The spec describes `useFileDrag` returning `makeRowProps(entry) → { ref, isDragTarget }`. The plan instead has `FileEntryRow` manage its own pdnd setup internally via `useEffect` + local ref, with the hook returning `dragTargetPath`, `setDragTargetPath`, and `handleFileDrop`. This is the idiomatic pdnd pattern (each draggable/droppable component owns its own setup), avoids complex callback-ref lifecycle management in the hook, and gives each row a stable `useEffect` tied to its own `entry.path`.
- **App.tsx `onDragStart`** is a mouse-based resize handler for the debug panel. It uses `React.MouseEvent` and `mousemove`/`mouseup` listeners — not the HTML5 Drag API. It is not part of this migration and is a false positive in audit greps.
- **Wails `window:filedrop` event** remains the mechanism for OS file upload. pdnd's `dropTargetForExternal()` provides visual feedback (the "Drop to upload" overlay) but does not handle the actual file data. `isDragOverRef` bridges the two systems.
- **Existing tests** (`paneTree.test.ts`, `workspaceActions.test.ts`) operate on pure tree-manipulation functions with pane/workspace ID arguments. They have no drag type references and require no changes.
- **`ContextMenuTrigger asChild`** in FileList wraps `FileEntryRow`. Since `FileEntryRow` uses `forwardRef` is not needed — `ContextMenuTrigger asChild` uses `Slot` which merges props onto the child. `FileEntryRow` manages its own ref internally via `useRef`, and Radix's `asChild` will merge the context menu's ref onto the button element. If TypeScript complains, wrap `FileEntryRow` in `forwardRef` to accept the merged ref.
