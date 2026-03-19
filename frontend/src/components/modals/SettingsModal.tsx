import { useAtom } from 'jotai'
import { isSettingsOpenAtom, closeConfirmPrefAtom } from '../../store/atoms'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'

export function SettingsModal() {
  const [isOpen, setIsOpen] = useAtom(isSettingsOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)

  const checked = closeConfirmPref !== false

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Separator />

        <div className="flex flex-col gap-4 py-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Sessions
          </p>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Confirm before closing sessions</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Show a confirmation dialog before disconnecting a session.
              </p>
            </div>
            <Switch
              checked={checked}
              onCheckedChange={(val) => setCloseConfirmPref(val ? null : false)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
