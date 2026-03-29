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

	// The implementation cleans "../../etc/passwd" via filepath.Clean("/"+name) which
	// normalizes it to "/etc/passwd", then joins with destDir -> destDir/etc/passwd.
	// This is safe because the file stays inside destDir. Verify it landed there.
	sanitizedPath := filepath.Join(destDir, "etc", "passwd")
	data, err := os.ReadFile(sanitizedPath)
	if err != nil {
		t.Fatalf("expected traversal path to be sanitized into destDir/etc/passwd, but file not found: %v", err)
	}
	if string(data) != "should not appear" {
		t.Errorf("sanitized file content = %q, want %q", string(data), "should not appear")
	}

	// Verify nothing was written outside destDir by checking the parent.
	parentEtc := filepath.Join(destDir, "..", "etc", "passwd")
	if _, err := os.Stat(parentEtc); err == nil {
		t.Fatal("path traversal entry escaped destDir")
	}

	// safe.txt should exist.
	data, err = os.ReadFile(filepath.Join(destDir, "safe.txt"))
	if err != nil {
		t.Fatalf("read safe.txt: %v", err)
	}
	if string(data) != "safe content" {
		t.Errorf("safe.txt = %q, want %q", string(data), "safe content")
	}
}
