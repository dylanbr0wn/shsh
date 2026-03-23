import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Info, FolderOpen, KeyRound, Loader2, Upload } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  isEditHostOpenAtom,
  editingHostAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  isTerminalProfilesOpenAtom,
} from '../../store/atoms'
import type { UpdateHostInput, Host, CredentialSource, PasswordManagersStatus } from '../../types'
import {
  UpdateHost,
  BrowseKeyFile,
  CheckPasswordManagers,
  TestCredentialRef,
} from '../../../wailsjs/go/main/App'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TagInput } from '../ui/tag-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { HOST_COLOR_PALETTE } from '../../lib/hostColors'
import { cn } from '../../lib/utils'
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from '../ui/field'
import { PMStatusBadge } from '../ui/pm-status-badge'
import { GenerateKeyModal } from './GenerateKeyModal'
import { DeployKeyModal } from './DeployKeyModal'

interface FormErrors {
  label?: string
  hostname?: string
  username?: string
}

function FieldHint({
  children,
  side = 'right',
}: {
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground/60 size-3 shrink-0 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-56" side={side}>
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export function EditHostModal() {
  const [isOpen, setIsOpen] = useAtom(isEditHostOpenAtom)
  const editingHost = useAtomValue(editingHostAtom)
  const setHosts = useSetAtom(hostsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)

  const [form, setForm] = useState<UpdateHostInput>({
    id: '',
    label: '',
    hostname: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
    credentialSource: 'inline',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [browsingKey, setBrowsingKey] = useState(false)
  const [generateKeyOpen, setGenerateKeyOpen] = useState(false)
  const [deployKeyOpen, setDeployKeyOpen] = useState(false)
  const [pmStatus, setPmStatus] = useState<PasswordManagersStatus | null>(null)
  const [testing, setTesting] = useState(false)

  const credSrc = form.credentialSource ?? 'inline'

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
        keyPath: editingHost.keyPath,
        keyPassphrase: '',
        groupId: editingHost.groupId,
        color: editingHost.color,
        tags: editingHost.tags,
        terminalProfileId: editingHost.terminalProfileId,
        jumpHostId: editingHost.jumpHostId,
        credentialSource: editingHost.credentialSource ?? 'inline',
        credentialRef: editingHost.credentialRef ?? '',
      })
      setErrors({})
      setPmStatus(null)
    }
  }, [editingHost])

  useEffect(() => {
    if (credSrc === 'inline') {
      setPmStatus(null)
      return
    }
    if (isOpen && form.authMethod === 'password') {
      CheckPasswordManagers()
        .then(setPmStatus)
        .catch(() => {})
    }
  }, [isOpen, form.authMethod, credSrc])

  function close() {
    setIsOpen(false)
    setErrors({})
  }

  function validate(): FormErrors {
    const e: FormErrors = {}
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

  async function handleTestCredential() {
    setTesting(true)
    try {
      await TestCredentialRef(credSrc, form.credentialRef ?? '')
      toast.success('Credential fetched successfully')
    } catch (err) {
      toast.error('Credential test failed', { description: String(err) })
    } finally {
      setTesting(false)
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
          <DialogDescription>Update the details of your SSH host.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form id="eh-form" onSubmit={handleSubmit}>
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
                <Field>
                  <FieldLabel htmlFor="eh-port">
                    Port
                    <FieldHint>
                      SSH normally runs on port 22. Your server admin may have configured a
                      different port.
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
                <FieldLabel htmlFor="eh-username">
                  Username
                  <FieldHint>The account to log in as — e.g. ubuntu, ec2-user, or root</FieldHint>
                </FieldLabel>
                <Input
                  id="eh-username"
                  placeholder="root"
                  value={form.username}
                  onChange={field('username')}
                />
                {errors.username && <FieldError>{errors.username}</FieldError>}
              </Field>

              <Field>
                <FieldLabel htmlFor="eh-auth-method">Auth Method</FieldLabel>
                <Select
                  value={form.authMethod}
                  onValueChange={(val) =>
                    setForm((f) => ({
                      ...f,
                      authMethod: val as typeof f.authMethod,
                      password: '',
                      keyPath: undefined,
                      keyPassphrase: '',
                      credentialSource: 'inline',
                      credentialRef: '',
                    }))
                  }
                >
                  <SelectTrigger id="eh-auth-method" className="h-9">
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
                <>
                  <Field>
                    <FieldLabel htmlFor="eh-cred-source">
                      Credential Source
                      <FieldHint>
                        Where to fetch the password at connect time. Use a password manager to avoid
                        storing credentials in shsh.
                      </FieldHint>
                    </FieldLabel>
                    <Select
                      value={credSrc}
                      onValueChange={(val) => {
                        setForm((f) => ({
                          ...f,
                          credentialSource: val as CredentialSource,
                          password: '',
                          credentialRef: val === 'inline' ? '' : f.credentialRef,
                        }))
                        if (val === 'inline') {
                          setPmStatus(null)
                        } else {
                          CheckPasswordManagers()
                            .then(setPmStatus)
                            .catch(() => {})
                        }
                      }}
                    >
                      <SelectTrigger id="eh-cred-source" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inline">Inline (macOS Keychain)</SelectItem>
                        <SelectItem value="1password">1Password</SelectItem>
                        <SelectItem value="bitwarden">Bitwarden</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {credSrc === 'inline' && (
                    <Field>
                      <FieldLabel htmlFor="eh-password">
                        Password
                        <FieldHint>Leave blank to keep the current password unchanged.</FieldHint>
                      </FieldLabel>
                      <Input
                        id="eh-password"
                        type="password"
                        placeholder="Leave blank to keep unchanged"
                        value={form.password ?? ''}
                        onChange={field('password')}
                      />
                    </Field>
                  )}

                  {(credSrc === '1password' || credSrc === 'bitwarden') && (
                    <Field>
                      <FieldLabel htmlFor="eh-cred-ref">
                        {credSrc === '1password' ? '1Password Reference' : 'Bitwarden Item'}
                        <FieldHint>
                          {credSrc === '1password'
                            ? 'An op:// URI (e.g. op://vault/item/password), item UUID, or item name'
                            : 'The Bitwarden item name or UUID'}
                        </FieldHint>
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="eh-cred-ref"
                          placeholder={
                            credSrc === '1password' ? 'op://Personal/MyServer/password' : 'MyServer'
                          }
                          value={form.credentialRef ?? ''}
                          onChange={field('credentialRef')}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={testing || !form.credentialRef}
                          onClick={handleTestCredential}
                        >
                          {testing && <Loader2 data-icon="inline-start" className="animate-spin" />}
                          Test
                        </Button>
                      </div>
                      <FieldDescription className="flex items-center justify-between">
                        <PMStatusBadge status={pmStatus} source={credSrc} />
                      </FieldDescription>
                    </Field>
                  )}
                </>
              )}

              {form.authMethod === 'key' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="eh-key-path">
                      Private Key File
                      <FieldHint>Path to your private key, e.g. ~/.ssh/id_ed25519</FieldHint>
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="eh-key-path"
                        placeholder="~/.ssh/id_ed25519"
                        value={form.keyPath ?? ''}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, keyPath: e.target.value || undefined }))
                        }
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
                        <FolderOpen data-icon="inline-start" />
                        Browse
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setGenerateKeyOpen(true)}
                      >
                        <KeyRound data-icon="inline-start" />
                        Generate…
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDeployKeyOpen(true)}
                      >
                        <Upload data-icon="inline-start" />
                        Deploy…
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
                  <DeployKeyModal
                    open={deployKeyOpen}
                    onClose={() => setDeployKeyOpen(false)}
                    hostId={form.id}
                    hostLabel={form.label}
                  />
                  <Field>
                    <FieldLabel htmlFor="eh-passphrase">
                      Passphrase
                      <FieldHint>
                        Leave blank to keep unchanged, or enter a new passphrase.
                      </FieldHint>
                    </FieldLabel>
                    <Input
                      id="eh-passphrase"
                      type="password"
                      placeholder="Leave blank to keep unchanged"
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
                    setForm((f) => ({
                      ...f,
                      terminalProfileId: val === '__none__' ? undefined : val,
                    }))
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

              {hosts.filter((h) => h.id !== form.id).length > 0 && (
                <Field>
                  <FieldLabel htmlFor="eh-jump-host">
                    Jump Host
                    <FieldHint>
                      Connect through this saved host first (ProxyJump / bastion server).
                    </FieldHint>
                  </FieldLabel>
                  <Select
                    value={form.jumpHostId ?? '__none__'}
                    onValueChange={(val) =>
                      setForm((f) => ({
                        ...f,
                        jumpHostId: val === '__none__' ? undefined : val,
                      }))
                    }
                  >
                    <SelectTrigger id="eh-jump-host" className="h-9">
                      <SelectValue placeholder="None (direct connection)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (direct connection)</SelectItem>
                      {hosts
                        .filter((h) => h.id !== form.id)
                        .map((h) => (
                          <SelectItem key={h.id} value={h.id}>
                            {h.label} ({h.hostname})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

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
          <Button type="submit" form="eh-form" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
