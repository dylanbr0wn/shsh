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
import { WorkspaceCard } from './WorkspaceCard'
import { CloseConfirmDialog } from '../sessions/CloseConfirmDialog'
import { SaveTemplateDialog } from '../workspace/SaveTemplateDialog'

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

      <div className="border-sidebar-border border-t p-2">
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) loadTemplates()
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="border-border text-muted-foreground hover:bg-muted/40 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed p-1.5 text-xs transition-colors">
              <Plus className="size-3" />
              New Session
            </button>
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
