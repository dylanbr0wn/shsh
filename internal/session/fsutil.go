package session

import (
	"encoding/base64"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pkg/sftp"
)

// sortFSEntries sorts entries with directories first, then alphabetically by name.
func sortFSEntries(entries []FSEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})
}

// buildPreview reads a file and returns a FilePreview. The caller provides
// an opener function that returns a ReadCloser and the file size.
func buildPreview(path string, name string, size int64, open func() (io.ReadCloser, error)) (*FilePreview, error) {
	ext := strings.ToLower(filepath.Ext(name))
	kind := classifyExtension(ext)
	// Fall back to text for unknown extensions (dotfiles, extensionless configs, etc.).
	// Binary content is caught by the frontend's replacement-character check.
	if kind == fileKindUnknown {
		kind = fileKindText
	}

	limit := maxPreviewSize(kind)
	if size > limit {
		return nil, fmt.Errorf("file too large to preview (%s, max %s for %s files)",
			formatBytes(size), formatBytes(limit), kind)
	}

	f, err := open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, fmt.Errorf("reading file: %w", err)
	}

	return &FilePreview{
		Name:     name,
		Path:     path,
		Size:     size,
		MimeType: mimeForExtension(ext),
		Content:  base64.StdEncoding.EncodeToString(buf),
	}, nil
}

// withSFTPClient looks up the SFTP channel and returns its client, handling the
// common lock-and-nil-check pattern that appears in every SFTP operation.
func (m *Manager) withSFTPClient(channelID string) (*SFTPChannel, *sftp.Client, error) {
	sftpCh, err := m.getSFTPChannel(channelID)
	if err != nil {
		return nil, nil, err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return nil, nil, fmt.Errorf("sftp client closed for channel %s", channelID)
	}

	return sftpCh, sc, nil
}
