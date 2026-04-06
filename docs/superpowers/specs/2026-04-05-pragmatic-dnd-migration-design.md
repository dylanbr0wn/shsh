# Pragmatic Drag-and-Drop Migration

Replace custom HTML5 Drag API code with [pragmatic-drag-and-drop](https://atlassian.design/components/pragmatic-drag-and-drop/) (pdnd) by Atlassian. The project has ~2,400 lines of hand-rolled drag infrastructure across three systems (pane dragging, host dragging, file dragging) that is becoming costly to maintain. pdnd provides built-in edge detection, typed drag data, and external file drop support — all things currently implemented by hand.

## Why pragmatic-drag-and-drop over dnd-kit

- **Built on HTML5 Drag API** — matches the existing architecture, supports OS file drops natively via `dropTargetForExternal()`. dnd-kit uses pointer events and cannot detect external file drags at all.
- **Built-in edge detection** — `attachClosestEdge()` / `extractClosestEdge()` directly replaces the custom `nearestEdge()` function in useDropZone.
- **4.7KB gzipped core** — smallest bundle of the viable options (dnd-kit is 12KB).
- **Active maintenance** — last release March 2026. Powers Trello, Jira, Confluence at scale.

## Packages

- `@atlaskit/pragmatic-drag-and-drop` — core `draggable()`, `dropTargetForElements()`, `dropTargetForExternal()`, `combine()`
- `@atlaskit/pragmatic-drag-and-drop-hitbox` — `attachClosestEdge()`, `extractClosestEdge()`

## Core API Shift

**Before (React event handlers on JSX):**

```tsx
<div onDragOver={handleDragOver} onDrop={handleDrop} />
```

**After (imperative attachment via refs + useEffect):**

```tsx
const ref = useRef<HTMLDivElement>(null)
useEffect(() => {
  const el = ref.current
  if (!el) return
  return dropTargetForElements({
    element: el,
    canDrop: ({ source }) => source.data.type === 'pane',
    onDrop: ({ source }) => { /* handle */ },
  })
}, [])
```

pdnd manages nested element enter/leave tracking internally, eliminating all `dragCounterRef` patterns.

## Drag Data Types

Replace MIME-type string discrimination with a typed union:

```ts
type DragData =
  | { type: 'pane'; paneId: string; workspaceId: string }
  | { type: 'host'; hostId: string }
  | { type: 'file-transfer'; channelId: string; path: string }
```

Drop targets use `canDrop({ source }) => source.data.type === 'pane'` instead of parsing `e.dataTransfer.types`.

## Phase 1: Pane + Host Drag

### Files Deleted

| File | Lines | Reason |
|------|-------|--------|
| `hooks/useDropZone.ts` | 101 | Replaced by `dropTargetForElements` + `attachClosestEdge` |
| `hooks/usePaneDrag.ts` | 45 | Replaced by `draggable()` |

### Files Modified

**PaneHeader.tsx** — Grip handle becomes a pdnd `draggable`:
- Ref attached to the grip `<span>`
- `getInitialData`: returns `{ type: 'pane', paneId, workspaceId }`
- `onGenerateDragPreview`: uses `setCustomNativeDragPreview` to render the existing styled preview (host label + type badge), replacing the `setDragImage` + offscreen positioning hack
- `onDragStart` / `onDrop`: manages `isDragging` state via `onDragStateChange`
- `previewRef` offscreen div removed

**PaneTree.tsx (PaneLeafView)** — Wrapping div becomes a pdnd `dropTargetForElements`:
- `canDrop`: accepts `type === 'pane'` or `type === 'host'`
- `getData`: uses `attachClosestEdge({ element, input, allowedEdges: ['top','bottom','left','right'] })` to embed edge info
- `onDragEnter` / `onDrag`: extracts edge via `extractClosestEdge()`, sets state for DropZoneOverlay
- `onDragLeave` / `onDrop`: clears state, fires existing `onDrop` callback
- `useDropZone` import and `dropHandlers` spread removed

**DropZoneOverlay.tsx** — No API change. Still receives `edge` and `color` props. Only the source of those props changes (pdnd state instead of useDropZone state).

**HostListItem.tsx** — Inline drag code replaced by pdnd `draggable()`:
- Ref attached to the `<div role="button">`
- `getInitialData`: returns `{ type: 'host', hostId: host.id }`
- `onGenerateDragPreview`: renders existing preview (host dot + label)
- `draggable` HTML attribute and inline `onDragStart` handler removed
- `previewRef` offscreen div removed

**WorkspaceCard.tsx** — Drop handling replaced by pdnd `dropTargetForElements`:
- `canDrop`: accepts only `type === 'pane'`
- `onDragEnter`: starts 300ms hover timer to auto-activate workspace
- `onDragLeave`: clears timer
- `onDrop`: parses pane data, calls `onPaneDrop`
- Four inline handler functions (`handleDragEnter`, `handleDragLeave`, `handleDragOver`, `handleDrop`) removed. `hoverTimerRef` stays.

**WorkspaceView.tsx** — `handleDrop` callback signature changes: receives typed `DragData` + `Edge` from pdnd instead of `(edge: DropEdge, mime: DropMime, data: string, ...)`. The `edgeToSplit` mapping stays. `DropEdge` / `DropMime` type imports removed.

### Type Changes

- `DropEdge` and `DropMime` exports from `useDropZone.ts` are removed
- pdnd's `Edge` type (`'top' | 'bottom' | 'left' | 'right'`) from `@atlaskit/pragmatic-drag-and-drop-hitbox` replaces `DropEdge` — same union, different import
- `DropMime` replaced by the `type` field on `DragData`

## Phase 2: File Drag + SFTPPanel Consolidation

### Files Deleted

| File | Lines | Reason |
|------|-------|--------|
| `components/filepanel/useFilePanelDrag.ts` | 167 | Replaced by new pdnd-based hook |

### New File

**`hooks/useFileDrag.ts`** — Shared hook for SFTPPanel and LocalFSPanel, built on pdnd.

Takes: `channelId`, `currentPath`, `listDir`, `renameFn`, `acceptOSDrops?`

Returns:
- `panelDropRef` — ref for the panel container element
- `isDragOver` — boolean for "Drop to upload/move" overlay
- `isDragOverRef` — ref for async Wails `window:filedrop` handler to check target
- `makeRowProps(entry)` — returns `{ ref, isDragTarget }` per row

Panel-level: uses `dropTargetForElements` with `canDrop: type === 'file-transfer'`. When `acceptOSDrops` is true, also uses `dropTargetForExternal()` via `combine()` for OS file drop visual feedback.

Row-level: `makeRowProps` returns a ref that attaches both `draggable()` and `dropTargetForElements()` via `combine()`:
- Draggable: `getInitialData: () => ({ type: 'file-transfer', channelId, path })`
- Drop target: `canDrop: source.data.type === 'file-transfer' && entry.isDir`, with circular-move validation

The `draggedEntryRef` pattern is eliminated — pdnd's `onDrop` receives both `source.data` and `self.data`, so paths can be compared directly.

### Files Modified

**SFTPPanel.tsx** — ~130 lines of inline drag handlers removed (lines 238-297 panel-level, lines 378-441 per-row). Uses `useFileDrag` hook instead, same as LocalFSPanel. The `isDragOver`, `dragTargetPath`, `draggedEntryRef`, `dragCounterRef`, `isDragOverRef` state/refs are all removed from the component and managed by the hook. OS file upload still handled via Wails `window:filedrop` event — `isDragOverRef` from the hook tells it whether this panel was the target.

**LocalFSPanel.tsx** — Switches from `useFilePanelDrag` to `useFileDrag`. Minimal change since it already uses the shared hook pattern.

**FileEntryRow.tsx** — `dragHandlers` prop (5 event handlers) replaced by a `dragRef` callback ref + `isDragTarget` boolean. The `draggable` HTML attribute is removed (pdnd sets it). Component becomes simpler.

**FileList.tsx** — Updated to pass `makeRowProps` results instead of `makeRowDragHandlers`.

## Post-Migration Audit

After phase 2, grep the entire `frontend/src/` for orphaned drag code:

| Pattern | Expected matches |
|---------|-----------------|
| `onDragStart`, `onDragEnd`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` (as React event handlers) | 0 |
| `draggable` (as HTML attribute) | 0 |
| `e.dataTransfer` / `dataTransfer` | 0 (except Wails `window:filedrop` if it uses it) |
| `application/x-shsh-pane`, `application/x-shsh-host`, `application/x-shsh-transfer` | 0 |
| `dragCounterRef`, `draggedEntryRef` | 0 |
| `setDragImage` | 0 |

Also check `App.tsx` for any debug panel drag code (identified during exploration).

## Existing Tests

Two test files touch drag-adjacent logic:

- **`lib/paneTree.test.ts`** — Tests `moveLeaf()` (6 cases) and `movePaneAcrossWorkspaces()` (5 cases). These are pure tree-manipulation functions that take pane/workspace IDs. They don't reference `DropEdge`, `DropMime`, or any drag event types. **No changes needed** — migration only changes how drag events trigger these functions, not the functions themselves.

- **`store/workspaceActions.test.ts`** — Tests `movePaneAtom` (2 cases) for intra- and cross-workspace moves via Jotai. Same as above — operates on pane/workspace IDs, no drag types involved. **No changes needed.**

No tests exist for the drag hooks themselves (useDropZone, usePaneDrag, useFilePanelDrag).

## Test Plan

### Existing test audit

After each phase, run `vitest run` to confirm no regressions. Specifically verify:

- `paneTree.test.ts` passes — if `moveLeaf` / `movePaneAcrossWorkspaces` signatures change, update tests
- `workspaceActions.test.ts` passes — if `movePaneAtom` payload shape changes, update tests

### Manual verification — Phase 1

- [ ] Drag pane grip to all four edges of another pane — splits in correct direction
- [ ] Drag host from sidebar to pane edges — type chooser appears at cursor (shift+drag opens SFTP directly)
- [ ] Drag pane onto workspace card — auto-activates after 300ms hover, moves pane on drop
- [ ] Custom drag previews render correctly (host: dot + label; pane: type badge + host label)
- [ ] Dragged pane dims to 30% opacity, restores on drop/cancel
- [ ] Drag onto invalid targets (e.g., sidebar) — no drop effect, no errors

### Manual verification — Phase 2

- [ ] Drag file row onto directory row (same panel) — moves file into directory
- [ ] Drag file row onto different SFTP/local panel background — moves to that panel's current directory
- [ ] Drag between SFTP panels on different hosts — cross-channel transfer with progress toast
- [ ] Drag folder into itself — "Cannot move a folder into itself" error toast
- [ ] Drag OS files onto SFTP panel — "Drop to upload" overlay appears, files upload via Wails
- [ ] OS file drag over LocalFSPanel — no overlay (acceptOSDrops disabled)
- [ ] Drag file over non-directory row — no drop indicator

### Audit verification

- [ ] All grep patterns from the audit table return 0 matches
- [ ] `vitest run` passes
- [ ] No TypeScript errors (`tsc --noEmit`)

## Removed Code Budget

| Deleted | Lines |
|---------|-------|
| `useDropZone.ts` | 101 |
| `usePaneDrag.ts` | 45 |
| `useFilePanelDrag.ts` | 167 |
| SFTPPanel inline drag handlers | ~130 |
| **Total removed** | **~443** |

| Added | Lines (est.) |
|-------|-------------|
| `useFileDrag.ts` (new shared hook) | ~80-100 |
| pdnd wiring per component (~5-15 lines each, ~8 components) | ~80 |
| **Total added** | **~160-180** |

**Net reduction: ~260-280 lines** of custom drag code replaced by a maintained library.
