import { Terminal } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { isAddHostOpenAtom } from '../../store/atoms'
import { Button } from '../ui/button'

export function WelcomeScreen() {
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <Terminal className="text-muted-foreground/40 size-16" />
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-lg font-semibold">No active sessions</h2>
        <p className="text-muted-foreground text-sm">Connect to a host to get started</p>
      </div>
      <Button onClick={() => setIsAddHostOpen(true)}>Connect to a host</Button>
    </div>
  )
}
