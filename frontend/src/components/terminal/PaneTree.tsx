import { useLayoutEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import type { PaneNode, LeafNode, Workspace } from '../../store/workspaces'
import { collectLeaves, splitLeaf, removeLeaf, firstLeaf } from '../../lib/paneTree'
import { leafToSession } from '../../lib/paneTree'
import { TerminalInstance } from './TerminalInstance'
import { PaneHeader } from './PaneHeader'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { hostsAtom } from '../../store/atoms'
import { DisconnectSession, SplitSession } from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'

interface PaneTreeProps {
  node: PaneNode
  workspace: Workspace
  isWorkspaceActive: boolean
}

export function PaneTree({ node, workspace, isWorkspaceActive }: PaneTreeProps) {
  const [, setWorkspaces] = useAtom(workspacesAtom)
  const hosts = useAtomValue(hostsAtom)

  function setFocused(paneId: string) {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspace.id ? { ...w, focusedPaneId: paneId } : w))
    )
  }

  async function handleSplit(paneId: string, direction: 'horizontal' | 'vertical') {
    const leaf = collectLeaves(workspace.layout).find((l) => l.paneId === paneId)
    if (!leaf) return
    try {
      const result = await SplitSession(leaf.sessionId)
      const newPaneId = crypto.randomUUID()
      const newLeaf: LeafNode = {
        type: 'leaf',
        paneId: newPaneId,
        sessionId: result.sessionId,
        hostId: leaf.hostId,
        hostLabel: leaf.hostLabel,
        status: 'connecting',
        parentSessionId: result.parentSessionId,
      }
      setWorkspaces((prev) =>
        prev.map((w) => {
          if (w.id !== workspace.id) return w
          return {
            ...w,
            layout: splitLeaf(w.layout, paneId, direction, newLeaf),
            focusedPaneId: newPaneId,
          }
        })
      )
    } catch (err) {
      toast.error('Split failed', { description: String(err) })
    }
  }

  function handleClose(paneId: string) {
    setWorkspaces((prev) => {
      const ws = prev.find((w) => w.id === workspace.id)
      if (!ws) return prev
      const leaf = collectLeaves(ws.layout).find((l) => l.paneId === paneId)
      if (leaf) DisconnectSession(leaf.sessionId).catch(() => {})
      const newLayout = removeLeaf(ws.layout, paneId)
      if (newLayout === null) {
        return prev.filter((w) => w.id !== workspace.id)
      }
      const newFocused =
        ws.focusedPaneId === paneId ? firstLeaf(newLayout).paneId : ws.focusedPaneId
      return prev.map((w) =>
        w.id === workspace.id ? { ...w, layout: newLayout, focusedPaneId: newFocused } : w
      )
    })
  }

  if (node.type === 'split') {
    const leftPct = node.ratio * 100
    const rightPct = (1 - node.ratio) * 100
    return (
      <ResizablePanelGroup
        orientation={node.direction === 'vertical' ? 'vertical' : 'horizontal'}
        className="h-full w-full"
      >
        <ResizablePanel defaultSize={leftPct} minSize={15}>
          <PaneTree node={node.left} workspace={workspace} isWorkspaceActive={isWorkspaceActive} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={rightPct} minSize={15}>
          <PaneTree node={node.right} workspace={workspace} isWorkspaceActive={isWorkspaceActive} />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  const leaf = node
  const isFocused = leaf.paneId === workspace.focusedPaneId
  const isActive = isWorkspaceActive && isFocused
  const host = hosts.find((h) => h.id === leaf.hostId)
  const totalLeaves = collectLeaves(workspace.layout).length
  const canClose = totalLeaves > 1

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pane focus on pointer down is intentional; terminal handles its own a11y
    <div
      className="group/pane relative h-full w-full"
      style={
        isFocused
          ? { boxShadow: `inset 0 0 0 1px ${host?.color ?? 'hsl(var(--border))'}` }
          : undefined
      }
      onMouseDown={() => setFocused(leaf.paneId)}
    >
      <PaneHeader
        hostLabel={leaf.hostLabel}
        hostColor={host?.color}
        onSplitVertical={() => handleSplit(leaf.paneId, 'vertical')}
        onSplitHorizontal={() => handleSplit(leaf.paneId, 'horizontal')}
        onClose={() => handleClose(leaf.paneId)}
        canClose={canClose}
      />
      <InitialFitTrigger isActive={isActive} />
      <TerminalInstance session={leafToSession(leaf)} isActive={isActive} />
      {(leaf.status === 'disconnected' || leaf.status === 'error') && <DisconnectedOverlay />}
    </div>
  )
}

function InitialFitTrigger({ isActive }: { isActive: boolean }) {
  const didFit = useRef(false)
  useLayoutEffect(() => {
    if (!didFit.current && !isActive) {
      window.dispatchEvent(new Event('resize'))
      didFit.current = true
    }
  }, [isActive])
  return null
}

function DisconnectedOverlay() {
  return (
    <div className="bg-background/70 absolute inset-0 flex items-center justify-center backdrop-blur-sm">
      <p className="text-muted-foreground text-sm">Disconnected</p>
    </div>
  )
}
