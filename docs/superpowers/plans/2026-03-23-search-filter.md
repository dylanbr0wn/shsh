# Host Search / Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group-name filtering and a `tag:`/`group:` prefix query syntax to the existing host search input in the sidebar.

**Architecture:** All changes are confined to `frontend/src/components/sidebar/HostList.tsx`. A new pure `parseQuery` function splits the raw search string into structured `{ plain, tags, groups }` parts, which the existing `filteredHosts` useMemo consumes. No new files, atoms, or backend changes.

**Tech Stack:** React 19, TypeScript, Jotai, Vite. No test framework exists in the frontend — verification is via `pnpm build`, `pnpm lint`, and `pnpm format:check`.

---

## Context: What already exists

Before touching anything, read `frontend/src/components/sidebar/HostList.tsx` in full. Key things already in place:

- `searchQuery` state (line 59) and a search `<Input>` (lines 298–315)
- `filteredHosts` useMemo (lines 88–100) filters by `label`, `hostname`, `username`, `tags`
- When `isSearching`, renders a flat list with an optional group name badge (lines 319–345)
- `groups` is available at line 48 via `useAtomValue(groupsAtom)` — no new imports needed
- **Bug:** `groups` is missing from the `filteredHosts` dependency array (line 100)

The GitHub issue for this feature does not exist yet — create it before opening the PR (see Task 4).

---

## File Map

| File | Change |
|---|---|
| `frontend/src/components/sidebar/HostList.tsx` | Add `parseQuery`, update `filteredHosts` useMemo, fix dep array |

---

## Task 1: Add `parseQuery` function

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx`

Add the following pure function and its local interface directly above the `comparator` function (before line 36). Do not export either — they are file-local.

- [ ] **Step 1: Insert `ParsedQuery` interface and `parseQuery` function**

Insert this block immediately before the `function comparator` line:

```ts
interface ParsedQuery {
  plain: string
  tags: string[]
  groups: string[]
}

function parseQuery(query: string): ParsedQuery {
  const tags: string[] = []
  const groups: string[] = []
  const plainParts: string[] = []

  for (const token of query.trim().split(/\s+/)) {
    if (!token) continue
    const lower = token.toLowerCase()
    if (lower.startsWith('tag:') || lower.startsWith('tags:')) {
      const prefix = lower.startsWith('tags:') ? 'tags:' : 'tag:'
      const value = token.slice(prefix.length)
      if (value) tags.push(value.toLowerCase())
      else plainParts.push(token)
    } else if (lower.startsWith('group:') || lower.startsWith('groups:')) {
      const prefix = lower.startsWith('groups:') ? 'groups:' : 'group:'
      const value = token.slice(prefix.length)
      if (value) groups.push(value.toLowerCase())
      else plainParts.push(token)
    } else {
      plainParts.push(token.toLowerCase())
    }
  }

  return { plain: plainParts.join(' '), tags, groups }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd frontend && pnpm build 2>&1 | tail -20
```

Expected: build succeeds (exit 0). The function is not yet called so no behavior change.

---

## Task 2: Update `filteredHosts` useMemo

**Files:**
- Modify: `frontend/src/components/sidebar/HostList.tsx` (lines 88–100)

- [ ] **Step 1: Replace the `filteredHosts` useMemo**

Find the existing block (starting with `// Flat filtered list (search active)`) and replace the entire useMemo with:

```ts
// Flat filtered list (search active)
const filteredHosts = useMemo(() => {
  if (!searchQuery.trim()) return []
  const { plain, tags, groups: groupTerms } = parseQuery(searchQuery)

  return [...hosts]
    .filter((h) => {
      const groupName = h.groupId
        ? (groups.find((g) => g.id === h.groupId)?.name ?? '').toLowerCase()
        : ''

      // group: tokens — all must match (AND); host with no/unresolvable group never matches
      if (groupTerms.length > 0) {
        if (!groupName) return false
        if (!groupTerms.every((term) => groupName.includes(term))) return false
      }

      // tag: tokens — all must match (AND); host with no tags never matches
      if (tags.length > 0) {
        const hostTags = h.tags?.map((t) => t.toLowerCase()) ?? []
        if (hostTags.length === 0) return false
        if (!tags.every((term) => hostTags.some((ht) => ht.includes(term)))) return false
      }

      // plain text — OR across all fields
      if (plain) {
        const matches =
          h.label.toLowerCase().includes(plain) ||
          h.hostname.toLowerCase().includes(plain) ||
          h.username.toLowerCase().includes(plain) ||
          (h.tags?.some((t) => t.toLowerCase().includes(plain)) ?? false) ||
          groupName.includes(plain)
        if (!matches) return false
      }

      return true
    })
    .sort(comparator(sortMode))
}, [hosts, groups, searchQuery, sortMode])
```

Key changes from the original:
- Uses `parseQuery` to split the query
- Adds group name lookup and group-term matching
- Adds `groups` to the dependency array (fixes the latent bug)
- Adds group name to plain-text matching

- [ ] **Step 2: Verify the build**

```bash
cd frontend && pnpm build 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 3: Verify lint passes**

```bash
cd frontend && pnpm lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Verify formatting**

```bash
cd frontend && pnpm format:check 2>&1 | tail -20
```

If formatting issues are reported, run:

```bash
cd frontend && pnpm format
```

Then re-run `pnpm format:check` to confirm clean.

---

## Task 3: Manual smoke test

Start the dev server and verify behavior in the UI before committing.

- [ ] **Step 1: Start dev server**

```bash
wails dev
```

- [ ] **Step 2: Verify plain search still works**

Type a partial hostname or label into the search box. Confirm matching hosts appear and non-matching hosts disappear.

- [ ] **Step 3: Verify group name search**

Type the name of a group (or a partial substring). Confirm that hosts in that group appear. Confirm hosts in other groups do not appear.

- [ ] **Step 4: Verify `group:` prefix**

Type `group:<partial-group-name>`. Confirm only hosts in matching groups appear.

- [ ] **Step 5: Verify `tag:` prefix**

Type `tag:<some-tag-value>`. Confirm only hosts with that tag appear.

- [ ] **Step 6: Verify combined query**

Type `group:prod tag:linux`. Confirm only hosts in a "prod" group AND with a "linux" tag appear.

- [ ] **Step 7: Verify empty-prefix edge case**

Type `group:` (no value after the colon). Confirm it does NOT match all hosts — the token should be treated as plain text and produce no results unless a host name/hostname/etc. contains the literal text "group:".

- [ ] **Step 8: Stop dev server** (`Ctrl+C`)

---

## Task 4: Create GitHub issue and commit

- [ ] **Step 1: Create the GitHub issue and capture the number**

Run from the repo root (`/Users/dylan/.superset/worktrees/shsh/feat/search-filter`):

```bash
ISSUE_URL=$(gh issue create \
  --repo dylanbr0wn/shsh \
  --title "feat: host search with group/tag prefix syntax" \
  --body "$(cat <<'EOF'
## Summary

Add group name as a searchable field and introduce prefix query syntax to the sidebar host search.

**Prefix syntax:**
- \`group:<name>\` — filter hosts whose group name contains the value
- \`groups:<name>\` — synonym for \`group:\`
- \`tag:<value>\` — filter hosts with a matching tag
- \`tags:<value>\` — synonym for \`tag:\`
- Plain text — matches label, hostname, username, tags, or group name (existing behavior + group name)

**Also fixes:** \`groups\` missing from \`filteredHosts\` dependency array (group renames didn't update search results).
EOF
)")
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -o '[0-9]*$')
echo "Issue: $ISSUE_NUMBER"
```

Confirm the printed number before proceeding.

- [ ] **Step 2: Stage and commit**

Run from the repo root (`/Users/dylan/.superset/worktrees/shsh/feat/search-filter`):

```bash
git add frontend/src/components/sidebar/HostList.tsx
git commit -m "$(cat <<EOF
feat(sidebar): add group name search and tag:/group: prefix syntax

Plain text search now also matches group names. Prefix tokens let users
narrow results to a specific group or tag. Fixes latent bug where renaming
a group did not update live search results (groups was absent from the
filteredHosts dep array).

Closes #${ISSUE_NUMBER}
EOF
)"
```

---

## Task 5: Pre-PR checklist

Run all checks from the root of the repo before opening the PR.

- [ ] **Step 1: Go tests**

```bash
go test ./...
```

Expected: all pass (no Go changes, this is a sanity check).

- [ ] **Step 2: Frontend build**

```bash
cd frontend && pnpm build
```

Expected: exit 0.

- [ ] **Step 3: Lint**

```bash
cd frontend && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Format check**

```bash
cd frontend && pnpm format:check
```

Expected: no issues.

- [ ] **Step 5: Open PR**

`ISSUE_NUMBER` must be set from Task 4 Step 1. Run from the repo root:

```bash
gh pr create \
  --repo dylanbr0wn/shsh \
  --title "feat(sidebar): group name search and tag:/group: prefix syntax" \
  --body "$(cat <<EOF
## Summary

- Plain search now matches group names in addition to label/hostname/username/tags
- New prefix syntax: `group:<name>`, `tag:<value>` (and plural forms as synonyms)
- Multiple prefix tokens of the same type are AND'd
- Fixes latent bug: `groups` was missing from `filteredHosts` dep array — renaming a group didn't update live search results

## Changes

Single file: `frontend/src/components/sidebar/HostList.tsx`
- Added `parseQuery` (file-local pure function)
- Updated `filteredHosts` useMemo

## Test plan

- [ ] Plain text search matches label, hostname, username, tags, group name
- [ ] `group:prod` shows only hosts in groups containing "prod"
- [ ] `tag:linux` shows only hosts with a "linux" tag
- [ ] `group:prod tag:linux` shows hosts matching both conditions
- [ ] `group:` (empty value) does not vacuously match all hosts
- [ ] Renaming a group updates search results immediately
- [ ] `pnpm build`, `pnpm lint`, `pnpm format:check` all pass

Closes #${ISSUE_NUMBER}
EOF
)"
```
