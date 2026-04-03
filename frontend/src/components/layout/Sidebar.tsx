import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import { sidebarViewAtom } from '../../store/sidebarView'
import { HostList } from '../sidebar/HostList'
import { SessionList } from '../sidebar/SessionList'
import { SidebarFooter } from '../sidebar/SidebarFooter'
import { Separator } from '../ui/separator'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { Badge } from '../ui/badge'

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

  // Zero-state: no workspaces, just show hosts (no toggle)
  if (workspaces.length === 0) {
    return (
      <div className="bg-sidebar flex h-full flex-col">
        <HostList />
        <Separator />
        <SidebarFooter />
      </div>
    )
  }

  return (
    <div className="bg-sidebar flex h-full flex-col">
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as 'hosts' | 'sessions')}
      >
        <TabsList variant="line" className="w-full border-b border-sidebar-border px-2">
          <TabsTrigger value="hosts" className="gap-1 text-xs">
            ⊞ Hosts
          </TabsTrigger>
          <TabsTrigger value="sessions" className="gap-1 text-xs">
            ▣ Sessions
            <Badge
              variant="default"
              className="ml-0.5 h-4 min-w-4 px-1 text-[9px]"
            >
              {workspaces.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'hosts' ? (
        <>
          <HostList />
          <Separator />
          <SidebarFooter />
        </>
      ) : (
        <SessionList />
      )}
    </div>
  )
}
