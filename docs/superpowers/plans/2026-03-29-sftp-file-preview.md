# SFTP File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview text and image files from remote SFTP servers in a read-only modal, without downloading to disk.

**Architecture:** New `SFTPPreviewFile` Go method reads remote file content (capped at 1 MB text / 10 MB image), base64-encodes it, and returns it over Wails RPC. Frontend renders text with Shiki syntax highlighting or images as `data:` URLs in a `Dialog` modal triggered from the SFTP panel context menu.

**Tech Stack:** Go `mime` package, `encoding/base64`; React `Dialog` (Radix UI), `shiki` for syntax highlighting.

---

### Task 1: Backend — File type classification and preview method

**Files:**
- Create: `internal/session/preview.go`
- Modify: `session_facade.go:241-297` (add facade method)
- Modify: `internal/session/session.go:44-52` (add FilePreview type)

- [ ] **Step 1: Write the failing test for text file preview**

Create `internal/session/preview_test.go`:

```go
package session

import (
	"encoding/base64"
	"testing"
)

func TestClassifyFile_TextExtensions(t *testing.T) {
	textExts := []string{
		".txt", ".log", ".conf", ".cfg", ".ini", ".json", ".yaml", ".yml",
		".xml", ".html", ".css", ".js", ".ts", ".go", ".py", ".rb", ".rs",
		".sh", ".bash", ".zsh", ".md", ".toml", ".env", ".csv", ".sql",
		".jsx", ".tsx", ".vue", ".svelte", ".java", ".c", ".cpp", ".h",
		".hpp", ".cs", ".php", ".swift", ".kt", ".scala", ".lua", ".r",
		".pl", ".dockerfile", ".makefile", ".gitignore",
	}
	for _, ext := range textExts {
		cat := classifyExtension(ext)
		if cat != fileKindText {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindText)
		}
	}
}

func TestClassifyFile_ImageExtensions(t *testing.T) {
	imageExts := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"}
	for _, ext := range imageExts {
		cat := classifyExtension(ext)
		if cat != fileKindImage {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindImage)
		}
	}
}

func TestClassifyFile_Unknown(t *testing.T) {
	unknownExts := []string{".exe", ".zip", ".pdf", ".mp4", ".bin", ""}
	for _, ext := range unknownExts {
		cat := classifyExtension(ext)
		if cat != fileKindUnknown {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindUnknown)
		}
	}
}

func TestSizeLimit(t *testing.T) {
	if maxPreviewSize(fileKindText) != 1<<20 {
		t.Errorf("text limit = %d, want %d", maxPreviewSize(fileKindText), 1<<20)
	}
	if maxPreviewSize(fileKindImage) != 10<<20 {
		t.Errorf("image limit = %d, want %d", maxPreviewSize(fileKindImage), 10<<20)
	}
}

func TestMimeForExtension(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{".json", "application/json"},
		{".html", "text/html"},
		{".png", "image/png"},
		{".jpg", "image/jpeg"},
		{".svg", "image/svg+xml"},
		{".txt", "text/plain"},
		{".go", "text/plain"},   // no registered MIME, fallback
		{".yaml", "text/plain"}, // no registered MIME, fallback
	}
	for _, tt := range tests {
		got := mimeForExtension(tt.ext)
		if got != tt.want {
			t.Errorf("mimeForExtension(%q) = %q, want %q", tt.ext, got, tt.want)
		}
	}
}

// TestBase64Encode verifies our encoding matches standard base64.
func TestBase64Encode(t *testing.T) {
	input := []byte("hello world")
	got := base64.StdEncoding.EncodeToString(input)
	want := "aGVsbG8gd29ybGQ="
	if got != want {
		t.Errorf("base64 encode = %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && go test ./internal/session/... -run "TestClassifyFile|TestSizeLimit|TestMimeForExtension|TestBase64Encode" -v`
Expected: compilation errors — `classifyExtension`, `fileKindText`, etc. are undefined.

- [ ] **Step 3: Add FilePreview type to session.go**

Add after `SFTPProgressEvent` (after line 59) in `internal/session/session.go`:

```go
// FilePreview holds the content and metadata for an in-app file preview.
type FilePreview struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
	Content  string `json:"content"` // base64-encoded
}
```

- [ ] **Step 4: Implement preview.go with classification, MIME, and size limits**

Create `internal/session/preview.go`:

```go
package session

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"
)

type fileKind string

const (
	fileKindText    fileKind = "text"
	fileKindImage   fileKind = "image"
	fileKindUnknown fileKind = "unknown"
)

var textExtensions = map[string]bool{
	".txt": true, ".log": true, ".conf": true, ".cfg": true, ".ini": true,
	".json": true, ".yaml": true, ".yml": true, ".xml": true, ".html": true,
	".css": true, ".js": true, ".ts": true, ".go": true, ".py": true,
	".rb": true, ".rs": true, ".sh": true, ".bash": true, ".zsh": true,
	".md": true, ".toml": true, ".env": true, ".csv": true, ".sql": true,
	".jsx": true, ".tsx": true, ".vue": true, ".svelte": true, ".java": true,
	".c": true, ".cpp": true, ".h": true, ".hpp": true, ".cs": true,
	".php": true, ".swift": true, ".kt": true, ".scala": true, ".lua": true,
	".r": true, ".pl": true, ".dockerfile": true, ".makefile": true,
	".gitignore": true,
}

var imageExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".svg": true, ".webp": true, ".ico": true, ".bmp": true,
}

func classifyExtension(ext string) fileKind {
	ext = strings.ToLower(ext)
	if textExtensions[ext] {
		return fileKindText
	}
	if imageExtensions[ext] {
		return fileKindImage
	}
	return fileKindUnknown
}

func maxPreviewSize(kind fileKind) int64 {
	switch kind {
	case fileKindText:
		return 1 << 20 // 1 MB
	case fileKindImage:
		return 10 << 20 // 10 MB
	default:
		return 0
	}
}

func mimeForExtension(ext string) string {
	ext = strings.ToLower(ext)
	mt := mime.TypeByExtension(ext)
	if mt != "" {
		// Strip parameters (e.g., "text/plain; charset=utf-8" -> "text/plain")
		if idx := strings.Index(mt, ";"); idx != -1 {
			mt = strings.TrimSpace(mt[:idx])
		}
		return mt
	}
	if imageExtensions[ext] {
		return "application/octet-stream"
	}
	return "text/plain"
}

func formatBytes(b int64) string {
	const (
		kb = 1024
		mb = kb * 1024
	)
	switch {
	case b >= mb:
		return fmt.Sprintf("%.1f MB", float64(b)/float64(mb))
	case b >= kb:
		return fmt.Sprintf("%.1f KB", float64(b)/float64(kb))
	default:
		return fmt.Sprintf("%d B", b)
	}
}

// SFTPPreviewFile reads a remote file for in-app preview.
func (m *Manager) SFTPPreviewFile(channelId string, path string) (*FilePreview, error) {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return nil, err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return nil, fmt.Errorf("sftp client closed for channel %s", channelId)
	}

	info, err := sc.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("cannot preview a directory")
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	// Handle extensionless files by checking the full lowercase name
	if ext == "" {
		lowerName := strings.ToLower(info.Name())
		switch {
		case lowerName == "dockerfile":
			ext = ".dockerfile"
		case lowerName == "makefile":
			ext = ".makefile"
		case lowerName == ".gitignore":
			ext = ".gitignore"
		}
	}

	kind := classifyExtension(ext)
	if kind == fileKindUnknown {
		return nil, fmt.Errorf("preview not supported for %q files", ext)
	}

	limit := maxPreviewSize(kind)
	if info.Size() > limit {
		return nil, fmt.Errorf("file too large to preview (%s, max %s for %s files)",
			formatBytes(info.Size()), formatBytes(limit), kind)
	}

	f, err := sc.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, fmt.Errorf("reading file: %w", err)
	}

	m.emitDebug("sftp", "debug", channelId, m.connLabel(sftpCh.connectionID),
		"preview file", map[string]any{"path": path, "size": len(buf), "kind": string(kind)})

	return &FilePreview{
		Name:     info.Name(),
		Path:     path,
		Size:     info.Size(),
		MimeType: mimeForExtension(ext),
		Content:  base64.StdEncoding.EncodeToString(buf),
	}, nil
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && go test ./internal/session/... -run "TestClassifyFile|TestSizeLimit|TestMimeForExtension|TestBase64Encode" -v`
Expected: all PASS.

- [ ] **Step 6: Add facade method**

Add after `SFTPRename` (after line 292) in `session_facade.go`:

```go
func (f *SessionFacade) SFTPPreviewFile(channelID string, path string) (*session.FilePreview, error) {
	return f.d.Manager.SFTPPreviewFile(channelID, path)
}
```

- [ ] **Step 7: Verify Go compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && go build ./...`
Expected: no errors.

- [ ] **Step 8: Regenerate Wails bindings**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && wails generate module`
Expected: `frontend/wailsjs/go/main/SessionFacade.js` now includes `SFTPPreviewFile`.

- [ ] **Step 9: Commit**

```bash
git add internal/session/preview.go internal/session/preview_test.go internal/session/session.go session_facade.go
git commit -m "feat(sftp): add SFTPPreviewFile backend with type classification

Reads remote files up to 1 MB (text) / 10 MB (image), base64-encodes
content, returns with MIME type. Extension-based classification for
text and common image formats.

Closes #34 (backend)"
```

---

### Task 2: Frontend — Install Shiki and create useHighlighter hook

**Files:**
- Modify: `frontend/package.json` (add shiki dependency)
- Create: `frontend/src/hooks/useHighlighter.ts`

- [ ] **Step 1: Install shiki**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm add shiki`

- [ ] **Step 2: Create the extension-to-language mapping and hook**

Create `frontend/src/hooks/useHighlighter.ts`:

```typescript
import { useRef, useCallback, useState } from 'react'
import type { BundledLanguage, Highlighter } from 'shiki'

const EXT_TO_LANG: Record<string, BundledLanguage> = {
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.go': 'go',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.md': 'markdown',
  '.toml': 'toml',
  '.sql': 'sql',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dockerfile': 'dockerfile',
  '.csv': 'csv',
  '.ini': 'ini',
  '.conf': 'ini',
  '.cfg': 'ini',
  '.env': 'shellscript',
  '.makefile': 'makefile',
}

function langFromPath(filePath: string): BundledLanguage {
  const name = filePath.split('/').pop() ?? ''
  const lowerName = name.toLowerCase()

  // Handle extensionless files
  if (lowerName === 'dockerfile') return 'dockerfile'
  if (lowerName === 'makefile') return 'makefile'

  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'text'
  const ext = name.slice(dot).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'text'
}

export function useHighlighter() {
  const highlighterRef = useRef<Highlighter | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const highlight = useCallback(async (code: string, filePath: string): Promise<string> => {
    setIsLoading(true)
    try {
      const lang = langFromPath(filePath)

      if (!highlighterRef.current) {
        const { createHighlighter } = await import('shiki')
        highlighterRef.current = await createHighlighter({
          themes: ['github-dark'],
          langs: [lang],
        })
      }

      const loadedLangs = highlighterRef.current.getLoadedLanguages()
      if (!loadedLangs.includes(lang)) {
        await highlighterRef.current.loadLanguage(lang)
      }

      return highlighterRef.current.codeToHtml(code, {
        lang,
        theme: 'github-dark',
      })
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { highlight, isLoading }
}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/hooks/useHighlighter.ts
git commit -m "feat(ui): add Shiki highlighter hook for file preview

Lazy-loads Shiki on first preview. Maps file extensions to language
IDs, loads grammars on demand, reuses the highlighter instance."
```

---

### Task 3: Frontend — FilePreviewModal component

**Files:**
- Create: `frontend/src/components/sftp/FilePreviewModal.tsx`

- [ ] **Step 1: Create the FilePreviewModal component**

Create `frontend/src/components/sftp/FilePreviewModal.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from '../ui/dialog'
import { Skeleton } from '../ui/skeleton'
import { SFTPPreviewFile } from '@wailsjs/go/main/SessionFacade'
import { useHighlighter } from '../../hooks/useHighlighter'

interface Props {
  channelId: string
  filePath: string
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function hasHighReplacementRatio(text: string): boolean {
  if (text.length === 0) return false
  let count = 0
  for (const ch of text) {
    if (ch === '\uFFFD') count++
  }
  return count / text.length > 0.1
}

export function FilePreviewModal({ channelId, filePath, onClose }: Props) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; name: string; size: number; mimeType: string; content: string; html?: string }
  >({ status: 'loading' })

  const { highlight, isLoading: isHighlighting } = useHighlighter()

  const load = useCallback(async () => {
    try {
      const preview = await SFTPPreviewFile(channelId, filePath)
      const isImage = preview.mimeType.startsWith('image/')
      const raw = isImage ? '' : atob(preview.content)

      if (!isImage && hasHighReplacementRatio(raw)) {
        setState({ status: 'error', message: 'This file appears to be binary.' })
        return
      }

      if (!isImage && raw.length === 0) {
        setState({
          status: 'ready',
          name: preview.name,
          size: preview.size,
          mimeType: preview.mimeType,
          content: preview.content,
        })
        return
      }

      if (isImage) {
        setState({
          status: 'ready',
          name: preview.name,
          size: preview.size,
          mimeType: preview.mimeType,
          content: preview.content,
        })
        return
      }

      // Text file — highlight
      const html = await highlight(raw, filePath)
      setState({
        status: 'ready',
        name: preview.name,
        size: preview.size,
        mimeType: preview.mimeType,
        content: preview.content,
        html,
      })
    } catch (err) {
      setState({ status: 'error', message: String(err) })
    }
  }, [channelId, filePath, highlight])

  useEffect(() => {
    load()
  }, [load])

  const isImage = state.status === 'ready' && state.mimeType.startsWith('image/')
  const isEmpty = state.status === 'ready' && !isImage && state.size === 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="truncate">
            {state.status === 'ready' ? state.name : filePath.split('/').pop()}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'ready' ? formatSize(state.size) : 'Loading...'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {(state.status === 'loading' || isHighlighting) && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="text-destructive py-8 text-center text-sm">
              {state.message}
            </div>
          )}

          {isEmpty && (
            <div className="text-muted-foreground py-8 text-center text-sm">
              File is empty
            </div>
          )}

          {state.status === 'ready' && isImage && (
            <div className="flex items-center justify-center py-4">
              <img
                src={`data:${state.mimeType};base64,${state.content}`}
                alt={state.name}
                className="max-h-[65vh] max-w-full rounded object-contain"
              />
            </div>
          )}

          {state.status === 'ready' && !isImage && !isEmpty && state.html && (
            <div
              className="overflow-x-auto rounded text-sm [&>pre]:p-4"
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sftp/FilePreviewModal.tsx
git commit -m "feat(ui): add FilePreviewModal for SFTP file preview

Modal renders text with Shiki syntax highlighting or images as
data URLs. Handles loading, error, empty, and binary-detection
states. Dismissed via close button, Escape, or backdrop click."
```

---

### Task 4: Frontend — Integrate preview into SFTPPanel context menu

**Files:**
- Modify: `frontend/src/components/sftp/SFTPPanel.tsx:1-615`

- [ ] **Step 1: Add previewable extension check**

Add a helper function near the top of `SFTPPanel.tsx` (after the `DEFAULT_SFTP_STATE` constant, around line 49):

```typescript
const PREVIEWABLE_EXTENSIONS = new Set([
  // Text
  '.txt', '.log', '.conf', '.cfg', '.ini', '.json', '.yaml', '.yml',
  '.xml', '.html', '.css', '.js', '.ts', '.go', '.py', '.rb', '.rs',
  '.sh', '.bash', '.zsh', '.md', '.toml', '.env', '.csv', '.sql',
  '.jsx', '.tsx', '.vue', '.svelte', '.java', '.c', '.cpp', '.h',
  '.hpp', '.cs', '.php', '.swift', '.kt', '.scala', '.lua', '.r',
  '.pl', '.dockerfile', '.makefile', '.gitignore',
  // Image
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
])

function isPreviewable(entry: SFTPEntry): boolean {
  if (entry.isDir) return false
  const name = entry.name.toLowerCase()
  // Extensionless files
  if (name === 'dockerfile' || name === 'makefile' || name === '.gitignore') return true
  const dot = entry.name.lastIndexOf('.')
  if (dot === -1) return false
  return PREVIEWABLE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())
}
```

- [ ] **Step 2: Add preview state and import FilePreviewModal**

Add import at the top of `SFTPPanel.tsx`:

```typescript
import { FilePreviewModal } from './FilePreviewModal'
```

Add a new state variable inside the `SFTPPanel` component (after the `draggedEntryRef` line, around line 69):

```typescript
const [previewPath, setPreviewPath] = useState<string | null>(null)
```

- [ ] **Step 3: Add "Preview" context menu item**

In the `<ContextMenuContent>` section (around line 476), add the Preview item before Download:

```tsx
<ContextMenuContent>
  {isPreviewable(entry) && (
    <ContextMenuItem onSelect={() => setPreviewPath(entry.path)}>
      Preview
    </ContextMenuItem>
  )}
  <ContextMenuItem
    onSelect={() => {
      const fn = entry.isDir ? SFTPDownloadDir : SFTPDownload
      fn(channelId, entry.path).catch((err) => toast.error(String(err)))
    }}
  >
    Download
  </ContextMenuItem>
```

- [ ] **Step 4: Render the FilePreviewModal**

Add after the existing `<Dialog>` block (after the closing `</Dialog>` around line 612), before the component's closing tags:

```tsx
{previewPath && (
  <FilePreviewModal
    channelId={channelId}
    filePath={previewPath}
    onClose={() => setPreviewPath(null)}
  />
)}
```

- [ ] **Step 5: Verify frontend compiles and lint passes**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm build && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Run format check and fix if needed**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm format:check`
If it fails: `pnpm format`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/sftp/SFTPPanel.tsx
git commit -m "feat(ui): add Preview context menu item in SFTP panel

Shows Preview option for text and image files in the right-click
menu. Opens FilePreviewModal which fetches and renders the file
content.

Closes #34"
```

---

### Task 5: Verification — End-to-end check

**Files:** None (verification only)

- [ ] **Step 1: Run all Go tests**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && go test ./internal/... -race -timeout 60s`
Expected: all PASS.

- [ ] **Step 2: Run Go vet**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && go vet ./internal/...`
Expected: no issues.

- [ ] **Step 3: Run full frontend checks**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview/frontend && pnpm build && pnpm lint && pnpm format:check`
Expected: all pass.

- [ ] **Step 4: Verify Wails bindings include the new method**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && grep -l "SFTPPreviewFile" frontend/wailsjs/go/main/SessionFacade.js`
Expected: file found with the method exported.

- [ ] **Step 5: Run govulncheck**

Run: `cd /Users/dylan/.superset/worktrees/shsh/feat/file-preview && govulncheck ./...`
Expected: no vulnerabilities.
