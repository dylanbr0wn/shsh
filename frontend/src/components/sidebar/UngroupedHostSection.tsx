import { groupExpandedAtom, UNGROUPED_GROUP_ID } from '@/store/atoms'
import { Group, Host } from '@/types'
import { useAtom } from 'jotai'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '../ui/item'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '@/lib/reportUIError'
import { HostListItem } from './HostListItem'

interface Props {
  group: Group
  hosts: Host[]
  connectedHostIds: Set<string>
  connectingHostIds: Set<string>
  onConnect: (hostId: string, hostLabel: string) => void
  onDelete: (hostId: string) => void
  onEdit: (host: Host) => void
  onMoveToGroup: (hostId: string, groupId: string | null) => void
  onDeployKey: (host: Host) => void
  onOpenFiles?: (hostId: string, hostLabel: string) => void
}

export function UngroupedHostSection({
  hosts,
  connectedHostIds,
  connectingHostIds,
  onConnect,
  onDelete,
  onDeployKey,
  onEdit,
  onMoveToGroup,
  onOpenFiles,
}: Omit<Props, 'group'>) {
  const [expanded, setExpanded] = useAtom(groupExpandedAtom)
  const isExpanded = expanded[UNGROUPED_GROUP_ID] !== false // default open
  return (
    <>
      <Collapsible
        open={isExpanded}
        onOpenChange={(open) => setExpanded((prev) => ({ ...prev, [UNGROUPED_GROUP_ID]: open }))}
        className="flex flex-col rounded-lg"
      >
        {/* Group header */}

        <CollapsibleTrigger asChild>
          <Item asChild size="xs" className="p-1">
            <button>
              <ItemMedia>
                <ChevronRight
                  className={cn(
                    'text-muted-foreground/60 size-3.5 shrink-0 transition-transform duration-150',
                    isExpanded && 'rotate-90'
                  )}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  <span>Ungrouped</span>
                  <span className="text-muted-foreground/50 text-xs">{hosts.length} hosts</span>
                </ItemTitle>
              </ItemContent>
            </button>
          </Item>
        </CollapsibleTrigger>

        {/* Hosts */}
        <CollapsibleContent>
          <ItemGroup className="gap-1! p-1">
            {hosts.map((host, index) => (
              <div
                key={host.id}
                className="host-item-animate"
                style={{
                  animation: 'host-item-in 200ms ease-out both',
                  animationDelay: `${Math.min(index, 8) * 40}ms`,
                }}
              >
                <ErrorBoundary
                  fallback="inline"
                  zone={`host-${host.id}`}
                  onError={(e, i) => reportUIError(e, i, `host-${host.id}`)}
                  resetKeys={[host.id]}
                >
                  <HostListItem
                    host={host}
                    isConnected={connectedHostIds.has(host.id)}
                    isConnecting={connectingHostIds.has(host.id)}
                    onConnect={() => onConnect(host.id, host.label)}
                    onDelete={() => onDelete(host.id)}
                    onEdit={() => onEdit(host)}
                    onDeployKey={() => onDeployKey(host)}
                    onMoveToGroup={onMoveToGroup}
                    onOpenFiles={onOpenFiles ? () => onOpenFiles(host.id, host.label) : undefined}
                  />
                </ErrorBoundary>
              </div>
            ))}
          </ItemGroup>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
