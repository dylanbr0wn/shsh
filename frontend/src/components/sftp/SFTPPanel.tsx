import { useEffect, useCallback, useState } from 'react'
import { useAtom } from 'jotai'
import {
  Folder,
  File,
  RefreshCw,
  Upload,
  FolderPlus,
  ChevronRight,
  Home,
  Loader2,
  PanelRightClose,
} from 'lucide-react'
import { toast } from 'sonner'
import { sftpStateAtom } from '../../store/atoms'
import type { SFTPEntry } from '../../types'
import {
  OpenSFTP,
  CloseSFTP,
  SFTPListDir,
  SFTPDownload,
  SFTPDownloadDir,
  SFTPUpload,
  SFTPMkdir,
  SFTPDelete,
  SFTPRename,
} from '../../../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime'
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
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '../../lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu'

interface Props {
  sessionId: string
  onClose?: () => void
}

type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: SFTPEntry; value: string }
  | { type: 'delete'; entry: SFTPEntry }

export function SFTPPanel({ sessionId, onClose }: Props) {
  const [sftpState, setSftpState] = useAtom(sftpStateAtom)
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>({ type: 'none' })

  const state = sftpState[sessionId]
  const setState = useCallback(
    (patch: Partial<typeof state>) => {
      setSftpState((prev) => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], ...patch },
      }))
    },
    [setSftpState, sessionId]
  )

  const listDir = useCallback(
    async (path: string) => {
      setState({ isLoading: true, error: null })
      try {
        const entries = await SFTPListDir(sessionId, path)
        setState({ entries: entries ?? [], currentPath: path, isLoading: false })
      } catch (err) {
        setState({ isLoading: false, error: String(err) })
      }
    },
    [sessionId, setState]
  )

  // Open SFTP and list home dir on mount
  useEffect(() => {
    let cancelled = false

    async function init() {
      setState({ isLoading: true, error: null, entries: [], currentPath: '' })
      try {
        await OpenSFTP(sessionId)
        if (!cancelled) await listDir('~')
      } catch (err) {
        if (!cancelled) setState({ isLoading: false, error: String(err) })
      }
    }

    init()

    // Progress toasts
    const eventKey = 'sftp:progress:' + sessionId
    const toastIds: Map<string, string | number> = new Map()

    EventsOn(eventKey, (evt: { path: string; bytes: number; total: number }) => {
      const pct = evt.total > 0 ? Math.round((evt.bytes / evt.total) * 100) : 0
      const label = evt.path.split('/').pop() ?? evt.path
      if (!toastIds.has(evt.path)) {
        const id = toast.loading(`Transferring ${label}… ${pct}%`)
        toastIds.set(evt.path, id)
      } else {
        const id = toastIds.get(evt.path)!
        if (pct >= 100) {
          toast.success(`${label} transferred`, { id })
          toastIds.delete(evt.path)
        } else {
          toast.loading(`Transferring ${label}… ${pct}%`, { id })
        }
      }
    })

    return () => {
      cancelled = true
      EventsOff(eventKey)
      CloseSFTP(sessionId).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (!state) return null

  const { currentPath, entries, isLoading, error } = state

  if (!currentPath) return null

  // Build breadcrumb segments
  const segments = currentPath.split('/').filter(Boolean)

  function navigateTo(idx: number) {
    const path = '/' + segments.slice(0, idx + 1).join('/')
    listDir(path)
  }

  async function handleRowDoubleClick(entry: SFTPEntry) {
    if (entry.isDir) {
      await listDir(entry.path)
    } else {
      try {
        await SFTPDownload(sessionId, entry.path)
      } catch (err) {
        toast.error(String(err))
      }
    }
  }

  async function handleUpload() {
    try {
      await SFTPUpload(sessionId, currentPath)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleMkdirConfirm(name: string) {
    setModal({ type: 'none' })
    try {
      await SFTPMkdir(sessionId, currentPath + '/' + name)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleRenameConfirm(entry: SFTPEntry, newName: string) {
    setModal({ type: 'none' })
    if (!newName || newName === entry.name) return
    try {
      await SFTPRename(sessionId, entry.path, currentPath + '/' + newName)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleDeleteConfirm(entry: SFTPEntry) {
    setModal({ type: 'none' })
    try {
      await SFTPDelete(sessionId, entry.path)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  function formatSize(bytes: number, isDir: boolean): string {
    if (isDir) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDate(iso: string): string {
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

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden border-l text-sm">
      {/* Toolbar */}
      <div className="border-border bg-muted/30 flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Refresh"
              onClick={() => listDir(currentPath)}
            >
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Upload file"
              onClick={handleUpload}
            >
              <Upload />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="New folder"
              onClick={() => setModal({ type: 'mkdir', value: '' })}
            >
              <FolderPlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-6"
                aria-label="Close file browser"
                onClick={onClose}
              >
                <PanelRightClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Close file browser</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="border-border flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-5 shrink-0"
              aria-label="Go to root"
              onClick={() => listDir('/')}
            >
              <Home />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Root</TooltipContent>
        </Tooltip>
        {segments.map((seg, idx) => (
          <span key={idx} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight className="text-muted-foreground/50 size-3" />
            <Button
              variant="ghost"
              className={cn(
                'h-5 px-1.5 text-xs',
                idx === segments.length - 1 ? 'text-foreground' : 'text-muted-foreground'
              )}
              onClick={() => navigateTo(idx)}
            >
              {seg}
            </Button>
          </span>
        ))}
      </div>

      {/* File list */}
      <ScrollArea className="@container min-h-0 flex-1 w-full">
        {isLoading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs">
            <Loader2 className="size-4 animate-spin" />
            <span>Loading…</span>
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
                <button
                  className={cn(
                    'flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left transition-colors select-none',
                    'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none focus-visible:ring-1',
                    selected === entry.path && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    const fn = entry.isDir ? SFTPDownloadDir : SFTPDownload
                    fn(sessionId, entry.path).catch((err) => toast.error(String(err)))
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
              </ContextMenuContent>
            </ContextMenu>
          ))}
          </>
        )}
      </ScrollArea>

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
                <Button variant="ghost" onClick={() => setModal({ type: 'none' })}>
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
                <Button variant="ghost" onClick={() => setModal({ type: 'none' })}>
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
                <Button variant="ghost" onClick={() => setModal({ type: 'none' })}>
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
    </div>
  )
}
