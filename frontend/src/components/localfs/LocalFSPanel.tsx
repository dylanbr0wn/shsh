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
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
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
