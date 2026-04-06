import { Plus } from 'lucide-react'
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions'
import { collectLeaves } from '../../lib/paneTree'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import { WorkspaceCard } from './WorkspaceCard'
import { CloseConfirmDialog } from '../sessions/CloseConfirmDialog'
import { SaveTemplateDialog } from '../workspace/SaveTemplateDialog'
import { Button } from '../ui/button'
import { ButtonGroup } from '../ui/button-group'

export function SessionList() {
  const {
    workspaces,
    activeWorkspaceId,
    hostById,
    templates,
    saveTemplateWorkspace,
    saveTemplateWorkspaceId,
    setSaveTemplateWorkspaceId,
    dialogOpen,
    pendingCount,
    loadTemplates,
    setPendingTemplate,
    setIsAddHostOpen,
    activateWorkspace,
    handleClose,
    handleCloseOthers,
    handleCloseAll,
    handleRename,
    handlePaneDrop,
    handleSaveTemplate,
    handleTemplateSaved,
    handleDialogConfirm,
    handleDialogCancel,
    workspaceHasActivity,
  } = useWorkspaceActions()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1.5 p-2">
          {workspaces.map((ws) => {
            const leaves = collectLeaves(ws.layout)
            return (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
                hasActivity={workspaceHasActivity(leaves)}
                isOnly={workspaces.length === 1}
                hostById={hostById}
                onActivate={() => activateWorkspace(ws.id)}
                onClose={() => handleClose(ws.id)}
                onCloseOthers={() => handleCloseOthers(ws.id)}
                onCloseAll={handleCloseAll}
                onRename={(name) => handleRename(ws.id, name)}
                onSaveTemplate={() => handleSaveTemplate(ws.id)}
                onPaneDrop={(sourcePaneId, sourceWorkspaceId) =>
                  handlePaneDrop(sourcePaneId, sourceWorkspaceId, ws.id)
                }
              />
            )
          })}
        </div>
      </ScrollArea>

      <Separator />
      <div className="p-1">
        <ButtonGroup className="w-full gap-1!">
          <DropdownMenu
          onOpenChange={(open) => {
            if (open) loadTemplates()
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="w-full">
              <Plus className="size-3" />
              New Session
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => setIsAddHostOpen(true)}>
              New connection
            </DropdownMenuItem>
            {templates.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Templates</DropdownMenuLabel>
                {templates.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => setPendingTemplate(t)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </ButtonGroup>

      </div>

      <CloseConfirmDialog
        open={dialogOpen}
        sessionCount={pendingCount}
        onConfirm={handleDialogConfirm}
        onCancel={handleDialogCancel}
      />
      {saveTemplateWorkspace && (
        <SaveTemplateDialog
          open={!!saveTemplateWorkspaceId}
          onOpenChange={(open) => {
            if (!open) setSaveTemplateWorkspaceId(null)
          }}
          workspace={saveTemplateWorkspace}
          onSaved={handleTemplateSaved}
        />
      )}
    </div>
  )
}
