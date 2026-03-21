import { useRef, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ChevronRight, Loader2, MoreHorizontal, Pencil, Plug2, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Group, Host } from '../../types'
import { groupExpandedAtom, groupsAtom, hostsAtom } from '../../store/atoms'
import { pendingConnects } from '../../store/useAppInit'
import { DeleteGroup, UpdateGroup, BulkConnectGroup } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
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
  onGroupDeleted?: () => void
}

export function HostGroupSection({
  group,
  hosts,
  connectedHostIds,
  connectingHostIds,
  onConnect,
  onDelete,
  onEdit,
  onMoveToGroup,
  onGroupDeleted,
}: Props) {
  const [expanded, setExpanded] = useAtom(groupExpandedAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setHosts = useSetAtom(hostsAtom)

  const isExpanded = expanded[group.id] !== false // default open

  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkConnecting, setBulkConnecting] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  function toggleExpand() {
    setExpanded((prev) => ({ ...prev, [group.id]: !isExpanded }))
  }

  function startRename() {
    setRenameValue(group.name)
    setRenaming(true)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  async function commitRename() {
    const name = renameValue.trim()
    if (!name || name === group.name) {
      setRenaming(false)
      return
    }
    try {
      const updated = await UpdateGroup({ id: group.id, name, sortOrder: group.sortOrder })
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? (updated as unknown as Group) : g)))
    } catch (err) {
      toast.error('Failed to rename group', { description: String(err) })
    }
    setRenaming(false)
  }

  function cancelRename() {
    setRenaming(false)
  }

  async function handleDelete() {
    try {
      await DeleteGroup(group.id)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      // Ungrouped hosts will be updated on next ListHosts call; update locally too
      setHosts((prev) => prev.map((h) => (h.groupId === group.id ? { ...h, groupId: undefined } : h)))
      onGroupDeleted?.()
    } catch (err) {
      toast.error('Failed to delete group', { description: String(err) })
    }
  }

  async function handleBulkConnect() {
    if (hosts.length === 0) return
    setBulkConnecting(true)
    try {
      const results = await BulkConnectGroup(group.id)
      results.forEach(({ sessionId, hostId }: { sessionId: string; hostId: string }) => {
        const host = hosts.find((h) => h.id === hostId)
        if (host) pendingConnects.set(sessionId, { hostId: host.id, hostLabel: host.label })
      })
    } catch (err) {
      toast.error('Bulk connect failed', { description: String(err) })
    } finally {
      setBulkConnecting(false)
    }
  }

  const anyConnecting = hosts.some((h) => connectingHostIds.has(h.id)) || bulkConnecting

  return (
    <>
      <div className="flex flex-col">
        {/* Group header */}
        <div
          className="group/header flex items-center gap-1 rounded-md px-1.5 py-1 cursor-pointer hover:bg-accent/40 transition-colors"
          onClick={toggleExpand}
        >
          <ChevronRight
            className={cn(
              'text-muted-foreground/60 size-3.5 shrink-0 transition-transform duration-150',
              isExpanded && 'rotate-90'
            )}
          />

          {renaming ? (
            <Input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-5 flex-1 px-1 text-xs font-semibold"
              autoFocus
            />
          ) : (
            <span className="flex-1 truncate text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/80">
              {group.name}
            </span>
          )}

          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] leading-4">
            {hosts.length}
          </Badge>

          {/* Connect All button */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-5 shrink-0 transition-opacity opacity-0 group-hover/header:opacity-100',
              anyConnecting && 'opacity-100'
            )}
            disabled={anyConnecting || hosts.length === 0}
            onClick={(e) => {
              e.stopPropagation()
              handleBulkConnect()
            }}
            title="Connect all"
          >
            {anyConnecting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plug2 className="size-3" />
            )}
          </Button>

          {/* Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 opacity-0 group-hover/header:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  startRename()
                }}
              >
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDelete(true)
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hosts */}
        {isExpanded && (
          <div className="flex flex-col gap-0.5 pl-2">
            {hosts.map((host) => (
              <HostListItem
                key={host.id}
                host={host}
                isConnected={connectedHostIds.has(host.id)}
                isConnecting={connectingHostIds.has(host.id)}
                onConnect={() => onConnect(host.id, host.label)}
                onDelete={() => onDelete(host.id)}
                onEdit={() => onEdit(host)}
                onMoveToGroup={onMoveToGroup}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Hosts in this group will become ungrouped. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
