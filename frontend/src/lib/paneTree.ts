import type { LeafNode, PaneNode } from '../store/workspaces'
import type { Session } from '../types'

/** Flatten all leaf nodes from a pane tree. */
export function collectLeaves(node: PaneNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.left), ...collectLeaves(node.right)]
}

/** Convert a LeafNode to the Session shape expected by existing consumers. */
export function leafToSession(leaf: LeafNode): Session {
  return {
    id: leaf.sessionId,
    hostId: leaf.hostId,
    hostLabel: leaf.hostLabel,
    status: leaf.status,
    connectedAt: leaf.connectedAt,
  }
}

/** Find a leaf by sessionId. Returns null if not found. */
export function findLeafBySessionId(node: PaneNode, sessionId: string): LeafNode | null {
  if (node.type === 'leaf') return node.sessionId === sessionId ? node : null
  return (
    findLeafBySessionId(node.left, sessionId) ??
    findLeafBySessionId(node.right, sessionId)
  )
}

/** Find a leaf by paneId. Returns null if not found. */
export function findLeafByPaneId(node: PaneNode, paneId: string): LeafNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null
  return (
    findLeafByPaneId(node.left, paneId) ??
    findLeafByPaneId(node.right, paneId)
  )
}

/** Return a new tree with the matching leaf updated by patch. */
export function updateLeafBySessionId(
  node: PaneNode,
  sessionId: string,
  patch: Partial<LeafNode>
): PaneNode {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? { ...node, ...patch } : node
  }
  return {
    ...node,
    left: updateLeafBySessionId(node.left, sessionId, patch),
    right: updateLeafBySessionId(node.right, sessionId, patch),
  }
}

/**
 * Replace the leaf with paneId with a SplitNode containing the old leaf
 * (left/top) and newLeaf (right/bottom).
 */
export function splitLeaf(
  node: PaneNode,
  paneId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: LeafNode
): PaneNode {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return node
    return { type: 'split', direction, ratio: 0.5, left: node, right: newLeaf }
  }
  return {
    ...node,
    left: splitLeaf(node.left, paneId, direction, newLeaf),
    right: splitLeaf(node.right, paneId, direction, newLeaf),
  }
}

/**
 * Remove the leaf with paneId. Returns the sibling when a SplitNode collapses,
 * or null if the removed leaf was the root (last pane in the workspace).
 */
export function removeLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? null : node
  }
  const newLeft = removeLeaf(node.left, paneId)
  if (newLeft !== node.left) {
    return newLeft === null ? node.right : { ...node, left: newLeft }
  }
  const newRight = removeLeaf(node.right, paneId)
  if (newRight !== node.right) {
    return newRight === null ? node.left : { ...node, right: newRight }
  }
  return node
}

/** Return the first (leftmost) leaf in a tree. Used for focus fallback. */
export function firstLeaf(node: PaneNode): LeafNode {
  if (node.type === 'leaf') return node
  return firstLeaf(node.left)
}

/**
 * Find sibling leaves: leaves that share the same SSH client as sessionId.
 * A sibling is any leaf where leaf.sessionId === parentId OR leaf.parentSessionId === parentId
 * (excluding the target itself).
 */
export function findSiblingLeaves(allLeaves: LeafNode[], sessionId: string): LeafNode[] {
  const target = allLeaves.find((l) => l.sessionId === sessionId)
  if (!target) return []
  const parentId = target.parentSessionId ?? target.sessionId
  return allLeaves.filter(
    (l) =>
      l.sessionId !== sessionId &&
      (l.sessionId === parentId || l.parentSessionId === parentId)
  )
}
