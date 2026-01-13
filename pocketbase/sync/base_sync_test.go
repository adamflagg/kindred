package sync

import (
	"testing"
)

func TestStats_Zero(t *testing.T) {
	s := Stats{}

	if s.Created != 0 {
		t.Errorf("Stats.Created = %d, want 0", s.Created)
	}
	if s.Updated != 0 {
		t.Errorf("Stats.Updated = %d, want 0", s.Updated)
	}
	if s.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0", s.Skipped)
	}
	if s.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Errors)
	}
}

func TestBaseSyncService_ClearProcessedKeys(t *testing.T) {
	service := BaseSyncService{
		ProcessedKeys: map[string]bool{
			"key1": true,
			"key2": true,
		},
	}

	service.ClearProcessedKeys()

	if len(service.ProcessedKeys) != 0 {
		t.Errorf("ProcessedKeys should be empty after clear, got %d items", len(service.ProcessedKeys))
	}
}

func TestPageSizeConstants(t *testing.T) {
	// Verify page size constants are reasonable
	if SmallPageSize <= 0 {
		t.Errorf("SmallPageSize should be positive, got %d", SmallPageSize)
	}
	if DefaultPageSize <= SmallPageSize {
		t.Errorf("DefaultPageSize (%d) should be larger than SmallPageSize (%d)",
			DefaultPageSize, SmallPageSize)
	}
	if LargePageSize <= DefaultPageSize {
		t.Errorf("LargePageSize (%d) should be larger than DefaultPageSize (%d)",
			LargePageSize, DefaultPageSize)
	}
}

func TestBaseSyncService_TrackProcessedKey(t *testing.T) {
	service := BaseSyncService{
		ProcessedKeys: make(map[string]bool),
	}

	// Track some keys
	service.TrackProcessedKey(12345, 2025)
	service.TrackProcessedKey("abc", 2024)

	// Verify they're tracked
	if !service.ProcessedKeys["12345|2025"] {
		t.Error("Expected key 12345|2025 to be tracked")
	}
	if !service.ProcessedKeys["abc|2024"] {
		t.Error("Expected key abc|2024 to be tracked")
	}

	// Verify other keys are not tracked
	if service.ProcessedKeys["12345|2024"] {
		t.Error("Key 12345|2024 should not be tracked")
	}
}

func TestBaseSyncService_TrackProcessedCompositeKey(t *testing.T) {
	service := BaseSyncService{
		ProcessedKeys: make(map[string]bool),
	}

	// Track composite keys
	service.TrackProcessedCompositeKey("person-123|session-456", 2025)
	service.TrackProcessedCompositeKey("bunk-1|plan-2", 2024)

	// Verify they're tracked with year appended
	if !service.ProcessedKeys["person-123|session-456|2025"] {
		t.Error("Expected key person-123|session-456|2025 to be tracked")
	}
	if !service.ProcessedKeys["bunk-1|plan-2|2024"] {
		t.Error("Expected key bunk-1|plan-2|2024 to be tracked")
	}
}
