import { useState } from 'react'
import { toast } from 'sonner'
import { useAtom, useSetAtom } from 'jotai'
import { addPortForwardSessionIdAtom, portForwardsAtom } from '../../store/atoms'
import { AddPortForward, ListPortForwards } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { InputGroup, InputGroupInput } from '../ui/input-group'
import { Field, FieldGroup, FieldLabel } from '../ui/field'

export function AddPortForwardModal() {
  const [sessionId, setSessionId] = useAtom(addPortForwardSessionIdAtom)
  const setPfState = useSetAtom(portForwardsAtom)

  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePort, setRemotePort] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isOpen = sessionId !== null

  function close() {
    setSessionId(null)
    setLocalPort('')
    setRemoteHost('')
    setRemotePort('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sessionId) return
    const lp = parseInt(localPort, 10)
    const rp = parseInt(remotePort, 10)
    if (!lp || !remoteHost.trim() || !rp) {
      toast.error('All fields are required.')
      return
    }
    setSubmitting(true)
    try {
      await AddPortForward(sessionId, lp, remoteHost.trim(), rp)
      const forwards = await ListPortForwards(sessionId)
      setPfState((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] ?? { isOpen: true, forwards: [] }), forwards: forwards ?? [] },
      }))
      close()
    } catch (err) {
      toast.error('Failed to add port forward', { description: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Port Forward</DialogTitle>
        </DialogHeader>

        <form id="apf-form" onSubmit={handleSubmit} className="pt-2">
          <FieldGroup>
          <Field>
            <FieldLabel htmlFor="apf-local-port">Local Port</FieldLabel>
            <Input
              id="apf-local-port"
              name="localPort"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="8080…"
              autoComplete="off"
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </Field>

          <Field>
            <FieldLabel>Remote Destination</FieldLabel>
            <InputGroup>
              <InputGroupInput
                name="remoteHost"
                placeholder="hostname…"
                autoComplete="off"
                value={remoteHost}
                onChange={(e) => setRemoteHost(e.target.value)}
              />
              <span className="px-1.5 text-sm text-muted-foreground select-none shrink-0">:</span>
              <InputGroupInput
                name="remotePort"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="22…"
                autoComplete="off"
                className="w-16 shrink-0 flex-none"
                value={remotePort}
                onChange={(e) => setRemotePort(e.target.value)}
              />
            </InputGroup>
          </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="apf-form" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Forward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
