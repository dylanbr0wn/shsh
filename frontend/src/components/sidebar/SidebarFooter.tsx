import { Plus, FileInput, FolderPlus } from 'lucide-react'
import { useAtom, useSetAtom } from 'jotai'
import {
  groupsAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isNewGroupOpenAtom,
} from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ButtonGroup } from '../ui/button-group'
import { Input } from '../ui/input'
import {
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  Popover,
} from '../ui/popover'
import { useRef, useState } from 'react'
import type { Group } from '@/types'
import { toast } from 'sonner'
import { AddGroup } from '../../../wailsjs/go/main/HostFacade'

export function SidebarFooter() {
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)

  const setGroups = useSetAtom(groupsAtom)

  const [newGroupOpen, setNewGroupOpen] = useAtom(isNewGroupOpenAtom)
  const [newGroupName, setNewGroupName] = useState('')

  const [creatingGroup, setCreatingGroup] = useState(false)
  const newGroupInputRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="p-1">
      <ButtonGroup className="w-full">
        <ButtonGroup className="grow">
          <Button variant="default" className="flex-1" onClick={() => setIsAddHostOpen(true)}>
            <Plus data-icon="inline-start" />
            Add Host
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setIsImportSSHConfigOpen(true)}
              >
                <FileInput />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Import from SSH Config</TooltipContent>
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
                  <Button variant="outline" size="icon">
                    <FolderPlus />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Group</TooltipContent>
            </Tooltip>
            <PopoverContent side="bottom" align="end">
              <PopoverHeader>
                <PopoverTitle>New Group</PopoverTitle>
                <PopoverDescription>Enter a name for the new group</PopoverDescription>
              </PopoverHeader>

              <Input
                ref={newGroupInputRef}
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateGroup()
                  if (e.key === 'Escape') setNewGroupOpen(false)
                }}
              />
              <Button
                size="sm"
                onClick={handleCreateGroup}
                disabled={creatingGroup || !newGroupName.trim()}
              >
                <Plus data-icon="inline-start" />
                Create
              </Button>
            </PopoverContent>
          </Popover>
        </ButtonGroup>
      </ButtonGroup>
    </div>
  )
}
