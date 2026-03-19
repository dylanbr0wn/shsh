import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'

interface Props {
  open: boolean
  sessionCount: number
  onConfirm: (dontAskAgain: boolean) => void
  onCancel: () => void
}

export function CloseConfirmDialog({ open, sessionCount, onConfirm, onCancel }: Props) {
  const [dontAskAgain, setDontAskAgain] = useState(false)

  function handleConfirm() {
    onConfirm(dontAskAgain)
    setDontAskAgain(false)
  }

  function handleCancel() {
    setDontAskAgain(false)
    onCancel()
  }

  const title = sessionCount === 1 ? 'Close session' : `Close ${sessionCount} sessions`
  const description =
    sessionCount === 1
      ? 'This will disconnect the session. You can reconnect at any time.'
      : `This will disconnect ${sessionCount} sessions. You can reconnect at any time.`
  const confirmLabel = sessionCount === 1 ? 'Close' : 'Close All'

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 py-1">
          <input
            id="dont-ask-again"
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
            className="h-4 w-4 cursor-pointer"
          />
          <label
            htmlFor="dont-ask-again"
            className="text-muted-foreground cursor-pointer text-sm select-none"
          >
            Don&apos;t ask me again
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
