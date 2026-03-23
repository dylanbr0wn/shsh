import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  sessionsAtom,
  activeSessionIdAtom,
  isAddHostOpenAtom,
  closeConfirmPrefAtom,
  hostsAtom,
  sessionActivityAtom,
} from '../../store/atoms'
import { DisconnectSession } from '../../../wailsjs/go/main/App'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TabItem } from './TabItem'
import { CloseConfirmDialog } from './CloseConfirmDialog'

export function TabBar() {
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom)
  const setIsAddHostOpen = useSetAtom(isAddHostOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const hosts = useAtomValue(hostsAtom)
  const hostById = useMemo(() => Object.fromEntries(hosts.map((h) => [h.id, h])), [hosts])
  const setSessionActivity = useSetAtom(sessionActivityAtom)

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

  function disconnectAndRemove(ids: string[]) {
    ids.forEach((id) => DisconnectSession(id).catch(() => {}))
    setSessions((prev) => prev.filter((s) => !ids.includes(s.id)))
  }

  function handleClose(sessionId: string) {
    requestClose(() => {
      DisconnectSession(sessionId).catch(() => {})
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId)
        if (activeSessionId === sessionId) {
          setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null)
        }
        return next
      })
    }, 1)
  }

  function handleCloseOthers(sessionId: string) {
    const toClose = sessions.filter((s) => s.id !== sessionId).map((s) => s.id)
    requestClose(() => {
      disconnectAndRemove(toClose)
      setActiveSessionId(sessionId)
    }, toClose.length)
  }

  function handleCloseToLeft(sessionId: string) {
    const idx = sessions.findIndex((s) => s.id === sessionId)
    const toClose = sessions.slice(0, idx).map((s) => s.id)
    requestClose(() => {
      disconnectAndRemove(toClose)
      setActiveSessionId(sessionId)
    }, toClose.length)
  }

  function handleCloseToRight(sessionId: string) {
    const idx = sessions.findIndex((s) => s.id === sessionId)
    const toClose = sessions.slice(idx + 1).map((s) => s.id)
    requestClose(() => {
      disconnectAndRemove(toClose)
      setActiveSessionId(sessionId)
    }, toClose.length)
  }

  function handleCloseAll() {
    requestClose(() => {
      disconnectAndRemove(sessions.map((s) => s.id))
      setActiveSessionId(null)
    }, sessions.length)
  }

  return (
    <>
      <div className="border-border bg-muted/30 flex h-8 shrink-0 items-stretch overflow-x-auto border-b">
        {sessions.map((session, idx) => (
          <TabItem
            key={session.id}
            session={session}
            host={hostById[session.hostId]}
            isActive={session.id === activeSessionId}
            isFirst={idx === 0}
            isLast={idx === sessions.length - 1}
            onActivate={() => {
              setActiveSessionId(session.id)
              setSessionActivity((prev) => {
                const next = new Set(prev)
                next.delete(session.id)
                return next
              })
            }}
            onClose={() => handleClose(session.id)}
            onCloseOthers={() => handleCloseOthers(session.id)}
            onCloseToLeft={() => handleCloseToLeft(session.id)}
            onCloseToRight={() => handleCloseToRight(session.id)}
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
