# Export/Import Hosts Design

**Issue:** #35 — feat: export/import hosts
**Date:** 2026-03-28

## Overview

Evolve the existing Import SSH Config modal into a general-purpose Import Hosts modal that supports importing from SSH config (existing), shsh JSON, shsh CSV, and Termius CSV. The export modal is already complete and unchanged by this work.

## Import Sources

| Source | Format | Auto-detect signal |
|--------|--------|--------------------|
| SSH Config | `~/.ssh/config` | N/A (separate path, auto-read) |
| shsh JSON | `{ version: 1, exportedAt, hosts }` | Top-level `version` field |
| shsh CSV | `label,hostname,port,...` headers | First header is `label` |
| Termius CSV | `Groups,Label,Tags,Hostname/IP,...` headers | First header is `Groups` |

## Data Model

### ImportCandidate

Normalized struct returned by all parsers:

```
label           string
hostname        string
port            int
username        string
authMethod      string   // password | key | agent
keyPath         string   // optional
password        string   // optional, from Termius CSV only
tags            []string
groupName       string   // optional, resolved to group ID on commit
color           string   // optional
isDuplicate     bool     // matched by hostname+port+username
duplicateHostId string   // ID of existing host if duplicate
```

### ImportPreview

```
candidates      []ImportCandidate
detectedFormat  string   // "shsh-json" | "shsh-csv" | "termius-csv"
```

## Backend API

### ToolsFacade.ParseImportFile() (ImportPreview, error)

- Opens native file dialog (Wails open dialog, filtered to `.json`/`.csv`)
- Returns empty preview if user cancels
- Reads file content, auto-detects format from content
- Parses into `[]ImportCandidate` via format-specific parser
- Checks each candidate against existing hosts via `Store.HostExists(hostname, port, username)`
- Sets `isDuplicate` and `duplicateHostId` on matches
- Returns `ImportPreview`
- No DB writes

### ToolsFacade.CommitImport(input CommitImportInput) ([]store.Host, error)

Input: `{ candidates []ImportCandidate }`

For each candidate:
1. If `groupName` is set and no matching group exists → `Store.AddGroup(name)`
2. If `isDuplicate` is true (user chose to overwrite) → `Store.UpdateHost()` using `duplicateHostId`
3. Otherwise → `Store.AddHost()`
4. Passwords (from Termius CSV) stored via existing keychain flow in `AddHost`

Returns all created/updated `Host` structs.

## Internal Package: `internal/importfile/`

### DetectFormat(content []byte) (Format, error)

- Try JSON parse → check for `version` field → `shsh-json`
- Try CSV header read → `Groups,Label,...` → `termius-csv`
- Try CSV header read → `label,hostname,...` → `shsh-csv`
- Otherwise → error: "Unrecognized file format"

### ParseJSON(content []byte) ([]ImportCandidate, error)

- Unmarshal versioned envelope
- Map each host to ImportCandidate
- `authMethod` preserved from export; defaults to `agent` if absent

### ParseCSV(content []byte) ([]ImportCandidate, error)

Handles both shsh and Termius CSV by header detection.

**shsh CSV columns:** `label, hostname, port, username, auth_method, key_path, tags, group, color`
- Tags: pipe-separated within cell
- Direct field mapping

**Termius CSV columns:** `Groups, Label, Tags, Hostname/IP, Protocol, Port, Username, Password, SSH_KEY`
- Only import rows where Protocol is `ssh` (skip others, report count)
- Password present → `authMethod: password`
- SSH_KEY present → `authMethod: key`
- Neither → `authMethod: agent`
- Tags: comma-separated in Termius format
- Groups mapped to `groupName`

## UI Flow

### Modal Evolution

`ImportSSHConfigModal` → `ImportHostsModal`

Atom rename: `isImportSSHConfigOpenAtom` → `isImportHostsOpenAtom`

### Layout

**Top:** Source toggle — **SSH Config** | **From File**

### SSH Config Path (preserved)

Existing behavior unchanged:
- Auto-reads `~/.ssh/config` on selection
- Table: checkbox, alias, host:port, user
- Select/deselect, import

### From File Path (new)

1. **"Choose File" button** → native file picker (`.json`, `.csv`)
2. Backend auto-detects format, returns `ImportPreview`
3. **Editable preview table:**
   - Columns: checkbox, label, hostname, port, username, auth method, group, tags
   - Duplicate rows: warning icon + tooltip ("Host already exists — will overwrite"), default unchecked
   - Each cell editable inline (text inputs / selects as appropriate)
   - Group column: dropdown of existing groups + new groups from file (with "(new)" badge)
4. **Footer:** badge with count of selected hosts, note about new groups to be created
5. **"Import" button** → `CommitImport(candidates)` → update `hostsAtom` → success toast

### Duplicate Handling

- Duplicates detected by hostname+port+username match
- Flagged with warning icon and tooltip
- Default unchecked — user must explicitly opt in to overwrite
- When checked, existing host is updated (not duplicated)

## Entry Points (updated)

All existing triggers renamed, no new entry points:

| Trigger | Before | After |
|---------|--------|-------|
| Command palette | "Import SSH Config" (⌘I) | "Import Hosts" (⌘I) |
| Sidebar button | "Import from SSH Config" | "Import Hosts" |
| Welcome screen | ⌘I | ⌘I (unchanged) |
| Menu event | `menu:import-ssh-config` | `menu:import-hosts` |
| Keyboard shortcut | ⌘I | ⌘I (unchanged) |

## Edge Cases

- **Malformed file:** Inline error in modal (not toast). User stays in modal to pick a different file.
- **Empty file / no hosts:** Empty state message, import button disabled.
- **Large file:** No pagination needed (host lists realistically <500). Loading spinner during parse.
- **Termius passwords:** Stored via existing keychain flow. Falls back to DB if keychain unavailable.
- **Termius non-SSH protocols:** Skipped silently, count shown in note ("2 non-SSH entries skipped").
- **Group name conflicts:** Imported group name matches existing → assign to existing group, don't create duplicate.
- **Auth method mapping:**
  - Termius CSV with password → `password`
  - Termius CSV with SSH_KEY → `key`
  - shsh JSON/CSV → preserved original `authMethod`
  - SSH config → `agent` (existing behavior)

## Out of Scope

- Encrypted Termius local database import
- Termius cloud API sync
- Import from other SSH clients (PuTTY, Royal TSX, etc.)
- Modifying the existing export modal
