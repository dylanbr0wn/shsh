import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  groupsAtom,
  connectingHostIdsAtom,
  isEditHostOpenAtom,
  editingHostAtom,
  isAddHostOpenAtom,
  isDeployKeyOpenAtom,
  deployKeyHostAtom,
} from '../../store/atoms'
import {
  workspacesAtom,
  activeWorkspaceIdAtom,
  type Workspace,
  type TerminalLeaf,
  type SFTPLeaf,
} from '../../store/workspaces'
import { useHostHealth } from '../../store/useHostHealth'
import { DeleteHost, UpdateHost, ListHosts } from '../../../wailsjs/go/main/HostFacade'
import { ConnectHost, ConnectForSFTP } from '../../../wailsjs/go/main/SessionFacade'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import {
  X,
  Server,
  Plus,
  ArrowUpAZ,
  ArrowDownAZ,
  Clock,
  Search,
} from 'lucide-react'
import { HostListItem } from './HostListItem'
import { HostGroupSection } from './HostGroupSection'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { Host } from '../../types'
import { collectLeaves } from '../../lib/paneTree'
import { Item, ItemContent, ItemDescription, ItemGroup } from '../ui/item'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group'
import { ButtonGroup } from '../ui/button-group'

type SortMode = 'az' | 'za' | 'recent'

interface ParsedQuery {
  plain: string
  tags: string[]
  groups: string[]
}

function parseQuery(query: string): ParsedQuery {
  const tags: string[] = []
  const groups: string[] = []
  const plainParts: string[] = []

  for (const token of query.trim().split(/\s+/)) {
    if (!token) continue
    const lower = token.toLowerCase()
    if (lower.startsWith('tag:') || lower.startsWith('tags:')) {
      const prefix = lower.startsWith('tags:') ? 'tags:' : 'tag:'
      const value = token.slice(prefix.length)
      if (value) tags.push(value.toLowerCase())
      else plainParts.push(token)
    } else if (lower.startsWith('group:') || lower.startsWith('groups:')) {
      const prefix = lower.startsWith('groups:') ? 'groups:' : 'group:'
      const value = token.slice(prefix.length)
      if (value) groups.push(value.toLowerCase())
      else plainParts.push(token)
    } else {
      plainParts.push(token.toLowerCase())
    }
  }

  return { plain: plainParts.join(' '), tags, groups }
}

function comparator(sortMode: SortMode) {
  return (a: Host, b: Host) => {
    if (sortMode === 'az') return a.label.toLowerCase().localeCompare(b.label.toLowerCase())
    if (sortMode === 'za') return b.label.toLowerCase().localeCompare(a.label.toLowerCase())
    const aTime = a.lastConnectedAt ?? a.createdAt
    const bTime = b.lastConnectedAt ?? b.createdAt
    return bTime.localeCompare(aTime)
  }
}

export function HostList() {
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const connectingHostIds = useAtomValue(connectingHostIdsAtom)
  const setHosts = useSetAtom(hostsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setWorkspaces = useSetAtom(workspacesAtom)
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom)
  const setIsEditOpen = useSetAtom(isEditHostOpenAtom)
  const setEditingHost = useSetAtom(editingHostAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsDeployKeyOpen = useSetAtom(isDeployKeyOpenAtom)
  const setDeployKeyHost = useSetAtom(deployKeyHostAtom)

  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('az')

  const connectedHostIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ws of workspaces) {
      for (const leaf of collectLeaves(ws.layout)) {
        if (leaf.hostId) ids.add(leaf.hostId)
      }
    }
    return ids
  }, [workspaces])

  useHostHealth(hosts)

  // Grouped data (no search)
  const { groupMap, ungrouped } = useMemo(() => {
    const cmp = comparator(sortMode)
    const sorted = [...hosts].sort(cmp)
    const map = new Map<string, Host[]>()
    const ungrouped: Host[] = []
    for (const host of sorted) {
      if (host.groupId) {
        if (!map.has(host.groupId)) map.set(host.groupId, [])
        map.get(host.groupId)!.push(host)
      } else {
        ungrouped.push(host)
      }
    }
    return { groupMap: map, ungrouped }
  }, [hosts, sortMode])

  // Flat filtered list (search active)
  const filteredHosts = useMemo(() => {
    if (!searchQuery.trim()) return []
    const { plain, tags, groups: groupTerms } = parseQuery(searchQuery)

    return [...hosts]
      .filter((h) => {
        const groupName = h.groupId
          ? (groups.find((g) => g.id === h.groupId)?.name ?? '').toLowerCase()
          : ''

        // group: tokens — all must match (AND); host with no/unresolvable group never matches
        if (groupTerms.length > 0) {
          if (!groupName) return false
          if (!groupTerms.every((term) => groupName.includes(term))) return false
        }

        // tag: tokens — all must match (AND); host with no tags never matches
        if (tags.length > 0) {
          const hostTags = h.tags?.map((t) => t.toLowerCase()) ?? []
          if (hostTags.length === 0) return false
          if (!tags.every((term) => hostTags.some((ht) => ht.includes(term)))) return false
        }

        // plain text — OR across all fields
        if (plain) {
          const matches =
            h.label.toLowerCase().includes(plain) ||
            h.hostname.toLowerCase().includes(plain) ||
            h.username.toLowerCase().includes(plain) ||
            (h.tags?.some((t) => t.toLowerCase().includes(plain)) ?? false) ||
            groupName.includes(plain)
          if (!matches) return false
        }

        return true
      })
      .sort(comparator(sortMode))
  }, [hosts, groups, searchQuery, sortMode])

  const sortedGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
      ),
    [groups]
  )

  function cycleSortMode() {
    setSortMode((prev) => (prev === 'az' ? 'za' : prev === 'za' ? 'recent' : 'az'))
  }

  const sortIcon =
    sortMode === 'az' ? <ArrowUpAZ /> : sortMode === 'za' ? <ArrowDownAZ /> : <Clock />

  const sortTooltip =
    sortMode === 'az'
      ? 'A–Z (click for Z–A)'
      : sortMode === 'za'
        ? 'Z–A (click for Recent)'
        : 'Recent (click for A–Z)'

  async function handleConnect(hostId: string, hostLabel: string) {
    setConnectingIds((prev) => new Set([...prev, hostId]))
    try {
      const result = await ConnectHost(hostId)
      const paneId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const leaf: TerminalLeaf = {
        type: 'leaf',
        kind: 'terminal',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId,
        hostLabel,
        status: 'connected',
        connectedAt: new Date().toISOString(),
      }
      const workspace: Workspace = {
        id: workspaceId,
        label: hostLabel,
        layout: leaf,
        focusedPaneId: paneId,
      }
      setWorkspaces((prev) => [...prev, workspace])
      setActiveWorkspaceId(workspaceId)
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(hostId)
        return next
      })
    } catch (err) {
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(hostId)
        return next
      })
      toast.error('Connection failed', { description: String(err) })
    }
  }

  async function handleOpenFiles(hostId: string, hostLabel: string) {
    setConnectingIds((prev) => new Set([...prev, hostId]))
    try {
      const result = await ConnectForSFTP(hostId)
      const paneId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const leaf: SFTPLeaf = {
        type: 'leaf',
        kind: 'sftp',
        paneId,
        connectionId: result.connectionId,
        channelId: result.channelId,
        hostId,
        hostLabel,
        status: 'connected',
      }
      const workspace: Workspace = {
        id: workspaceId,
        label: `${hostLabel} — Files`,
        layout: leaf,
        focusedPaneId: paneId,
      }
      setWorkspaces((prev) => [...prev, workspace])
      setActiveWorkspaceId(workspaceId)
    } catch (err) {
      toast.error('Failed to open files', { description: String(err) })
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(hostId)
        return next
      })
    }
  }

  async function handleDelete(hostId: string) {
    try {
      await DeleteHost(hostId)
      setHosts((prev) => prev.filter((h) => h.id !== hostId))
    } catch (err) {
      toast.error('Failed to delete host', { description: String(err) })
    }
  }

  function handleEdit(host: Host) {
    setEditingHost(host)
    setIsEditOpen(true)
  }

  function handleDeployKey(host: Host) {
    setDeployKeyHost(host)
    setIsDeployKeyOpen(true)
  }

  async function handleMoveToGroup(hostId: string, groupId: string | null) {
    const host = hosts.find((h) => h.id === hostId)
    if (!host) return
    try {
      const updated = await UpdateHost({
        id: host.id,
        label: host.label,
        hostname: host.hostname,
        port: host.port,
        username: host.username,
        authMethod: host.authMethod,
        groupId: groupId ?? undefined,
      })
      setHosts((prev) => prev.map((h) => (h.id === hostId ? (updated as unknown as Host) : h)))
    } catch (err) {
      toast.error('Failed to move host', { description: String(err) })
    }
  }



  // Re-sync hosts from DB after group deletion to reflect nulled group_ids
  async function handleGroupDeleted() {
    try {
      const fresh = await ListHosts()
      setHosts(fresh as unknown as Host[])
    } catch {
      // best-effort
    }
  }

  if (hosts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <Server className="text-muted-foreground/40 size-8" />
        <p className="text-muted-foreground text-center text-xs">No saved hosts yet</p>
        <Button size="sm" variant="outline" onClick={() => setIsAddHostOpen(true)}>
          <Plus data-icon="inline-start" /> Add Host
        </Button>
      </div>
    )
  }

  const isSearching = searchQuery.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      {/* Header */}
      {/* <div className="border-border/50 flex shrink-0 items-center justify-between border-b px-3 pt-2 pb-1.5">
        <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-widest uppercase select-none">
          Hosts
        </span>
        <ButtonGroup>

        </ButtonGroup>
      </div> */}

      {/* Search */}
      <ButtonGroup className='w-full'>
        <ButtonGroup className='grow'>
          <InputGroup>
          <InputGroupInput
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          {searchQuery && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                title="Clear"
                aria-label="Clear"
                onClick={() => setSearchQuery('')}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        </ButtonGroup>
        <ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={cycleSortMode}>
                {sortIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sortTooltip}</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </ButtonGroup>
      <ScrollArea className="min-h-0 flex-1 select-none">
        <ItemGroup>
          {isSearching ? (
            // Flat filtered list with optional group badge
            filteredHosts.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>No matching hosts</ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              filteredHosts.map((host, index) => {
                const group = host.groupId ? groups.find((g) => g.id === host.groupId) : undefined
                return (
                  <div
                    key={host.id}
                    className="host-item-animate flex flex-col"
                    style={{
                      animation: 'host-item-in 200ms ease-out both',
                      animationDelay: `${Math.min(index, 8) * 40}ms`,
                    }}
                  >
                    {group && (
                      <span className="text-muted-foreground/50 px-3 pt-0.5 text-[10px]">
                        · {group.name}
                      </span>
                    )}
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
                        onConnect={() => handleConnect(host.id, host.label)}
                        onDelete={() => handleDelete(host.id)}
                        onEdit={() => handleEdit(host)}
                        onDeployKey={() => handleDeployKey(host)}
                        onMoveToGroup={handleMoveToGroup}
                        onOpenFiles={() => handleOpenFiles(host.id, host.label)}
                      />
                    </ErrorBoundary>
                  </div>
                )
              })
            )
          ) : (
            // Grouped view
            <>
              {sortedGroups.map((group) => (
                <HostGroupSection
                  key={group.id}
                  group={group}
                  hosts={groupMap.get(group.id) ?? []}
                  connectedHostIds={connectedHostIds}
                  connectingHostIds={connectingHostIds}
                  onConnect={handleConnect}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onDeployKey={handleDeployKey}
                  onMoveToGroup={handleMoveToGroup}
                  onGroupDeleted={handleGroupDeleted}
                  onOpenFiles={handleOpenFiles}
                />
              ))}

              {/* Ungrouped hosts */}
              {ungrouped.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {sortedGroups.length > 0 && (
                    <span className="text-muted-foreground/50 px-1.5 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                      Ungrouped
                    </span>
                  )}
                  {ungrouped.map((host, index) => (
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
                          onConnect={() => handleConnect(host.id, host.label)}
                          onDelete={() => handleDelete(host.id)}
                          onEdit={() => handleEdit(host)}
                          onDeployKey={() => handleDeployKey(host)}
                          onMoveToGroup={handleMoveToGroup}
                          onOpenFiles={() => handleOpenFiles(host.id, host.label)}
                        />
                      </ErrorBoundary>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ItemGroup>
      </ScrollArea>
    </div>
  )
}
