import { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { groupsAtom, isNewGroupOpenAtom } from '../../store/atoms'
import type { Group } from '../../types'
import { AddGroup } from '@wailsjs/go/main/HostFacade'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Field, FieldGroup, FieldLabel } from '../ui/field'

export function AddGroupModal() {
  const [open, setOpen] = useAtom(isNewGroupOpenAtom)
  const setGroups = useSetAtom(groupsAtom)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  function close() {
    setOpen(false)
    setName('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const group = await AddGroup({ name: name.trim() })
      setGroups((prev) => [...prev, group as unknown as Group])
      close()
    } catch (err) {
      toast.error('Failed to create group', { description: String(err) })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Group</DialogTitle>
        </DialogHeader>

        <form id="ag-form" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ag-name">Name</FieldLabel>
              <Input
                id="ag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                autoFocus
              />
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="ag-form" disabled={creating || !name.trim()}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
