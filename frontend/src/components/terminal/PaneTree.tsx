import { useLayoutEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import type { PaneNode, Workspace } from '../../store/workspaces'
import { collectLeaves } from '../../lib/paneTree'
import { leafToSession } from '../../lib/paneTree'
import { TerminalInstance } from './TerminalInstance'
import { PaneHeader } from './PaneHeader'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { hostsAtom } from '../../store/atoms'

interface PaneTreeProps {
  node: PaneNode
  workspace: Workspace
  isWorkspaceActive: boolean
  onSplit: (paneId: string, direction: 'horizontal' | 'vertical') => void
  onClose: (paneId: string) => void
}

export function PaneTree({ node, workspace, isWorkspaceActive, onSplit, onClose }: PaneTreeProps) {
  const [, setWorkspaces] = useAtom(workspacesAtom)
  const hosts = useAtomValue(hostsAtom)

  function setFocused(paneId: string) {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspace.id ? { ...w, focusedPaneId: paneId } : w))
    )
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
          <PaneTree
            node={node.left}
            workspace={workspace}
            isWorkspaceActive={isWorkspaceActive}
            onSplit={onSplit}
            onClose={onClose}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={rightPct} minSize={15}>
          <PaneTree
            node={node.right}
            workspace={workspace}
            isWorkspaceActive={isWorkspaceActive}
            onSplit={onSplit}
            onClose={onClose}
          />
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
      className="group/pane relative h-full w-full p-2"
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
        onSplitVertical={() => onSplit(leaf.paneId, 'vertical')}
        onSplitHorizontal={() => onSplit(leaf.paneId, 'horizontal')}
        onClose={() => onClose(leaf.paneId)}
        canClose={canClose}
      />
      <InitialFitTrigger isActive={isActive} />
      <TerminalInstance session={leafToSession(leaf)} isActive={isActive} />
      {(leaf.status === 'disconnected' || leaf.status === 'error') && (
        <DisconnectedOverlay onReconnect={() => {}} />
      )}
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

function DisconnectedOverlay({ onReconnect: _ }: { onReconnect: () => void }) {
  return (
    <div className="bg-background/70 absolute inset-0 flex items-center justify-center backdrop-blur-sm">
      <p className="text-muted-foreground text-sm">Disconnected</p>
    </div>
  )
}
