package sync

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadBunkRequestsUploadMetadata_Missing(t *testing.T) {
	t.Parallel()
	tmp := t.TempDir()
	got, err := readBunkRequestsUploadMetadata(tmp)
	if err != nil {
		t.Fatalf("expected nil error on missing metadata, got %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil result on missing metadata, got %+v", got)
	}
}

func TestReadBunkRequestsUploadMetadata_Valid(t *testing.T) {
	t.Parallel()
	tmp := t.TempDir()
	csvDir := filepath.Join(tmp, "bunk_requests")
	if err := os.MkdirAll(csvDir, 0750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	contents := `{
		"filename": "BunkRequests_2026-05-04.csv",
		"uploaded_at": "2026-05-04T14:13:22Z",
		"size": 12345,
		"header_count": 42,
		"year": 2026
	}`
	if err := os.WriteFile(filepath.Join(csvDir, "upload_metadata.json"), []byte(contents), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := readBunkRequestsUploadMetadata(tmp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil result")
	}
	if got.Filename != "BunkRequests_2026-05-04.csv" {
		t.Errorf("filename = %q, want BunkRequests_2026-05-04.csv", got.Filename)
	}
	if got.UploadedAt != "2026-05-04T14:13:22Z" {
		t.Errorf("uploaded_at = %q, want 2026-05-04T14:13:22Z", got.UploadedAt)
	}
}

func TestReadBunkRequestsUploadMetadata_InvalidJSON(t *testing.T) {
	t.Parallel()
	tmp := t.TempDir()
	csvDir := filepath.Join(tmp, "bunk_requests")
	if err := os.MkdirAll(csvDir, 0750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(csvDir, "upload_metadata.json"), []byte("not json"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}

	if _, err := readBunkRequestsUploadMetadata(tmp); err == nil {
		t.Fatal("expected parse error on invalid JSON, got nil")
	}
}
