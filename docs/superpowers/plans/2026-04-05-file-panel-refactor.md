# File Panel Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~400 lines of duplicate code between `SFTPPanel` and `LocalFSPanel` by extracting shared types, hooks, and components into `components/filepanel/`.

**Architecture:** Extract shared logic into a `useFilePanelState` hook (state, listDir, modals, CRUD) and a `useFilePanelDrag` hook (drag counter, MIME handling, drop handlers). Extract shared UI into `FileList`, `FileEntryRow`, `FilePanelModals`, and `FilePanelToolbar` components. Rename `SFTPEntry`/`SFTPState`/`sftpStateAtom` to generic `FSEntry`/`FSState`/`fsPanelStateAtom`. Move `FilePreviewModal` from `sftp/` to `filepanel/`.

**Tech Stack:** React 19, TypeScript, Jotai (atoms), Vitest + React Testing Library, Tailwind CSS, shadcn/ui components

**Spec:** `docs/superpowers/specs/2026-04-05-file-panel-refactor-design.md`

---

## File Map

### New files
- `frontend/src/components/filepanel/fileUtils.ts` — `formatSize`, `formatDate` pure utilities
- `frontend/src/components/filepanel/fileUtils.test.ts` — tests for utilities
- `frontend/src/components/filepanel/useFilePanelState.ts` — shared state hook
- `frontend/src/components/filepanel/useFilePanelDrag.ts` — shared drag hook
- `frontend/src/components/filepanel/FilePanelToolbar.tsx` — toolbar component
- `frontend/src/components/filepanel/FilePanelModals.tsx` — mkdir/rename/delete dialogs
- `frontend/src/components/filepanel/FileEntryRow.tsx` — single file row
- `frontend/src/components/filepanel/FileList.tsx` — scrollable file list with loading/error/empty states

### Moved files
- `frontend/src/components/sftp/FilePreviewModal.tsx` → `frontend/src/components/filepanel/FilePreviewModal.tsx`

### Modified files
- `frontend/src/types/index.ts` — rename `SFTPEntry` → `FSEntry`, `SFTPState` → `FSState`
- `frontend/src/store/atoms.ts` — rename `sftpStateAtom` → `fsPanelStateAtom`
- `frontend/src/components/sftp/SFTPPanel.tsx` — rewrite as thin wrapper
- `frontend/src/components/localfs/LocalFSPanel.tsx` — rewrite as thin wrapper
- `frontend/src/components/workspace/PaneTree.tsx` — update `SFTPPanel` props (remove `connectionId`)
- `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts` — add `SFTPPreviewFile`, `LocalPreviewFile` stubs

---

### Task 1: Rename types and atom

**Files:**
- Modify: `frontend/src/types/index.ts:127-141`
- Modify: `frontend/src/store/atoms.ts:4,34`
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx:7,45-50,57-61,63-64,70`
- Modify: `frontend/src/components/localfs/LocalFSPanel.tsx:6,42-47,53-57,59-60,66`

- [ ] **Step 1: Rename types in `types/index.ts`**

In `frontend/src/types/index.ts`, rename `SFTPEntry` to `FSEntry` and `SFTPState` to `FSState`:

```ts
export interface FSEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: string
  mode: string
}

export interface FSState {
  currentPath: string
  entries: FSEntry[]
  isLoading: boolean
  error: string | null
}
```

- [ ] **Step 2: Rename atom in `store/atoms.ts`**

In `frontend/src/store/atoms.ts`:

Change the import on line 4:
```ts
import type { Host, Group, FSState, PortForwardPanelState, TerminalProfile } from '../types'
```

Change the atom on line 34:
```ts
// Map of channelId → FSState (used by both SFTP and local file panels)
export const fsPanelStateAtom = atom<Record<string, FSState>>({})
```

- [ ] **Step 3: Update `SFTPPanel.tsx` imports and references**

In `frontend/src/components/sftp/SFTPPanel.tsx`:

Change line 5:
```ts
import { fsPanelStateAtom } from '../../store/atoms'
```

Change line 7:
```ts
import type { FSEntry, FSState } from '../../types'
```

Change line 45:
```ts
const DEFAULT_SFTP_STATE: FSState = {
```

Change `Modal` type (lines 57-61) — replace `SFTPEntry` with `FSEntry`:
```ts
type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: FSEntry; value: string }
  | { type: 'delete'; entry: FSEntry }
```

Change line 64:
```ts
  const [state, setState] = useChannelPanelState(fsPanelStateAtom, channelId, DEFAULT_SFTP_STATE)
```

Change line 70:
```ts
  const draggedEntryRef = useRef<FSEntry | null>(null)
```

Change `handleRowDoubleClick` parameter (line 168):
```ts
  function handleRowDoubleClick(entry: FSEntry) {
```

Change `handleRenameConfirm` parameter (line 195):
```ts
  async function handleRenameConfirm(entry: FSEntry, newName: string) {
```

Change `handleDeleteConfirm` parameter (line 206):
```ts
  async function handleDeleteConfirm(entry: FSEntry) {
```

- [ ] **Step 4: Update `LocalFSPanel.tsx` imports and references**

In `frontend/src/components/localfs/LocalFSPanel.tsx`:

Change line 4:
```ts
import { fsPanelStateAtom } from '../../store/atoms'
```

Change line 6:
```ts
import type { FSEntry, FSState } from '../../types'
```

Change line 42:
```ts
const DEFAULT_LOCAL_STATE: FSState = {
```

Change `Modal` type (lines 53-57) — replace `SFTPEntry` with `FSEntry`:
```ts
type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: FSEntry; value: string }
  | { type: 'delete'; entry: FSEntry }
```

Change line 60:
```ts
  const [state, setState] = useChannelPanelState(fsPanelStateAtom, channelId, DEFAULT_LOCAL_STATE)
```

Change line 66:
```ts
  const draggedEntryRef = useRef<FSEntry | null>(null)
```

Change `handleRowDoubleClick` parameter (line 134):
```ts
  function handleRowDoubleClick(entry: FSEntry) {
```

Change `handleRenameConfirm` parameter (line 152):
```ts
  async function handleRenameConfirm(entry: FSEntry, newName: string) {
```

Change `handleDeleteConfirm` parameter (line 163):
```ts
  async function handleDeleteConfirm(entry: FSEntry) {
```

- [ ] **Step 5: Verify build and tests pass**

Run:
```bash
cd frontend && npx tsc --noEmit && npm test
```
Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/store/atoms.ts frontend/src/components/sftp/SFTPPanel.tsx frontend/src/components/localfs/LocalFSPanel.tsx
git commit -m "refactor: rename SFTPEntry/SFTPState/sftpStateAtom to FSEntry/FSState/fsPanelStateAtom"
```

---

### Task 2: Extract `fileUtils.ts` with tests

**Files:**
- Create: `frontend/src/components/filepanel/fileUtils.ts`
- Create: `frontend/src/components/filepanel/fileUtils.test.ts`

- [ ] **Step 1: Write tests for `formatSize` and `formatDate`**

Create `frontend/src/components/filepanel/fileUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatSize, formatDate } from './fileUtils'

describe('formatSize', () => {
  it('returns dash for directories', () => {
    expect(formatSize(4096, true)).toBe('—')
  })

  it('formats bytes', () => {
    expect(formatSize(512, false)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatSize(2048, false)).toBe('2.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatSize(1536 * 1024, false)).toBe('1.5 MB')
  })

  it('formats zero bytes', () => {
    expect(formatSize(0, false)).toBe('0 B')
  })
})

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    const result = formatDate('2026-01-15T10:30:00Z')
    // Intl output varies by locale, just verify it doesn't throw and contains year
    expect(result).toContain('2026')
  })

  it('returns the raw string for an invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd frontend && npx vitest run src/components/filepanel/fileUtils.test.ts
```
Expected: FAIL — module `./fileUtils` not found.

- [ ] **Step 3: Implement `fileUtils.ts`**

Create `frontend/src/components/filepanel/fileUtils.ts`:

```ts
export function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/components/filepanel/fileUtils.test.ts
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/filepanel/fileUtils.ts frontend/src/components/filepanel/fileUtils.test.ts
git commit -m "refactor: extract formatSize and formatDate into filepanel/fileUtils"
```

---

### Task 3: Create `useFilePanelState` hook

**Files:**
- Create: `frontend/src/components/filepanel/useFilePanelState.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/components/filepanel/useFilePanelState.ts`:

```ts
import { useEffect, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { fsPanelStateAtom } from '../../store/atoms'
import { useChannelPanelState } from '../../store/useChannelPanelState'
import type { FSEntry, FSState } from '../../types'
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime'

export type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: FSEntry; value: string }
  | { type: 'delete'; entry: FSEntry }

export interface FilePanelStateOptions {
  listDirFn: (channelId: string, path: string) => Promise<FSEntry[]>
  getInitialPath: () => Promise<string>
  resolvePath?: (entries: FSEntry[], requestedPath: string) => string
}

export interface FilePanelOperations {
  mkdir: (channelId: string, path: string) => Promise<void>
  rename: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  delete: (channelId: string, path: string) => Promise<void>
}

const DEFAULT_STATE: FSState = {
  currentPath: '',
  entries: [],
  isLoading: false,
  error: null,
}

export function useFilePanelState(
  channelId: string,
  options: FilePanelStateOptions,
  operations: FilePanelOperations
) {
  const [state, setState] = useChannelPanelState(fsPanelStateAtom, channelId, DEFAULT_STATE)
  const { currentPath, entries, isLoading, error } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>({ type: 'none' })
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const listDir = useCallback(
    async (path: string) => {
      setState({ isLoading: true, error: null })
      try {
        const result = await options.listDirFn(channelId, path)
        const resolvedPath = options.resolvePath
          ? options.resolvePath(result ?? [], path)
          : path
        setState({ entries: result ?? [], currentPath: resolvedPath, isLoading: false })
      } catch (err) {
        setState({ isLoading: false, error: String(err) })
      }
    },
    [channelId, setState, options]
  )

  // Mount init + progress toasts
  useEffect(() => {
    let cancelled = false

    async function init() {
      setState({ isLoading: true, error: null, entries: [], currentPath: '' })
      try {
        const initialPath = await options.getInitialPath()
        if (!cancelled) await listDir(initialPath || '/')
      } catch (err) {
        if (!cancelled) setState({ isLoading: false, error: String(err) })
      }
    }

    init()

    // Transfer progress toasts
    const eventKey = `channel:transfer-progress:${channelId}`
    const toastIds: Map<string, string | number> = new Map()
    const completedPaths: Set<string> = new Set()

    EventsOn(eventKey, (evt: { path: string; bytes: number; total: number }) => {
      if (completedPaths.has(evt.path)) return
      const pct = evt.total > 0 ? Math.round((evt.bytes / evt.total) * 100) : 0
      const label = evt.path.split('/').pop() ?? evt.path
      const existing = toastIds.get(evt.path)
      if (pct >= 100) {
        completedPaths.add(evt.path)
        if (existing !== undefined) {
          toast.success(`${label} transferred`, { id: existing })
        } else {
          toast.success(`${label} transferred`)
        }
        toastIds.delete(evt.path)
      } else if (existing !== undefined) {
        toast.loading(`Transferring ${label}… ${pct}%`, { id: existing })
      } else {
        const id = toast.loading(`Transferring ${label}… ${pct}%`)
        toastIds.set(evt.path, id)
      }
    })

    return () => {
      cancelled = true
      EventsOff(eventKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  function handleRowDoubleClick(entry: FSEntry) {
    if (entry.isDir) {
      listDir(entry.path)
    } else {
      setPreviewPath(entry.path)
    }
  }

  async function handleMkdirConfirm(name: string) {
    setModal({ type: 'none' })
    try {
      await operations.mkdir(channelId, currentPath + '/' + name)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleRenameConfirm(entry: FSEntry, newName: string) {
    setModal({ type: 'none' })
    if (!newName || newName === entry.name) return
    try {
      await operations.rename(channelId, entry.path, currentPath + '/' + newName)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleDeleteConfirm(entry: FSEntry) {
    setModal({ type: 'none' })
    try {
      await operations.delete(channelId, entry.path)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  return {
    currentPath,
    entries,
    isLoading,
    error,
    listDir,
    selected,
    setSelected,
    modal,
    setModal,
    previewPath,
    setPreviewPath,
    handleRowDoubleClick,
    handleMkdirConfirm,
    handleRenameConfirm,
    handleDeleteConfirm,
  }
}
```

- [ ] **Step 2: Verify build passes**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/filepanel/useFilePanelState.ts
git commit -m "refactor: extract useFilePanelState hook for shared file panel logic"
```

---

### Task 4: Create `useFilePanelDrag` hook

**Files:**
- Create: `frontend/src/components/filepanel/useFilePanelDrag.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/components/filepanel/useFilePanelDrag.ts`:

```ts
import { useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import type { FSEntry } from '../../types'
import { TransferBetweenChannels } from '@wailsjs/go/main/SessionFacade'

export interface FilePanelDragOptions {
  channelId: string
  currentPath: string
  listDir: (path: string) => Promise<void>
  renameFn: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  acceptMimeTypes: string[]
  acceptOSDrops?: boolean
}

export function useFilePanelDrag(options: FilePanelDragOptions) {
  const { channelId, currentPath, listDir, renameFn, acceptMimeTypes, acceptOSDrops } = options
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const draggedEntryRef = useRef<FSEntry | null>(null)
  const dragCounterRef = useRef(0)
  const isDragOverRef = useRef(false)

  const hasAcceptedType = useCallback(
    (types: DOMStringList | readonly string[]) => {
      return acceptMimeTypes.some((mime) =>
        typeof types.contains === 'function' ? types.contains(mime) : (types as readonly string[]).includes(mime)
      )
    },
    [acceptMimeTypes]
  )

  const panelDragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (hasAcceptedType(e.dataTransfer.types)) {
        e.preventDefault()
        dragCounterRef.current++
        if (dragCounterRef.current === 1) {
          if (acceptOSDrops) isDragOverRef.current = true
          setIsDragOver(true)
        }
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasAcceptedType(e.dataTransfer.types)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
      }
    },
    onDragLeave: () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) {
        if (acceptOSDrops) isDragOverRef.current = false
        setIsDragOver(false)
      }
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault()
      dragCounterRef.current = 0
      if (acceptOSDrops) isDragOverRef.current = false
      setIsDragOver(false)

      const raw = e.dataTransfer.getData('application/x-shsh-transfer')
      if (raw) {
        const payload: { channelId: string; path: string } = JSON.parse(raw)
        const draggedName = payload.path.split('/').pop() ?? payload.path
        draggedEntryRef.current = null

        try {
          if (payload.channelId === channelId) {
            await renameFn(channelId, payload.path, currentPath + '/' + draggedName)
          } else {
            await TransferBetweenChannels(
              payload.channelId,
              payload.path,
              channelId,
              currentPath + '/' + draggedName
            )
          }
          await listDir(currentPath)
        } catch (err) {
          toast.error(String(err))
        }
      }
    },
  }

  function makeRowDragHandlers(entry: FSEntry) {
    return {
      onDragStart: (e: React.DragEvent) => {
        draggedEntryRef.current = entry
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/x-shsh-transfer',
          JSON.stringify({ channelId, path: entry.path })
        )
      },
      onDragOver: (e: React.DragEvent) => {
        if (entry.isDir && e.dataTransfer.types.includes('application/x-shsh-transfer')) {
          if (draggedEntryRef.current?.path === entry.path) return
          e.preventDefault()
          e.stopPropagation()
          setDragTargetPath(entry.path)
        }
      },
      onDragLeave: () => setDragTargetPath(null),
      onDrop: async (e: React.DragEvent) => {
        if (!entry.isDir) return
        e.preventDefault()
        e.stopPropagation()
        setDragTargetPath(null)

        const raw = e.dataTransfer.getData('application/x-shsh-transfer')
        if (!raw) return
        const payload: { channelId: string; path: string } = JSON.parse(raw)
        const draggedName = payload.path.split('/').pop() ?? payload.path

        draggedEntryRef.current = null

        if (payload.path === entry.path) return
        if (entry.path.startsWith(payload.path + '/')) {
          toast.error('Cannot move a folder into itself.')
          return
        }

        try {
          if (payload.channelId === channelId) {
            await renameFn(channelId, payload.path, entry.path + '/' + draggedName)
          } else {
            await TransferBetweenChannels(
              payload.channelId,
              payload.path,
              channelId,
              entry.path + '/' + draggedName
            )
          }
          await listDir(currentPath)
        } catch (err) {
          toast.error(String(err))
        }
      },
      onDragEnd: () => {
        draggedEntryRef.current = null
        setDragTargetPath(null)
      },
    }
  }

  return {
    isDragOver,
    isDragOverRef,
    dragTargetPath,
    setDragTargetPath,
    draggedEntryRef,
    panelDragHandlers,
    makeRowDragHandlers,
  }
}
```

- [ ] **Step 2: Verify build passes**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/filepanel/useFilePanelDrag.ts
git commit -m "refactor: extract useFilePanelDrag hook for shared drag-and-drop logic"
```

---

### Task 5: Create shared UI components

**Files:**
- Create: `frontend/src/components/filepanel/FileEntryRow.tsx`
- Create: `frontend/src/components/filepanel/FileList.tsx`
- Create: `frontend/src/components/filepanel/FilePanelToolbar.tsx`
- Create: `frontend/src/components/filepanel/FilePanelModals.tsx`

- [ ] **Step 1: Create `FileEntryRow.tsx`**

Create `frontend/src/components/filepanel/FileEntryRow.tsx`:

```tsx
import { Folder, File } from 'lucide-react'
import type { FSEntry } from '../../types'
import { cn } from '../../lib/utils'
import { formatSize, formatDate } from './fileUtils'

interface FileEntryRowProps {
  entry: FSEntry
  isSelected: boolean
  isDragTarget: boolean
  onClick: () => void
  onDoubleClick: () => void
  dragHandlers: {
    onDragStart: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDrop: React.DragEventHandler
    onDragEnd: React.DragEventHandler
  }
}

export function FileEntryRow({
  entry,
  isSelected,
  isDragTarget,
  onClick,
  onDoubleClick,
  dragHandlers,
}: FileEntryRowProps) {
  return (
    <button
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left transition-colors select-none',
        'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
        isSelected && 'bg-accent text-accent-foreground',
        isDragTarget && 'ring-primary bg-primary/10 ring-1 ring-inset'
      )}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...dragHandlers}
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

- [ ] **Step 2: Create `FileList.tsx`**

Create `frontend/src/components/filepanel/FileList.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { FSEntry } from '../../types'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from '../ui/context-menu'
import { FileEntryRow } from './FileEntryRow'

interface FileListProps {
  entries: FSEntry[]
  isLoading: boolean
  error: string | null
  selected: string | null
  dragTargetPath: string | null
  onSelect: (path: string) => void
  onDoubleClick: (entry: FSEntry) => void
  makeRowDragHandlers: (entry: FSEntry) => {
    onDragStart: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDrop: React.DragEventHandler
    onDragEnd: React.DragEventHandler
  }
  contextMenuContent: (entry: FSEntry) => ReactNode
}

export function FileList({
  entries,
  isLoading,
  error,
  selected,
  dragTargetPath,
  onSelect,
  onDoubleClick,
  makeRowDragHandlers,
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
                  onClick={() => onSelect(entry.path)}
                  onDoubleClick={() => onDoubleClick(entry)}
                  dragHandlers={makeRowDragHandlers(entry)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                {contextMenuContent(entry)}
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </>
      )}
    </ScrollArea>
  )
}
```

- [ ] **Step 3: Create `FilePanelToolbar.tsx`**

Create `frontend/src/components/filepanel/FilePanelToolbar.tsx`:

```tsx
import type { ReactNode } from 'react'
import { RefreshCw, FolderPlus } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface FilePanelToolbarProps {
  onRefresh: () => void
  onNewFolder: () => void
  children?: ReactNode
}

export function FilePanelToolbar({ onRefresh, onNewFolder, children }: FilePanelToolbarProps) {
  return (
    <div className="border-border flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New folder"
            onClick={onNewFolder}
          >
            <FolderPlus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New folder</TooltipContent>
      </Tooltip>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Create `FilePanelModals.tsx`**

Create `frontend/src/components/filepanel/FilePanelModals.tsx`:

```tsx
import type { FSEntry } from '../../types'
import type { Modal } from './useFilePanelState'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

interface FilePanelModalsProps {
  modal: Modal
  setModal: (modal: Modal) => void
  currentPath: string
  onMkdirConfirm: (name: string) => void
  onRenameConfirm: (entry: FSEntry, newName: string) => void
  onDeleteConfirm: (entry: FSEntry) => void
  deleteLocationText: string
}

export function FilePanelModals({
  modal,
  setModal,
  currentPath,
  onMkdirConfirm,
  onRenameConfirm,
  onDeleteConfirm,
  deleteLocationText,
}: FilePanelModalsProps) {
  return (
    <Dialog
      open={modal.type !== 'none'}
      onOpenChange={(open) => {
        if (!open) setModal({ type: 'none' })
      }}
    >
      <DialogContent>
        {modal.type === 'mkdir' && (
          <>
            <DialogHeader>
              <DialogTitle>New Folder</DialogTitle>
              <DialogDescription>Create a new folder in {currentPath}.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mkdir-name">Folder name</Label>
              <Input
                id="mkdir-name"
                placeholder="folder-name…"
                autoComplete="off"
                value={modal.value}
                onChange={(e) => setModal({ type: 'mkdir', value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && modal.value.trim())
                    onMkdirConfirm(modal.value.trim())
                }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </Button>
              <Button
                onClick={() => onMkdirConfirm(modal.value.trim())}
                disabled={!modal.value.trim()}
              >
                Create Folder
              </Button>
            </DialogFooter>
          </>
        )}
        {modal.type === 'rename' && (
          <>
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
              <DialogDescription>
                Enter a new name for &quot;{modal.entry.name}&quot;.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rename-name">New name</Label>
              <Input
                id="rename-name"
                autoComplete="off"
                value={modal.value}
                onChange={(e) =>
                  setModal({ type: 'rename', entry: modal.entry, value: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && modal.value.trim())
                    onRenameConfirm(modal.entry, modal.value.trim())
                }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </Button>
              <Button
                onClick={() => onRenameConfirm(modal.entry, modal.value.trim())}
                disabled={!modal.value.trim() || modal.value === modal.entry.name}
              >
                Rename
              </Button>
            </DialogFooter>
          </>
        )}
        {modal.type === 'delete' && (
          <>
            <DialogHeader>
              <DialogTitle>Delete {modal.entry.isDir ? 'Folder' : 'File'}</DialogTitle>
              <DialogDescription>
                &quot;{modal.entry.name}&quot; will be permanently deleted {deleteLocationText}. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => onDeleteConfirm(modal.entry)}>
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Verify build passes**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/filepanel/FileEntryRow.tsx frontend/src/components/filepanel/FileList.tsx frontend/src/components/filepanel/FilePanelToolbar.tsx frontend/src/components/filepanel/FilePanelModals.tsx
git commit -m "refactor: extract FileList, FileEntryRow, FilePanelToolbar, FilePanelModals components"
```

---

### Task 6: Move `FilePreviewModal` and add test stubs

**Files:**
- Move: `frontend/src/components/sftp/FilePreviewModal.tsx` → `frontend/src/components/filepanel/FilePreviewModal.tsx`
- Modify: `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts`

- [ ] **Step 1: Move `FilePreviewModal`**

```bash
cd frontend && mkdir -p src/components/filepanel && git mv src/components/sftp/FilePreviewModal.tsx src/components/filepanel/FilePreviewModal.tsx
```

- [ ] **Step 2: Add preview stubs to `SessionFacade.ts`**

In `frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts`, add after line 33 (the `LocalRename` line):

```ts
export const SFTPPreviewFile = (..._args: any[]): Promise<any> => Promise.resolve({ name: '', size: 0, mimeType: 'text/plain', content: '' })
export const LocalPreviewFile = (..._args: any[]): Promise<any> => Promise.resolve({ name: '', size: 0, mimeType: 'text/plain', content: '' })
```

- [ ] **Step 3: Verify build and tests pass**

Run:
```bash
cd frontend && npx tsc --noEmit && npm test
```
Expected: no type errors, all tests pass. (At this point both `SFTPPanel` and `LocalFSPanel` still have old imports pointing to `../sftp/FilePreviewModal` — those will be updated in the next tasks.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/filepanel/FilePreviewModal.tsx frontend/src/test/wailsjs-stubs/go/main/SessionFacade.ts
git commit -m "refactor: move FilePreviewModal to filepanel/ and add preview test stubs"
```

---

### Task 7: Rewrite `SFTPPanel` as thin wrapper

**Files:**
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx` (full rewrite)
- Modify: `frontend/src/components/workspace/PaneTree.tsx:10,222`

- [ ] **Step 1: Rewrite `SFTPPanel.tsx`**

Replace the entire contents of `frontend/src/components/sftp/SFTPPanel.tsx` with:

```tsx
import { useEffect } from 'react'
import { Upload, HelpCircle } from 'lucide-react'
import { DOCS_BASE_URL } from '../../lib/constants'
import { toast } from 'sonner'
import {
  SFTPListDir,
  SFTPDownload,
  SFTPDownloadDir,
  SFTPUpload,
  SFTPUploadPath,
  SFTPMkdir,
  SFTPDelete,
  SFTPRename,
} from '@wailsjs/go/main/SessionFacade'
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime'
import { PathBreadcrumb } from '../shared/PathBreadcrumb'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu'
import { useFilePanelState } from '../filepanel/useFilePanelState'
import { useFilePanelDrag } from '../filepanel/useFilePanelDrag'
import { FilePanelToolbar } from '../filepanel/FilePanelToolbar'
import { FilePanelModals } from '../filepanel/FilePanelModals'
import { FileList } from '../filepanel/FileList'
import { FilePreviewModal } from '../filepanel/FilePreviewModal'
import type { FSEntry } from '../../types'

interface Props {
  channelId: string
}

function resolveSFTPPath(entries: FSEntry[], requestedPath: string): string {
  if (requestedPath === '~' && entries.length > 0) {
    const firstPath = entries[0].path
    return firstPath.substring(0, firstPath.lastIndexOf('/'))
  }
  return requestedPath
}

export function SFTPPanel({ channelId }: Props) {
  const panel = useFilePanelState(
    channelId,
    {
      listDirFn: SFTPListDir,
      getInitialPath: () => Promise.resolve('~'),
      resolvePath: resolveSFTPPath,
    },
    { mkdir: SFTPMkdir, rename: SFTPRename, delete: SFTPDelete }
  )

  const drag = useFilePanelDrag({
    channelId,
    currentPath: panel.currentPath,
    listDir: panel.listDir,
    renameFn: SFTPRename,
    acceptMimeTypes: ['Files', 'application/x-shsh-transfer'],
    acceptOSDrops: true,
  })

  // Handle OS file drops — paths come from Go's runtime.OnFileDrop via Wails event
  useEffect(() => {
    EventsOn('window:filedrop', async (data: { paths: string[] }) => {
      if (!drag.isDragOverRef.current) return
      drag.isDragOverRef.current = false
      const paths = data.paths ?? []
      if (!paths.length) return
      const results = await Promise.allSettled(
        paths.map((p) =>
          SFTPUploadPath(channelId, p, panel.currentPath + '/' + p.split('/').pop())
        )
      )
      results.forEach((r, i) => {
        if (r.status === 'rejected')
          toast.error(`Failed to upload ${paths[i].split('/').pop()}: ${r.reason}`)
      })
      await panel.listDir(panel.currentPath)
    })
    return () => EventsOff('window:filedrop')
  }, [channelId, panel.currentPath, panel.listDir, drag.isDragOverRef])

  if (!panel.currentPath) return null

  async function handleUpload() {
    try {
      await SFTPUpload(channelId, panel.currentPath)
      await panel.listDir(panel.currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  return (
    <div
      className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
      {...drag.panelDragHandlers}
    >
      <FilePanelToolbar
        onRefresh={() => panel.listDir(panel.currentPath)}
        onNewFolder={() => panel.setModal({ type: 'mkdir', value: '' })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Upload file" onClick={handleUpload}>
              <Upload aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`${DOCS_BASE_URL}/features/sftp/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors"
            >
              <HelpCircle className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>SFTP documentation</TooltipContent>
        </Tooltip>
      </FilePanelToolbar>

      <div className="border-border flex shrink-0 items-center overflow-x-auto overflow-y-hidden border-b px-1.5 py-1">
        <PathBreadcrumb path={panel.currentPath} onNavigate={panel.listDir} />
      </div>

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
          <>
            {!entry.isDir && (
              <ContextMenuItem onSelect={() => panel.setPreviewPath(entry.path)}>
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
              onSelect={() => panel.setModal({ type: 'rename', entry, value: entry.name })}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => panel.setModal({ type: 'delete', entry })}
            >
              Delete
            </ContextMenuItem>
          </>
        )}
      />

      {drag.isDragOver && (
        <div className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm">
          <Upload className="size-6" />
          <span>Drop to upload</span>
        </div>
      )}

      <FilePanelModals
        modal={panel.modal}
        setModal={panel.setModal}
        currentPath={panel.currentPath}
        onMkdirConfirm={panel.handleMkdirConfirm}
        onRenameConfirm={panel.handleRenameConfirm}
        onDeleteConfirm={panel.handleDeleteConfirm}
        deleteLocationText="from the server"
      />

      {panel.previewPath && (
        <FilePreviewModal
          channelId={channelId}
          filePath={panel.previewPath}
          onClose={() => panel.setPreviewPath(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `PaneTree.tsx` — remove `connectionId` prop**

In `frontend/src/components/workspace/PaneTree.tsx`, change line 222:

From:
```tsx
            <SFTPPanel channelId={leaf.channelId} connectionId={leaf.connectionId} />
```
To:
```tsx
            <SFTPPanel channelId={leaf.channelId} />
```

- [ ] **Step 3: Verify build passes**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sftp/SFTPPanel.tsx frontend/src/components/workspace/PaneTree.tsx
git commit -m "refactor: rewrite SFTPPanel as thin wrapper using shared filepanel components"
```

---

### Task 8: Rewrite `LocalFSPanel` as thin wrapper

**Files:**
- Modify: `frontend/src/components/localfs/LocalFSPanel.tsx` (full rewrite)

- [ ] **Step 1: Rewrite `LocalFSPanel.tsx`**

Replace the entire contents of `frontend/src/components/localfs/LocalFSPanel.tsx` with:

```tsx
import { MoveRight } from 'lucide-react'
import {
  LocalListDir,
  LocalMkdir,
  LocalDelete,
  LocalRename,
  LocalPreviewFile,
} from '@wailsjs/go/main/SessionFacade'
import { GetHomeDir } from '@wailsjs/go/main/ToolsFacade'
import { PathBreadcrumb } from '../shared/PathBreadcrumb'
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu'
import { useFilePanelState } from '../filepanel/useFilePanelState'
import { useFilePanelDrag } from '../filepanel/useFilePanelDrag'
import { FilePanelToolbar } from '../filepanel/FilePanelToolbar'
import { FilePanelModals } from '../filepanel/FilePanelModals'
import { FileList } from '../filepanel/FileList'
import { FilePreviewModal } from '../filepanel/FilePreviewModal'

interface Props {
  channelId: string
}

export function LocalFSPanel({ channelId }: Props) {
  const panel = useFilePanelState(
    channelId,
    {
      listDirFn: LocalListDir,
      getInitialPath: GetHomeDir,
    },
    { mkdir: LocalMkdir, rename: LocalRename, delete: LocalDelete }
  )

  const drag = useFilePanelDrag({
    channelId,
    currentPath: panel.currentPath,
    listDir: panel.listDir,
    renameFn: LocalRename,
    acceptMimeTypes: ['application/x-shsh-transfer'],
  })

  if (!panel.currentPath) return null

  return (
    <div
      className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
      {...drag.panelDragHandlers}
    >
      <FilePanelToolbar
        onRefresh={() => panel.listDir(panel.currentPath)}
        onNewFolder={() => panel.setModal({ type: 'mkdir', value: '' })}
      />

      <div className="border-border flex shrink-0 items-center overflow-x-auto border-b px-1.5 py-1">
        <PathBreadcrumb path={panel.currentPath} onNavigate={panel.listDir} />
      </div>

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
          <>
            {!entry.isDir && (
              <ContextMenuItem onSelect={() => panel.setPreviewPath(entry.path)}>
                Preview
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onSelect={() => panel.setModal({ type: 'rename', entry, value: entry.name })}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => panel.setModal({ type: 'delete', entry })}
            >
              Delete
            </ContextMenuItem>
          </>
        )}
      />

      {drag.isDragOver && (
        <div className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm">
          <MoveRight className="size-6" />
          <span>Drop to move here</span>
        </div>
      )}

      <FilePanelModals
        modal={panel.modal}
        setModal={panel.setModal}
        currentPath={panel.currentPath}
        onMkdirConfirm={panel.handleMkdirConfirm}
        onRenameConfirm={panel.handleRenameConfirm}
        onDeleteConfirm={panel.handleDeleteConfirm}
        deleteLocationText="from your computer"
      />

      {panel.previewPath && (
        <FilePreviewModal
          channelId={channelId}
          filePath={panel.previewPath}
          onClose={() => panel.setPreviewPath(null)}
          previewFn={LocalPreviewFile}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build and all tests pass**

Run:
```bash
cd frontend && npx tsc --noEmit && npm test
```
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/localfs/LocalFSPanel.tsx
git commit -m "refactor: rewrite LocalFSPanel as thin wrapper using shared filepanel components"
```

---

### Task 9: Clean up old `sftp/` directory and verify

**Files:**
- Verify: `frontend/src/components/sftp/` should now only contain `SFTPPanel.tsx` (no `FilePreviewModal.tsx`)

- [ ] **Step 1: Verify `FilePreviewModal.tsx` is gone from `sftp/`**

Run:
```bash
ls frontend/src/components/sftp/
```
Expected: only `SFTPPanel.tsx` — `FilePreviewModal.tsx` was moved in Task 6.

- [ ] **Step 2: Verify no stale imports reference old paths**

Run:
```bash
cd frontend && grep -r "from.*sftp/FilePreviewModal" src/ || echo "No stale imports found"
```
Expected: "No stale imports found"

- [ ] **Step 3: Run full build and test suite**

Run:
```bash
cd frontend && npx tsc --noEmit && npm test
```
Expected: no type errors, all tests pass.

- [ ] **Step 4: Verify the file structure**

Run:
```bash
ls frontend/src/components/filepanel/
```
Expected:
```
FileEntryRow.tsx
FileList.tsx
FilePanelModals.tsx
FilePanelToolbar.tsx
FilePreviewModal.tsx
fileUtils.test.ts
fileUtils.ts
useFilePanelDrag.ts
useFilePanelState.ts
```

- [ ] **Step 5: Run lint check**

Run:
```bash
cd frontend && npx eslint src/components/filepanel/ src/components/sftp/SFTPPanel.tsx src/components/localfs/LocalFSPanel.tsx src/types/index.ts src/store/atoms.ts
```
Expected: no lint errors.

- [ ] **Step 6: Commit any lint fixes if needed, then tag the refactor complete**

If there were lint fixes:
```bash
git add -u && git commit -m "fix: lint cleanup after file panel refactor"
```
