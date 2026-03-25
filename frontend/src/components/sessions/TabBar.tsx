import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
import {
  isAddHostOpenAtom,
  closeConfirmPrefAtom,
  hostsAtom,
  channelActivityAtom,
  pendingTemplateAtom,
} from '../../store/atoms'
import { collectLeaves } from '../../lib/paneTree'
import { CloseChannel, ListWorkspaceTemplates } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { TabItem } from './TabItem'
import { CloseConfirmDialog } from './CloseConfirmDialog'
import { SaveTemplateDialog } from '../workspace/SaveTemplateDialog'
import type { Workspace } from '../../store/workspaces'
import type { WorkspaceTemplate } from '../../types'

export function TabBar() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const hosts = useAtomValue(hostsAtom)
  const hostById = useMemo(() => Object.fromEntries(hosts.map((h) => [h.id, h])), [hosts])
  const [channelActivity, setChannelActivity] = useAtom(channelActivityAtom)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [pendingCount, setPendingCount] = useState(1)

  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([])
  const setPendingTemplate = useSetAtom(pendingTemplateAtom)

  const [saveTemplateWorkspaceId, setSaveTemplateWorkspaceId] = useState<string | null>(null)
  const saveTemplateWorkspace = workspaces.find((w) => w.id === saveTemplateWorkspaceId) ?? null

  async function loadTemplates() {
    try {
      const list = await ListWorkspaceTemplates()
      // layout field comes as number[] from Wails — keep as-is; WorkspaceView decodes it
      setTemplates((list ?? []) as unknown as WorkspaceTemplate[])
    } catch {
      /* ignore */
    }
  }

  function handleSaveTemplate(workspaceId: string) {
    setSaveTemplateWorkspaceId(workspaceId)
  }

  function handleTemplateSaved(templateId: string) {
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === saveTemplateWorkspaceId ? { ...w, savedTemplateId: templateId } : w
      )
    )
    setSaveTemplateWorkspaceId(null)
  }

  function requestClose(action: () => void, count: number) {
    if (closeConfirmPref === false) {
      action()
    } else {
      setPendingAction(() => action)
      setPendingCount(count)
      setDialogOpen(true)
    }
  }

  function handleDialogConfirm(dontAskAgain: boolean) {
    if (dontAskAgain) setCloseConfirmPref(false)
    pendingAction?.()
    setDialogOpen(false)
    setPendingAction(null)
  }

  function handleDialogCancel() {
    setDialogOpen(false)
    setPendingAction(null)
  }

  /** Close all channels in a workspace and remove it from the list. */
  function closeWorkspace(workspaceId: string) {
    const ws = workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const leaves = collectLeaves(ws.layout)
    leaves.forEach((leaf) => CloseChannel(leaf.channelId).catch(() => {}))
    const channelIds = new Set(leaves.map((l) => l.channelId))
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.id !== workspaceId)
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspaceId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
    setChannelActivity((prev) => prev.filter((id) => !channelIds.has(id)))
  }

  function handleClose(workspaceId: string) {
    requestClose(() => closeWorkspace(workspaceId), 1)
  }

  function handleCloseOthers(workspaceId: string) {
    const toClose = workspaces.filter((w) => w.id !== workspaceId).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseToLeft(workspaceId: string) {
    const idx = workspaces.findIndex((w) => w.id === workspaceId)
    const toClose = workspaces.slice(0, idx).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseToRight(workspaceId: string) {
    const idx = workspaces.findIndex((w) => w.id === workspaceId)
    const toClose = workspaces.slice(idx + 1).map((w) => w.id)
    requestClose(() => {
      toClose.forEach(closeWorkspace)
      setActiveWorkspaceId(workspaceId)
    }, toClose.length)
  }

  function handleCloseAll() {
    requestClose(() => {
      workspaces.forEach((w) => closeWorkspace(w.id))
    }, workspaces.length)
  }

  function handleRename(workspaceId: string, name: string) {
    setWorkspaces((prev) => prev.map((w) => (w.id === workspaceId ? { ...w, name } : w)))
  }

  function getConnectionDots(ws: Workspace) {
    const leaves = collectLeaves(ws.layout)
    const seen = new Map<string, { color?: string; status: string }>()
    for (const leaf of leaves) {
      if (!seen.has(leaf.connectionId)) {
        const host = hostById[leaf.hostId]
        seen.set(leaf.connectionId, { color: host?.color, status: leaf.status })
      }
    }
    return Array.from(seen.values())
  }

  // Derive a tab session object from the first leaf's data
  function workspaceToTabSession(ws: Workspace) {
    const leaves = collectLeaves(ws.layout)
    const primaryLeaf = leaves[0]
    return {
      id: ws.id,
      hostId: primaryLeaf?.hostId ?? '',
      hostLabel: ws.label,
      status: primaryLeaf?.status ?? 'disconnected',
      connectedAt:
        primaryLeaf && 'connectedAt' in primaryLeaf ? primaryLeaf.connectedAt : undefined,
    }
  }

  const workspaceHasActivity = (ws: Workspace) =>
    collectLeaves(ws.layout).some((l) => channelActivity.includes(l.channelId))

  return (
    <>
      <div className="border-border bg-muted/30 flex h-8 shrink-0 items-stretch overflow-x-auto border-b">
        {workspaces.map((ws, idx) => (
          <TabItem
            key={ws.id}
            session={workspaceToTabSession(ws)}
            host={hostById[collectLeaves(ws.layout)[0]?.hostId ?? '']}
            isActive={ws.id === activeWorkspaceId}
            hasActivity={workspaceHasActivity(ws)}
            isFirst={idx === 0}
            isLast={idx === workspaces.length - 1}
            workspaceName={ws.name}
            connectionDots={getConnectionDots(ws)}
            onActivate={() => {
              setActiveWorkspaceId(ws.id)
              const ids = new Set(collectLeaves(ws.layout).map((l) => l.channelId))
              setChannelActivity((prev) => prev.filter((id) => !ids.has(id)))
            }}
            onClose={() => handleClose(ws.id)}
            onCloseOthers={() => handleCloseOthers(ws.id)}
            onCloseToLeft={() => handleCloseToLeft(ws.id)}
            onCloseToRight={() => handleCloseToRight(ws.id)}
            onCloseAll={handleCloseAll}
            onRename={(name) => handleRename(ws.id, name)}
            onSaveTemplate={() => handleSaveTemplate(ws.id)}
          />
        ))}
        <div className="ml-auto flex shrink-0 items-center px-1">
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) loadTemplates()
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="New connection or template">
                <Plus className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
    </>
  )
}
