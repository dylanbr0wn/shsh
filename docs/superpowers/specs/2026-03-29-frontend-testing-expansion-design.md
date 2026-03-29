# Frontend Testing Expansion

**Date:** 2026-03-29
**Scope:** Vitest unit/component test infrastructure + Playwright E2E spike

## Context

The shsh frontend (React 19 + TypeScript + Vite) has **zero test infrastructure** — no test runner, no test files, no mocks. The codebase is ~13,730 LOC across 123 files with complex pure logic (pane tree operations), Jotai atom-based state management, and xterm.js terminal integration.

This spec covers standing up the test framework and writing tests across four layers, prioritized by ROI:
1. Pure logic (no dependencies)
2. Jotai atom actions (minimal mocking)
3. Hooks (RTL `renderHook` + mocks)
4. Components (RTL render + mocked backends)

It also covers a Playwright E2E spike against `wails dev`, with fallback to a deferred E2E plan if infeasible.

## Test Infrastructure

### Dependencies

**Unit/component testing:**
- `vitest` — test runner (Vite-native, fast)
- `@vitest/coverage-v8` — coverage reporting
- `jsdom` — DOM environment for React tests
- `@testing-library/react` — component/hook rendering
- `@testing-library/jest-dom` — DOM assertion matchers

**E2E testing (spike):**
- `@playwright/test` — browser automation

### Configuration

**`frontend/vitest.config.ts`** — extends `vite.config.ts`:
- Inherits `@` path alias and plugins
- `environment: 'jsdom'` for DOM tests
- `setupFiles` pointing to a global setup file
- Coverage thresholds (enforced in CI once baseline is established)

**`frontend/src/test/setup.ts`** — global test setup:
- Import `@testing-library/jest-dom` matchers
- Global mock for `wailsjs/runtime/runtime` (EventsOn, EventsOff, EventsEmit, etc.)

**`frontend/src/__mocks__/`** — Vitest auto-mocks:
- Mock modules for `wailsjs/go/main/SessionFacade` and other facades
- Mock for `sonner` toast

### File Conventions

- Unit tests co-located with source: `paneTree.test.ts` next to `paneTree.ts`
- Component tests co-located: `SFTPPanel.test.tsx` next to `SFTPPanel.tsx`
- E2E tests in `frontend/e2e/` (if spike succeeds)
- Test helpers/fixtures in `frontend/src/test/`

### Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test"
}
```

## Layer 1: Pure Logic — `paneTree.ts`

**File:** `frontend/src/lib/paneTree.test.ts`

All 8 exported functions tested with no mocking needed. Test data uses minimal `PaneLeaf` and `SplitNode` fixtures.

### `collectLeaves`
- Single leaf returns `[leaf]`
- Nested split returns all leaves in left-to-right order
- Deep tree (3+ levels) collects correctly

### `updateLeafByChannelId`
- Matching leaf at root returns patched copy
- Non-matching leaf returns same reference (identity check)
- Nested tree patches correct leaf, leaves others unchanged

### `insertLeaf`
- `position: 'before'` — new leaf on left, existing on right
- `position: 'after'` — existing on left, new leaf on right
- Non-matching target — tree returned unchanged
- Horizontal and vertical directions set correctly on split node

### `splitLeaf`
- Delegates to `insertLeaf` with `'after'` — verify split node structure

### `moveLeaf`
- Same source and target paneId — returns unchanged tree
- Source not found — returns unchanged tree
- Successful move — leaf removed from old position, inserted at target
- Tree collapses to null when move empties a single-leaf tree

### `removeLeaf`
- Root leaf removed — returns `null`
- Split collapses to sibling when one child removed
- Nested removal preserves rest of tree
- Non-matching paneId — returns same reference

### `firstLeaf`
- Single leaf returns itself
- Deep tree returns leftmost leaf

### `movePaneAcrossWorkspaces`
- Source workspace removed when last pane moves out
- Focus updates to `firstLeaf` when focused pane moves away
- Target workspace gains pane with focus set to moved pane
- Invalid workspace IDs — returns unchanged array

## Layer 2: Jotai Atom Actions — `workspaceActions.ts`

**File:** `frontend/src/store/workspaceActions.test.ts`

Uses Jotai's `createStore()` for isolated atom testing. Each test creates a fresh store, sets initial workspace state, dispatches the write atom, and asserts the resulting state.

**Mocks:**
- `vi.mock('../../wailsjs/go/main/SessionFacade')` — mock `CloseChannel`
- `vi.mock('sonner')` — mock `toast.error`

### `patchLeafByChannelIdAtom`
- Patches matching leaf across multiple workspaces
- Non-matching channelId leaves state unchanged

### `patchLeavesByConnectionIdAtom`
- Patches all leaves sharing a connectionId
- Returns affected leaves array
- Returns empty array when no matches

### `splitPaneAtom`
- Without position — uses `splitLeaf` (new leaf on right)
- With position `'before'` — uses `insertLeaf`
- Updates `focusedPaneId` to new leaf

### `closePaneAtom`
- Removes pane, workspace layout updates
- Last pane in workspace — workspace removed entirely
- Calls `CloseChannel` with the leaf's channelId
- Focus falls back to `firstLeaf` when focused pane closed

### `movePaneAtom`
- Intra-workspace move (same workspaceId) — delegates to `moveLeaf`
- Cross-workspace move — delegates to `movePaneAcrossWorkspaces`

### `requireActiveLeafAtom`
- No active workspace — toasts error
- No focused pane — toasts error
- Focused leaf not connected — toasts error
- Connected focused leaf — calls action with leaf

### `disconnectAllAtom`
- Calls `CloseChannel` for each connected leaf
- No connected leaves — toasts error
- Partial failures — toasts failure count

## Layer 3: Hooks

**Selected hooks with highest logic density.**

### `useChannelEvents` — `frontend/src/hooks/useChannelEvents.test.ts`
- Channel status events update leaf atoms correctly
- Port forward state cleaned up on disconnect

### `useWailsEvent` — `frontend/src/hooks/useWailsEvent.test.ts`
- Subscribes to Wails event on mount
- Unsubscribes on unmount
- Callback updates don't cause re-subscription (ref stability)

### `useTerminal` — deferred
Deeply coupled to xterm.js DOM (WebGL, ResizeObserver, canvas). If we identify extractable pure logic (e.g., terminal settings resolution), test that as a standalone function. Full hook testing deferred to E2E.

## Layer 4: Components (if time permits)

Light smoke tests with mocked backends, focused on logic-heavy components.

### `ImportHostsModal`
- Format detection renders correct preview
- Deduplication logic marks existing hosts
- Submit calls backend with correct payload

### `HostList`
- Groups render with correct host children
- Filter/search narrows visible hosts
- Empty state renders correctly

## E2E Testing — Playwright Spike

### Goal

Determine if Playwright can meaningfully test the shsh UI against `wails dev` at `http://localhost:34115`.

### Spike Scope (2-3 tests)

1. **App loads** — navigate to `:34115`, assert sidebar and main area are in DOM
2. **Settings modal** — trigger settings open, verify panels render, close
3. **Terminal interaction** (stretch) — if a test SSH target is available, verify xterm.js container renders and accepts keyboard input

### Known Risks

- **xterm.js canvas/WebGL** — Playwright can send keystrokes but can't easily assert rendered terminal content
- **`wails dev` reliability** — startup time varies, may need retry/health-check logic
- **CI environment** — requires Go, Wails CLI, and Node; adds orchestration complexity

### Feasibility Decision

After the spike:
- **If feasible:** wire up `pnpm test:e2e` with a `webServer` config in `playwright.config.ts` that starts `wails dev` and waits for `:34115`
- **If infeasible:** document blockers and the CI architecture design (start → wait → test → teardown) in a follow-up issue for later implementation

### CI Architecture (designed regardless of spike outcome)

```yaml
# Vitest (always runs)
- run: cd frontend && pnpm test

# Playwright (optional, separate job)
- run: wails dev &
- run: npx wait-on http://localhost:34115
- run: cd frontend && pnpm test:e2e
```

## Out of Scope

- Backend Go test expansion (separate effort)
- Visual regression testing (screenshot comparison)
- Performance/benchmark testing
- Full component test coverage for all 123 files
