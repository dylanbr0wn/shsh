import { Plus, FileInput, FolderPlus } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { isAddHostOpenAtom, isImportHostsOpenAtom, isNewGroupOpenAtom } from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ButtonGroup } from '../ui/button-group'

export function SidebarFooter() {
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsImportHostsOpen = useSetAtom(isImportHostsOpenAtom)
  const setNewGroupOpen = useSetAtom(isNewGroupOpenAtom)

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
                onClick={() => setIsImportHostsOpen(true)}
              >
                <FileInput />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Import Hosts</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => setNewGroupOpen(true)}>
                <FolderPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New Group</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </ButtonGroup>
    </div>
  )
}
