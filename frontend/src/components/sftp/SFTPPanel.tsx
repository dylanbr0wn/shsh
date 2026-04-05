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
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
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
      drag.resetDrag()
      const paths = data.paths ?? []
      if (!paths.length) return
      const results = await Promise.allSettled(
        paths.map((p) => SFTPUploadPath(channelId, p, panel.currentPath + '/' + p.split('/').pop()))
      )
      results.forEach((r, i) => {
        if (r.status === 'rejected')
          toast.error(`Failed to upload ${paths[i].split('/').pop()}: ${r.reason}`)
      })
      await panel.listDir(panel.currentPath)
    })
    return () => EventsOff('window:filedrop')
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
