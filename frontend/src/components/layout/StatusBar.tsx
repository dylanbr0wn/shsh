import { useAtom } from 'jotai'
import { BarChart3 } from 'lucide-react'
import { debugPanelOpenAtom } from '../../store/debugStore'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function StatusBar() {
  const [debugPanelOpen, setDebugPanelOpen] = useAtom(debugPanelOpenAtom)

  return (
    <div className="bg-sidebar border-border flex h-6 shrink-0 items-center justify-between border-t px-2 text-xs">
      {/* Left zone — status info (added in later tasks) */}
      <div className="flex items-center gap-3" />

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
