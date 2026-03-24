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
	"github.com/rs/zerolog/log"
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
		log.Error().Err(err).Str("sessionID", sessionID).Msg("SFTP negotiation failed")
		return fmt.Errorf("sftp negotiation failed: %w", err)
	}
	log.Debug().Str("sessionID", sessionID).Msg("SFTP session opened")
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
		log.Debug().Str("sessionID", sessionID).Msg("SFTP session closed")
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

// SFTPDownload downloads the remote file to localPath.
// The caller is responsible for resolving localPath (e.g. via a save dialog).
func (m *Manager) SFTPDownload(sessionID string, remotePath string, localPath string) error {
	if localPath == "" {
		return nil
	}

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

	remoteFile, err := sc.Open(remotePath)
	if err != nil {
		log.Error().Err(err).Str("sessionID", sessionID).Str("remote", remotePath).Msg("SFTP download failed to open remote file")
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

	log.Info().Str("sessionID", sessionID).Str("remote", remotePath).Str("local", localPath).Int64("size", total).Msg("SFTP download started")
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("sftp:progress:"+sessionID, SFTPProgressEvent{
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
	log.Info().Str("sessionID", sessionID).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP download complete")
	return nil
}

// SFTPDownloadDir tars a remote directory, downloads it, and unpacks it locally.
// localDir is the destination directory; the caller is responsible for resolving it
// (e.g. via an open-directory dialog).
func (m *Manager) SFTPDownloadDir(sessionID string, remotePath string, localDir string) error {
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

	if localDir == "" {
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

	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	eventKey := "sftp:progress:" + sessionID
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localTmp.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit(eventKey, SFTPProgressEvent{
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

// SFTPUpload uploads localPath to remoteDir.
// The caller is responsible for resolving localPath (e.g. via a file picker dialog).
func (m *Manager) SFTPUpload(sessionID string, remoteDir string, localPath string) error {
	if localPath == "" {
		return nil
	}

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
		log.Error().Err(err).Str("sessionID", sessionID).Str("remote", remotePath).Msg("SFTP upload failed to create remote file")
		return err
	}
	defer remoteFile.Close()

	log.Info().Str("sessionID", sessionID).Str("local", localPath).Str("remote", remotePath).Int64("size", total).Msg("SFTP upload started")
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("sftp:progress:"+sessionID, SFTPProgressEvent{
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
	log.Info().Str("sessionID", sessionID).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP upload complete")
	return nil
}

// SFTPUploadPath uploads a local file at localPath to the given remotePath.
func (m *Manager) SFTPUploadPath(sessionID string, localPath string, remotePath string) error {
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

	info, err := os.Stat(localPath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("cannot upload a directory via drag-drop; upload files only")
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	total := info.Size()

	remoteFile, err := sc.Create(remotePath)
	if err != nil {
		log.Error().Err(err).Str("sessionID", sessionID).Str("remote", remotePath).Msg("SFTP upload failed to create remote file")
		return err
	}
	defer remoteFile.Close()

	log.Info().Str("sessionID", sessionID).Str("local", localPath).Str("remote", remotePath).Int64("size", total).Msg("SFTP upload started")
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("sftp:progress:"+sessionID, SFTPProgressEvent{
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
	log.Info().Str("sessionID", sessionID).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP upload complete")
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
