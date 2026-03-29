# Frontend Testing Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vitest + React Testing Library test infrastructure and write comprehensive tests for the frontend's most complex logic, atoms, and hooks, plus spike Playwright E2E.

**Architecture:** Co-located test files next to source. Global mocks for `wailsjs/` bindings. Four test layers: pure logic, Jotai atoms, hooks, components. Separate Playwright E2E config for full-stack spike.

**Tech Stack:** Vitest, jsdom, @testing-library/react, @testing-library/jest-dom, @playwright/test

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/vitest.config.ts` | Vitest config extending Vite |
| Create | `frontend/src/test/setup.ts` | Global test setup (jest-dom matchers, Wails runtime mock) |
| Create | `frontend/src/lib/paneTree.test.ts` | Pure logic tests for pane tree operations |
| Create | `frontend/src/store/workspaceActions.test.ts` | Jotai atom action tests |
| Create | `frontend/src/hooks/useWailsEvent.test.tsx` | Hook lifecycle tests |
| Create | `frontend/src/hooks/useChannelEvents.test.tsx` | Channel event handler tests |
| Create | `frontend/playwright.config.ts` | Playwright E2E config (spike) |
| Create | `frontend/e2e/app-loads.spec.ts` | E2E: app loads and renders |
| Modify | `frontend/package.json` | Add test deps and scripts |
| Modify | `frontend/tsconfig.json` | Include test files |

---

### Task 1: Install Test Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install Vitest + RTL dependencies**

Run from `frontend/`:

```bash
pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/dom
```

- [ ] **Step 2: Install Playwright**

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 3: Add test scripts to package.json**

Add these scripts to the `"scripts"` object in `frontend/package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"test:e2e": "playwright test"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore(ui): add vitest, RTL, and playwright test dependencies"
```

---

### Task 2: Vitest Configuration + Global Setup

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`

- [ ] **Step 1: Create Vitest config**

Create `frontend/vitest.config.ts`:

```ts
import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
```

Note: We intentionally do NOT extend the main `vite.config.ts` because it includes the React Compiler babel plugin and tailwindcss plugin which are unnecessary for tests and can cause issues. We only need the `react()` plugin and the `@` alias.

- [ ] **Step 2: Create global test setup**

Create `frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock the Wails runtime — every module that imports from wailsjs/runtime/runtime
// gets these stubs instead. EventsOn returns a cancel function.
vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
  EventsOff: vi.fn(),
  EventsEmit: vi.fn(),
  WindowSetDarkTheme: vi.fn(),
  WindowSetLightTheme: vi.fn(),
  WindowMinimise: vi.fn(),
  WindowMaximise: vi.fn(),
  WindowUnmaximise: vi.fn(),
  WindowClose: vi.fn(),
  WindowIsMaximised: vi.fn(() => Promise.resolve(false)),
  WindowToggleMaximise: vi.fn(),
}))

// Mock SessionFacade — the most commonly imported Go facade
vi.mock('../../wailsjs/go/main/SessionFacade', () => ({
  CloseChannel: vi.fn(() => Promise.resolve()),
  ConnectHost: vi.fn(() => Promise.resolve()),
  WriteToChannel: vi.fn(() => Promise.resolve()),
  ResizeChannel: vi.fn(() => Promise.resolve()),
  ListPortForwards: vi.fn(() => Promise.resolve([])),
  RemovePortForward: vi.fn(() => Promise.resolve()),
  StartSessionLog: vi.fn(() => Promise.resolve('')),
  StopSessionLog: vi.fn(() => Promise.resolve()),
  ListSFTPDir: vi.fn(() => Promise.resolve([])),
  DownloadFile: vi.fn(() => Promise.resolve()),
  UploadFile: vi.fn(() => Promise.resolve()),
}))

// Mock HostFacade
vi.mock('../../wailsjs/go/main/HostFacade', () => ({
  ListHosts: vi.fn(() => Promise.resolve([])),
  ListGroups: vi.fn(() => Promise.resolve([])),
  ListTerminalProfiles: vi.fn(() => Promise.resolve([])),
  ListWorkspaceTemplates: vi.fn(() => Promise.resolve([])),
  AddGroup: vi.fn(() => Promise.resolve()),
  PingHosts: vi.fn(() => Promise.resolve({})),
}))

// Mock App facade
vi.mock('../../wailsjs/go/main/App', () => ({
  GetConfig: vi.fn(() => Promise.resolve({})),
  SetDebugLevel: vi.fn(() => Promise.resolve()),
  UpdateConfig: vi.fn(() => Promise.resolve()),
}))

// Mock ToolsFacade
vi.mock('../../wailsjs/go/main/ToolsFacade', () => ({
  OpenLogsDirectory: vi.fn(() => Promise.resolve()),
}))
```

- [ ] **Step 3: Verify setup compiles**

```bash
cd frontend && pnpm test
```

Expected: 0 tests found, no errors. Vitest exits cleanly.

- [ ] **Step 4: Commit**

```bash
git add frontend/vitest.config.ts frontend/src/test/setup.ts
git commit -m "chore(ui): add vitest config and global test setup with wailsjs mocks"
```

---

### Task 3: paneTree.ts — Pure Logic Tests

**Files:**
- Create: `frontend/src/lib/paneTree.test.ts`
- Reference: `frontend/src/lib/paneTree.ts`
- Reference: `frontend/src/store/workspaces.ts` (types)

- [ ] **Step 1: Write test file with fixtures and collectLeaves tests**

Create `frontend/src/lib/paneTree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { PaneLeaf, PaneNode, SplitNode, Workspace } from '../store/workspaces'
import {
  collectLeaves,
  updateLeafByChannelId,
  insertLeaf,
  splitLeaf,
  moveLeaf,
  removeLeaf,
  firstLeaf,
  movePaneAcrossWorkspaces,
} from './paneTree'

// --------------- fixtures ---------------

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
  }
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

// --------------- collectLeaves ---------------

describe('collectLeaves', () => {
  it('returns single leaf in an array', () => {
    const l = leaf('a')
    expect(collectLeaves(l)).toEqual([l])
  })

  it('returns leaves left-to-right from a split', () => {
    const a = leaf('a')
    const b = leaf('b')
    const tree = split(a, b)
    expect(collectLeaves(tree)).toEqual([a, b])
  })

  it('handles deeply nested trees', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    // ((a | b) | c)
    const tree = split(split(a, b), c)
    expect(collectLeaves(tree)).toEqual([a, b, c])
  })
})

// --------------- updateLeafByChannelId ---------------

describe('updateLeafByChannelId', () => {
  it('patches the matching leaf', () => {
    const a = leaf('a')
    const result = updateLeafByChannelId(a, 'ch-a', { status: 'disconnected' })
    expect(result).toEqual({ ...a, status: 'disconnected' })
  })

  it('returns same reference when no match', () => {
    const a = leaf('a')
    const result = updateLeafByChannelId(a, 'ch-nope', { status: 'disconnected' })
    expect(result).toBe(a)
  })

  it('patches correct leaf in a nested tree', () => {
    const a = leaf('a')
    const b = leaf('b')
    const tree = split(a, b)
    const result = updateLeafByChannelId(tree, 'ch-b', { status: 'error' })
    expect(collectLeaves(result)).toEqual([a, { ...b, status: 'error' }])
  })
})

// --------------- insertLeaf ---------------

describe('insertLeaf', () => {
  it('inserts before — new leaf on left', () => {
    const a = leaf('a')
    const n = leaf('n')
    const result = insertLeaf(a, 'pane-a', 'horizontal', n, 'before') as SplitNode
    expect(result.type).toBe('split')
    expect(result.direction).toBe('horizontal')
    expect(result.left).toBe(n)
    expect(result.right).toBe(a)
  })

  it('inserts after — new leaf on right', () => {
    const a = leaf('a')
    const n = leaf('n')
    const result = insertLeaf(a, 'pane-a', 'vertical', n, 'after') as SplitNode
    expect(result.type).toBe('split')
    expect(result.direction).toBe('vertical')
    expect(result.left).toBe(a)
    expect(result.right).toBe(n)
  })

  it('returns tree unchanged when target not found', () => {
    const a = leaf('a')
    const n = leaf('n')
    const result = insertLeaf(a, 'pane-nope', 'horizontal', n, 'after')
    expect(result).toBe(a)
  })

  it('inserts into correct position in nested tree', () => {
    const a = leaf('a')
    const b = leaf('b')
    const n = leaf('n')
    const tree = split(a, b)
    const result = insertLeaf(tree, 'pane-b', 'vertical', n, 'after')
    const leaves = collectLeaves(result)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-a', 'pane-b', 'pane-n'])
  })
})

// --------------- splitLeaf ---------------

describe('splitLeaf', () => {
  it('wraps target in a split with new leaf on right', () => {
    const a = leaf('a')
    const n = leaf('n')
    const result = splitLeaf(a, 'pane-a', 'horizontal', n) as SplitNode
    expect(result.left).toBe(a)
    expect(result.right).toBe(n)
  })
})

// --------------- removeLeaf ---------------

describe('removeLeaf', () => {
  it('returns null when removing root leaf', () => {
    const a = leaf('a')
    expect(removeLeaf(a, 'pane-a')).toBeNull()
  })

  it('returns same reference when paneId not found', () => {
    const a = leaf('a')
    expect(removeLeaf(a, 'pane-nope')).toBe(a)
  })

  it('collapses split to sibling when one child removed', () => {
    const a = leaf('a')
    const b = leaf('b')
    const tree = split(a, b)
    expect(removeLeaf(tree, 'pane-a')).toBe(b)
    expect(removeLeaf(tree, 'pane-b')).toBe(a)
  })

  it('preserves rest of tree on nested removal', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const tree = split(split(a, b), c)
    const result = removeLeaf(tree, 'pane-a')
    // inner split collapses, leaving (b | c)
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-b', 'pane-c'])
  })
})

// --------------- moveLeaf ---------------

describe('moveLeaf', () => {
  it('returns unchanged tree when source === target', () => {
    const a = leaf('a')
    const b = leaf('b')
    const tree = split(a, b)
    expect(moveLeaf(tree, 'pane-a', 'pane-a', 'horizontal', 'after')).toBe(tree)
  })

  it('returns unchanged tree when source not found', () => {
    const a = leaf('a')
    const b = leaf('b')
    const tree = split(a, b)
    expect(moveLeaf(tree, 'pane-nope', 'pane-a', 'horizontal', 'after')).toBe(tree)
  })

  it('moves leaf to new position', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    // (a | (b | c)) → move a after c → (b | (c | a))
    const tree = split(a, split(b, c))
    const result = moveLeaf(tree, 'pane-a', 'pane-c', 'horizontal', 'after')
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-b', 'pane-c', 'pane-a'])
  })

  it('returns null when move empties a single-leaf tree', () => {
    // This can't actually happen (source === target would short-circuit),
    // but removeLeaf on a single leaf returns null, which moveLeaf propagates.
    const a = leaf('a')
    const b = leaf('b')
    // Two-leaf tree: remove a, insert at b → works fine
    const tree = split(a, b)
    const result = moveLeaf(tree, 'pane-a', 'pane-b', 'vertical', 'before')
    expect(result).not.toBeNull()
    const leaves = collectLeaves(result!)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-a', 'pane-b'])
  })
})

// --------------- firstLeaf ---------------

describe('firstLeaf', () => {
  it('returns the leaf itself for a single leaf', () => {
    const a = leaf('a')
    expect(firstLeaf(a)).toBe(a)
  })

  it('returns leftmost leaf in a deep tree', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const tree = split(split(a, b), c)
    expect(firstLeaf(tree)).toBe(a)
  })
})

// --------------- movePaneAcrossWorkspaces ---------------

describe('movePaneAcrossWorkspaces', () => {
  it('moves pane from source to target workspace', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const ws1 = workspace('ws1', split(a, b), 'pane-a')
    const ws2 = workspace('ws2', c, 'pane-c')

    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-c',
      'horizontal',
      'after'
    )

    // ws1 lost pane-a, should have only pane-b
    const r1 = result.find((w) => w.id === 'ws1')!
    expect(collectLeaves(r1.layout).map((l) => l.paneId)).toEqual(['pane-b'])

    // ws2 gained pane-a after pane-c
    const r2 = result.find((w) => w.id === 'ws2')!
    expect(collectLeaves(r2.layout).map((l) => l.paneId)).toEqual(['pane-c', 'pane-a'])
  })

  it('removes source workspace when last pane moves out', () => {
    const a = leaf('a')
    const b = leaf('b')
    const ws1 = workspace('ws1', a)
    const ws2 = workspace('ws2', b)

    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-b',
      'horizontal',
      'after'
    )

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('ws2')
  })

  it('updates focus when focused pane moves away', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const ws1 = workspace('ws1', split(a, b), 'pane-a') // focused on a
    const ws2 = workspace('ws2', c)

    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-c',
      'horizontal',
      'after'
    )

    const r1 = result.find((w) => w.id === 'ws1')!
    expect(r1.focusedPaneId).toBe('pane-b') // fell back to firstLeaf
  })

  it('sets focus to moved pane in target workspace', () => {
    const a = leaf('a')
    const b = leaf('b')
    const ws1 = workspace('ws1', a)
    const ws2 = workspace('ws2', b, 'pane-b')

    const result = movePaneAcrossWorkspaces(
      [ws1, ws2],
      'pane-a',
      'ws1',
      'ws2',
      'pane-b',
      'horizontal',
      'after'
    )

    const r2 = result.find((w) => w.id === 'ws2')!
    expect(r2.focusedPaneId).toBe('pane-a')
  })

  it('returns unchanged array for invalid workspace IDs', () => {
    const a = leaf('a')
    const ws1 = workspace('ws1', a)
    const result = movePaneAcrossWorkspaces(
      [ws1],
      'pane-a',
      'ws-nope',
      'ws1',
      'pane-a',
      'horizontal',
      'after'
    )
    expect(result).toBe([ws1] as unknown) // same reference check won't work on array literal
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd frontend && pnpm test -- src/lib/paneTree.test.ts
```

Expected: All tests PASS. These are testing existing, working pure functions.

Note: The last test in `movePaneAcrossWorkspaces` ("invalid workspace IDs") may need adjustment — `workspaces` is returned as-is from the function, but since we pass an array literal `[ws1]`, referential equality won't hold. Change the assertion to:

```ts
expect(result).toEqual([ws1])
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/paneTree.test.ts
git commit -m "test(ui): add comprehensive paneTree pure logic tests"
```

---

### Task 4: workspaceActions.ts — Jotai Atom Tests

**Files:**
- Create: `frontend/src/store/workspaceActions.test.ts`
- Reference: `frontend/src/store/workspaceActions.ts`
- Reference: `frontend/src/store/workspaces.ts`
- Reference: `frontend/src/lib/paneTree.ts`

- [ ] **Step 1: Write atom action tests**

Create `frontend/src/store/workspaceActions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import type { PaneLeaf, PaneNode, SplitNode, Workspace } from './workspaces'
import { workspacesAtom, activeWorkspaceIdAtom } from './workspaces'
import { collectLeaves } from '../lib/paneTree'
import {
  patchLeafByChannelIdAtom,
  patchLeavesByConnectionIdAtom,
  splitPaneAtom,
  closePaneAtom,
  movePaneAtom,
  requireActiveLeafAtom,
  disconnectAllAtom,
} from './workspaceActions'

// Re-import the mocked modules so we can inspect calls
import { CloseChannel } from '../../wailsjs/go/main/SessionFacade'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

// SessionFacade is globally mocked in setup.ts, but we need the reference here

// --------------- fixtures ---------------

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
  }
}

function split(left: PaneNode, right: PaneNode): SplitNode {
  return { type: 'split', direction: 'horizontal', ratio: 0.5, left, right }
}

function ws(id: string, layout: PaneNode, focusedPaneId?: string): Workspace {
  const leaves = collectLeaves(layout)
  return {
    id,
    label: `Workspace ${id}`,
    layout,
    focusedPaneId: focusedPaneId ?? leaves[0]?.paneId ?? null,
  }
}

// --------------- helpers ---------------

function setupStore(workspaces: Workspace[], activeId?: string | null) {
  const store = createStore()
  store.set(workspacesAtom, workspaces)
  store.set(activeWorkspaceIdAtom, activeId ?? null)
  return store
}

// --------------- tests ---------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('patchLeafByChannelIdAtom', () => {
  it('patches matching leaf across workspaces', () => {
    const a = leaf('a')
    const b = leaf('b')
    const store = setupStore([ws('w1', a), ws('w2', b)])

    store.set(patchLeafByChannelIdAtom, { channelId: 'ch-b', patch: { status: 'error' } })

    const result = store.get(workspacesAtom)
    expect(collectLeaves(result[0].layout)[0].status).toBe('connected')
    expect(collectLeaves(result[1].layout)[0].status).toBe('error')
  })

  it('leaves state unchanged when no match', () => {
    const a = leaf('a')
    const store = setupStore([ws('w1', a)])
    const before = store.get(workspacesAtom)

    store.set(patchLeafByChannelIdAtom, { channelId: 'ch-nope', patch: { status: 'error' } })

    const after = store.get(workspacesAtom)
    // Leaves should be identical (updateLeafByChannelId returns same ref for non-matches)
    expect(collectLeaves(after[0].layout)[0]).toBe(collectLeaves(before[0].layout)[0])
  })
})

describe('patchLeavesByConnectionIdAtom', () => {
  it('patches all leaves sharing a connectionId', () => {
    const a = leaf('a', { connectionId: 'conn-shared' })
    const b = leaf('b', { connectionId: 'conn-shared' })
    const c = leaf('c', { connectionId: 'conn-other' })
    const store = setupStore([ws('w1', split(a, split(b, c)))])

    const affected = store.set(patchLeavesByConnectionIdAtom, {
      connectionId: 'conn-shared',
      patch: { status: 'reconnecting' },
    })

    expect(affected).toHaveLength(2)
    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves[0].status).toBe('reconnecting')
    expect(leaves[1].status).toBe('reconnecting')
    expect(leaves[2].status).toBe('connected') // conn-other unchanged
  })

  it('returns empty array when no matches', () => {
    const a = leaf('a')
    const store = setupStore([ws('w1', a)])

    const affected = store.set(patchLeavesByConnectionIdAtom, {
      connectionId: 'conn-nope',
      patch: { status: 'error' },
    })

    expect(affected).toEqual([])
  })
})

describe('splitPaneAtom', () => {
  it('splits pane with new leaf on right (default)', () => {
    const a = leaf('a')
    const n = leaf('n')
    const store = setupStore([ws('w1', a)])

    store.set(splitPaneAtom, {
      workspaceId: 'w1',
      paneId: 'pane-a',
      direction: 'horizontal',
      newLeaf: n,
    })

    const result = store.get(workspacesAtom)[0]
    const leaves = collectLeaves(result.layout)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-a', 'pane-n'])
    expect(result.focusedPaneId).toBe('pane-n')
  })

  it('respects position=before', () => {
    const a = leaf('a')
    const n = leaf('n')
    const store = setupStore([ws('w1', a)])

    store.set(splitPaneAtom, {
      workspaceId: 'w1',
      paneId: 'pane-a',
      direction: 'vertical',
      newLeaf: n,
      position: 'before',
    })

    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-n', 'pane-a'])
  })
})

describe('closePaneAtom', () => {
  it('removes pane and calls CloseChannel', () => {
    const a = leaf('a')
    const b = leaf('b')
    const store = setupStore([ws('w1', split(a, b), 'pane-a')])

    store.set(closePaneAtom, { workspaceId: 'w1', paneId: 'pane-a' })

    expect(CloseChannel).toHaveBeenCalledWith('ch-a')
    const result = store.get(workspacesAtom)[0]
    const leaves = collectLeaves(result.layout)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-b'])
  })

  it('removes workspace when last pane closed', () => {
    const a = leaf('a')
    const store = setupStore([ws('w1', a)])

    store.set(closePaneAtom, { workspaceId: 'w1', paneId: 'pane-a' })

    expect(store.get(workspacesAtom)).toHaveLength(0)
  })

  it('updates focus to firstLeaf when focused pane closed', () => {
    const a = leaf('a')
    const b = leaf('b')
    const store = setupStore([ws('w1', split(a, b), 'pane-a')])

    store.set(closePaneAtom, { workspaceId: 'w1', paneId: 'pane-a' })

    expect(store.get(workspacesAtom)[0].focusedPaneId).toBe('pane-b')
  })
})

describe('movePaneAtom', () => {
  it('moves pane within same workspace', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const store = setupStore([ws('w1', split(a, split(b, c)))])

    store.set(movePaneAtom, {
      sourcePaneId: 'pane-a',
      sourceWorkspaceId: 'w1',
      targetWorkspaceId: 'w1',
      targetPaneId: 'pane-c',
      direction: 'horizontal',
      position: 'after',
    })

    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves.map((l) => l.paneId)).toEqual(['pane-b', 'pane-c', 'pane-a'])
  })

  it('moves pane across workspaces', () => {
    const a = leaf('a')
    const b = leaf('b')
    const c = leaf('c')
    const store = setupStore([ws('w1', split(a, b)), ws('w2', c)])

    store.set(movePaneAtom, {
      sourcePaneId: 'pane-a',
      sourceWorkspaceId: 'w1',
      targetWorkspaceId: 'w2',
      targetPaneId: 'pane-c',
      direction: 'horizontal',
      position: 'after',
    })

    const result = store.get(workspacesAtom)
    expect(collectLeaves(result[0].layout).map((l) => l.paneId)).toEqual(['pane-b'])
    expect(collectLeaves(result[1].layout).map((l) => l.paneId)).toEqual(['pane-c', 'pane-a'])
  })
})

describe('requireActiveLeafAtom', () => {
  it('calls action with connected focused leaf', () => {
    const a = leaf('a', { status: 'connected' })
    const store = setupStore([ws('w1', a, 'pane-a')], 'w1')
    const action = vi.fn()

    store.set(requireActiveLeafAtom, { action })

    expect(action).toHaveBeenCalledWith(a)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts error when no active workspace', () => {
    const store = setupStore([], null)
    const action = vi.fn()

    store.set(requireActiveLeafAtom, { action })

    expect(action).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active session')
  })

  it('toasts error when focused leaf is not connected', () => {
    const a = leaf('a', { status: 'disconnected' })
    const store = setupStore([ws('w1', a, 'pane-a')], 'w1')
    const action = vi.fn()

    store.set(requireActiveLeafAtom, { action })

    expect(action).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active session')
  })
})

describe('disconnectAllAtom', () => {
  it('calls CloseChannel for each connected leaf', async () => {
    const a = leaf('a', { status: 'connected' })
    const b = leaf('b', { status: 'connected' })
    const c = leaf('c', { status: 'disconnected' })
    const store = setupStore([ws('w1', split(a, split(b, c)))])

    await store.set(disconnectAllAtom)

    expect(CloseChannel).toHaveBeenCalledTimes(2)
    expect(CloseChannel).toHaveBeenCalledWith('ch-a')
    expect(CloseChannel).toHaveBeenCalledWith('ch-b')
  })

  it('toasts error when no connected sessions', async () => {
    const a = leaf('a', { status: 'disconnected' })
    const store = setupStore([ws('w1', a)])

    await store.set(disconnectAllAtom)

    expect(toast.error).toHaveBeenCalledWith('No active sessions')
    expect(CloseChannel).not.toHaveBeenCalled()
  })

  it('toasts failure count on partial errors', async () => {
    const a = leaf('a', { status: 'connected' })
    const b = leaf('b', { status: 'connected' })
    const store = setupStore([ws('w1', split(a, b))])

    vi.mocked(CloseChannel)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('fail'))

    await store.set(disconnectAllAtom)

    expect(toast.error).toHaveBeenCalledWith('Failed to disconnect 1 session(s)')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && pnpm test -- src/store/workspaceActions.test.ts
```

Expected: All tests PASS.

If the `sonner` mock doesn't resolve correctly (since it's both globally mocked in setup.ts for other facades and locally here), you may need to adjust the mock. The `vi.mock('sonner', ...)` in this file will take precedence for this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/workspaceActions.test.ts
git commit -m "test(ui): add jotai atom action tests for workspace operations"
```

---

### Task 5: useWailsEvent Hook Tests

**Files:**
- Create: `frontend/src/hooks/useWailsEvent.test.tsx`
- Reference: `frontend/src/hooks/useWailsEvent.ts`

- [ ] **Step 1: Write hook tests**

Create `frontend/src/hooks/useWailsEvent.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWailsEvent } from './useWailsEvent'
import { EventsOn } from '../../wailsjs/runtime/runtime'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useWailsEvent', () => {
  it('subscribes to the event on mount', () => {
    const cb = vi.fn()
    renderHook(() => useWailsEvent('channel:status', cb))

    expect(EventsOn).toHaveBeenCalledTimes(1)
    expect(EventsOn).toHaveBeenCalledWith('channel:status', expect.any(Function))
  })

  it('calls cancel function on unmount', () => {
    const cancel = vi.fn()
    vi.mocked(EventsOn).mockReturnValue(cancel)

    const { unmount } = renderHook(() => useWailsEvent('channel:status', vi.fn()))
    unmount()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('forwards event args to the current callback via ref', () => {
    const cb = vi.fn()
    // Capture the internal handler that EventsOn receives
    let internalHandler: (...args: unknown[]) => void = () => {}
    vi.mocked(EventsOn).mockImplementation((_event, handler) => {
      internalHandler = handler
      return vi.fn()
    })

    renderHook(() => useWailsEvent('channel:status', cb))

    const payload = { channelId: 'ch-1', status: 'connected' }
    internalHandler(payload)

    expect(cb).toHaveBeenCalledWith(payload)
  })

  it('does not re-subscribe when callback changes', () => {
    let internalHandler: (...args: unknown[]) => void = () => {}
    vi.mocked(EventsOn).mockImplementation((_event, handler) => {
      internalHandler = handler
      return vi.fn()
    })

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const { rerender } = renderHook(({ cb }) => useWailsEvent('channel:status', cb), {
      initialProps: { cb: cb1 },
    })

    // EventsOn called once on mount
    expect(EventsOn).toHaveBeenCalledTimes(1)

    // Rerender with new callback — should NOT re-subscribe
    rerender({ cb: cb2 })
    expect(EventsOn).toHaveBeenCalledTimes(1)

    // But the new callback should be called via ref
    internalHandler({ test: true })
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledWith({ test: true })
  })

  it('re-subscribes when event name changes', () => {
    const cancel = vi.fn()
    vi.mocked(EventsOn).mockReturnValue(cancel)

    const { rerender } = renderHook(
      ({ event }) => useWailsEvent(event, vi.fn()),
      { initialProps: { event: 'channel:status' as string } }
    )

    expect(EventsOn).toHaveBeenCalledTimes(1)

    rerender({ event: 'connection:status' })

    expect(cancel).toHaveBeenCalledTimes(1) // old subscription cancelled
    expect(EventsOn).toHaveBeenCalledTimes(2) // new subscription created
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && pnpm test -- src/hooks/useWailsEvent.test.tsx
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useWailsEvent.test.tsx
git commit -m "test(ui): add useWailsEvent hook lifecycle tests"
```

---

### Task 6: useChannelEvents Hook Tests

**Files:**
- Create: `frontend/src/hooks/useChannelEvents.test.tsx`
- Reference: `frontend/src/hooks/useChannelEvents.ts`
- Reference: `frontend/src/store/atoms.ts`

- [ ] **Step 1: Write hook tests**

Create `frontend/src/hooks/useChannelEvents.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { Provider, createStore } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import type { PaneLeaf, SplitNode, PaneNode, Workspace } from '../store/workspaces'
import { workspacesAtom } from '../store/workspaces'
import { connectingHostIdsAtom, portForwardsAtom } from '../store/atoms'
import { collectLeaves } from '../lib/paneTree'
import { useChannelEvents } from './useChannelEvents'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

// --------------- fixtures ---------------

function leaf(id: string, overrides?: Partial<PaneLeaf>): PaneLeaf {
  return {
    type: 'leaf',
    kind: 'terminal',
    paneId: `pane-${id}`,
    connectionId: `conn-${id}`,
    channelId: `ch-${id}`,
    hostId: `host-${id}`,
    hostLabel: `Host ${id}`,
    status: 'connecting',
    ...overrides,
  }
}

// --------------- helpers ---------------

// Capture the handler that useWailsEvent registers via EventsOn
let channelStatusHandler: (payload: unknown) => void = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(EventsOn).mockImplementation((_event, handler) => {
    channelStatusHandler = handler
    return vi.fn()
  })
})

function HydrateAtoms({
  atoms,
  children,
}: {
  atoms: Array<[any, any]>
  children: React.ReactNode
}) {
  useHydrateAtoms(atoms)
  return children
}

function createWrapper(workspaces: Workspace[], connectingHostIds: Set<string> = new Set()) {
  const store = createStore()
  return {
    store,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        Provider,
        { store },
        React.createElement(
          HydrateAtoms,
          {
            atoms: [
              [workspacesAtom, workspaces],
              [connectingHostIdsAtom, connectingHostIds],
            ],
          },
          children
        )
      ),
  }
}

// --------------- tests ---------------

describe('useChannelEvents', () => {
  it('ignores connecting status', () => {
    const a = leaf('a')
    const { wrapper, store } = createWrapper(
      [{ id: 'w1', label: 'W1', layout: a, focusedPaneId: 'pane-a' }],
      new Set(['host-a'])
    )

    renderHook(() => useChannelEvents(), { wrapper })

    act(() => {
      channelStatusHandler({ channelId: 'ch-a', connectionId: 'conn-a', status: 'connecting' })
    })

    // connectingHostIds should still contain host-a (not removed)
    expect(store.get(connectingHostIdsAtom).has('host-a')).toBe(true)
  })

  it('patches leaf to connected and removes from connectingHostIds', () => {
    const a = leaf('a', { status: 'connecting' })
    const { wrapper, store } = createWrapper(
      [{ id: 'w1', label: 'W1', layout: a, focusedPaneId: 'pane-a' }],
      new Set(['host-a'])
    )

    renderHook(() => useChannelEvents(), { wrapper })

    act(() => {
      channelStatusHandler({
        channelId: 'ch-a',
        connectionId: 'conn-a',
        status: 'connected',
      })
    })

    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves[0].status).toBe('connected')
    expect(leaves[0].connectedAt).toBeDefined()
    expect(store.get(connectingHostIdsAtom).has('host-a')).toBe(false)
  })

  it('patches leaf to error and toasts on error status', () => {
    const a = leaf('a', { status: 'connecting' })
    const { wrapper, store } = createWrapper(
      [{ id: 'w1', label: 'W1', layout: a, focusedPaneId: 'pane-a' }],
      new Set(['host-a'])
    )

    renderHook(() => useChannelEvents(), { wrapper })

    act(() => {
      channelStatusHandler({
        channelId: 'ch-a',
        connectionId: 'conn-a',
        status: 'error',
        error: 'auth failed',
      })
    })

    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves[0].status).toBe('error')
    expect(toast.error).toHaveBeenCalledWith('SSH channel error', {
      description: 'auth failed',
    })
  })

  it('cleans up port forwards on disconnect', () => {
    const a = leaf('a', { status: 'connected' })
    const { wrapper, store } = createWrapper([
      { id: 'w1', label: 'W1', layout: a, focusedPaneId: 'pane-a' },
    ])

    // Seed port forwards for this channel
    store.set(portForwardsAtom, {
      'ch-a': { forwards: [{ id: 'pf1', localPort: 8080, remoteHost: 'localhost', remotePort: 80 }] },
    })

    renderHook(() => useChannelEvents(), { wrapper })

    act(() => {
      channelStatusHandler({
        channelId: 'ch-a',
        connectionId: 'conn-a',
        status: 'disconnected',
      })
    })

    expect(store.get(portForwardsAtom)['ch-a']).toBeUndefined()
    const leaves = collectLeaves(store.get(workspacesAtom)[0].layout)
    expect(leaves[0].status).toBe('disconnected')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && pnpm test -- src/hooks/useChannelEvents.test.tsx
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useChannelEvents.test.tsx
git commit -m "test(ui): add useChannelEvents hook tests"
```

---

### Task 7: Playwright E2E Spike

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/app-loads.spec.ts`

- [ ] **Step 1: Create Playwright config**

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:34115',
    headless: true,
  },
  // Don't auto-start webServer — wails dev must be running manually or via CI script
})
```

- [ ] **Step 2: Create smoke test**

Create `frontend/e2e/app-loads.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('app loads and renders the sidebar', async ({ page }) => {
  await page.goto('/')
  // Wait for the React app to hydrate — the sidebar should be visible
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 10_000 })
})

test('settings modal opens and closes', async ({ page }) => {
  await page.goto('/')
  // Open settings via keyboard shortcut (Cmd+, on macOS)
  await page.keyboard.press('Meta+,')
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 })

  // Close via Escape
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="dialog"]')).not.toBeVisible()
})
```

- [ ] **Step 3: Test feasibility (requires `wails dev` running)**

Start `wails dev` in another terminal, then:

```bash
cd frontend && pnpm test:e2e
```

**If it works:** Tests pass, Playwright can interact with the Wails webview dev server. Proceed to commit.

**If it fails:** Document the blocker (e.g., CORS issues, WebSocket errors, app doesn't render at `:34115`). The config and test file are still useful as a starting point for future work.

Note: The tests reference `data-testid="sidebar"` — you may need to add this attribute to the Sidebar component. If the sidebar doesn't have a testid, use an alternative selector like `aside` or a known text element. Adjust selectors based on what's actually in the DOM.

- [ ] **Step 4: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e/app-loads.spec.ts
git commit -m "test(ui): add playwright E2E spike config and smoke tests"
```

---

### Task 8: Run Full Test Suite + CI Script Update

**Files:**
- Modify: `frontend/package.json` (verify scripts work)

- [ ] **Step 1: Run the full Vitest suite**

```bash
cd frontend && pnpm test
```

Expected: All unit tests from Tasks 3-6 pass.

- [ ] **Step 2: Run coverage**

```bash
cd frontend && pnpm test:coverage
```

Review the output to confirm coverage reports are generated for `paneTree.ts` and `workspaceActions.ts`.

- [ ] **Step 3: Run existing CI checks to ensure nothing broke**

```bash
cd frontend && pnpm build && pnpm lint && pnpm format:check
```

Expected: All pass. The test files should be properly formatted — if `format:check` fails, run `pnpm format` first.

- [ ] **Step 4: Format test files if needed**

```bash
cd frontend && pnpm format
```

- [ ] **Step 5: Commit any formatting fixes**

```bash
git add -u frontend/
git commit -m "style(ui): format test files"
```
