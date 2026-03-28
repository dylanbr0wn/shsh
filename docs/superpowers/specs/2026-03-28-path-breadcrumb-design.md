# Path Breadcrumb Component

## Context

Both `SFTPPanel` and `LocalFSPanel` have ad-hoc breadcrumb implementations (manual segment splitting + button rendering) instead of using the existing shadcn `Breadcrumb` component. Neither implementation supports collapsing for deep paths. This spec defines a shared `PathBreadcrumb` component that uses the shadcn primitives and collapses long paths into a dropdown.

## Component

**File:** `frontend/src/components/shared/PathBreadcrumb.tsx`

### Props

```typescript
interface PathBreadcrumbProps {
  path: string                        // Absolute path, e.g. "/home/user/projects/app/src"
  onNavigate: (path: string) => void  // Called with the absolute path to navigate to
  maxVisible?: number                 // Max visible segments including root (default: 5)
  className?: string
}
```

### Rendering Rules

1. Split `path` by `/`, filter empty strings to produce `segments[]`
2. Root (`/`) is always the first breadcrumb item, rendered as a `Home` icon
3. **When `segments.length + 1 <= maxVisible`:** render all segments normally
4. **When `segments.length + 1 > maxVisible`:** collapse middle segments
   - Show root (Home icon)
   - Show ellipsis dropdown containing `segments[0 .. segments.length - (maxVisible - 1))` — each item navigates to its absolute path
   - Show last `maxVisible - 1` segments
5. Last segment renders as `BreadcrumbPage` (non-clickable, `aria-current="page"`)
6. All other visible segments render as clickable `BreadcrumbLink`
7. Separators (`BreadcrumbSeparator`) between each item

### Collapse Example

```
Path: /home/user/projects/myapp/src/components
Segments: [home, user, projects, myapp, src, components] — 6 items + root = 7

maxVisible = 5, so collapse first 2 segments:

[/] > [...] > myapp > src > components
       ↑ dropdown: home → /home
                   user → /home/user
                   projects → /home/user/projects
```

### Dependencies (all existing)

- `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` from `@/components/ui/breadcrumb`
- `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `@/components/ui/dropdown-menu`
- `Home` from `lucide-react`

## Integration

### SFTPPanel.tsx

Replace lines ~368-399 (the `{/* Breadcrumb */}` section inner content) with:

```tsx
<PathBreadcrumb path={currentPath} onNavigate={listDir} />
```

The outer container `<div className="border-border flex shrink-0 items-center ...">` stays as-is in the panel.

### LocalFSPanel.tsx

Same pattern — replace the equivalent breadcrumb section with `<PathBreadcrumb>`.

## Verification

1. `cd frontend && pnpm build` — typecheck + build passes
2. `cd frontend && pnpm lint` — no lint errors
3. Manual testing with `wails dev`:
   - Navigate to a shallow path (e.g. `/home`) — all segments visible, no ellipsis
   - Navigate to a deep path (6+ segments) — ellipsis dropdown appears after root
   - Click collapsed items in dropdown — navigates correctly
   - Click visible segments — navigates correctly
   - Click root Home icon — navigates to `/`
   - Verify both SFTP and LocalFS panes work
