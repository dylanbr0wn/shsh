import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../../store/workspaces'
import {
  isAddHostOpenAtom,
  closeConfirmPrefAtom,
  hostsAtom,
  sessionActivityAtom,
} from '../../store/atoms'
import { collectLeaves } from '../../lib/paneTree'
import { DisconnectSession } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TabItem } from './TabItem'
import { CloseConfirmDialog } from './CloseConfirmDialog'
import type { Workspace } from '../../store/workspaces'

export function TabBar() {
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const hosts = useAtomValue(hostsAtom)
  const hostById = useMemo(() => Object.fromEntries(hosts.map((h) => [h.id, h])), [hosts])
  const [sessionActivity, setSessionActivity] = useAtom(sessionActivityAtom)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [pendingCount, setPendingCount] = useState(1)

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

  /** Disconnect all sessions in a workspace and remove it from the list. */
  function closeWorkspace(workspaceId: string) {
    const ws = workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const leaves = collectLeaves(ws.layout)
    leaves.forEach((leaf) => DisconnectSession(leaf.sessionId).catch(() => {}))
    const sessionIds = new Set(leaves.map((l) => l.sessionId))
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.id !== workspaceId)
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspaceId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
    setSessionActivity((prev) => prev.filter((id) => !sessionIds.has(id)))
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

  // Derive a "session" for TabItem from the first leaf's hostId
  function workspaceToTabSession(ws: Workspace) {
    const leaves = collectLeaves(ws.layout)
    const primaryLeaf = leaves[0]
    return {
      id: ws.id,
      hostId: primaryLeaf?.hostId ?? '',
      hostLabel: ws.label,
      status: primaryLeaf?.status ?? 'disconnected',
      connectedAt: primaryLeaf?.connectedAt,
    }
  }

  const workspaceHasActivity = (ws: Workspace) =>
    collectLeaves(ws.layout).some((l) => sessionActivity.includes(l.sessionId))

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
            onActivate={() => {
              setActiveWorkspaceId(ws.id)
              const ids = new Set(collectLeaves(ws.layout).map((l) => l.sessionId))
              setSessionActivity((prev) => prev.filter((id) => !ids.has(id)))
            }}
            onClose={() => handleClose(ws.id)}
            onCloseOthers={() => handleCloseOthers(ws.id)}
            onCloseToLeft={() => handleCloseToLeft(ws.id)}
            onCloseToRight={() => handleCloseToRight(ws.id)}
            onCloseAll={handleCloseAll}
          />
        ))}
        <div className="ml-auto flex shrink-0 items-center px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => setIsAddHostOpen(true)}>
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New connection</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <CloseConfirmDialog
        open={dialogOpen}
        sessionCount={pendingCount}
        onConfirm={handleDialogConfirm}
        onCancel={handleDialogCancel}
      />
    </>
  )
}
