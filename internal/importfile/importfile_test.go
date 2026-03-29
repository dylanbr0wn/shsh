// internal/importfile/importfile_test.go
package importfile

import "testing"

func TestDetectFormat_ShshJSON(t *testing.T) {
	content := []byte(`{"version":1,"exportedAt":"2026-01-01T00:00:00Z","hosts":[]}`)
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatShshJSON {
		t.Fatalf("got %q, want %q", f, FormatShshJSON)
	}
}

func TestDetectFormat_ShshCSV(t *testing.T) {
	content := []byte("label,hostname,port,username,auth_method,key_path,tags,group,color\n")
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatShshCSV {
		t.Fatalf("got %q, want %q", f, FormatShshCSV)
	}
}

func TestDetectFormat_TermiusCSV(t *testing.T) {
	content := []byte("Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,Password,SSH_KEY\n")
	f, err := DetectFormat(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f != FormatTermiusCSV {
		t.Fatalf("got %q, want %q", f, FormatTermiusCSV)
	}
}

func TestDetectFormat_Unknown(t *testing.T) {
	content := []byte("this is not a valid format")
	_, err := DetectFormat(content)
	if err == nil {
		t.Fatal("expected error for unknown format")
	}
}
