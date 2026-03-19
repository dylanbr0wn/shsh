import { HostList } from '../sidebar/HostList'
import { SidebarFooter } from '../sidebar/SidebarFooter'
import { Separator } from '../ui/separator'

export function Sidebar() {
  return (
    <div className="bg-sidebar border-border flex h-full flex-col border-r">
      <HostList />
      <Separator />
      <SidebarFooter />
    </div>
  )
}
