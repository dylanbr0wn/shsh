import { useState, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { groupsAtom, terminalProfilesAtom, isTerminalProfilesOpenAtom } from '../../store/atoms'
import type { Group } from '../../types'
import { UpdateGroup } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

interface Props {
  group: Group | null
  open: boolean
  onClose: () => void
}

export function EditGroupModal({ group, open, onClose }: Props) {
  const setGroups = useSetAtom(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)

  const [name, setName] = useState('')
  const [profileId, setProfileId] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (group) {
      setName(group.name)
      setProfileId(group.terminalProfileId)
    }
  }, [group])

  function close() {
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!group || !name.trim()) return
    setSaving(true)
    try {
      const updated = await UpdateGroup({
        id: group.id,
        name: name.trim(),
        sortOrder: group.sortOrder,
        terminalProfileId: profileId || undefined,
      })
      setGroups(prev => prev.map(g => g.id === updated.id ? (updated as unknown as Group) : g))
      close()
    } catch (err) {
      toast.error('Failed to update group', { description: String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
        </DialogHeader>

        <form id="eg-form" onSubmit={handleSubmit} className="pt-2">
          <FieldGroup>
          <Field>
            <FieldLabel htmlFor="eg-name">Name</FieldLabel>
            <Input
              id="eg-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Group name"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="eg-profile">Terminal Profile</FieldLabel>
            <Select
              value={profileId ?? '__none__'}
              onValueChange={val => {
                if (val === '__manage__') { setProfilesOpen(true); return }
                setProfileId(val === '__none__' ? undefined : val)
              }}
            >
              <SelectTrigger id="eg-profile" className="h-9">
                <SelectValue placeholder="None (use defaults)" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__none__">None (use defaults)</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectItem value="__manage__">Manage profiles…</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" form="eg-form" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
