import type { PaneLeaf, PaneNode } from '../store/workspaces'

/** Flatten all leaf nodes from a pane tree. */
export function collectLeaves(node: PaneNode): PaneLeaf[] {
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.left), ...collectLeaves(node.right)]
}

/** Return a new tree with the matching leaf updated by patch. */
export function updateLeafByChannelId(
  node: PaneNode,
  channelId: string,
  patch: Partial<PaneLeaf>
): PaneNode {
  if (node.type === 'leaf') {
    return node.channelId === channelId
      ? ({ ...node, ...patch } as PaneLeaf)
      : node
  }
  return {
    ...node,
    left: updateLeafByChannelId(node.left, channelId, patch),
    right: updateLeafByChannelId(node.right, channelId, patch),
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
  newLeaf: PaneLeaf
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
export function firstLeaf(node: PaneNode): PaneLeaf {
  if (node.type === 'leaf') return node
  return firstLeaf(node.left)
}
