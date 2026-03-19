import { useState } from 'react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  hostsAtom,
  sessionsAtom,
  connectingHostIdsAtom,
  isEditHostOpenAtom,
  editingHostAtom,
  isAddHostOpenAtom,
} from '../../store/atoms'
import { pendingConnects } from '../../store/useAppInit'
import { DeleteHost, ConnectHost } from '../../../wailsjs/go/main/App'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { X, Server, Plus } from 'lucide-react'
import { HostListItem } from './HostListItem'
import type { Host } from '../../types'

export function HostList() {
  const hosts = useAtomValue(hostsAtom)
  const sessions = useAtomValue(sessionsAtom)
  const connectingHostIds = useAtomValue(connectingHostIdsAtom)
  const setHosts = useSetAtom(hostsAtom)
  const setConnectingIds = useSetAtom(connectingHostIdsAtom)
  const setIsEditOpen = useSetAtom(isEditHostOpenAtom)
  const setEditingHost = useSetAtom(editingHostAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)

  const [searchQuery, setSearchQuery] = useState('')

  const connectedHostIds = new Set(sessions.map((s) => s.hostId))

  const filteredHosts = searchQuery.trim()
    ? hosts.filter((h) => {
        const q = searchQuery.toLowerCase()
        return (
          h.label.toLowerCase().includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          h.username.toLowerCase().includes(q)
        )
      })
    : hosts

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between px-3 pt-2 pb-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Hosts
        </span>
        <Badge variant="secondary" className="h-4 px-1.5 text-xs font-normal">
          {hosts.length}
        </Badge>
      </div>
      {hosts.length >= 4 && (
        <div className="relative shrink-0 px-2 pb-1">
          <Input
            placeholder="Search hosts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pr-6 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground absolute top-1/2 right-4 size-5 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
            >
              <X />
            </Button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 px-2 py-1">
          {filteredHosts.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">No matching hosts</p>
          ) : (
            filteredHosts.map((host) => (
              <HostListItem
                key={host.id}
                host={host}
                isConnected={connectedHostIds.has(host.id)}
                isConnecting={connectingHostIds.has(host.id)}
                onConnect={() => handleConnect(host.id, host.label)}
                onDelete={() => handleDelete(host.id)}
                onEdit={() => handleEdit(host)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
