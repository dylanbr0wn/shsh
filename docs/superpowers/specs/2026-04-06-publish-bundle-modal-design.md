# Publish Bundle Modal

Adds a UI for pushing host bundles to a connected registry. The backend `PushBundle` Wails binding already exists — this work is frontend-only.

## Entry Points

Three ways to open the modal:

1. **Host context menu / dropdown** — "Publish to Registry..." item in `HostListItem`. Opens the modal with that single host pre-selected.
2. **Group context menu / dropdown** — "Publish to Registry..." item in `HostGroupSection`. Opens the modal with all local hosts in that group pre-selected.
3. **Command palette** — "Publish to Registry" action. Opens the modal with nothing pre-selected.

## Modal Layout

Single-pane stacked dialog (`sm:max-w-lg`), matching the ExportHostsModal pattern.

### Top section — metadata form

2-column grid with four required fields:

| Field | Component | Notes |
|-------|-----------|-------|
| Registry | `Select` dropdown | Populated from `GetRegistries()` |
| Namespace | `Input` | Free text; server validates against API key scope |
| Bundle Name | `Input` | e.g. `prod-servers` |
| Tag | `Input` | e.g. `v1`, `latest` |

### Bottom section — host/group picker

Separated from the form by a `FieldSeparator`. A scrollable grouped checkbox tree:

- **Group rows** — checkbox + group name + host count badge. Checking a group toggles all its children. Indeterminate state when partially selected.
- **Host rows** — indented under their group. Checkbox + label + `hostname:port` secondary text.
- **Ungrouped section** — hosts with no group, shown under an "Ungrouped" header.
- **Filter** — only local hosts (`origin === "local"`) are shown. Registry-imported hosts are excluded to prevent re-publishing.
- **Header** — "Select all" checkbox with "N of M selected" counter.

### Footer

`DialogFooter` with:
- Cancel button (outline)
- "Publish N hosts" primary button — disabled until a registry is selected and at least one host is checked. Shows the live count.

## State Management

New atom in `store/atoms.ts`:

```ts
export const publishBundleAtom = atom<{ open: boolean; preSelectedHostIds: string[] }>({
  open: false,
  preSelectedHostIds: [],
})
```

Context menu handlers write `{ open: true, preSelectedHostIds: [...] }` to this atom. The modal reads it on open, seeds `selectedHostIds` from `preSelectedHostIds`, and resets everything on close.

## Submission Flow

1. Validate: all four text fields non-empty, at least one host selected.
2. Call `PushBundle({ registryName, namespace, name, tag, hostIds: [...selectedHostIds] })`.
3. Success: `toast.success("Published N hosts to namespace/bundle-name")`, close modal.
4. Error: `toast.error("Failed to publish", { description: errorMessage })`.

## Credentials

The backend (`registry_facade.go:PushBundle`) strips all sensitive data before sending to the registry server. The frontend does not need to handle credential filtering.

## Files

| File | Change |
|------|--------|
| `frontend/src/components/modals/PublishBundleModal.tsx` | **New** — the modal component |
| `frontend/src/store/atoms.ts` | Add `publishBundleAtom` |
| `frontend/src/components/sidebar/HostListItem.tsx` | Add "Publish to Registry..." to context menu and dropdown |
| `frontend/src/components/sidebar/HostGroupSection.tsx` | Add "Publish to Registry..." to context menu and dropdown |
| `frontend/src/components/CommandPalette.tsx` | Add "Publish to Registry" action |
| `frontend/src/App.tsx` | Mount `<PublishBundleModal />` |

No backend changes required.
