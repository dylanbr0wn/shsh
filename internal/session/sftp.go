package session

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// OpenSFTP opens an SFTP subsystem on an existing SSH session.
func (m *Manager) OpenSFTP(sessionID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	defer sess.sftpMu.Unlock()

	if sess.sftpClient != nil {
		return nil
	}

	sc, err := sftp.NewClient(sess.client.Client)
	if err != nil {
		return fmt.Errorf("sftp negotiation failed: %w", err)
	}
	sess.sftpClient = sc
	return nil
}

// CloseSFTP closes the SFTP subsystem for a session.
func (m *Manager) CloseSFTP(sessionID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}

	sess.sftpMu.Lock()
	defer sess.sftpMu.Unlock()

	if sess.sftpClient != nil {
		sess.sftpClient.Close()
		sess.sftpClient = nil
	}
	return nil
}

// SFTPListDir lists entries in the given remote directory, dirs first then files.
func (m *Manager) SFTPListDir(sessionID string, path string) ([]SFTPEntry, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()

	if sc == nil {
		return nil, fmt.Errorf("sftp not open for session %s", sessionID)
	}

	if path == "~" {
		home, err := sc.Getwd()
		if err != nil {
			home = "/"
		}
		path = home
	}

	infos, err := sc.ReadDir(path)
	if err != nil {
		return nil, err
	}

	entries := make([]SFTPEntry, 0, len(infos))
	for _, fi := range infos {
		fullPath := path + "/" + fi.Name()
		entries = append(entries, SFTPEntry{
			Name:    fi.Name(),
			Path:    fullPath,
			IsDir:   fi.IsDir(),
			Size:    fi.Size(),
			ModTime: fi.ModTime().UTC().Format(time.RFC3339),
			Mode:    fi.Mode().String(),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})

	return entries, nil
}

// SFTPDownload opens a save dialog and downloads the remote file to the chosen path.
func (m *Manager) SFTPDownload(sessionID string, remotePath string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	localPath, err := runtime.SaveFileDialog(m.ctx, runtime.SaveDialogOptions{
		DefaultFilename: filepath.Base(remotePath),
		Title:           "Save file",
	})
	if err != nil || localPath == "" {
		return nil
	}

	remoteFile, err := sc.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	stat, _ := remoteFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	buf := make([]byte, 32*1024)
	var written int64
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localFile.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(m.ctx, "sftp:progress:"+sessionID, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

// SFTPDownloadDir tars a remote directory, downloads it, and unpacks it locally.
func (m *Manager) SFTPDownloadDir(sessionID string, remotePath string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	localDir, err := runtime.OpenDirectoryDialog(m.ctx, runtime.OpenDialogOptions{
		Title: "Save folder to",
	})
	if err != nil || localDir == "" {
		return nil
	}

	dirName := filepath.Base(remotePath)
	parentDir := filepath.Dir(remotePath)
	tempRemote := fmt.Sprintf("/tmp/shsh_%s.tar.gz", uuid.New().String())
	tarCmd := fmt.Sprintf("tar czf %s -C %s %s", tempRemote, parentDir, dirName)
	if _, err := sess.client.Run(tarCmd); err != nil {
		return fmt.Errorf("tar failed (is tar installed on remote?): %w", err)
	}

	remoteFile, err := sc.Open(tempRemote)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	stat, _ := remoteFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	localTmp, err := os.CreateTemp("", "shsh-*.tar.gz")
	if err != nil {
		return err
	}
	localTmpPath := localTmp.Name()
	defer os.Remove(localTmpPath)

	buf := make([]byte, 32*1024)
	var written int64
	eventKey := "sftp:progress:" + sessionID
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localTmp.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(m.ctx, eventKey, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				localTmp.Close()
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			localTmp.Close()
			return rerr
		}
	}
	localTmp.Close()

	sess.client.Run("rm " + tempRemote) //nolint:errcheck

	return extractTarGz(localTmpPath, localDir)
}

// SFTPUpload opens a file picker and uploads the chosen file to remoteDir.
func (m *Manager) SFTPUpload(sessionID string, remoteDir string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	localPath, err := runtime.OpenFileDialog(m.ctx, runtime.OpenDialogOptions{
		Title: "Upload file",
	})
	if err != nil || localPath == "" {
		return nil
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	stat, _ := localFile.Stat()
	var total int64
	if stat != nil {
		total = stat.Size()
	}

	remotePath := remoteDir + "/" + filepath.Base(localPath)
	remoteFile, err := sc.Create(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	buf := make([]byte, 32*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			runtime.EventsEmit(m.ctx, "sftp:progress:"+sessionID, SFTPProgressEvent{
				Path:  remotePath,
				Bytes: written,
				Total: total,
			})
			if werr != nil {
				return werr
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

// SFTPMkdir creates a directory at the given remote path.
func (m *Manager) SFTPMkdir(sessionID string, path string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	return sc.Mkdir(path)
}

// SFTPDelete removes a file or directory at the given remote path.
func (m *Manager) SFTPDelete(sessionID string, path string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	fi, err := sc.Stat(path)
	if err != nil {
		return err
	}
	if fi.IsDir() {
		return sc.RemoveAll(path)
	}
	return sc.Remove(path)
}

// SFTPRename renames/moves a remote file or directory.
func (m *Manager) SFTPRename(sessionID string, oldPath string, newPath string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}

	sess.sftpMu.Lock()
	sc := sess.sftpClient
	sess.sftpMu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp not open for session %s", sessionID)
	}

	return sc.Rename(oldPath, newPath)
}

// extractTarGz unpacks a .tar.gz archive into destDir.
func extractTarGz(archivePath, destDir string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		target := filepath.Join(destDir, filepath.Clean("/"+hdr.Name))
		if !strings.HasPrefix(target, filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755) //nolint:errcheck
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755) //nolint:errcheck
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
	return nil
}
