# Host Search / Filter — Design Spec

**Date:** 2026-03-23
**Branch:** feat/search-filter
**Status:** Approved

---

## Overview

The sidebar already has a search input that filters hosts by label, hostname, username, and tags. This spec completes the feature by:

1. Adding group name as a searchable field
2. Introducing a prefix-based query syntax (`group:`, `tag:`) for targeted filtering
3. Fixing a latent bug where `groups` was missing from the `filteredHosts` dependency array

---

## Scope

**Single file changed:** `frontend/src/components/sidebar/HostList.tsx`

No new components, atoms, backend changes, or additional files required.

---

## Query Parser

A pure `parseQuery(query: string)` function is added to `HostList.tsx`.

### Output type

```ts
interface ParsedQuery {
  plain: string      // text left after extracting prefixed tokens
  tags: string[]     // values from tag:/tags: tokens
  groups: string[]   // values from group:/groups: tokens
}
```

### Parsing rules

- Tokens matching `tag:value`, `tags:value`, `group:value`, `groups:value` are extracted from the query string
- The remainder (whitespace-trimmed) becomes `plain`
- All comparisons are case-insensitive substring matches
- `tag:` and `tags:` are synonyms; `group:` and `groups:` are synonyms

### Examples

| Input | `plain` | `tags` | `groups` |
|---|---|---|---|
| `web` | `"web"` | `[]` | `[]` |
| `group:prod` | `""` | `[]` | `["prod"]` |
| `tag:linux` | `""` | `["linux"]` | `[]` |
| `web group:prod tag:linux` | `"web"` | `["linux"]` | `["prod"]` |
| `group:prod tag:linux tag:db` | `""` | `["linux", "db"]` | `["prod"]` |

---

## Filtering Logic

The existing `filteredHosts` useMemo is updated to use the parsed query. A host passes the filter when **all present conditions** are satisfied:

1. **`groups` tokens** — host's group name must contain every group term (AND). A host with no group never matches a `group:` term.
2. **`tags` tokens** — host must have at least one tag containing each tag term (AND). A host with no tags never matches a `tag:` term.
3. **`plain` text** — must match any of: `label`, `hostname`, `username`, `tags` (any tag), or group name (OR).

If a condition has no tokens (empty array / empty string), it is skipped.

Results are sorted by the current `sortMode` (A–Z, Z–A, or Recent).

### Dependency fix

`groups` is added to the `filteredHosts` dependency array. Currently absent, this means renaming a group does not update live search results — a latent bug this change resolves.

---

## UI

No UI changes. The existing search input, clear button (`X`), flat result list, and group badge rendering are correct as-is.

---

## What is not in scope

- Negation syntax (`-tag:deprecated`)
- Exact-match quoting (`tag:"my tag"`)
- OR operators between terms
- Keyboard shortcut to focus the search input
- Highlighted match text in results

These may be addressed in follow-up issues.

---

## Files changed

| File | Change |
|---|---|
| `frontend/src/components/sidebar/HostList.tsx` | Add `parseQuery`, update `filteredHosts` useMemo, add `groups` to dep array |
