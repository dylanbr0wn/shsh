import { Plus, Settings, FileInput } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { isAddHostOpenAtom, isSettingsOpenAtom, isImportSSHConfigOpenAtom } from '../../store/atoms'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function SidebarFooter() {
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom)
  const setIsImportSSHConfigOpen = useSetAtom(isImportSSHConfigOpenAtom)

  return (
    <div className="bg-sidebar flex shrink-0 items-center gap-2 p-3">
      <Button variant="default" size="sm" className="flex-1" onClick={() => setIsAddHostOpen(true)}>
        <Plus data-icon="inline-start" />
        Add Host
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setIsImportSSHConfigOpen(true)}
          >
            <FileInput />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Import from SSH Config</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Settings</TooltipContent>
      </Tooltip>
    </div>
  )
}
