import { HostList } from '../sidebar/HostList'
import { SidebarFooter } from '../sidebar/SidebarFooter'
import { Separator } from '../ui/separator'

export function Sidebar() {
  return (
    <div className="bg-sidebar flex h-full flex-col">
      <HostList />
      <Separator />
      <SidebarFooter />
    </div>
  )
}
