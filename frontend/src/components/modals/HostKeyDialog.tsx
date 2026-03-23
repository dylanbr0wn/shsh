import { useState } from 'react'
import { useAtom } from 'jotai'
import { ShieldAlert, Copy, Check } from 'lucide-react'
import { pendingHostKeyAtom } from '../../store/atoms'
import { RespondHostKey } from '../../../wailsjs/go/main/App'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'

export function HostKeyDialog() {
  const [pending, setPending] = useAtom(pendingHostKeyAtom)
  const [copied, setCopied] = useState(false)

  if (!pending) return null

  async function respond(accepted: boolean) {
    if (!pending) return
    await RespondHostKey(pending.sessionId, accepted)
    setPending(null)
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
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Verify Host Identity
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            A host key is the server&apos;s cryptographic identity. Verify it to confirm you&apos;re
            connecting to the right machine.
          </p>
          {pending.isNew && (
            <p className="text-sm">You are connecting to this host for the first time.</p>
          )}
          {pending.hasChanged && (
            <p className="text-destructive text-sm font-medium">
              ⚠ The host key has changed since your last connection. This may indicate a
              man-in-the-middle attack.
            </p>
          )}

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Host fingerprint (SHA-256)
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
            Verify this fingerprint matches the server before accepting.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => respond(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => respond(false)}>
            Reject
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => respond(true)}
          >
            Accept &amp; Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
