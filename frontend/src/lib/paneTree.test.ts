import { describe, it, expect } from 'vitest'
import type { PaneLeaf, PaneNode, SplitNode, Workspace } from '../store/workspaces'
import {
  collectLeaves,
  updateLeafByChannelId,
  insertLeaf,
  splitLeaf,
  removeLeaf,
  moveLeaf,
  firstLeaf,
  movePaneAcrossWorkspaces,
} from './paneTree'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function leaf(id: string, overrides?: Partial<PaneLeaf>): PaneLeaf {
  return {
    type: 'leaf',
    kind: 'terminal',
    paneId: `pane-${id}`,
    connectionId: `conn-${id}`,
    channelId: `ch-${id}`,
    hostId: `host-${id}`,
    hostLabel: `Host ${id}`,
    status: 'connected',
    ...overrides,
  } as PaneLeaf
}

function split(
  left: PaneNode,
  right: PaneNode,
  direction: 'horizontal' | 'vertical' = 'horizontal'
): SplitNode {
  return { type: 'split', direction, ratio: 0.5, left, right }
}

function workspace(id: string, layout: PaneNode, focusedPaneId?: string): Workspace {
  const leaves = collectLeaves(layout)
  return {
    id,
    label: `Workspace ${id}`,
    layout,
    focusedPaneId: focusedPaneId ?? leaves[0]?.paneId ?? null,
  }
}

// ---------------------------------------------------------------------------
// collectLeaves
// ---------------------------------------------------------------------------

describe('collectLeaves', () => {
  it('single leaf returns [leaf]', () => {
    const l = leaf('a')
    expect(collectLeaves(l)).toEqual([l])
  })

  it('nested split returns all leaves in left-to-right order', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    expect(collectLeaves(tree)).toEqual([la, lb])
  })

  it('deep tree (3+ levels) collects correctly', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ld = leaf('d')
    // ((a | b) | (c | d))
    const tree = split(split(la, lb), split(lc, ld))
    expect(collectLeaves(tree)).toEqual([la, lb, lc, ld])
  })
})

// ---------------------------------------------------------------------------
// updateLeafByChannelId
// ---------------------------------------------------------------------------

describe('updateLeafByChannelId', () => {
  it('matching leaf at root returns patched copy', () => {
    const l = leaf('a')
    const result = updateLeafByChannelId(l, 'ch-a', { status: 'disconnected' })
    expect(result).toEqual({ ...l, status: 'disconnected' })
    // original unchanged
    expect(l.status).toBe('connected')
  })

  it('non-matching leaf returns same reference', () => {
    const l = leaf('a')
    const result = updateLeafByChannelId(l, 'ch-z', { status: 'disconnected' })
    expect(result).toBe(l)
  })

  it('nested tree patches correct leaf, leaves others unchanged', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const tree = split(la, split(lb, lc))
    const result = updateLeafByChannelId(tree, 'ch-b', { status: 'disconnected' })
    const leaves = collectLeaves(result)
    expect(leaves[0]).toEqual(la)
    expect(leaves[1]).toEqual({ ...lb, status: 'disconnected' })
    expect(leaves[2]).toEqual(lc)
  })
})

// ---------------------------------------------------------------------------
// insertLeaf
// ---------------------------------------------------------------------------

describe('insertLeaf', () => {
  it("position: 'before' — new leaf on left, existing on right", () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = insertLeaf(existing, 'pane-a', 'horizontal', newL, 'before')
    expect(result).toEqual(split(newL, existing, 'horizontal'))
  })

  it("position: 'after' — existing on left, new leaf on right", () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = insertLeaf(existing, 'pane-a', 'horizontal', newL, 'after')
    expect(result).toEqual(split(existing, newL, 'horizontal'))
  })

  it('non-matching target — tree returned unchanged', () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = insertLeaf(existing, 'pane-z', 'horizontal', newL, 'after')
    expect(result).toBe(existing)
  })

  it('horizontal direction set correctly on split node', () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = insertLeaf(existing, 'pane-a', 'horizontal', newL, 'after')
    expect(result).toMatchObject({ type: 'split', direction: 'horizontal' })
  })

  it('vertical direction set correctly on split node', () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = insertLeaf(existing, 'pane-a', 'vertical', newL, 'after')
    expect(result).toMatchObject({ type: 'split', direction: 'vertical' })
  })

  it('inserts into correct position in nested tree', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const newL = leaf('new')
    const tree = split(la, split(lb, lc))
    // Insert after 'b'
    const result = insertLeaf(tree, 'pane-b', 'horizontal', newL, 'after')
    const leaves = collectLeaves(result)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-a', 'pane-b', 'pane-new', 'pane-c'])
  })
})

// ---------------------------------------------------------------------------
// splitLeaf
// ---------------------------------------------------------------------------

describe('splitLeaf', () => {
  it('wraps target in a split with new leaf on right', () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = splitLeaf(existing, 'pane-a', 'horizontal', newL)
    expect(result).toEqual(split(existing, newL, 'horizontal'))
  })

  it('sets direction correctly for vertical split', () => {
    const existing = leaf('a')
    const newL = leaf('new')
    const result = splitLeaf(existing, 'pane-a', 'vertical', newL)
    expect(result).toEqual(split(existing, newL, 'vertical'))
  })
})

// ---------------------------------------------------------------------------
// removeLeaf
// ---------------------------------------------------------------------------

describe('removeLeaf', () => {
  it('root leaf removed — returns null', () => {
    const l = leaf('a')
    expect(removeLeaf(l, 'pane-a')).toBeNull()
  })

  it('split collapses to sibling when one child removed', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    const result = removeLeaf(tree, 'pane-a')
    expect(result).toBe(lb)
  })

  it('split collapses to left sibling when right child removed', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    const result = removeLeaf(tree, 'pane-b')
    expect(result).toBe(la)
  })

  it('non-matching paneId — returns same reference', () => {
    const l = leaf('a')
    expect(removeLeaf(l, 'pane-z')).toBe(l)
  })

  it('nested removal preserves rest of tree', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const tree = split(la, split(lb, lc))
    const result = removeLeaf(tree, 'pane-b')
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-a', 'pane-c'])
  })
})

// ---------------------------------------------------------------------------
// moveLeaf
// ---------------------------------------------------------------------------

describe('moveLeaf', () => {
  it('same source and target paneId — returns unchanged tree', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    const result = moveLeaf(tree, 'pane-a', 'pane-a', 'horizontal', 'after')
    expect(result).toBe(tree)
  })

  it('source not found — returns unchanged tree', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    const result = moveLeaf(tree, 'pane-z', 'pane-a', 'horizontal', 'after')
    expect(result).toBe(tree)
  })

  it('successful move — leaf removed from old position, inserted at target', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    // tree: (a | (b | c))
    const tree = split(la, split(lb, lc))
    // move 'c' before 'a'
    const result = moveLeaf(tree, 'pane-c', 'pane-a', 'horizontal', 'before')
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-c', 'pane-a', 'pane-b'])
  })

  it('move between two leaves in a split (does not collapse to null)', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const tree = split(la, lb)
    // move 'a' after 'b'
    const result = moveLeaf(tree, 'pane-a', 'pane-b', 'horizontal', 'after')
    expect(result).not.toBeNull()
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-b', 'pane-a'])
  })

  it('returns null when tree collapses after source removal (target not found)', () => {
    const la = leaf('a')
    const result = moveLeaf(la, 'pane-a', 'pane-nonexistent', 'horizontal', 'after')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// firstLeaf
// ---------------------------------------------------------------------------

describe('firstLeaf', () => {
  it('single leaf returns itself', () => {
    const l = leaf('a')
    expect(firstLeaf(l)).toBe(l)
  })

  it('deep tree returns leftmost leaf', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ld = leaf('d')
    // ((a | b) | (c | d))
    const tree = split(split(la, lb), split(lc, ld))
    expect(firstLeaf(tree)).toBe(la)
  })
})

// ---------------------------------------------------------------------------
// movePaneAcrossWorkspaces
// ---------------------------------------------------------------------------

describe('movePaneAcrossWorkspaces', () => {
  it('moves pane from source to target workspace', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ws1 = workspace('ws1', split(la, lb))
    const ws2 = workspace('ws2', lc)
    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-c',
      'horizontal',
      'after'
    )
    const source = result.find((w) => w.id === 'ws1')!
    const target = result.find((w) => w.id === 'ws2')!
    expect(collectLeaves(source.layout).map((l) => l.paneId)).toEqual(['pane-b'])
    expect(collectLeaves(target.layout).map((l) => l.paneId)).toEqual(['pane-c', 'pane-a'])
  })

  it('removes source workspace when last pane moves out', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws1 = workspace('ws1', la)
    const ws2 = workspace('ws2', lb)
    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-b',
      'horizontal',
      'after'
    )
    expect(result.find((w) => w.id === 'ws1')).toBeUndefined()
    expect(result).toHaveLength(1)
  })

  it('updates focus to firstLeaf when focused pane moves away', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    // ws1 is focused on 'a', and 'a' is moving
    const ws1 = workspace('ws1', split(la, lb), 'pane-a')
    const ws2 = workspace('ws2', lc)
    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-c',
      'horizontal',
      'after'
    )
    const source = result.find((w) => w.id === 'ws1')!
    // firstLeaf of remaining tree (just lb) should be the new focus
    expect(source.focusedPaneId).toBe('pane-b')
  })

  it('sets focus to moved pane in target workspace', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const lc = leaf('c')
    const ws1 = workspace('ws1', split(la, lb))
    const ws2 = workspace('ws2', lc)
    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-c',
      'horizontal',
      'after'
    )
    const target = result.find((w) => w.id === 'ws2')!
    expect(target.focusedPaneId).toBe('pane-a')
  })

  it('returns unchanged array for invalid source workspace ID', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws1 = workspace('ws1', la)
    const ws2 = workspace('ws2', lb)
    const workspaces = [ws1, ws2]
    const result = movePaneAcrossWorkspaces(
      workspaces,
      'pane-a',
      'ws-invalid',
      'ws2',
      'pane-b',
      'horizontal',
      'after'
    )
    expect(result).toEqual(workspaces)
  })

  it('returns unchanged array for invalid target workspace ID', () => {
    const la = leaf('a')
    const lb = leaf('b')
    const ws1 = workspace('ws1', la)
    const ws2 = workspace('ws2', lb)
    const workspaces = [ws1, ws2]
    const result = movePaneAcrossWorkspaces(
      workspaces,
      'pane-a',
      'ws1',
      'ws-invalid',
      'pane-b',
      'horizontal',
      'after'
    )
    expect(result).toEqual(workspaces)
  })
})
