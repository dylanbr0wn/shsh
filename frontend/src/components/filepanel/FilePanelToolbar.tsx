import type { ReactNode } from 'react'
import { RefreshCw, FolderPlus } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface FilePanelToolbarProps {
  onRefresh: () => void
  onNewFolder: () => void
  children?: ReactNode
}

export function FilePanelToolbar({ onRefresh, onNewFolder, children }: FilePanelToolbarProps) {
  return (
    <div className="border-border flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="New folder" onClick={onNewFolder}>
            <FolderPlus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New folder</TooltipContent>
      </Tooltip>
      {children}
    </div>
  )
}
