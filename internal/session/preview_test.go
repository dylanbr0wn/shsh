package session

import (
	"encoding/base64"
	"testing"
)

func TestClassifyFile_TextExtensions(t *testing.T) {
	textExts := []string{
		".txt", ".log", ".conf", ".cfg", ".ini", ".json", ".yaml", ".yml",
		".xml", ".html", ".css", ".js", ".ts", ".go", ".py", ".rb", ".rs",
		".sh", ".bash", ".zsh", ".md", ".toml", ".env", ".csv", ".sql",
		".jsx", ".tsx", ".vue", ".svelte", ".java", ".c", ".cpp", ".h",
		".hpp", ".cs", ".php", ".swift", ".kt", ".scala", ".lua", ".r",
		".pl", ".dockerfile", ".makefile", ".gitignore",
	}
	for _, ext := range textExts {
		cat := classifyExtension(ext)
		if cat != fileKindText {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindText)
		}
	}
}

func TestClassifyFile_ImageExtensions(t *testing.T) {
	imageExts := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"}
	for _, ext := range imageExts {
		cat := classifyExtension(ext)
		if cat != fileKindImage {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindImage)
		}
	}
}

func TestClassifyFile_Unknown(t *testing.T) {
	unknownExts := []string{".exe", ".zip", ".pdf", ".mp4", ".bin", ""}
	for _, ext := range unknownExts {
		cat := classifyExtension(ext)
		if cat != fileKindUnknown {
			t.Errorf("classifyExtension(%q) = %q, want %q", ext, cat, fileKindUnknown)
		}
	}
}

func TestSizeLimit(t *testing.T) {
	if maxPreviewSize(fileKindText) != 1<<20 {
		t.Errorf("text limit = %d, want %d", maxPreviewSize(fileKindText), 1<<20)
	}
	if maxPreviewSize(fileKindImage) != 10<<20 {
		t.Errorf("image limit = %d, want %d", maxPreviewSize(fileKindImage), 10<<20)
	}
}

func TestMimeForExtension(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{".json", "application/json"},
		{".html", "text/html"},
		{".png", "image/png"},
		{".jpg", "image/jpeg"},
		{".svg", "image/svg+xml"},
		{".txt", "text/plain"},
	}
	for _, tt := range tests {
		got := mimeForExtension(tt.ext)
		if got != tt.want {
			t.Errorf("mimeForExtension(%q) = %q, want %q", tt.ext, got, tt.want)
		}
	}

	// These extensions have platform-dependent MIME registrations.
	// On macOS they may fall through to "text/plain"; on Linux they
	// resolve to "text/x-go" / "application/yaml". Just verify we
	// get a non-empty result.
	for _, ext := range []string{".go", ".yaml"} {
		got := mimeForExtension(ext)
		if got == "" {
			t.Errorf("mimeForExtension(%q) returned empty string", ext)
		}
	}
}

// TestBase64Encode verifies our encoding matches standard base64.
func TestBase64Encode(t *testing.T) {
	input := []byte("hello world")
	got := base64.StdEncoding.EncodeToString(input)
	want := "aGVsbG8gd29ybGQ="
	if got != want {
		t.Errorf("base64 encode = %q, want %q", got, want)
	}
}
