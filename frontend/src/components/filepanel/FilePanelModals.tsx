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
                  if (e.key === 'Enter' && modal.value.trim()) onMkdirConfirm(modal.value.trim())
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
                &quot;{modal.entry.name}&quot; will be permanently deleted {deleteLocationText}.
                This cannot be undone.
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
