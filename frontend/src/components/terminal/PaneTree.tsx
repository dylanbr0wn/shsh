import { useLayoutEffect, useRef, useCallback, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import type { PaneNode, PaneLeaf, Workspace } from '../../store/workspaces'
import { collectLeaves } from '../../lib/paneTree'
import { useDropZone } from '../../hooks/useDropZone'
import type { DropEdge, DropMime } from '../../hooks/useDropZone'
import { DropZoneOverlay } from '../workspace/DropZoneOverlay'
import { TerminalInstance } from './TerminalInstance'
import { SFTPPanel } from '../sftp/SFTPPanel'
import { LocalFSPanel } from '../localfs/LocalFSPanel'
import { PaneHeader } from './PaneHeader'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { hostsAtom } from '../../store/atoms'
import { ErrorBoundary } from '../ErrorBoundary'
import { reportUIError } from '../../lib/reportUIError'
import { cn } from '../../lib/utils'

interface PaneTreeProps {
  node: PaneNode
  workspace: Workspace
  isWorkspaceActive: boolean
  onSplit: (paneId: string, direction: 'horizontal' | 'vertical', kind?: PaneLeaf['kind'], hostId?: string) => void
  onClose: (paneId: string) => void
  onDrop: (paneId: string, edge: DropEdge, mime: DropMime, data: string, shiftKey: boolean) => void
}

export function PaneTree({
  node,
  workspace,
  isWorkspaceActive,
  onSplit,
  onClose,
  onDrop,
}: PaneTreeProps) {
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
            onDrop={onDrop}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={rightPct} minSize={15}>
          <PaneTree
            node={node.right}
            workspace={workspace}
            isWorkspaceActive={isWorkspaceActive}
            onSplit={onSplit}
            onClose={onClose}
            onDrop={onDrop}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  return (
    <PaneLeafView
      leaf={node}
      workspace={workspace}
      isWorkspaceActive={isWorkspaceActive}
      onSplit={onSplit}
      onClose={onClose}
      onDrop={onDrop}
    />
  )
}

interface PaneLeafViewProps {
  leaf: PaneLeaf
  workspace: Workspace
  isWorkspaceActive: boolean
  onSplit: (paneId: string, direction: 'horizontal' | 'vertical', kind?: PaneLeaf['kind'], hostId?: string) => void
  onClose: (paneId: string) => void
  onDrop: (paneId: string, edge: DropEdge, mime: DropMime, data: string, shiftKey: boolean) => void
}

function PaneLeafView({
  leaf,
  workspace,
  isWorkspaceActive,
  onSplit,
  onClose,
  onDrop,
}: PaneLeafViewProps) {
  const [, setWorkspaces] = useAtom(workspacesAtom)
  const hosts = useAtomValue(hostsAtom)
  const [isDragging, setIsDragging] = useState(false)

  const isFocused = leaf.paneId === workspace.focusedPaneId
  const isActive = isWorkspaceActive && isFocused
  const host = hosts.find((h) => h.id === leaf.hostId)
  const totalLeaves = collectLeaves(workspace.layout).length
  const canClose = totalLeaves > 1

  function setFocused(paneId: string) {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspace.id ? { ...w, focusedPaneId: paneId } : w))
    )
  }

  const handleDrop = useCallback(
    (edge: DropEdge, mime: DropMime, data: string, shiftKey: boolean) =>
      onDrop(leaf.paneId, edge, mime, data, shiftKey),
    [onDrop, leaf.paneId]
  )

  const { state: dropState, handlers: dropHandlers } = useDropZone({
    onDrop: handleDrop,
  })

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pane focus on pointer down is intentional; terminal handles its own a11y
    <div
      className={cn('group/pane relative h-full w-full', isDragging && 'opacity-30')}
      {...dropHandlers}
      onMouseDown={() => setFocused(leaf.paneId)}
      style={
        isFocused
          ? { boxShadow: `inset 0 0 0 1px ${host?.color ?? 'hsl(var(--border))'}` }
          : undefined
      }
    >
      <PaneHeader
        hostLabel={leaf.hostLabel}
        hostColor={host?.color}
        hostId={leaf.hostId}
        kind={leaf.kind}
        paneId={leaf.paneId}
        workspaceId={workspace.id}
        onSplit={(direction, kind, hostId) => onSplit(leaf.paneId, direction, kind, hostId)}
        onClose={() => onClose(leaf.paneId)}
        canClose={canClose}
        onDragStateChange={setIsDragging}
        onToggle={
          leaf.kind !== 'local'
            ? () =>
                onSplit(
                  leaf.paneId,
                  'horizontal',
                  leaf.kind === 'terminal' ? 'sftp' : 'terminal',
                  leaf.hostId
                )
            : undefined
        }
      />
      {dropState.edge && (
        <DropZoneOverlay
          edge={dropState.edge}
          color={dropState.mime === 'application/x-shsh-host' ? host?.color : undefined}
        />
      )}
      {leaf.kind === 'sftp' ? (
        <ErrorBoundary
          fallback="inline"
          zone={`sftp-${leaf.channelId}`}
          onError={(e, i) => reportUIError(e, i, `sftp-${leaf.channelId}`)}
          resetKeys={[leaf.channelId]}
        >
          <SFTPPanel channelId={leaf.channelId} connectionId={leaf.connectionId} />
        </ErrorBoundary>
      ) : leaf.kind === 'local' ? (
        <LocalFSPanel channelId={leaf.channelId} />
      ) : (
        <ErrorBoundary
          fallback="inline"
          zone={`terminal-${leaf.channelId}`}
          onError={(e, i) => reportUIError(e, i, `terminal-${leaf.channelId}`)}
          resetKeys={[leaf.channelId]}
        >
          <InitialFitTrigger isActive={isActive} />
          <TerminalInstance channelId={leaf.channelId} hostId={leaf.hostId} isActive={isActive} />
        </ErrorBoundary>
      )}
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
