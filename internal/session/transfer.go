package session

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/rs/zerolog/log"
)

const defaultBufferSizeKB = 32

// bufferSize returns the configured transfer buffer size in bytes,
// falling back to a sensible default when the config value is zero.
func (m *Manager) bufferSize() int {
	if m.cfg.SFTP.BufferSizeKB > 0 {
		return m.cfg.SFTP.BufferSizeKB * 1024
	}
	return defaultBufferSizeKB * 1024
}

// channelReader opens a file for reading from any channel type and returns
// the reader, total file size, and any error.
func (m *Manager) channelReader(channelID, path string) (io.ReadCloser, int64, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, 0, fmt.Errorf("channel %s not found", channelID)
	}

	switch ch.Kind() {
	case ChannelLocalFS:
		f, err := os.Open(path)
		if err != nil {
			return nil, 0, fmt.Errorf("open local file: %w", err)
		}
		stat, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, 0, fmt.Errorf("stat local file: %w", err)
		}
		return f, stat.Size(), nil

	case ChannelSFTP:
		sc, err := m.getSFTPChannel(channelID)
		if err != nil {
			return nil, 0, err
		}
		sc.mu.Lock()
		client := sc.client
		sc.mu.Unlock()
		if client == nil {
			return nil, 0, fmt.Errorf("sftp client closed")
		}
		f, err := client.Open(path)
		if err != nil {
			return nil, 0, fmt.Errorf("open remote file: %w", err)
		}
		stat, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, 0, fmt.Errorf("stat remote file: %w", err)
		}
		return f, stat.Size(), nil

	default:
		return nil, 0, fmt.Errorf("channel %s (kind %s) does not support reading", channelID, ch.Kind())
	}
}

// channelWriter opens a file for writing on any channel type.
func (m *Manager) channelWriter(channelID, path string) (io.WriteCloser, error) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("channel %s not found", channelID)
	}

	switch ch.Kind() {
	case ChannelLocalFS:
		f, err := os.Create(path)
		if err != nil {
			return nil, fmt.Errorf("create local file: %w", err)
		}
		return f, nil

	case ChannelSFTP:
		sc, err := m.getSFTPChannel(channelID)
		if err != nil {
			return nil, err
		}
		sc.mu.Lock()
		client := sc.client
		sc.mu.Unlock()
		if client == nil {
			return nil, fmt.Errorf("sftp client closed")
		}
		f, err := client.Create(path)
		if err != nil {
			return nil, fmt.Errorf("create remote file: %w", err)
		}
		return f, nil

	default:
		return nil, fmt.Errorf("channel %s (kind %s) does not support writing", channelID, ch.Kind())
	}
}

// combinedContext returns a context that cancels when either channel's
// underlying connection context is done. For LocalFS channels the connection
// is the long-lived virtual connection which only cancels on app shutdown.
func (m *Manager) combinedContext(srcChannelID, dstChannelID string) (context.Context, context.CancelFunc, error) {
	srcConnID := m.channelConnectionID(srcChannelID)
	dstConnID := m.channelConnectionID(dstChannelID)

	srcConn, err := m.getConnection(srcConnID)
	if err != nil {
		return nil, nil, fmt.Errorf("source connection: %w", err)
	}
	dstConn, err := m.getConnection(dstConnID)
	if err != nil {
		return nil, nil, fmt.Errorf("destination connection: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		select {
		case <-srcConn.ctx.Done():
			cancel()
		case <-dstConn.ctx.Done():
			cancel()
		case <-ctx.Done():
		}
	}()

	return ctx, cancel, nil
}

// channelConnectionID returns the connection ID for a channel, or empty string
// if the channel is not found.
func (m *Manager) channelConnectionID(channelID string) string {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return ""
	}
	return ch.ConnectionID()
}

// cleanupDst is a best-effort removal of a partially written destination file.
func (m *Manager) cleanupDst(channelID, path string) {
	m.mu.Lock()
	ch, ok := m.channels[channelID]
	m.mu.Unlock()
	if !ok {
		return
	}

	switch ch.Kind() {
	case ChannelLocalFS:
		os.Remove(path) //nolint:errcheck
	case ChannelSFTP:
		sc, err := m.getSFTPChannel(channelID)
		if err != nil {
			return
		}
		sc.mu.Lock()
		client := sc.client
		sc.mu.Unlock()
		if client != nil {
			client.Remove(path) //nolint:errcheck
		}
	}
}

// TransferBetweenChannels copies a file from one channel to another, streaming
// data through the local process. It works with any combination of SFTP and
// LocalFS channels. Progress events are emitted on
// "channel:transfer-progress:{dstChannelID}".
func (m *Manager) TransferBetweenChannels(srcChannelID, srcPath, dstChannelID, dstPath string) error {
	ctx, cancel, err := m.combinedContext(srcChannelID, dstChannelID)
	if err != nil {
		return err
	}
	defer cancel()

	reader, total, err := m.channelReader(srcChannelID, srcPath)
	if err != nil {
		return fmt.Errorf("source: %w", err)
	}
	defer reader.Close()

	writer, err := m.channelWriter(dstChannelID, dstPath)
	if err != nil {
		return fmt.Errorf("destination: %w", err)
	}

	log.Info().
		Str("srcChannelId", srcChannelID).Str("srcPath", srcPath).
		Str("dstChannelId", dstChannelID).Str("dstPath", dstPath).
		Int64("size", total).
		Msg("channel transfer started")

	buf := make([]byte, m.bufferSize())
	var written int64
	for {
		select {
		case <-ctx.Done():
			writer.Close() //nolint:errcheck
			m.cleanupDst(dstChannelID, dstPath)
			return fmt.Errorf("transfer cancelled: %w", ctx.Err())
		default:
		}

		nr, rerr := reader.Read(buf)
		if nr > 0 {
			nw, werr := writer.Write(buf[:nr])
			written += int64(nw)

			m.emitter.Emit("channel:transfer-progress:"+dstChannelID, SFTPProgressEvent{
				Path:  srcPath,
				Bytes: written,
				Total: total,
			})

			if werr != nil {
				writer.Close() //nolint:errcheck
				m.cleanupDst(dstChannelID, dstPath)
				return fmt.Errorf("write to destination: %w", werr)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			writer.Close() //nolint:errcheck
			m.cleanupDst(dstChannelID, dstPath)
			return fmt.Errorf("read from source: %w", rerr)
		}
	}

	if err := writer.Close(); err != nil {
		m.cleanupDst(dstChannelID, dstPath)
		return fmt.Errorf("close destination file: %w", err)
	}

	log.Info().
		Str("srcChannelId", srcChannelID).Str("dstChannelId", dstChannelID).
		Int64("bytes", written).
		Msg("channel transfer complete")

	return nil
}
