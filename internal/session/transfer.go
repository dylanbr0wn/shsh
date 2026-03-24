package session

import (
	"context"
	"fmt"
	"io"

	"github.com/rs/zerolog/log"
)

// TransferBetweenHosts copies a file from one SFTP channel to another,
// streaming data through the local process without requiring both hosts
// to communicate directly.
func (m *Manager) TransferBetweenHosts(srcChannelId, srcPath, dstChannelId, dstPath string) error {
	srcCh, err := m.getSFTPChannel(srcChannelId)
	if err != nil {
		return fmt.Errorf("source: %w", err)
	}
	dstCh, err := m.getSFTPChannel(dstChannelId)
	if err != nil {
		return fmt.Errorf("destination: %w", err)
	}

	srcCh.mu.Lock()
	srcClient := srcCh.client
	srcCh.mu.Unlock()
	if srcClient == nil {
		return fmt.Errorf("source sftp client closed")
	}

	dstCh.mu.Lock()
	dstClient := dstCh.client
	dstCh.mu.Unlock()
	if dstClient == nil {
		return fmt.Errorf("destination sftp client closed")
	}

	// Derive a context that cancels if either connection goes away.
	srcConn, err := m.getConnection(srcCh.connectionID)
	if err != nil {
		return fmt.Errorf("source connection: %w", err)
	}
	dstConn, err := m.getConnection(dstCh.connectionID)
	if err != nil {
		return fmt.Errorf("destination connection: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-srcConn.ctx.Done():
			cancel()
		case <-dstConn.ctx.Done():
			cancel()
		case <-ctx.Done():
		}
	}()

	// Open source file.
	reader, err := srcClient.Open(srcPath)
	if err != nil {
		return fmt.Errorf("open source file: %w", err)
	}
	defer reader.Close()

	stat, err := reader.Stat()
	if err != nil {
		return fmt.Errorf("stat source file: %w", err)
	}
	total := stat.Size()

	// Create destination file.
	writer, err := dstClient.Create(dstPath)
	if err != nil {
		return fmt.Errorf("create destination file: %w", err)
	}

	log.Info().
		Str("srcChannelId", srcChannelId).Str("srcPath", srcPath).
		Str("dstChannelId", dstChannelId).Str("dstPath", dstPath).
		Int64("size", total).
		Msg("cross-host transfer started")

	// Copy in buffered loop with progress events.
	buf := make([]byte, m.cfg.SFTP.BufferSizeKB*1024)
	var written int64
	for {
		select {
		case <-ctx.Done():
			writer.Close()
			dstClient.Remove(dstPath) //nolint:errcheck
			return fmt.Errorf("transfer cancelled: %w", ctx.Err())
		default:
		}

		nr, rerr := reader.Read(buf)
		if nr > 0 {
			nw, werr := writer.Write(buf[:nr])
			written += int64(nw)

			progress := SFTPProgressEvent{
				Path:  srcPath,
				Bytes: written,
				Total: total,
			}
			m.emitter.Emit("channel:sftp-progress:"+srcChannelId, progress)
			m.emitter.Emit("channel:sftp-progress:"+dstChannelId, progress)

			if werr != nil {
				writer.Close()
				dstClient.Remove(dstPath) //nolint:errcheck
				return fmt.Errorf("write to destination: %w", werr)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			writer.Close()
			dstClient.Remove(dstPath) //nolint:errcheck
			return fmt.Errorf("read from source: %w", rerr)
		}
	}

	if err := writer.Close(); err != nil {
		dstClient.Remove(dstPath) //nolint:errcheck
		return fmt.Errorf("close destination file: %w", err)
	}

	log.Info().
		Str("srcChannelId", srcChannelId).Str("dstChannelId", dstChannelId).
		Int64("bytes", written).
		Msg("cross-host transfer complete")

	return nil
}
