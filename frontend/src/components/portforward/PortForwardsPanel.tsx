import { useEffect, useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { Trash2, Plus, HelpCircle } from 'lucide-react'
import { portForwardsAtom, addPortForwardConnectionIdAtom } from '../../store/atoms'
import { useChannelPanelState } from '../../store/useChannelPanelState'
import { RemovePortForward, ListPortForwards } from '../../../wailsjs/go/main/SessionFacade'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { PanelHeader } from '../terminal/PanelHeader'
import type { PortForwardPanelState } from '../../types'

const DEFAULT_PF_STATE: PortForwardPanelState = {
  forwards: [],
}

interface Props {
  connectionId: string
}

export function PortForwardsPanel({ connectionId }: Props) {
  const [state, setState] = useChannelPanelState(portForwardsAtom, connectionId, DEFAULT_PF_STATE)
  const setAddPfConnection = useSetAtom(addPortForwardConnectionIdAtom)

  const listForwards = useCallback(async () => {
    try {
      const forwards = await ListPortForwards(connectionId)
      setState({ forwards: forwards ?? [] })
    } catch {
      // silently ignore — panel will just show empty
    }
  }, [connectionId, setState])

  useEffect(() => {
    listForwards()
  }, [listForwards])

  async function handleRemove(forwardId: string) {
    try {
      await RemovePortForward(connectionId, forwardId)
      await listForwards()
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-background flex h-full flex-col overflow-hidden text-sm">
      <PanelHeader title="Port Forwards">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add forward"
              onClick={() => setAddPfConnection(connectionId)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://dylanbr0wn.github.io/shsh/features/port-forwarding/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors"
            >
              <HelpCircle className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>Port forwarding documentation</TooltipContent>
        </Tooltip>
      </PanelHeader>

      <ScrollArea className="min-h-0 flex-1">
        {state.forwards.length === 0 && (
          <div className="text-muted-foreground flex items-center justify-center py-10 text-xs">
            No active forwards.
          </div>
        )}
        {state.forwards.map((fwd) => (
          <div key={fwd.id} className="hover:bg-accent/60 flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              127.0.0.1:{fwd.localPort} → {fwd.remoteHost}:{fwd.remotePort}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove forward"
                  onClick={() => handleRemove(fwd.id)}
                >
                  <Trash2 aria-hidden="true" />
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
