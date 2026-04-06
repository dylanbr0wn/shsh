import { useEffect, useCallback, useState } from 'react'
import { RefreshCw, Upload, FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { fsPanelStateAtom } from '../../store/atoms'
import { useChannelPanelState } from '../../store/useChannelPanelState'
import type { FSEntry, FSState } from '../../types'
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
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { FilePreviewModal } from '../filepanel/FilePreviewModal'
import { FileList } from '../filepanel/FileList'
import { useFileDrag } from '../../hooks/useFileDrag'

const DEFAULT_SFTP_STATE: FSState = {
  currentPath: '~',
  entries: [],
  isLoading: false,
  error: null,
}

interface Props {
  channelId: string
  connectionId: string
}

type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: FSEntry; value: string }
  | { type: 'delete'; entry: FSEntry }

export function SFTPPanel({ channelId, connectionId: _connectionId }: Props) {
  const [state, setState] = useChannelPanelState(fsPanelStateAtom, channelId, DEFAULT_SFTP_STATE)
  const { currentPath, entries, isLoading, error } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>({ type: 'none' })
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const listDir = useCallback(
    async (path: string) => {
      setState({ isLoading: true, error: null })
      try {
        const entries = await SFTPListDir(channelId, path)
        // When path is "~", the Go backend resolves it to an absolute path
        // for the entries but doesn't return the resolved path. Derive it
        // from the first entry so currentPath is always absolute (SFTP
        // doesn't understand "~").
        let resolvedPath = path
        if (path === '~' && entries && entries.length > 0) {
          const firstPath = entries[0].path
          resolvedPath = firstPath.substring(0, firstPath.lastIndexOf('/'))
        }
        setState({ entries: entries ?? [], currentPath: resolvedPath, isLoading: false })
      } catch (err) {
        setState({ isLoading: false, error: String(err) })
      }
    },
    [channelId, setState]
  )

  const drag = useFileDrag({
    channelId,
    currentPath,
    listDir,
    renameFn: SFTPRename,
    acceptOSDrops: true,
  })

  // List home dir on mount (channel lifecycle managed externally)
  useEffect(() => {
    let cancelled = false

    async function init() {
      setState({ isLoading: true, error: null, entries: [], currentPath: '' })
      try {
        if (!cancelled) await listDir('~')
      } catch (err) {
        if (!cancelled) setState({ isLoading: false, error: String(err) })
      }
    }

    init()

    // Progress toasts
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

  // Handle OS file drops — paths come from Go's runtime.OnFileDrop via Wails event
  useEffect(() => {
    EventsOn('window:filedrop', async (data: { paths: string[] }) => {
      if (!drag.isDragOverRef.current) return
      drag.isDragOverRef.current = false
      const paths = data.paths ?? []
      if (!paths.length) return
      const results = await Promise.allSettled(
        paths.map((p) => SFTPUploadPath(channelId, p, currentPath + '/' + p.split('/').pop()))
      )
      results.forEach((r, i) => {
        if (r.status === 'rejected')
          toast.error(`Failed to upload ${paths[i].split('/').pop()}: ${r.reason}`)
      })
      await listDir(currentPath)
    })
    return () => EventsOff('window:filedrop')
  }, [channelId, currentPath, listDir])

  if (!currentPath) return null

  function handleRowDoubleClick(entry: FSEntry) {
    if (entry.isDir) {
      listDir(entry.path)
    } else {
      setPreviewPath(entry.path)
    }
  }

  async function handleUpload() {
    try {
      await SFTPUpload(channelId, currentPath)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleMkdirConfirm(name: string) {
    setModal({ type: 'none' })
    try {
      await SFTPMkdir(channelId, currentPath + '/' + name)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleRenameConfirm(entry: FSEntry, newName: string) {
    setModal({ type: 'none' })
    if (!newName || newName === entry.name) return
    try {
      await SFTPRename(channelId, entry.path, currentPath + '/' + newName)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleDeleteConfirm(entry: FSEntry) {
    setModal({ type: 'none' })
    try {
      await SFTPDelete(channelId, entry.path)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  return (
    <div
      ref={drag.panelRef}
      className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
    >
      {/* Toolbar */}
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
        <PathBreadcrumb path={currentPath} onNavigate={listDir} maxVisible={3} />
        <div className="grow" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => listDir(currentPath)}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New folder"
              onClick={() => setModal({ type: 'mkdir', value: '' })}
            >
              <FolderPlus aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
      </div>

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
              <ContextMenuItem onSelect={() => setPreviewPath(entry.path)}>Preview</ContextMenuItem>
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

      {drag.isDragOver && (
        <div className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm">
          <Upload className="size-6" />
          <span>Drop to upload</span>
        </div>
      )}

      {/* Modals */}
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
                      handleMkdirConfirm(modal.value.trim())
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
                  onClick={() => handleMkdirConfirm(modal.value.trim())}
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
                      handleRenameConfirm(modal.entry, modal.value.trim())
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
                  onClick={() => handleRenameConfirm(modal.entry, modal.value.trim())}
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
                  &quot;{modal.entry.name}&quot; will be permanently deleted from the server. This
                  cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal({ type: 'none' })}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => handleDeleteConfirm(modal.entry)}>
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {previewPath && (
        <FilePreviewModal
          channelId={channelId}
          filePath={previewPath}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  )
}
