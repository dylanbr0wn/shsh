import { useState } from 'react'
import { toast } from 'sonner'
import { Info, FolderOpen, KeyRound } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { isAddHostOpenAtom, hostsAtom, groupsAtom, terminalProfilesAtom, isTerminalProfilesOpenAtom } from '../../store/atoms'
import type { CreateHostInput, Host } from '../../types'
import { AddHost, BrowseKeyFile } from '../../../wailsjs/go/main/App'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TagInput } from '../ui/tag-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { HOST_COLOR_PALETTE } from '../../lib/hostColors'
import { cn } from '../../lib/utils'
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field'
import { GenerateKeyModal } from './GenerateKeyModal'

const defaultForm: CreateHostInput = {
  label: '',
  hostname: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
}

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

export function AddHostModal() {
  const [isAddHostOpen, setIsAddHostOpen] = useAtom(isAddHostOpenAtom)
  const setHosts = useSetAtom(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)

  const [form, setForm] = useState<CreateHostInput>(defaultForm)
  const [errors, setErrors] = useState<FieldError>({})
  const [submitting, setSubmitting] = useState(false)
  const [browsingKey, setBrowsingKey] = useState(false)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)

  function close() {
    setIsAddHostOpen(false)
    setForm(defaultForm)
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
      const host = await AddHost({ ...form, port: Number(form.port) || 22 })
      setHosts((prev) => [...prev, host as unknown as Host])
      close()
    } catch (err) {
      toast.error('Failed to save host', { description: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  function field(name: keyof CreateHostInput) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value }))
  }

  return (
    <Dialog open={isAddHostOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add SSH Host</DialogTitle>
          <DialogDescription>
            Save a host you frequently connect to for easy access later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="ah-form" onSubmit={handleSubmit}>
          <FieldGroup>
          <Field>
            <FieldLabel htmlFor="eh-label">Label</FieldLabel>
            <Input
              id="eh-label"
              placeholder="My Server"
              value={form.label}
              onChange={field('label')}
            />
            {errors.label && <FieldError>{errors.label}</FieldError>}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="eh-hostname">
                Hostname
                <FieldHint>
                  IP address or domain name of the remote server — e.g. 192.168.1.10 or
                  myserver.example.com
                </FieldHint>
              </FieldLabel>
              <Input
                id="eh-hostname"
                placeholder="192.168.1.1"
                value={form.hostname}
                onChange={field('hostname')}
              />
              {errors.hostname && <FieldError>{errors.hostname}</FieldError>}
            </Field>
            <Field >
              <FieldLabel htmlFor="eh-port" >
                Port
                <FieldHint>
                  SSH normally runs on port 22. Your server admin may have configured a different
                  port.
                </FieldHint>
              </FieldLabel>
              <Input
                id="eh-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={field('port')}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ah-username">
              Username
              <FieldHint>The account to log in as — e.g. ubuntu, ec2-user, or root</FieldHint>
            </FieldLabel>
            <Input
              id="ah-username"
              placeholder="root"
              value={form.username}
              onChange={field('username')}
            />
            {errors.username && <FieldError>{errors.username}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="ah-auth-method">Auth Method</FieldLabel>
            <Select
              value={form.authMethod}
              onValueChange={(val) =>
                setForm((f) => ({ ...f, authMethod: val as typeof f.authMethod, password: '', keyPath: undefined, keyPassphrase: '' }))
              }
            >
              <SelectTrigger id="ah-auth-method" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="key">SSH Key</SelectItem>
                <SelectItem value="agent">SSH Agent</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {form.authMethod === 'password' && (
            <Field>
              <FieldLabel htmlFor="ah-password">
                Password
                <FieldHint>Leave blank for passwordless or agent-based auth.</FieldHint>
              </FieldLabel>
              <Input
                id="ah-password"
                type="password"
                placeholder="Leave blank if not required"
                value={form.password ?? ''}
                onChange={field('password')}
              />
            </Field>
          )}

          {form.authMethod === 'key' && (
            <>
              <Field>
                <FieldLabel htmlFor="ah-key-path">
                  Private Key File
                  <FieldHint>Path to your private key, e.g. ~/.ssh/id_ed25519</FieldHint>
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="ah-key-path"
                    placeholder="~/.ssh/id_ed25519"
                    value={form.keyPath ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, keyPath: e.target.value || undefined }))}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={browsingKey}
                    onClick={async () => {
                      setBrowsingKey(true)
                      try {
                        const path = await BrowseKeyFile()
                        if (path) setForm((f) => ({ ...f, keyPath: path }))
                      } catch {
                        // user cancelled or error
                      } finally {
                        setBrowsingKey(false)
                      }
                    }}
                  >
                    <FolderOpen className="size-3.5" />
                    Browse
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGenerateKeyOpen(true)}
                  >
                    <KeyRound className="size-3.5" />
                    Generate…
                  </Button>
                </div>
              </Field>
              <GenerateKeyModal
                open={generateKeyOpen}
                onClose={() => setGenerateKeyOpen(false)}
                onGenerated={(path) => {
                  setForm((f) => ({ ...f, keyPath: path }))
                  setGenerateKeyOpen(false)
                }}
              />
              <Field>
                <FieldLabel htmlFor="ah-passphrase">
                  Passphrase
                  <FieldHint>Only required if your key file is encrypted.</FieldHint>
                </FieldLabel>
                <Input
                  id="ah-passphrase"
                  type="password"
                  placeholder="Leave blank if key has no passphrase"
                  value={form.keyPassphrase ?? ''}
                  onChange={field('keyPassphrase')}
                />
              </Field>
            </>
          )}

          {form.authMethod === 'agent' && (
            <p className="text-muted-foreground text-xs">
              Will authenticate using your running SSH agent (e.g. ssh-agent or 1Password).
            </p>
          )}

          {groups.length > 0 && (
            <Field>
              <FieldLabel htmlFor="eh-group">Group</FieldLabel>
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
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="eh-profile">Terminal Profile</FieldLabel>
            <Select
              value={form.terminalProfileId ?? '__none__'}
              onValueChange={(val) => {
                if (val === '__manage__') {
                  setProfilesOpen(true)
                  return
                }
                setForm((f) => ({ ...f, terminalProfileId: val === '__none__' ? undefined : val }))
              }}
            >
              <SelectTrigger id="eh-profile" className="h-9">
                <SelectValue placeholder="None (use defaults)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (use defaults)</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                <SelectItem value="__manage__">Manage profiles…</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Color</FieldLabel>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'bg-muted size-6 rounded-full border-2',
                  !form.color && 'ring-ring ring-2 ring-offset-1'
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
                    form.color === c && 'ring-ring ring-2 ring-offset-1'
                  )}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                />
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel>Tags</FieldLabel>
            <TagInput
              tags={form.tags ?? []}
              onChange={(tags) => setForm((f) => ({ ...f, tags }))}
            />
          </Field>
          </FieldGroup>
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="ah-form" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Host'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
