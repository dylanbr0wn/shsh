import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Info, X } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { isEditHostOpenAtom, editingHostAtom, hostsAtom, groupsAtom } from '../../store/atoms'
import type { UpdateHostInput, Host } from '../../types'
import { UpdateHost } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { HOST_COLOR_PALETTE } from '../../lib/hostColors'
import { cn } from '../../lib/utils'

interface FieldError {
  label?: string
  hostname?: string
  username?: string
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground/60 size-3 shrink-0 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{children}</TooltipContent>
    </Tooltip>
  )
}

export function EditHostModal() {
  const [isOpen, setIsOpen] = useAtom(isEditHostOpenAtom)
  const editingHost = useAtomValue(editingHostAtom)
  const setHosts = useSetAtom(hostsAtom)
  const groups = useAtomValue(groupsAtom)

  const [form, setForm] = useState<UpdateHostInput>({
    id: '',
    label: '',
    hostname: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
  })
  const [errors, setErrors] = useState<FieldError>({})
  const [submitting, setSubmitting] = useState(false)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (editingHost) {
      setForm({
        id: editingHost.id,
        label: editingHost.label,
        hostname: editingHost.hostname,
        port: editingHost.port,
        username: editingHost.username,
        authMethod: editingHost.authMethod,
        password: '',
        groupId: editingHost.groupId,
        color: editingHost.color,
        tags: editingHost.tags,
      })
      setErrors({})
      setTagInput('')
    }
  }, [editingHost])

  function close() {
    setIsOpen(false)
    setErrors({})
  }

  function addTag(t: string) {
    if (t && !(form.tags ?? []).includes(t))
      setForm((f) => ({ ...f, tags: [...(f.tags ?? []), t] }))
  }

  function removeTag(t: string) {
    setForm((f) => ({ ...f, tags: (f.tags ?? []).filter((x) => x !== t) }))
  }

  function validate(): FieldError {
    const e: FieldError = {}
    if (!form.label.trim()) e.label = 'Label is required'
    if (!form.hostname.trim()) e.hostname = 'Hostname is required'
    if (!form.username.trim()) e.username = 'Username is required'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    if (tagInput.trim()) addTag(tagInput.trim())
    setSubmitting(true)
    try {
      const updated = await UpdateHost({ ...form, port: Number(form.port) || 22 })
      setHosts((prev) => prev.map((h) => (h.id === updated.id ? (updated as unknown as Host) : h)))
      close()
    } catch (err) {
      toast.error('Failed to update host', { description: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  function field(name: keyof UpdateHostInput) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value }))
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit SSH Host</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eh-label">Label</Label>
            <Input
              id="eh-label"
              placeholder="My Server"
              value={form.label}
              onChange={field('label')}
            />
            {errors.label && <p className="text-destructive text-xs">{errors.label}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eh-hostname" className="flex items-center gap-1">
              Hostname
              <FieldHint>
                IP address or domain name of the remote server — e.g. 192.168.1.10 or
                myserver.example.com
              </FieldHint>
            </Label>
            <Input
              id="eh-hostname"
              placeholder="192.168.1.1"
              value={form.hostname}
              onChange={field('hostname')}
            />
            {errors.hostname && <p className="text-destructive text-xs">{errors.hostname}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eh-port" className="flex items-center gap-1">
                Port
                <FieldHint>
                  SSH normally runs on port 22. Your server admin may have configured a different
                  port.
                </FieldHint>
              </Label>
              <Input
                id="eh-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={field('port')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eh-username" className="flex items-center gap-1">
                Username
                <FieldHint>The account to log in as — e.g. ubuntu, ec2-user, or root</FieldHint>
              </Label>
              <Input
                id="eh-username"
                placeholder="root"
                value={form.username}
                onChange={field('username')}
              />
              {errors.username && <p className="text-destructive text-xs">{errors.username}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eh-password" className="flex items-center gap-1">
              Password
              <FieldHint>Leave blank to keep the current password unchanged.</FieldHint>
            </Label>
            <Input
              id="eh-password"
              type="password"
              placeholder="Leave blank to keep unchanged"
              value={form.password ?? ''}
              onChange={field('password')}
            />
          </div>

          {groups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eh-group">Group</Label>
              <Select
                value={form.groupId ?? '__none__'}
                onValueChange={(val) =>
                  setForm((f) => ({ ...f, groupId: val === '__none__' ? undefined : val }))
                }
              >
                <SelectTrigger id="eh-group" className="h-9">
                  <SelectValue placeholder="No Group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No Group</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'size-6 rounded-full border-2 bg-muted',
                  !form.color && 'ring-2 ring-ring ring-offset-1'
                )}
                onClick={() => setForm((f) => ({ ...f, color: undefined }))}
              />
              {HOST_COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  style={{ background: c }}
                  className={cn(
                    'size-6 rounded-full',
                    form.color === c && 'ring-2 ring-ring ring-offset-1'
                  )}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1">
              {(form.tags ?? []).map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 text-xs">
                  {t}
                  <X className="size-3 cursor-pointer" onClick={() => removeTag(t)} />
                </Badge>
              ))}
              <Input
                placeholder="Add tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault()
                    addTag(tagInput.trim().replace(/,$/, ''))
                    setTagInput('')
                  }
                }}
                className="h-6 w-24 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
