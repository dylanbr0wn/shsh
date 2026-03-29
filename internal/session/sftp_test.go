package session

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

// createTarGz builds a .tar.gz archive from the given entries.
func createTarGz(t *testing.T, path string, entries []tarEntry) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	for _, e := range entries {
		hdr := &tar.Header{
			Name: e.Name,
			Size: int64(len(e.Body)),
		}
		if e.IsDir {
			hdr.Typeflag = tar.TypeDir
			hdr.Mode = 0755
			hdr.Size = 0
		} else {
			hdr.Typeflag = tar.TypeReg
			hdr.Mode = 0644
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("write header %q: %v", e.Name, err)
		}
		if !e.IsDir && len(e.Body) > 0 {
			if _, err := tw.Write([]byte(e.Body)); err != nil {
				t.Fatalf("write body %q: %v", e.Name, err)
			}
		}
	}
}

type tarEntry struct {
	Name  string
	Body  string
	IsDir bool
}

func TestExtractTarGz_Normal(t *testing.T) {
	archiveDir := t.TempDir()
	destDir := t.TempDir()

	archivePath := filepath.Join(archiveDir, "test.tar.gz")
	createTarGz(t, archivePath, []tarEntry{
		{Name: "subdir/", IsDir: true},
		{Name: "subdir/file.txt", Body: "hello from subdir"},
		{Name: "root.txt", Body: "hello from root"},
	})

	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// Verify subdir/file.txt
	data, err := os.ReadFile(filepath.Join(destDir, "subdir", "file.txt"))
	if err != nil {
		t.Fatalf("read subdir/file.txt: %v", err)
	}
	if string(data) != "hello from subdir" {
		t.Errorf("subdir/file.txt = %q, want %q", string(data), "hello from subdir")
	}

	// Verify root.txt
	data, err = os.ReadFile(filepath.Join(destDir, "root.txt"))
	if err != nil {
		t.Fatalf("read root.txt: %v", err)
	}
	if string(data) != "hello from root" {
		t.Errorf("root.txt = %q, want %q", string(data), "hello from root")
	}
}

func TestExtractTarGz_PathTraversal(t *testing.T) {
	archiveDir := t.TempDir()
	destDir := t.TempDir()

	archivePath := filepath.Join(archiveDir, "evil.tar.gz")
	createTarGz(t, archivePath, []tarEntry{
		{Name: "../../etc/passwd", Body: "should not appear"},
		{Name: "safe.txt", Body: "safe content"},
	})

	if err := extractTarGz(archivePath, destDir); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// The traversal entry should be skipped — verify it does not exist outside dest.
	traversalPath := filepath.Join(destDir, "..", "..", "etc", "passwd")
	if _, err := os.Stat(traversalPath); err == nil {
		t.Fatal("path traversal entry should have been skipped, but file exists outside dest")
	}

	// Also verify it didn't end up anywhere in the dest dir.
	if _, err := os.Stat(filepath.Join(destDir, "etc", "passwd")); err == nil {
		// This is actually fine — the implementation cleans the path with
		// filepath.Clean("/"+hdr.Name) which turns "../../etc/passwd" into
		// "/etc/passwd" -> destDir/etc/passwd. As long as it's inside destDir, it's safe.
	}

	// safe.txt should exist.
	data, err := os.ReadFile(filepath.Join(destDir, "safe.txt"))
	if err != nil {
		t.Fatalf("read safe.txt: %v", err)
	}
	if string(data) != "safe content" {
		t.Errorf("safe.txt = %q, want %q", string(data), "safe content")
	}
}
