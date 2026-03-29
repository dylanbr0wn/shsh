import { useAtom, useAtomValue } from 'jotai'
import { BarChart3 } from 'lucide-react'
import { debugPanelOpenAtom } from '../../store/debugStore'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/atoms'
import { collectLeaves } from '../../lib/paneTree'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function StatusBar() {
  const [debugPanelOpen, setDebugPanelOpen] = useAtom(debugPanelOpenAtom)
  const workspaces = useAtomValue(workspacesAtom)

  // Collect all leaves across all workspaces
  const allLeaves = workspaces.flatMap((ws) => collectLeaves(ws.layout))
  const sessionCount = allLeaves.filter((l) => l.kind !== 'local').length
  const allConnected = sessionCount > 0 && allLeaves
    .filter((l) => l.kind !== 'local')
    .every((l) => l.status === 'connected')
  const anyConnecting = allLeaves
    .filter((l) => l.kind !== 'local')
    .some((l) => l.status === 'connecting' || l.status === 'reconnecting')

  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom)

  const focusedHostLabel = (() => {
    if (!activeWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws || !ws.focusedPaneId) return null
    const leaf = collectLeaves(ws.layout).find((l) => l.paneId === ws.focusedPaneId)
    return leaf?.hostLabel ?? null
  })()

  return (
    <div className="bg-sidebar border-border flex h-6 shrink-0 items-center justify-between border-t px-2 text-xs">
      {/* Left zone — status info */}
      <div className="text-muted-foreground flex items-center gap-3">
        {sessionCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full',
                    anyConnecting ? 'bg-yellow-500' : allConnected ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                <span>{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {sessionCount} active {sessionCount === 1 ? 'session' : 'sessions'}
            </TooltipContent>
          </Tooltip>
        )}
        {focusedHostLabel && (
          <span className="max-w-[200px] truncate opacity-60">{focusedHostLabel}</span>
        )}
      </div>

      {/* Right zone — actions & indicators */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Toggle debug panel"
              aria-pressed={debugPanelOpen}
              onClick={() => setDebugPanelOpen((prev) => !prev)}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors',
                debugPanelOpen
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <BarChart3 className="size-3" />
              <span>Debug</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle debug panel (⌘J)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
