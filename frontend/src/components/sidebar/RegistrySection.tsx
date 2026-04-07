import { useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { ChevronRight, Package, Globe } from 'lucide-react'
import { cn } from '../../lib/utils'
import { HostListItem } from './HostListItem'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { ItemGroup } from '../ui/item'
import type { Host, Group } from '../../types'

interface RegistrySectionProps {
  origin: string
  hosts: Host[]
  groups: Group[]
  connectedHostIds: Set<string>
  connectingHostIds: Set<string>
  onConnect: (hostId: string, hostLabel: string) => void
  onOpenFiles?: (hostId: string, hostLabel: string) => void
}

function parseOriginLabel(origin: string): { registry: string; bundle: string } {
  // origin format: "registry:<registry-name>/<namespace>/<bundle>"
  const withoutPrefix = origin.replace(/^registry:/, '')
  const firstSlash = withoutPrefix.indexOf('/')
  if (firstSlash === -1) return { registry: withoutPrefix, bundle: '' }
  return {
    registry: withoutPrefix.slice(0, firstSlash),
    bundle: withoutPrefix.slice(firstSlash + 1),
  }
}

export function RegistrySection({
  origin,
  hosts,
  groups,
  connectedHostIds,
  connectingHostIds,
  onConnect,
  onOpenFiles,
}: RegistrySectionProps) {
  const [open, setOpen] = useState(true)
  const { registry, bundle } = parseOriginLabel(origin)

  // Group hosts within this registry section
  const { groupedHosts, ungrouped } = useMemo(() => {
    const groupMap = new Map<string, Host[]>()
    const ungrouped: Host[] = []
    for (const host of hosts) {
      if (host.groupId) {
        if (!groupMap.has(host.groupId)) groupMap.set(host.groupId, [])
        groupMap.get(host.groupId)!.push(host)
      } else {
        ungrouped.push(host)
      }
    }
    return { groupedHosts: groupMap, ungrouped }
  }, [hosts])

  const sortedGroups = useMemo(() => {
    return groups.filter((g) => g.origin === origin).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [groups, origin])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors">
        <ChevronRight
          className={cn('text-muted-foreground size-3 transition-transform', open && 'rotate-90')}
        />
        <Globe className="text-muted-foreground size-3" />
        <span className="truncate font-medium">{registry}</span>
        <span className="text-muted-foreground/70 truncate font-mono text-[10px]">{bundle}</span>
        <span className="text-muted-foreground/50 ml-auto text-[10px]">{hosts.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-muted ml-2 border-l pl-1">
          <ItemGroup>
            {/* Grouped hosts */}
            {sortedGroups.map((group) => {
              const groupHosts = groupedHosts.get(group.id) ?? []
              if (groupHosts.length === 0) return null
              return (
                <RegistryGroupSection
                  key={group.id}
                  group={group}
                  hosts={groupHosts}
                  connectedHostIds={connectedHostIds}
                  connectingHostIds={connectingHostIds}
                  onConnect={onConnect}
                  onOpenFiles={onOpenFiles}
                />
              )
            })}
            {/* Ungrouped hosts */}
            {ungrouped.map((host, index) => (
              <div
                key={host.id}
                style={{
                  animation: 'host-item-in 200ms ease-out both',
                  animationDelay: `${Math.min(index, 8) * 40}ms`,
                }}
              >
                <ErrorBoundary
                  fallback="inline"
                  zone={`reg-host-${host.id}`}
                  onError={(e, i) => reportUIError(e, i, `reg-host-${host.id}`)}
                  resetKeys={[host.id]}
                >
                  <HostListItem
                    host={host}
                    isConnected={connectedHostIds.has(host.id)}
                    isConnecting={connectingHostIds.has(host.id)}
                    onConnect={() => onConnect(host.id, host.label)}
                    onDelete={() => {}}
                    onEdit={() => {}}
                    onDeployKey={() => {}}
                    onOpenFiles={onOpenFiles ? () => onOpenFiles(host.id, host.label) : undefined}
                    readOnly
                  />
                </ErrorBoundary>
              </div>
            ))}
          </ItemGroup>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function RegistryGroupSection({
  group,
  hosts,
  connectedHostIds,
  connectingHostIds,
  onConnect,
  onOpenFiles,
}: {
  group: Group
  hosts: Host[]
  connectedHostIds: Set<string>
  connectingHostIds: Set<string>
  onConnect: (hostId: string, hostLabel: string) => void
  onOpenFiles?: (hostId: string, hostLabel: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors">
        <ChevronRight
          className={cn('text-muted-foreground size-3 transition-transform', open && 'rotate-90')}
        />
        <Package className="text-muted-foreground size-3" />
        <span className="truncate">{group.name}</span>
        <span className="text-muted-foreground/50 ml-auto text-[10px]">{hosts.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ItemGroup>
          {hosts.map((host, index) => (
            <div
              key={host.id}
              style={{
                animation: 'host-item-in 200ms ease-out both',
                animationDelay: `${Math.min(index, 8) * 40}ms`,
              }}
            >
              <ErrorBoundary
                fallback="inline"
                zone={`reg-host-${host.id}`}
                onError={(e, i) => reportUIError(e, i, `reg-host-${host.id}`)}
                resetKeys={[host.id]}
              >
                <HostListItem
                  host={host}
                  isConnected={connectedHostIds.has(host.id)}
                  isConnecting={connectingHostIds.has(host.id)}
                  onConnect={() => onConnect(host.id, host.label)}
                  onDelete={() => {}}
                  onEdit={() => {}}
                  onDeployKey={() => {}}
                  onOpenFiles={onOpenFiles ? () => onOpenFiles(host.id, host.label) : undefined}
                  readOnly
                />
              </ErrorBoundary>
            </div>
          ))}
        </ItemGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}
