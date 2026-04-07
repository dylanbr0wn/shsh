import { useEffect, useRef, type CSSProperties } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { PanelLeftClose } from 'lucide-react'
import { workspacesAtom } from '../../store/workspaces'
import { sidebarViewAtom } from '../../store/sidebarView'
import { sidebarCollapsedAtom } from '../../store/atoms'
import { HostList } from '../sidebar/HostList'
import { SessionList } from '../sidebar/SessionList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'

export function Sidebar() {
  const workspaces = useAtomValue(workspacesAtom)
  const [view, setView] = useAtom(sidebarViewAtom)
  const [, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const prevCount = useRef(workspaces.length)

  useEffect(() => {
    const prev = prevCount.current
    prevCount.current = workspaces.length
    if (prev === 0 && workspaces.length > 0) setView('sessions')
    if (workspaces.length === 0) setView('hosts')
  }, [workspaces.length, setView])

  return (
    <div className="bg-sidebar flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className="flex h-9 shrink-0 items-center justify-end px-0.5"
        style={{ '--wails-draggable': 'drag' } as CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-8 w-8"
              style={{ '--wails-draggable': 'no-drag' } as CSSProperties}
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Hide sidebar"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Hide sidebar</TooltipContent>
        </Tooltip>
      </div>
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as 'hosts' | 'sessions')}
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <TabsList variant="line" className="border-sidebar-border w-full border-b px-2">
          <TabsTrigger value="hosts" className="gap-1 text-xs">
            ⊞ Hosts
          </TabsTrigger>
          <TabsTrigger value="sessions" disabled={workspaces.length <= 0} className="gap-1 text-xs">
            ▣ Sessions
            <Badge variant="link" className="text-muted-foreground/70 block shrink-0 text-[10px]">
              {workspaces.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="hosts" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary
            fallback="inline"
            zone="host-list"
            onError={(e, i) => reportUIError(e, i, 'host-list')}
          >
            <HostList />
          </ErrorBoundary>
        </TabsContent>
        <TabsContent value="sessions" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary
            fallback="inline"
            zone="session-list"
            onError={(e, i) => reportUIError(e, i, 'session-list')}
          >
            <SessionList />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  )
}
