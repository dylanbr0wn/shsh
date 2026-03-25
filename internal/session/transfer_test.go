package session

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/dylanbr0wn/shsh/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTransferBetweenChannels_LocalToLocal(t *testing.T) {
	m := NewManager(context.Background(), &config.Config{}, &stubEmitter{})

	srcCh, err := m.OpenLocalFSChannel()
	require.NoError(t, err)
	dstCh, err := m.OpenLocalFSChannel()
	require.NoError(t, err)

	srcDir := t.TempDir()
	dstDir := t.TempDir()

	content := []byte("transfer test content")
	srcFile := filepath.Join(srcDir, "test.txt")
	os.WriteFile(srcFile, content, 0644)

	dstFile := filepath.Join(dstDir, "test.txt")

	err = m.TransferBetweenChannels(srcCh, srcFile, dstCh, dstFile)
	require.NoError(t, err)

	got, err := os.ReadFile(dstFile)
	require.NoError(t, err)
	assert.Equal(t, content, got)
}
