import { useState } from 'react'
import { toast } from 'sonner'
import { Spinner } from '../ui/spinner'
import { useAtom, useSetAtom } from 'jotai'
import { isQuickConnectOpenAtom } from '../../store/atoms'
import { workspacesAtom, activeWorkspaceIdAtom, type TerminalLeaf } from '../../store/workspaces'
import { QuickConnect } from '@wailsjs/go/main/SessionFacade'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field'

interface FormState {
  hostShorthand: string
  hostname: string
  port: number
  username: string
  password: string
  authMethod: 'password' | 'agent'
}

const defaultForm: FormState = {
  hostShorthand: '',
  hostname: '',
  port: 22,
  username: '',
  password: '',
  authMethod: 'password',
}

interface FieldErrors {
  hostname?: string
  username?: string
}

/** Parse [user@]host[:port] shorthand into parts. */
function parseShorthand(raw: string): { username: string; hostname: string; port: number } {
  let username = ''
  let hostname = raw
  let port = 22

  const atIdx = raw.indexOf('@')
  if (atIdx !== -1) {
    username = raw.slice(0, atIdx)
    hostname = raw.slice(atIdx + 1)
  }

  const colonIdx = hostname.lastIndexOf(':')
  if (colonIdx !== -1) {
    const maybePort = Number(hostname.slice(colonIdx + 1))
    if (Number.isInteger(maybePort) && maybePort > 0) {
      port = maybePort
      hostname = hostname.slice(0, colonIdx)
    }
  }

  return { username, hostname, port }
}

export function QuickConnectModal() {
  const [open, setOpen] = useAtom(isQuickConnectOpenAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [connecting, setConnecting] = useState(false)

  function close() {
    setOpen(false)
    setForm(defaultForm)
    setErrors({})
  }

  function handleHostBlur() {
    if (!form.hostShorthand.trim()) return
    const { username, hostname, port } = parseShorthand(form.hostShorthand.trim())
    setForm((f) => ({
      ...f,
      hostname: hostname || f.hostname,
      port: port,
      username: username || f.username,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Re-parse shorthand one last time before submitting
    const {
      username: parsedUser,
      hostname: parsedHost,
      port: parsedPort,
    } = parseShorthand(form.hostShorthand.trim())
    const hostname = form.hostname.trim() || parsedHost
    const username = form.username.trim() || parsedUser
    const port = form.port || parsedPort

    const resolved = { ...form, hostname, username, port }
    const errs: FieldErrors = {}
    if (!resolved.hostname) errs.hostname = 'Hostname is required'
    if (!resolved.username) errs.username = 'Username is required'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setConnecting(true)
    try {
      const result = await QuickConnect({
        hostname: resolved.hostname,
        port: resolved.port,
        username: resolved.username,
        password: resolved.authMethod === 'password' ? resolved.password : '',
        authMethod: resolved.authMethod,
      })
      const paneId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const label = `${resolved.username}@${resolved.hostname}`
      const leaf: TerminalLeaf = {
        type: 'leaf',
        kind: 'terminal',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId: result.channelId, // quick-connect has no persisted hostId; use channelId as fallback
        hostLabel: label,
        status: 'connecting',
      }
      setWorkspaces((prev) => [
        ...prev,
        {
          id: workspaceId,
          label,
          layout: leaf,
          focusedPaneId: paneId,
        },
      ])
      setActiveWorkspaceId(workspaceId)
      close()
    } catch (err) {
      toast.error('Connection failed', { description: String(err) })
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick Connect</DialogTitle>
        </DialogHeader>

        <DialogBody className="pt-1">
          <form id="qc-form" onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Shorthand field */}
              <Field>
                <FieldLabel htmlFor="qc-host">Host</FieldLabel>
                <Input
                  id="qc-host"
                  placeholder="user@hostname:22"
                  value={form.hostShorthand}
                  onChange={(e) => setForm((f) => ({ ...f, hostShorthand: e.target.value }))}
                  onBlur={handleHostBlur}
                />
                <FieldDescription>
                  Shorthand: <span className="font-mono">user@host:port</span>
                </FieldDescription>
              </Field>

              {/* Hostname + Port */}
              <div className="grid grid-cols-[1fr_80px] gap-3">
                <Field>
                  <FieldLabel htmlFor="qc-hostname">Hostname</FieldLabel>
                  <Input
                    id="qc-hostname"
                    placeholder="192.168.1.1"
                    value={form.hostname}
                    onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
                  />
                  {errors.hostname && <FieldError>{errors.hostname}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="qc-port">Port</FieldLabel>
                  <Input
                    id="qc-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) || 22 }))}
                  />
                </Field>
              </div>

              {/* Username */}
              <Field>
                <FieldLabel htmlFor="qc-username">Username</FieldLabel>
                <Input
                  id="qc-username"
                  placeholder="root"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                />
                {errors.username && <FieldError>{errors.username}</FieldError>}
              </Field>

              {/* Auth method */}
              <Field>
                <FieldLabel>Auth Method</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={form.authMethod}
                  onValueChange={(val) => {
                    if (val) setForm((f) => ({ ...f, authMethod: val as 'password' | 'agent' }))
                  }}
                  className="w-full"
                >
                  <ToggleGroupItem value="password" className="flex-1">
                    Password
                  </ToggleGroupItem>
                  <ToggleGroupItem value="agent" className="flex-1">
                    SSH Agent
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              {/* Password */}
              {form.authMethod === 'password' && (
                <Field>
                  <FieldLabel htmlFor="qc-password">Password</FieldLabel>
                  <Input
                    id="qc-password"
                    type="password"
                    placeholder="Optional"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                </Field>
              )}
            </FieldGroup>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={connecting}>
            Cancel
          </Button>
          <Button type="submit" form="qc-form" disabled={connecting}>
            {connecting && <Spinner className="size-3.5" />}
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
