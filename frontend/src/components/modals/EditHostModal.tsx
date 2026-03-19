import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { isEditHostOpenAtom, editingHostAtom, hostsAtom } from '../../store/atoms'
import type { UpdateHostInput, Host } from '../../types'
import { UpdateHost } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

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
      })
      setErrors({})
    }
  }, [editingHost])

  function close() {
    setIsOpen(false)
    setErrors({})
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
