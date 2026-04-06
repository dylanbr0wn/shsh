# Sidebar Panel Consistency

## Problem

The two sidebar views (Hosts and Sessions) use inconsistent structural patterns:

- **SessionList** is self-contained: it owns its scroll area, list content, and footer ("New Session" button) in one component, wrapped in an `ErrorBoundary` by `Sidebar.tsx`.
- **HostList** only owns its scroll area and header. The footer (`SidebarFooter`) is a separate component composed by `Sidebar.tsx`, with a `Separator` between them. No `ErrorBoundary`.

This makes the sidebar layout harder to reason about — the parent has to know about HostList's internal layout needs.

## Design

Unify both views to follow SessionList's self-contained pattern.

### HostList.tsx

Absorb the footer content currently in `SidebarFooter.tsx`:

- Import the atoms and hooks that `SidebarFooter` uses: `isAddHostOpenAtom`, `isImportHostsOpenAtom`, `isNewGroupOpenAtom`, `groupsAtom`, `AddGroup`
- Add a `<Separator />` after the `<ScrollArea>`
- Add the ButtonGroup footer (Add Host, Import, New Group + popover) below the separator
- The footer renders in both the empty state and the populated state

### SessionList.tsx

- Replace the `border-t border-sidebar-border` on the footer div with a `<Separator />` for visual consistency with HostList

### Sidebar.tsx

- Remove `<Separator />` and `<SidebarFooter />` from the hosts branch
- Wrap `<HostList />` in an `<ErrorBoundary>` matching the existing SessionList pattern
- Remove the `SidebarFooter` import

### SidebarFooter.tsx

- Delete the file

## Files Changed

| File | Action |
|------|--------|
| `frontend/src/components/sidebar/HostList.tsx` | Absorb footer content |
| `frontend/src/components/sidebar/SessionList.tsx` | Replace border with Separator |
| `frontend/src/components/layout/Sidebar.tsx` | Remove SidebarFooter, add ErrorBoundary |
| `frontend/src/components/sidebar/SidebarFooter.tsx` | Delete |
