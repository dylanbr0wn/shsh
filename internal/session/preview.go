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

var textExtensions = map[string]struct{}{
	".txt": {}, ".log": {}, ".conf": {}, ".cfg": {}, ".ini": {},
	".json": {}, ".yaml": {}, ".yml": {}, ".xml": {}, ".html": {},
	".css": {}, ".js": {}, ".ts": {}, ".go": {}, ".py": {},
	".rb": {}, ".rs": {}, ".sh": {}, ".bash": {}, ".zsh": {},
	".md": {}, ".toml": {}, ".env": {}, ".csv": {}, ".sql": {},
	".jsx": {}, ".tsx": {}, ".vue": {}, ".svelte": {}, ".java": {},
	".c": {}, ".cpp": {}, ".h": {}, ".hpp": {}, ".cs": {},
	".php": {}, ".swift": {}, ".kt": {}, ".scala": {}, ".lua": {},
	".r": {}, ".pl": {}, ".dockerfile": {}, ".makefile": {},
	".gitignore": {},
}

var imageExtensions = map[string]struct{}{
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {},
	".svg": {}, ".webp": {}, ".ico": {}, ".bmp": {},
}

func classifyExtension(ext string) fileKind {
	ext = strings.ToLower(ext)
	if _, ok := textExtensions[ext]; ok {
		return fileKindText
	}
	if _, ok := imageExtensions[ext]; ok {
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
	if _, ok := imageExtensions[ext]; ok {
		return "image/" + strings.TrimPrefix(ext, ".")
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
	kind := classifyExtension(ext)
	// Fall back to text for unknown extensions (dotfiles, extensionless configs, etc.).
	// Binary content is caught by the frontend's replacement-character check.
	if kind == fileKindUnknown {
		kind = fileKindText
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
