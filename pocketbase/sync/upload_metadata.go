package sync

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// BunkRequestsUploadMetadata is the subset of upload_metadata.json exposed to
// the frontend. The on-disk file may contain additional fields (size,
// header_count, year) that are intentionally ignored here.
type BunkRequestsUploadMetadata struct {
	Filename   string `json:"filename"`
	UploadedAt string `json:"uploaded_at"`
}

// readBunkRequestsUploadMetadata reads bunk_requests/upload_metadata.json from
// the given data dir. Returns (nil, nil) when the file is absent — the typical
// state before the first CSV upload of a season.
func readBunkRequestsUploadMetadata(dataDir string) (*BunkRequestsUploadMetadata, error) {
	path := filepath.Join(dataDir, "bunk_requests", "upload_metadata.json")
	data, err := os.ReadFile(path) //nolint:gosec // path is composed from controlled dataDir
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read upload metadata: %w", err)
	}

	var meta BunkRequestsUploadMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parse upload metadata: %w", err)
	}
	return &meta, nil
}
