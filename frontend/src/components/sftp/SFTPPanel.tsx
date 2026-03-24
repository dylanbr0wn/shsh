import { useEffect, useCallback, useState, useRef } from 'react'
import {
  Folder,
  File,
  RefreshCw,
  Upload,
  FolderPlus,
  ChevronRight,
  Home,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { sftpStateAtom } from '../../store/atoms'
import { useChannelPanelState } from '../../store/useChannelPanelState'
import type { SFTPEntry, SFTPState } from '../../types'
import {
  SFTPListDir,
  SFTPDownload,
  SFTPDownloadDir,
  SFTPUpload,
  SFTPUploadPath,
  SFTPMkdir,
  SFTPDelete,
  SFTPRename,
  TransferBetweenHosts,
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

const DEFAULT_SFTP_STATE: SFTPState = {
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
  | { type: 'rename'; entry: SFTPEntry; value: string }
  | { type: 'delete'; entry: SFTPEntry }

export function SFTPPanel({ channelId, connectionId: _connectionId }: Props) {
  const [state, setState] = useChannelPanelState(sftpStateAtom, channelId, DEFAULT_SFTP_STATE)
  const { currentPath, entries, isLoading, error } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>({ type: 'none' })
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const draggedEntryRef = useRef<SFTPEntry | null>(null)
  const dragCounterRef = useRef(0)
  const isDragOverRef = useRef(false)

  const listDir = useCallback(
    async (path: string) => {
      setState({ isLoading: true, error: null })
      try {
        const entries = await SFTPListDir(channelId, path)
        setState({ entries: entries ?? [], currentPath: path, isLoading: false })
      } catch (err) {
        setState({ isLoading: false, error: String(err) })
      }
    },
    [channelId, setState]
  )

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
    const eventKey = `channel:sftp-progress:${channelId}`
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
      if (!isDragOverRef.current) return
      isDragOverRef.current = false
      dragCounterRef.current = 0
      setIsDragOver(false)
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
        await SFTPDownload(channelId, entry.path)
      } catch (err) {
        toast.error(String(err))
      }
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

  async function handleRenameConfirm(entry: SFTPEntry, newName: string) {
    setModal({ type: 'none' })
    if (!newName || newName === entry.name) return
    try {
      await SFTPRename(channelId, entry.path, currentPath + '/' + newName)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleDeleteConfirm(entry: SFTPEntry) {
    setModal({ type: 'none' })
    try {
      await SFTPDelete(channelId, entry.path)
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
    <div
      className="bg-background relative flex h-full flex-col overflow-hidden text-sm"
      onDragEnter={(e) => {
        if (
          e.dataTransfer.types.includes('Files') ||
          e.dataTransfer.types.includes('application/x-shsh-sftp')
        ) {
          e.preventDefault()
          dragCounterRef.current++
          if (dragCounterRef.current === 1) {
            isDragOverRef.current = true
            setIsDragOver(true)
          }
        }
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('Files') ||
          e.dataTransfer.types.includes('application/x-shsh-sftp')
        ) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
        }
      }}
      onDragLeave={() => {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
        if (dragCounterRef.current === 0) {
          isDragOverRef.current = false
          setIsDragOver(false)
        }
      }}
      onDrop={async (e) => {
        e.preventDefault()
        dragCounterRef.current = 0
        isDragOverRef.current = false
        setIsDragOver(false)

        // Handle SFTP cross-panel drops onto the panel background (into currentPath)
        const raw = e.dataTransfer.getData('application/x-shsh-sftp')
        if (raw) {
          const payload: { channelId: string; path: string } = JSON.parse(raw)
          const draggedName = payload.path.split('/').pop() ?? payload.path
          draggedEntryRef.current = null

          try {
            if (payload.channelId === channelId) {
              await SFTPRename(channelId, payload.path, currentPath + '/' + draggedName)
            } else {
              await TransferBetweenHosts(
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
        // OS file drops handled via window:filedrop Wails event
      }}
    >
      {/* Toolbar */}
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
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

      {/* Breadcrumb */}
      <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0"
              aria-label="Go to root"
              onClick={() => listDir('/')}
            >
              <Home aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Root</TooltipContent>
        </Tooltip>
        {segments.map((seg, idx) => (
          <span key={idx} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="text-muted-foreground/50 size-3" aria-hidden="true" />
            <Button
              variant="ghost"
              size="xs"
              className={cn(
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
      <ScrollArea className="@container min-h-0 w-full flex-1">
        {isLoading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
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
                      'hover:bg-accent/60 focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
                      selected === entry.path && 'bg-accent text-accent-foreground',
                      dragTargetPath === entry.path &&
                        'ring-primary bg-primary/10 ring-1 ring-inset'
                    )}
                    draggable
                    onClick={() => setSelected(entry.path)}
                    onDoubleClick={() => handleRowDoubleClick(entry)}
                    onDragStart={(e) => {
                      draggedEntryRef.current = entry
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData(
                        'application/x-shsh-sftp',
                        JSON.stringify({ channelId, path: entry.path })
                      )
                    }}
                    onDragOver={(e) => {
                      if (
                        entry.isDir &&
                        e.dataTransfer.types.includes('application/x-shsh-sftp')
                      ) {
                        // For same-panel drags, skip if hovering over the dragged item itself
                        if (draggedEntryRef.current?.path === entry.path) return
                        e.preventDefault()
                        e.stopPropagation()
                        setDragTargetPath(entry.path)
                      }
                    }}
                    onDragLeave={() => setDragTargetPath(null)}
                    onDrop={async (e) => {
                      if (!entry.isDir) return
                      e.preventDefault()
                      e.stopPropagation()
                      setDragTargetPath(null)

                      // Parse drag payload from dataTransfer (works across panels)
                      const raw = e.dataTransfer.getData('application/x-shsh-sftp')
                      if (!raw) return
                      const payload: { channelId: string; path: string } = JSON.parse(raw)
                      const draggedName = payload.path.split('/').pop() ?? payload.path

                      // Clear local ref if this was a same-panel drag
                      draggedEntryRef.current = null

                      if (payload.path === entry.path) return
                      if (entry.path.startsWith(payload.path + '/')) {
                        toast.error('Cannot move a folder into itself.')
                        return
                      }

                      try {
                        if (payload.channelId === channelId) {
                          // Same channel — rename/move
                          await SFTPRename(channelId, payload.path, entry.path + '/' + draggedName)
                        } else {
                          // Cross-channel transfer
                          await TransferBetweenHosts(
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
                    }}
                    onDragEnd={() => {
                      draggedEntryRef.current = null
                      setDragTargetPath(null)
                    }}
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
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </>
        )}
      </ScrollArea>

      {isDragOver && (
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
    </div>
  )
}
