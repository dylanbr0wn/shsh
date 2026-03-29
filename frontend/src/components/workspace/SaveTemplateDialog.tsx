import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SaveWorkspaceTemplate } from '@wailsjs/go/main/HostFacade'
import { store } from '@wailsjs/go/models'
import type { Workspace, PaneNode, PaneLeaf } from '../../store/workspaces'
import type { TemplateNode } from '../../types'

function paneNodeToTemplate(node: PaneNode): TemplateNode {
  if (node.type === 'split') {
    return {
      direction: node.direction,
      ratio: node.ratio,
      left: paneNodeToTemplate(node.left),
      right: paneNodeToTemplate(node.right),
    }
  }
  const leaf = node as PaneLeaf
  if (leaf.kind === 'local') {
    return { kind: 'local' }
  }
  return { kind: leaf.kind, hostId: leaf.hostId }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace
  onSaved?: (templateId: string) => void
}

export function SaveTemplateDialog({ open, onOpenChange, workspace, onSaved }: Props) {
  const [name, setName] = useState(workspace.name ?? workspace.label)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return

    setSaving(true)
    setError(null)
    try {
      const templateNode = paneNodeToTemplate(workspace.layout)
      const input = store.CreateTemplateInput.createFrom({
        id: workspace.savedTemplateId ?? '',
        name: trimmed,
        layout: new TextEncoder().encode(JSON.stringify(templateNode)),
      })
      const saved = await SaveWorkspaceTemplate(input)
      onSaved?.(saved.id)
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setError(null)
    } else {
      setName(workspace.name ?? workspace.label)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Save the current workspace layout as a reusable template.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
              placeholder="My workspace template"
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
