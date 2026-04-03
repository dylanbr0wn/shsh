import { useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { workspacesAtom, activeWorkspaceIdAtom } from '../store/workspaces'
import {
  isAddHostOpenAtom,
  closeConfirmPrefAtom,
  hostsAtom,
  channelActivityAtom,
  pendingTemplateAtom,
} from '../store/atoms'
import { collectLeaves, firstLeaf, movePaneAcrossWorkspaces } from '../lib/paneTree'
import { CloseChannel } from '@wailsjs/go/main/SessionFacade'
import { ListWorkspaceTemplates } from '@wailsjs/go/main/HostFacade'
import type { PaneLeaf } from '../store/workspaces'
import type { WorkspaceTemplate } from '../types'

export function useWorkspaceActions() {
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

  function handleCloseAll() {
    requestClose(() => {
      workspaces.forEach((w) => closeWorkspace(w.id))
    }, workspaces.length)
  }

  function handleRename(workspaceId: string, name: string) {
    setWorkspaces((prev) => prev.map((w) => (w.id === workspaceId ? { ...w, name } : w)))
  }

  function handlePaneDrop(
    sourcePaneId: string,
    sourceWorkspaceId: string,
    targetWorkspaceId: string
  ) {
    if (sourceWorkspaceId === targetWorkspaceId) return
    setWorkspaces((prev) => {
      const targetWs = prev.find((w) => w.id === targetWorkspaceId)
      if (!targetWs) return prev
      const targetPane = firstLeaf(targetWs.layout)
      return movePaneAcrossWorkspaces(
        prev,
        sourcePaneId,
        sourceWorkspaceId,
        targetWorkspaceId,
        targetPane.paneId,
        'horizontal',
        'after'
      )
    })
    setActiveWorkspaceId(targetWorkspaceId)
  }

  function activateWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId)
    const ws = workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const leaves = collectLeaves(ws.layout)
    const ids = new Set(leaves.map((l) => l.channelId))
    setChannelActivity((prev) => prev.filter((id) => !ids.has(id)))
  }

  const workspaceHasActivity = (leaves: PaneLeaf[]) =>
    leaves.some((l) => channelActivity.includes(l.channelId))

  return {
    workspaces,
    activeWorkspaceId,
    hostById,
    channelActivity,
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
    closeWorkspace,
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
  }
}
