import { atom } from 'jotai'
import type { SessionStatus } from '../types'

export type TerminalLeaf = {
  type: 'leaf'
  kind: 'terminal'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
}

export type SFTPLeaf = {
  type: 'leaf'
  kind: 'sftp'
  paneId: string
  connectionId: string
  channelId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
}

export type LocalFSLeaf = {
  type: 'leaf'
  kind: 'local'
  paneId: string
  connectionId: 'local'
  channelId: string
  hostId: 'local'
  hostLabel: 'Local'
  status: SessionStatus
}

export type PaneLeaf = TerminalLeaf | SFTPLeaf | LocalFSLeaf

export type SplitNode = {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  // 0–1 proportion given to left/top panel. Starts at 0.5, updated via onLayout.
  ratio: number
  left: PaneNode
  right: PaneNode
}

export type PaneNode = PaneLeaf | SplitNode

export interface Workspace {
  id: string
  // Derived from first pane's host label on creation.
  label: string
  name?: string
  savedTemplateId?: string
  layout: PaneNode
  // INVARIANT: never null on a rendered workspace.
  // Only null as part of an atomic workspace-removal write.
  focusedPaneId: string | null
}

export const workspacesAtom = atom<Workspace[]>([])
export const activeWorkspaceIdAtom = atom<string | null>(null)
