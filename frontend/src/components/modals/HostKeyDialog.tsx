import { useState } from 'react'
import { useAtom } from 'jotai'
import { ShieldAlert, ShieldX, Copy, Check } from 'lucide-react'
import { pendingHostKeyAtom } from '../../store/atoms'
import { RespondHostKey } from '../../../wailsjs/go/main/SessionFacade'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'

export function HostKeyDialog() {
  const [pending, setPending] = useAtom(pendingHostKeyAtom)
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  if (!pending) return null

  const isChanged = pending.hasChanged

  async function respond(accepted: boolean) {
    if (!pending) return
    await RespondHostKey(pending.connectionId, accepted)
    setPending(null)
    setAcknowledged(false)
  }

  function copyFingerprint() {
    if (!pending) return
    navigator.clipboard.writeText(pending.fingerprint)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open onOpenChange={() => respond(false)}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={() => respond(false)}
        onEscapeKeyDown={() => respond(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isChanged ? (
              <>
                <ShieldX className="text-destructive h-5 w-5" />
                Host Key Changed &mdash; Possible Attack
              </>
            ) : (
              <>
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                Verify Host Identity
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isChanged ? (
            <div className="bg-destructive/10 border-destructive/30 space-y-2 rounded-md border p-3">
              <p className="text-destructive text-sm font-semibold">
                The host key for this server has changed since your last connection.
              </p>
              <p className="text-destructive/80 text-sm">
                This could mean someone is intercepting your connection (man-in-the-middle attack),
                or the server was legitimately reinstalled or reconfigured.
              </p>
              {pending.oldKeyTypes && pending.oldKeyTypes.length > 0 && (
                <p className="text-destructive/70 text-xs">
                  Previously known key type{pending.oldKeyTypes.length > 1 ? 's' : ''}:{' '}
                  <span className="font-mono">{pending.oldKeyTypes.join(', ')}</span>
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                A host key is the server&apos;s cryptographic identity. Verify it to confirm
                you&apos;re connecting to the right machine.
              </p>
              <p className="text-sm">You are connecting to this host for the first time.</p>
            </>
          )}

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {isChanged ? 'New host fingerprint (SHA-256)' : 'Host fingerprint (SHA-256)'}
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted flex-1 rounded px-3 py-2 font-mono text-xs break-all">
                {pending.fingerprint}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={copyFingerprint}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            {isChanged
              ? 'Only accept if you are certain the server was legitimately changed.'
              : 'Verify this fingerprint matches the server before accepting.'}
          </p>

          {isChanged && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="acknowledge-changed-key"
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
              <Label htmlFor="acknowledge-changed-key" className="cursor-pointer text-sm">
                I understand this may indicate a man-in-the-middle attack
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => respond(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => respond(false)}>
            Reject
          </Button>
          {isChanged ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!acknowledged}
              onClick={() => respond(true)}
            >
              Accept Changed Key
            </Button>
          ) : (
            <Button type="button" variant="default" onClick={() => respond(true)}>
              Accept &amp; Connect
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
