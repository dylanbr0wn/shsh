import { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Group, Host } from '../../types'
import { groupExpandedAtom, groupsAtom, hostsAtom } from '../../store/atoms'
import { DeleteGroup } from '../../../wailsjs/go/main/HostFacade'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
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
import { EditGroupModal } from '../modals/EditGroupModal'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '../ui/item'
import { ButtonGroup } from '../ui/button-group'

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
  onGroupDeleted?: () => void
  onOpenFiles?: (hostId: string, hostLabel: string) => void
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
  onDeployKey,
  onGroupDeleted,
  onOpenFiles,
}: Props) {
  const [expanded, setExpanded] = useAtom(groupExpandedAtom)
  const setGroups = useSetAtom(groupsAtom)
  const setHosts = useSetAtom(hostsAtom)

  const isExpanded = expanded[group.id] !== false // default open

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editGroupOpen, setEditGroupOpen] = useState(false)

  async function handleDelete() {
    try {
      await DeleteGroup(group.id)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      // Ungrouped hosts will be updated on next ListHosts call; update locally too
      setHosts((prev) =>
        prev.map((h) => (h.groupId === group.id ? { ...h, groupId: undefined } : h))
      )
      onGroupDeleted?.()
    } catch (err) {
      toast.error('Failed to delete group', { description: String(err) })
    }
  }

  return (
    <>
      <Collapsible
        open={isExpanded}
        onOpenChange={(open) => setExpanded((prev) => ({ ...prev, [group.id]: open }))}
        className="bg-accent/40 flex flex-col gap-1 rounded-lg"
      >
        {/* Group header */}

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <CollapsibleTrigger asChild>
              <Item asChild variant="outline" size="xs">
                <a>
                  <ItemMedia>
                    <ChevronRight
                      className={cn(
                        'text-muted-foreground/60 size-3.5 shrink-0 transition-transform duration-150',
                        isExpanded && 'rotate-90'
                      )}
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{group.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="ghost">{hosts.length} hosts</Badge>
                    <ButtonGroup>
                      {/* Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditGroupOpen(true)
                            }}
                          >
                            Edit group…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete(true)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ButtonGroup>
                    {/* Connect All button */}
                  </ItemActions>
                </a>
              </Item>
            </CollapsibleTrigger>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setEditGroupOpen(true)}>Edit group…</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Hosts */}
        <CollapsibleContent>
          <ItemGroup>
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

      <EditGroupModal group={group} open={editGroupOpen} onClose={() => setEditGroupOpen(false)} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group &quot;{group.name}&quot;?</AlertDialogTitle>
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
