import type { Group, Host } from '../../types'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { HostListItem } from './HostListItem'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '../ui/item'

interface Props {
  origin: string
  hosts: Host[]
  groups: Group[]
  connectedHostIds: Set<string>
  connectingHostIds: Set<string>
  onConnect: (hostId: string, hostLabel: string) => void
  onOpenFiles: (hostId: string, hostLabel: string) => void
}

export function RegistrySection({
  origin,
  hosts,
  groups,
  connectedHostIds,
  connectingHostIds,
  onConnect,
  onOpenFiles,
}: Props) {
  if (hosts.length === 0) return null

  return (
    <ItemGroup className="bg-muted/30 rounded-lg p-1">
      <Item size="xs">
        <ItemContent>
          <ItemTitle>{origin}</ItemTitle>
          <ItemDescription>
            Registry hosts: {hosts.length}
            {groups.length > 0 ? `, groups: ${groups.length}` : ''}
          </ItemDescription>
        </ItemContent>
      </Item>
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
            zone={`registry-host-${host.id}`}
            onError={(e, i) => reportUIError(e, i, `registry-host-${host.id}`)}
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
              onOpenFiles={() => onOpenFiles(host.id, host.label)}
              readOnly
            />
          </ErrorBoundary>
        </div>
      ))}
    </ItemGroup>
  )
}
