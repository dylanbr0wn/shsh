# File Panel Refactor Design

**Date:** 2026-04-05
**Goal:** Eliminate ~400 lines of duplicate code between `SFTPPanel` and `LocalFSPanel` by extracting shared types, hooks, and components into a `components/filepanel/` module.

## Context

`SFTPPanel.tsx` (625 lines) and `LocalFSPanel.tsx` (544 lines) share roughly 70% of their code. The duplicated portions include: state management, transfer progress toasts, CRUD confirm handlers, utility functions (`formatSize`, `formatDate`), file list rendering (skeletons, error banner, empty state, entry rows), modal dialogs (mkdir, rename, delete), toolbar buttons, and drag-and-drop plumbing. The panels differ in: backend call names, initial path resolution, OS file drop support (SFTP only), toolbar extras (Upload button and help link on SFTP), context menu items (Download on SFTP), delete confirmation text, and drag MIME type acceptance.

Additionally, the shared types `SFTPEntry`, `SFTPState`, and atom `sftpStateAtom` are named after SFTP despite being used by both panels. `FilePreviewModal` lives under `sftp/` despite being imported by `LocalFSPanel`.

## Decisions

- **Approach:** Hook + shared components (not a single generic component). Each panel remains a readable wrapper that assembles shared pieces with panel-specific config.
- **Drag isolation:** Drag logic is extracted into a separate `useFilePanelDrag` hook (not merged into the main state hook) because drag behavior will be formalized further soon.
- **Shared code location:** `components/filepanel/` — a new top-level sibling to `sftp/` and `localfs/`.
- **Type renames:** `SFTPEntry` → `FSEntry`, `SFTPState` → `FSState`, `sftpStateAtom` → `fsPanelStateAtom` (frontend only, Go backend untouched).

## Type & Atom Renames

| Current | New | File |
|---|---|---|
| `SFTPEntry` | `FSEntry` | `types/index.ts` |
| `SFTPState` | `FSState` | `types/index.ts` |
| `sftpStateAtom` | `fsPanelStateAtom` | `store/atoms.ts` |

Referenced in 4 source files: `types/index.ts`, `store/atoms.ts`, `SFTPPanel.tsx`, `LocalFSPanel.tsx`. Doc files reference these in prose but are left unchanged.

## New File Structure

```
components/filepanel/
├── FileList.tsx           # ScrollArea with skeletons, error, empty state, entry rows
├── FileEntryRow.tsx       # Single row: icon, name, size, date, click/drag handlers
├── FilePanelModals.tsx    # Mkdir, rename, delete dialogs
├── FilePanelToolbar.tsx   # Refresh + New Folder buttons, with children slot for extras
├── FilePreviewModal.tsx   # Moved from sftp/ (already shared by both panels)
├── useFilePanelState.ts   # Hook: state atom, listDir, mount init, progress toasts, modals
├── useFilePanelDrag.ts    # Hook: drag counter, isDragOver, panel-level drag handlers
└── fileUtils.ts           # formatSize, formatDate
```

`PathBreadcrumb` stays in `shared/` — it has a generic API not specific to file panels.

## `useFilePanelState` Hook

Owns: atom state, `listDir` callback, mount initialization, transfer progress toasts, selection, modal state, and CRUD confirm handlers.

### Signature

```ts
function useFilePanelState(
  channelId: string,
  options: FilePanelStateOptions,
  operations: FilePanelOperations
): FilePanelStateReturn
```

### Config interfaces

```ts
interface FilePanelStateOptions {
  /** Backend list-directory function */
  listDirFn: (channelId: string, path: string) => Promise<FSEntry[]>
  /** Returns the initial path to navigate to on mount */
  getInitialPath: () => Promise<string>
  /** Optional path resolution after listing (SFTP uses this for ~ expansion) */
  resolvePath?: (entries: FSEntry[], requestedPath: string) => string
}

interface FilePanelOperations {
  mkdir: (channelId: string, path: string) => Promise<void>
  rename: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  delete: (channelId: string, path: string) => Promise<void>
}
```

### Return type

```ts
interface FilePanelStateReturn {
  currentPath: string
  entries: FSEntry[]
  isLoading: boolean
  error: string | null
  listDir: (path: string) => Promise<void>
  selected: string | null
  setSelected: (path: string | null) => void
  modal: Modal
  setModal: (modal: Modal) => void
  previewPath: string | null
  setPreviewPath: (path: string | null) => void
  handleRowDoubleClick: (entry: FSEntry) => void
  handleMkdirConfirm: (name: string) => Promise<void>
  handleRenameConfirm: (entry: FSEntry, newName: string) => Promise<void>
  handleDeleteConfirm: (entry: FSEntry) => Promise<void>
}
```

### Panel-specific usage

- **SFTP:** `getInitialPath: () => Promise.resolve('~')`, `resolvePath` extracts the resolved absolute path from the first entry when `~` was requested.
- **Local:** `getInitialPath: GetHomeDir`, no `resolvePath` needed.

## `useFilePanelDrag` Hook

Isolated drag logic. Designed to be extended as drag behavior is formalized.

### Config interface

```ts
interface FilePanelDragOptions {
  channelId: string
  currentPath: string
  listDir: (path: string) => Promise<void>
  renameFn: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  /** MIME types to accept for panel-level drops */
  acceptMimeTypes: string[]
  /** Whether to track isDragOverRef for OS drop coordination (SFTP only) */
  acceptOSDrops?: boolean
}
```

### Return type

```ts
interface FilePanelDragReturn {
  isDragOver: boolean
  /** Ref for OS drop coordination — only meaningful when acceptOSDrops is true */
  isDragOverRef: React.MutableRefObject<boolean>
  dragTargetPath: string | null
  setDragTargetPath: (path: string | null) => void
  draggedEntryRef: React.MutableRefObject<FSEntry | null>
  /** Spread onto the root panel div */
  panelDragHandlers: {
    onDragEnter: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDrop: React.DragEventHandler
  }
  /** Generate drag handlers for a single file row */
  makeRowDragHandlers: (entry: FSEntry) => {
    onDragStart: React.DragEventHandler
    onDragOver: React.DragEventHandler
    onDragLeave: React.DragEventHandler
    onDrop: React.DragEventHandler
    onDragEnd: React.DragEventHandler
  }
}
```

### Panel-specific behavior

- **SFTP:** `acceptMimeTypes: ['Files', 'application/x-shsh-transfer']`, `acceptOSDrops: true`. The `window:filedrop` useEffect remains in `SFTPPanel.tsx` — it's OS-specific logic that coordinates with `isDragOverRef` exposed by the hook.
- **Local:** `acceptMimeTypes: ['application/x-shsh-transfer']`, `acceptOSDrops: false`.

The hook handles `dropEffect` selection (`'copy'` for `'Files'`, `'move'` for transfers) based on the detected MIME type during `onDragOver`.

## Shared Components

### `FileList`

Renders the `ScrollArea` containing loading skeletons, error banner, empty state, and the entry list. Props:

- `entries`, `isLoading`, `error` — from state hook
- `selected`, `onSelect` — selection state
- `dragTargetPath` — from drag hook
- `onDoubleClick: (entry: FSEntry) => void`
- `makeRowDragHandlers` — from drag hook
- `contextMenuContent: (entry: FSEntry) => React.ReactNode` — render prop for per-entry context menu items (allows SFTP to include Download, local to omit it)

### `FileEntryRow`

Single row component rendering: folder/file icon, name, size column (responsive), date column (responsive). Receives an entry, selection state, drag highlight state, click handler, and drag handlers from `makeRowDragHandlers`. Identical rendering between both panels.

### `FilePanelModals`

The mkdir, rename, and delete `Dialog` blocks. Props:

- `modal`, `setModal` — modal state
- `currentPath` — for the mkdir description text
- `onMkdirConfirm`, `onRenameConfirm`, `onDeleteConfirm` — confirm handlers from state hook
- `deleteLocationText: string` — "from the server" or "from your computer"

### `FilePanelToolbar`

Refresh and New Folder buttons. Props:

- `onRefresh: () => void`
- `onNewFolder: () => void`
- `children?: React.ReactNode` — slot for panel-specific extras

SFTP passes Upload button and help link as children. Local passes nothing.

## Resulting Panel Wrappers

### `SFTPPanel.tsx` (~60-80 lines)

- Calls `useFilePanelState` with SFTP backend functions and `~` path resolution
- Calls `useFilePanelDrag` with `acceptOSDrops: true` and both MIME types
- Owns the `window:filedrop` useEffect for OS file drops
- Renders `FilePanelToolbar` with Upload + Help link children
- Renders `FileList` with SFTP context menu (Preview, Download, Rename, Delete)
- Renders `FilePanelModals` with `deleteLocationText="from the server"`
- Renders `FilePreviewModal` with default `previewFn`

### `LocalFSPanel.tsx` (~40-60 lines)

- Calls `useFilePanelState` with local backend functions and `GetHomeDir`
- Calls `useFilePanelDrag` with transfer MIME type only
- Renders `FilePanelToolbar` (no extra children)
- Renders `FileList` with local context menu (Preview, Rename, Delete)
- Renders `FilePanelModals` with `deleteLocationText="from your computer"`
- Renders `FilePreviewModal` with `LocalPreviewFile`

## What Doesn't Change

- `useChannelPanelState` hook — already generic, stays as-is
- `PathBreadcrumb` — stays in `shared/`, rendered inline by each panel
- Go backend types and API surface — untouched
- `workspaces.ts` leaf types (`SFTPLeaf`, `LocalFSLeaf`) — describe workspace topology, not file panel state
- Unused `connectionId` prop on `SFTPPanel` — removed as dead code cleanup

## Migration Notes

- All imports of `SFTPEntry`/`SFTPState` update to `FSEntry`/`FSState`
- All imports of `sftpStateAtom` update to `fsPanelStateAtom`
- `LocalFSPanel`'s import of `FilePreviewModal` from `'../sftp/FilePreviewModal'` changes to `'../filepanel/FilePreviewModal'`
- `SFTPPanel`'s import changes similarly
- The `Modal` type union is exported from `useFilePanelState.ts` (or a separate types file in `filepanel/`) since both the hook and `FilePanelModals` need it
