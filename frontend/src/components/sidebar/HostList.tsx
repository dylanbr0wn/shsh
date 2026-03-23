import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  groupsAtom,
  sessionsAtom,
  connectingHostIdsAtom,
  isEditHostOpenAtom,
  editingHostAtom,
  isAddHostOpenAtom,
  isQuickConnectOpenAtom,
  isNewGroupOpenAtom,
} from '../../store/atoms'
import { pendingConnects } from '../../store/useAppInit'
import { useHostHealth } from '../../store/useHostHealth'
import {
  DeleteHost,
  ConnectHost,
  UpdateHost,
  AddGroup,
  ListHosts,
} from '../../../wailsjs/go/main/App'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { X, Server, Plus, ArrowUpAZ, ArrowDownAZ, Clock, FolderPlus, Zap } from 'lucide-react'
import { HostListItem } from './HostListItem'
import { HostGroupSection } from './HostGroupSection'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { Group, Host } from '../../types'

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
  const sessions = useAtomValue(sessionsAtom)
  const connectingHostIds = useAtomValue(connectingHostIdsAtom)
  const setHosts = useSetAtom(hostsAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setIsEditOpen = useSetAtom(isEditHostOpenAtom)
  const setEditingHost = useSetAtom(editingHostAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsQuickConnectOpen = useSetAtom(isQuickConnectOpenAtom)

  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('az')
  const [newGroupOpen, setNewGroupOpen] = useAtom(isNewGroupOpenAtom)
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const newGroupInputRef = useRef<HTMLInputElement>(null)

  const connectedHostIds = useMemo(() => new Set(sessions.map((s) => s.hostId)), [sessions])

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
      const sessionId = await ConnectHost(hostId)
      pendingConnects.set(sessionId, { hostId, hostLabel })
    } catch (err) {
      setConnectingIds((prev) => {
        const next = new Set(prev)
        next.delete(hostId)
        return next
      })
      toast.error('Connection failed', { description: String(err) })
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

  async function handleCreateGroup() {
    const name = newGroupName.trim()
    if (!name) return
    setCreatingGroup(true)
    try {
      const group = await AddGroup({ name })
      setGroups((prev) => [...prev, group as unknown as Group])
      setNewGroupName('')
      setNewGroupOpen(false)
    } catch (err) {
      toast.error('Failed to create group', { description: String(err) })
    } finally {
      setCreatingGroup(false)
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border/50 flex shrink-0 items-center justify-between border-b px-3 pt-2 pb-1.5">
        <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-widest uppercase select-none">
          Hosts
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={cycleSortMode}
              >
                {sortIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sortTooltip}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setIsQuickConnectOpen(true)}
              >
                <Zap />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Quick Connect</TooltipContent>
          </Tooltip>

          <Popover
            open={newGroupOpen}
            onOpenChange={(open) => {
              setNewGroupOpen(open)
              if (open) setTimeout(() => newGroupInputRef.current?.focus(), 0)
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <FolderPlus />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Group</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-56 p-3" side="bottom" align="end">
              <p className="mb-2 text-xs font-medium">New Group</p>
              <div className="flex gap-2">
                <Input
                  ref={newGroupInputRef}
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateGroup()
                    if (e.key === 'Escape') setNewGroupOpen(false)
                  }}
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleCreateGroup}
                  disabled={creatingGroup || !newGroupName.trim()}
                >
                  Create
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Search */}
      <div className="relative shrink-0 px-2 pt-1.5 pb-1 select-none">
        <Input
          placeholder="Search hosts…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-7 pr-6 text-xs"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground absolute top-1/2 right-4 -translate-y-1/2"
            onClick={() => setSearchQuery('')}
          >
            <X />
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 select-none">
        <div className="flex flex-col gap-0.5 px-2 py-1">
          {isSearching ? (
            // Flat filtered list with optional group badge
            filteredHosts.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">No matching hosts</p>
            ) : (
              filteredHosts.map((host) => {
                const group = host.groupId ? groups.find((g) => g.id === host.groupId) : undefined
                return (
                  <div key={host.id} className="flex flex-col">
                    {group && (
                      <span className="text-muted-foreground/50 px-3 pt-0.5 text-[10px]">
                        · {group.name}
                      </span>
                    )}
                    <HostListItem
                      host={host}
                      isConnected={connectedHostIds.has(host.id)}
                      isConnecting={connectingHostIds.has(host.id)}
                      onConnect={() => handleConnect(host.id, host.label)}
                      onDelete={() => handleDelete(host.id)}
                      onEdit={() => handleEdit(host)}
                      onMoveToGroup={handleMoveToGroup}
                    />
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
                  onMoveToGroup={handleMoveToGroup}
                  onGroupDeleted={handleGroupDeleted}
                />
              ))}

              {/* Ungrouped hosts */}
              {ungrouped.length > 0 && (
                <div className="flex flex-col gap-0.5 pl-2">
                  {sortedGroups.length > 0 && (
                    <span className="text-muted-foreground/50 px-1.5 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                      Ungrouped
                    </span>
                  )}
                  {ungrouped.map((host) => (
                    <HostListItem
                      key={host.id}
                      host={host}
                      isConnected={connectedHostIds.has(host.id)}
                      isConnecting={connectingHostIds.has(host.id)}
                      onConnect={() => handleConnect(host.id, host.label)}
                      onDelete={() => handleDelete(host.id)}
                      onEdit={() => handleEdit(host)}
                      onMoveToGroup={handleMoveToGroup}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
