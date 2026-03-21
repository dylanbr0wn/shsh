import { useEffect, useState, useCallback } from 'react'
import { useAtom } from 'jotai'
import { PanelRightClose, Trash2, Plus } from 'lucide-react'
import { portForwardsAtom } from '../../store/atoms'
import { AddPortForward, RemovePortForward, ListPortForwards } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface Props {
  sessionId: string
  onClose?: () => void
}

export function PortForwardsPanel({ sessionId, onClose }: Props) {
  const [pfState, setPfState] = useAtom(portForwardsAtom)
  const state = pfState[sessionId] ?? { isOpen: true, forwards: [], isAdding: false, error: null }

  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePort, setRemotePort] = useState('')

  const setState = useCallback(
    (patch: Partial<typeof state>) => {
      setPfState((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] ?? { isOpen: true, forwards: [], isAdding: false, error: null }), ...patch },
      }))
    },
    [setPfState, sessionId]
  )

  const listForwards = useCallback(async () => {
    try {
      const forwards = await ListPortForwards(sessionId)
      setState({ forwards: forwards ?? [], error: null })
    } catch (err) {
      setState({ error: String(err) })
    }
  }, [sessionId, setState])

  useEffect(() => {
    listForwards()
  }, [listForwards])

  async function handleAdd() {
    const lp = parseInt(localPort, 10)
    const rp = parseInt(remotePort, 10)
    if (!lp || !remoteHost.trim() || !rp) {
      setState({ error: 'All fields are required.' })
      return
    }
    try {
      setState({ error: null })
      await AddPortForward(sessionId, lp, remoteHost.trim(), rp)
      await listForwards()
      setLocalPort('')
      setRemoteHost('')
      setRemotePort('')
      setState({ isAdding: false })
    } catch (err) {
      setState({ error: String(err) })
    }
  }

  async function handleRemove(forwardId: string) {
    try {
      await RemovePortForward(sessionId, forwardId)
      await listForwards()
    } catch (err) {
      setState({ error: String(err) })
    }
  }

  function handleCancelAdd() {
    setLocalPort('')
    setRemoteHost('')
    setRemotePort('')
    setState({ isAdding: false, error: null })
  }

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden border-l text-sm">
      {/* Toolbar */}
      <div className="border-border bg-muted/30 flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <span className="text-foreground flex-1 truncate text-xs font-medium">Port Forwards</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Add forward"
              onClick={() => setState({ isAdding: true, error: null })}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add forward</TooltipContent>
        </Tooltip>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Close port forwards"
                onClick={onClose}
              >
                <PanelRightClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Close</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Add form */}
      {state.isAdding && (
        <div className="border-border border-b px-2 py-2 flex flex-col gap-2">
          <div className="flex gap-1">
            <Input
              className="h-7 text-xs w-20 shrink-0"
              placeholder="Local port"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <Input
              className="h-7 text-xs flex-1 min-w-0"
              placeholder="Remote host"
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            />
            <Input
              className="h-7 text-xs w-20 shrink-0"
              placeholder="Remote port"
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            />
          </div>
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancelAdd}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mx-2 mt-2 rounded-md border px-3 py-2 text-xs">
          {state.error}
        </div>
      )}

      {/* Forward list */}
      <ScrollArea className="min-h-0 flex-1">
        {state.forwards.length === 0 && (
          <div className="text-muted-foreground flex items-center justify-center py-10 text-xs">
            No active forwards.
          </div>
        )}
        {state.forwards.map((fwd) => (
          <div
            key={fwd.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-accent/60"
          >
            <span className="font-mono text-xs flex-1 min-w-0 truncate">
              127.0.0.1:{fwd.localPort} → {fwd.remoteHost}:{fwd.remotePort}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-6 shrink-0"
                  aria-label="Remove forward"
                  onClick={() => handleRemove(fwd.id)}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}
