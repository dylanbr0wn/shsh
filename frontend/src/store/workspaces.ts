import { atom } from 'jotai'
import type { SessionStatus } from '../types'

export type LeafNode = {
  type: 'leaf'
  paneId: string
  sessionId: string
  hostId: string
  hostLabel: string
  status: SessionStatus
  connectedAt?: string
}

export type SplitNode = {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  // 0–1 proportion given to left/top panel. Starts at 0.5, updated via onLayout.
  ratio: number
  left: PaneNode
  right: PaneNode
}

export type PaneNode = LeafNode | SplitNode

export interface Workspace {
  id: string
  // Derived from first pane's host label on creation.
  label: string
  layout: PaneNode
  // INVARIANT: never null on a rendered workspace.
  // Only null as part of an atomic workspace-removal write.
  focusedPaneId: string | null
}

export const workspacesAtom = atom<Workspace[]>([])
export const activeWorkspaceIdAtom = atom<string | null>(null)
