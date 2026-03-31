# SFTP File Preview

**Issue:** #34
**Date:** 2026-03-29

## Summary

Preview text and image files directly from the SFTP file browser without downloading to disk. Read-only modal overlay triggered from the context menu, with syntax highlighting for code files via Shiki.

## Scope

### In scope
- Text-based file preview (plain text, config, source code, JSON, YAML, XML, Markdown, etc.)
- Common image format preview (PNG, JPG, GIF, SVG, WebP, ICO, BMP)
- Syntax highlighting via Shiki
- Size caps: 1 MB for text, 10 MB for images

### Out of scope
- Editing / save-back
- PDF, video, audio, or binary preview
- File caching or live reload
- Streaming / partial reads

## Architecture: Base64 over Wails RPC

File content travels: remote disk → SFTP read → Go memory → base64 encode → Wails RPC → frontend decode → render. This fits the existing RPC pattern used by all other SFTP operations and avoids new infrastructure (no temp files, no embedded HTTP server).

The 33% base64 overhead is acceptable given our size caps (worst case: 10 MB image → ~13 MB over RPC).

## Backend

### New method on `SessionFacade`

```go
type FilePreview struct {
    Name     string `json:"name"`
    Path     string `json:"path"`
    Size     int64  `json:"size"`
    MimeType string `json:"mimeType"`
    Content  string `json:"content"` // base64-encoded
}

func (f *SessionFacade) SFTPPreviewFile(channelId, path string) (*FilePreview, error)
```

### Behavior

1. Stat the remote file — reject if directory.
2. Classify by extension into `text` or `image` category.
3. Check size against the category's cap (1 MB text, 10 MB image). Return descriptive error if over.
4. Read file content into a buffer.
5. Base64-encode the buffer.
6. Return `FilePreview` with inferred MIME type.

### Type classification

Extension-based lookup. Two categories:

- **Text:** `.txt`, `.log`, `.conf`, `.cfg`, `.ini`, `.json`, `.yaml`, `.yml`, `.xml`, `.html`, `.css`, `.js`, `.ts`, `.go`, `.py`, `.rb`, `.rs`, `.sh`, `.bash`, `.zsh`, `.md`, `.toml`, `.env`, `.csv`, `.sql`, `.dockerfile`, and similar.
- **Image:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico`, `.bmp`.

Unrecognized extensions return an error: "Preview not supported for this file type."

### MIME detection

Use Go's `mime` package to map extensions to MIME types. Fallback to `text/plain` for recognized text extensions without a registered MIME type and `application/octet-stream` for unrecognized files (which then gets rejected).

## Frontend

### FilePreviewModal component

**Props:**
- `channelId: string`
- `filePath: string`
- `onClose: () => void`

**States:** `loading` → `ready` | `error`

**Rendering by MIME type:**
- **Text/code:** Decode base64 → UTF-8 string → Shiki-highlighted `<pre>` block. Language inferred from file extension.
- **Image:** Decode base64 → `data:` URL → `<img>` tag with `object-fit: contain`, constrained to modal viewport.

**Modal layout:**
- Header: file name, human-readable size, close button (✕)
- Body: scrollable content area (text scrolls vertically, images centered and fit-to-view)
- No footer

**Dismissal:** Close button, Escape key, backdrop click.

### Context menu integration

Add a "Preview" item to the existing context menu in `SFTPPanel.tsx`. Only shown for files (not directories) with recognized preview extensions. Clicking opens `FilePreviewModal`, which calls `SFTPPreviewFile` on mount.

### Shiki integration

- Install `shiki` as a frontend dependency.
- `useHighlighter` hook: lazily initializes Shiki on first preview, reuses the instance across subsequent previews.
- Single dark theme matching the app aesthetic (e.g., `one-dark-pro` or `github-dark`).
- Extension → Shiki language ID mapping (e.g., `.py` → `python`, `.ts` → `typescript`). Fallback to plain text.
- Grammars load lazily per language on first use.

## Error Handling

### Backend errors (surfaced as error state in modal)
- **File too large:** `"File too large to preview (X MB, max Y MB for Z files)"`
- **Unsupported type:** `"Preview not supported for .ext files"`
- **File not found / permission denied:** Pass through SFTP error message.
- **Connection lost:** SFTP client error surfaces naturally.

### Frontend edge cases
- **Binary masquerading as text:** If decoded UTF-8 string has a high ratio of replacement characters (`\uFFFD`), show "This file appears to be binary" instead of garbage.
- **Empty files:** Centered "File is empty" message.
- **SVG:** Always render as `<img src="data:...">`, never inline HTML, to prevent XSS from malicious remote SVG content.

## Limitations

- **No streaming:** Entire file is buffered in Go memory before sending. Acceptable under our size caps.
- **No caching:** Each preview triggers a fresh SFTP read. Repeated previews of the same file re-fetch.
- **Base64 overhead:** ~33% payload inflation. Worst case 13 MB for a 10 MB image.
- **Shiki bundle size:** ~2-3 MB of WASM grammars loaded on demand. Acceptable for a desktop app.
