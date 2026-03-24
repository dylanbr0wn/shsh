import { FolderOpen, Info, KeyRound, Loader2, Upload } from 'lucide-react'
import type {
  CredentialSource,
  Group,
  Host,
  PasswordManagersStatus,
  TerminalProfile,
} from '../../types'
import type { CreateHostInput } from '../../types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'
import { TagInput } from '../ui/tag-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { PMStatusBadge } from '../ui/pm-status-badge'
import { HOST_COLOR_PALETTE } from '../../lib/hostColors'
import { cn } from '../../lib/utils'

// Covers both CreateHostInput and UpdateHostInput (id is optional — only present in edit mode)
export type HostFormData = CreateHostInput & { id?: string }

export interface HostFormTabsProps {
  form: HostFormData
  setForm: React.Dispatch<React.SetStateAction<HostFormData>>
  errors: { label?: string; hostname?: string; username?: string }
  hosts: Host[]
  groups: Group[]
  profiles: TerminalProfile[]
  activeTab: string
  onTabChange: (tab: string) => void
  pmStatus: PasswordManagersStatus | null
  testing: boolean
  browsingKey: boolean
  onTestCredential: () => void
  onBrowseKeyFile: () => void
  onOpenGenerateKeyModal: () => void
  onOpenDeployKeyModal?: () => void // only provided in edit mode
  onOpenProfilesModal: () => void
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

export function HostFormTabs({
  form,
  setForm,
  errors,
  hosts,
  groups,
  profiles,
  activeTab,
  onTabChange,
  pmStatus,
  testing,
  browsingKey,
  onTestCredential,
  onBrowseKeyFile,
  onOpenGenerateKeyModal,
  onOpenDeployKeyModal,
  onOpenProfilesModal,
}: HostFormTabsProps) {
  const credSrc = form.credentialSource ?? 'inline'

  function field(name: keyof HostFormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value }))
  }

  // Hosts eligible as jump hosts: exclude self (if editing)
  const jumpHostOptions = form.id ? hosts.filter((h) => h.id !== form.id) : hosts

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList className="mb-4 w-full">
        <TabsTrigger value="connection" className="flex-1">
          Connection
        </TabsTrigger>
        <TabsTrigger value="organization" className="flex-1">
          Organization
        </TabsTrigger>
        <TabsTrigger value="advanced" className="flex-1">
          Advanced
        </TabsTrigger>
      </TabsList>

      {/* ── Connection tab ── */}
      <TabsContent value="connection">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hf-label">Label</FieldLabel>
            <Input
              id="hf-label"
              placeholder="My Server"
              value={form.label}
              onChange={field('label')}
            />
            {errors.label && <FieldError>{errors.label}</FieldError>}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="hf-hostname">
                Hostname
                <FieldHint>
                  IP address or domain name — e.g. 192.168.1.10 or myserver.example.com
                </FieldHint>
              </FieldLabel>
              <Input
                id="hf-hostname"
                placeholder="192.168.1.1"
                value={form.hostname}
                onChange={field('hostname')}
              />
              {errors.hostname && <FieldError>{errors.hostname}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="hf-port">
                Port
                <FieldHint>SSH normally runs on port 22.</FieldHint>
              </FieldLabel>
              <Input
                id="hf-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={field('port')}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="hf-username">
              Username
              <FieldHint>The account to log in as — e.g. ubuntu, ec2-user, or root</FieldHint>
            </FieldLabel>
            <Input
              id="hf-username"
              placeholder="root"
              value={form.username}
              onChange={field('username')}
            />
            {errors.username && <FieldError>{errors.username}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="hf-auth-method">Auth Method</FieldLabel>
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
              <SelectTrigger id="hf-auth-method" className="h-9">
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
                <FieldLabel htmlFor="hf-cred-source">
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
                  }}
                >
                  <SelectTrigger id="hf-cred-source" className="h-9">
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
                  <FieldLabel htmlFor="hf-password">
                    Password
                    <FieldHint>Stored securely in macOS Keychain, never in plain text.</FieldHint>
                  </FieldLabel>
                  <Input
                    id="hf-password"
                    type="password"
                    placeholder={
                      form.id ? 'Leave blank to keep unchanged' : 'Leave blank if not required'
                    }
                    value={form.password ?? ''}
                    onChange={field('password')}
                  />
                </Field>
              )}

              {(credSrc === '1password' || credSrc === 'bitwarden') && (
                <Field>
                  <FieldLabel htmlFor="hf-cred-ref">
                    {credSrc === '1password' ? '1Password Reference' : 'Bitwarden Item'}
                    <FieldHint>
                      {credSrc === '1password'
                        ? 'An op:// URI (e.g. op://vault/item/password), item UUID, or item name'
                        : 'The Bitwarden item name or UUID'}
                    </FieldHint>
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="hf-cred-ref"
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
                      onClick={onTestCredential}
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
                <FieldLabel htmlFor="hf-key-path">
                  Private Key File
                  <FieldHint>Path to your private key, e.g. ~/.ssh/id_ed25519</FieldHint>
                </FieldLabel>
                <div className="flex flex-col gap-2">
                  <Input
                    id="hf-key-path"
                    placeholder="~/.ssh/id_ed25519"
                    value={form.keyPath ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, keyPath: e.target.value || undefined }))
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={browsingKey}
                      onClick={onBrowseKeyFile}
                    >
                      <FolderOpen data-icon="inline-start" />
                      Browse
                    </Button>
                    <Button type="button" variant="outline" onClick={onOpenGenerateKeyModal}>
                      <KeyRound data-icon="inline-start" />
                      Generate…
                    </Button>
                    {onOpenDeployKeyModal && (
                      <Button type="button" variant="outline" onClick={onOpenDeployKeyModal}>
                        <Upload data-icon="inline-start" />
                        Deploy…
                      </Button>
                    )}
                  </div>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="hf-passphrase">
                  Passphrase
                  <FieldHint>
                    {form.id
                      ? 'Leave blank to keep unchanged, or enter a new passphrase.'
                      : 'Only required if your key file is encrypted.'}
                  </FieldHint>
                </FieldLabel>
                <Input
                  id="hf-passphrase"
                  type="password"
                  placeholder={
                    form.id
                      ? 'Leave blank to keep unchanged'
                      : 'Leave blank if key has no passphrase'
                  }
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
        </FieldGroup>
      </TabsContent>

      {/* ── Organization tab ── */}
      <TabsContent value="organization">
        <FieldGroup>
          {groups.length > 0 && (
            <Field>
              <FieldLabel htmlFor="hf-group">Group</FieldLabel>
              <Select
                value={form.groupId ?? '__none__'}
                onValueChange={(val) =>
                  setForm((f) => ({ ...f, groupId: val === '__none__' ? undefined : val }))
                }
              >
                <SelectTrigger id="hf-group" className="h-9">
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
      </TabsContent>

      {/* ── Advanced tab ── */}
      <TabsContent value="advanced">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hf-profile">Terminal Profile</FieldLabel>
            <Select
              value={form.terminalProfileId ?? '__none__'}
              onValueChange={(val) => {
                if (val === '__manage__') {
                  onOpenProfilesModal()
                  return
                }
                setForm((f) => ({
                  ...f,
                  terminalProfileId: val === '__none__' ? undefined : val,
                }))
              }}
            >
              <SelectTrigger id="hf-profile" className="h-9">
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

          {jumpHostOptions.length > 0 && (
            <Field>
              <FieldLabel htmlFor="hf-jump-host">
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
                <SelectTrigger id="hf-jump-host" className="h-9">
                  <SelectValue placeholder="None (direct connection)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (direct connection)</SelectItem>
                  {jumpHostOptions.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label} ({h.hostname})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </FieldGroup>
      </TabsContent>
    </Tabs>
  )
}
