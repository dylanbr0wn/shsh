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
	"github.com/rs/zerolog/log"
)

// SFTPListDir lists entries in the given remote directory, dirs first then files.
func (m *Manager) SFTPListDir(channelId string, path string) ([]SFTPEntry, error) {
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

	if path == "~" {
		home, err := sc.Getwd()
		if err != nil {
			home = "/"
		}
		path = home
	}

	infos, err := sc.ReadDir(path)
	if err != nil {
		m.emitDebug("sftp", "error", channelId, m.connLabel(sftpCh.connectionID), "readdir failed: "+err.Error(), map[string]any{"path": path})
		return nil, err
	}
	m.emitDebug("sftp", "debug", channelId, m.connLabel(sftpCh.connectionID), "readdir", map[string]any{"path": path, "entries": len(infos)})

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
func (m *Manager) SFTPDownload(channelId string, remotePath string, localPath string) error {
	if localPath == "" {
		return nil
	}

	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
	}

	remoteFile, err := sc.Open(remotePath)
	if err != nil {
		log.Error().Err(err).Str("channelId", channelId).Str("remote", remotePath).Msg("SFTP download failed to open remote file")
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

	log.Info().Str("channelId", channelId).Str("remote", remotePath).Str("local", localPath).Int64("size", total).Msg("SFTP download started")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "download started", map[string]any{"remote": remotePath, "size": total})
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := remoteFile.Read(buf)
		if nr > 0 {
			nw, werr := localFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("channel:sftp-progress:"+channelId, SFTPProgressEvent{
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
			m.emitDebug("sftp", "error", channelId, m.connLabel(sftpCh.connectionID), "download error: "+rerr.Error(), map[string]any{"remote": remotePath})
			return rerr
		}
	}
	log.Info().Str("channelId", channelId).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP download complete")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "download complete", map[string]any{"remote": remotePath, "bytes": written})
	return nil
}

// SFTPDownloadDir tars a remote directory, downloads it, and unpacks it locally.
func (m *Manager) SFTPDownloadDir(channelId string, remotePath string, localDir string) error {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
	}

	// Get the goph.Client from the connection for running remote commands.
	conn, err := m.getConnection(sftpCh.connectionID)
	if err != nil {
		return err
	}

	if localDir == "" {
		return nil
	}

	dirName := filepath.Base(remotePath)
	parentDir := filepath.Dir(remotePath)
	tempRemote := fmt.Sprintf("/tmp/shsh_%s.tar.gz", uuid.New().String())
	tarCmd := fmt.Sprintf("tar czf %s -C %s %s", tempRemote, parentDir, dirName)
	if _, err := conn.client.Run(tarCmd); err != nil {
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
	eventKey := "channel:sftp-progress:" + channelId
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

	conn.client.Run("rm " + tempRemote) //nolint:errcheck

	return extractTarGz(localTmpPath, localDir)
}

// SFTPUpload uploads localPath to remoteDir.
func (m *Manager) SFTPUpload(channelId string, remoteDir string, localPath string) error {
	if localPath == "" {
		return nil
	}

	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
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
		log.Error().Err(err).Str("channelId", channelId).Str("remote", remotePath).Msg("SFTP upload failed to create remote file")
		return err
	}
	defer remoteFile.Close()

	log.Info().Str("channelId", channelId).Str("local", localPath).Str("remote", remotePath).Int64("size", total).Msg("SFTP upload started")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "upload started", map[string]any{"remote": remotePath, "size": total})
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("channel:sftp-progress:"+channelId, SFTPProgressEvent{
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
			m.emitDebug("sftp", "error", channelId, m.connLabel(sftpCh.connectionID), "upload error: "+rerr.Error(), map[string]any{"remote": remotePath})
			return rerr
		}
	}
	log.Info().Str("channelId", channelId).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP upload complete")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "upload complete", map[string]any{"remote": remotePath, "bytes": written})
	return nil
}

// SFTPUploadPath uploads a local file at localPath to the given remotePath.
func (m *Manager) SFTPUploadPath(channelId string, localPath string, remotePath string) error {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
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
		log.Error().Err(err).Str("channelId", channelId).Str("remote", remotePath).Msg("SFTP upload failed to create remote file")
		return err
	}
	defer remoteFile.Close()

	log.Info().Str("channelId", channelId).Str("local", localPath).Str("remote", remotePath).Int64("size", total).Msg("SFTP upload started")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "upload started", map[string]any{"remote": remotePath, "size": total})
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		nr, rerr := localFile.Read(buf)
		if nr > 0 {
			nw, werr := remoteFile.Write(buf[:nr])
			written += int64(nw)
			m.emitter.Emit("channel:sftp-progress:"+channelId, SFTPProgressEvent{
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
			m.emitDebug("sftp", "error", channelId, m.connLabel(sftpCh.connectionID), "upload error: "+rerr.Error(), map[string]any{"remote": remotePath})
			return rerr
		}
	}
	log.Info().Str("channelId", channelId).Str("remote", remotePath).Int64("bytes", written).Msg("SFTP upload complete")
	m.emitDebug("sftp", "info", channelId, m.connLabel(sftpCh.connectionID), "upload complete", map[string]any{"remote": remotePath, "bytes": written})
	return nil
}

// SFTPMkdir creates a directory at the given remote path.
func (m *Manager) SFTPMkdir(channelId string, path string) error {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
	}

	return sc.Mkdir(path)
}

// SFTPDelete removes a file or directory at the given remote path.
func (m *Manager) SFTPDelete(channelId string, path string) error {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
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
func (m *Manager) SFTPRename(channelId string, oldPath string, newPath string) error {
	sftpCh, err := m.getSFTPChannel(channelId)
	if err != nil {
		return err
	}

	sftpCh.mu.Lock()
	sc := sftpCh.client
	sftpCh.mu.Unlock()
	if sc == nil {
		return fmt.Errorf("sftp client closed for channel %s", channelId)
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
