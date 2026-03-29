# @wailsjs Path Alias

**Date:** 2026-03-29
**Scope:** Replace relative `wailsjs` imports with `@wailsjs` path alias across the frontend

## Problem

38 source files use relative imports (`../../wailsjs/...`, `../../../wailsjs/...`) to reference auto-generated Wails bindings. The `wailsjs/` directory is gitignored and only exists after running `wails generate module` or `wails dev`. This causes `tsc` (and therefore `pnpm build`) to fail in any environment where the bindings haven't been generated — fresh clones, CI before the generate step, and local test-only workflows.

The current workaround for Vitest uses three depth-level aliases in `vitest.config.ts` (`../wailsjs`, `../../wailsjs`, `../../../wailsjs`), which is brittle and will break for files nested 4+ directories deep.

## Solution

Introduce an `@wailsjs` path alias configured at three levels:

| File | Alias Pattern | Resolves To | Purpose |
|------|---------------|-------------|---------|
| `tsconfig.json` | `@wailsjs/*` → `["./wailsjs/*", "./src/test/wailsjs-stubs/*"]` | Real bindings if present, stubs as fallback | Type checking works without `wails generate` |
| `vite.config.ts` | `@wailsjs` → `./wailsjs` | Real bindings (always exist in dev/build) | Dev server and production builds |
| `vitest.config.ts` | `@wailsjs` → `./src/test/wailsjs-stubs` | Committed stubs | Tests run without Go tooling |

## Import Rewrite

All 54 relative wailsjs imports across 38 files change to aliased form:

```ts
// Before
import { CloseChannel } from '../../wailsjs/go/main/SessionFacade'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { store } from '../../../wailsjs/go/models'

// After
import { CloseChannel } from '@wailsjs/go/main/SessionFacade'
import { EventsOn } from '@wailsjs/runtime/runtime'
import { store } from '@wailsjs/go/models'
```

This is a mechanical find-and-replace. No logic changes.

## Missing Stubs

Two modules are imported in source but lack stubs in `src/test/wailsjs-stubs/`:

### `go/main/KeysFacade.ts`

Used by: `EditHostModal`, `AddHostModal`, `GenerateKeyModal`, `DeployKeyModal`

```ts
export function BrowseKeyFile(): Promise<string> { return Promise.resolve('') }
export function GenerateSSHKey(): Promise<void> { return Promise.resolve() }
export function DeployKey(): Promise<void> { return Promise.resolve() }
export function ListDeployKeys(): Promise<unknown[]> { return Promise.resolve([]) }
export function DeleteDeployKey(): Promise<void> { return Promise.resolve() }
```

### `go/models.ts`

Used by: `SaveTemplateDialog` (`store.CreateTemplateInput.createFrom(...)`)

```ts
export const store = {
  CreateTemplateInput: {
    createFrom: (obj: Record<string, unknown>) => obj,
  },
}
```

## Config Changes

### `tsconfig.json`

Add to `compilerOptions.paths`:

```json
"@wailsjs/*": ["./wailsjs/*", "./src/test/wailsjs-stubs/*"]
```

The array order means TypeScript prefers real bindings when they exist, falls back to stubs otherwise.

### `vite.config.ts`

Add alias:

```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@wailsjs': path.resolve(__dirname, './wailsjs'),
  },
},
```

### `vitest.config.ts`

Replace the three depth-level aliases with one:

```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@wailsjs': path.resolve(__dirname, './src/test/wailsjs-stubs'),
  },
},
```

### `setup.ts`

Update all `vi.mock()` paths from relative to aliased:

```ts
vi.mock('@wailsjs/runtime/runtime', () => ({ ... }))
vi.mock('@wailsjs/go/main/SessionFacade', () => ({ ... }))
// etc.
```

## What Stays the Same

- `wailsjs/` stays gitignored — no generated code in git
- Stubs stay in `frontend/src/test/wailsjs-stubs/` — they're test infrastructure
- CI still runs `wails generate module` before `pnpm build`
- `wails dev` still generates real bindings for local development
- ESLint and Prettier configs are unchanged

## Verification

After the change:

- `pnpm test` passes (stubs via vitest alias)
- `pnpm build` passes when `wailsjs/` exists (real bindings via vite alias)
- `tsc` passes even without `wailsjs/` (falls back to stubs via tsconfig paths)
- `pnpm lint` and `pnpm format:check` pass
