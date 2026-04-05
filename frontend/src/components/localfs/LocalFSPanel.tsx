import { RefreshCw, FolderPlus, MoveRight } from 'lucide-react'
import {
  LocalListDir,
  LocalMkdir,
  LocalDelete,
  LocalRename,
  LocalPreviewFile,
} from '@wailsjs/go/main/SessionFacade'
import { GetHomeDir } from '@wailsjs/go/main/ToolsFacade'
import { PathBreadcrumb } from '../shared/PathBreadcrumb'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { useFilePanelState } from '../filepanel/useFilePanelState'
import { useFilePanelDrag } from '../filepanel/useFilePanelDrag'
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
      {/* Toolbar */}
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
        <PathBreadcrumb path={panel.currentPath} onNavigate={panel.listDir} maxVisible={3} />
        <div className="grow" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => panel.listDir(panel.currentPath)}
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
              onClick={() => panel.setModal({ type: 'mkdir', value: '' })}
            >
              <FolderPlus aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
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
