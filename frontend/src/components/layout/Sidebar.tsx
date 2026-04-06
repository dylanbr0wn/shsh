import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import { sidebarViewAtom } from '../../store/sidebarView'
import { HostList } from '../sidebar/HostList'
import { SessionList } from '../sidebar/SessionList'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { Badge } from '../ui/badge'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'

export function Sidebar() {
  const workspaces = useAtomValue(workspacesAtom)
  const [view, setView] = useAtom(sidebarViewAtom)
  const prevCount = useRef(workspaces.length)

  useEffect(() => {
    const prev = prevCount.current
    prevCount.current = workspaces.length
    if (prev === 0 && workspaces.length > 0) setView('sessions')
    if (workspaces.length === 0) setView('hosts')
  }, [workspaces.length, setView])

  return (
    <div className="bg-sidebar flex h-full flex-col">
      <Tabs value={view} onValueChange={(v) => setView(v as 'hosts' | 'sessions')}>
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
      </Tabs>

      {view === 'hosts' ? (
        <ErrorBoundary
          fallback="inline"
          zone="host-list"
          onError={(e, i) => reportUIError(e, i, 'host-list')}
        >
          <HostList />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary
          fallback="inline"
          zone="session-list"
          onError={(e, i) => reportUIError(e, i, 'session-list')}
        >
          <SessionList />
        </ErrorBoundary>
      )}
    </div>
  )
}
