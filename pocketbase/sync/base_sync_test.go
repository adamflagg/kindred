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

func TestBaseSyncService_IsKeyProcessed(t *testing.T) {
	service := BaseSyncService{
		ProcessedKeys: make(map[string]bool),
	}

	// Initially no keys are processed
	if service.IsKeyProcessed(12345, 2025) {
		t.Error("Key should not be processed initially")
	}

	// Track a key
	service.TrackProcessedKey(12345, 2025)

	// Now it should be processed
	if !service.IsKeyProcessed(12345, 2025) {
		t.Error("Key 12345|2025 should be processed after tracking")
	}

	// Different year should not be processed
	if service.IsKeyProcessed(12345, 2024) {
		t.Error("Key 12345|2024 should not be processed")
	}

	// Different ID should not be processed
	if service.IsKeyProcessed(99999, 2025) {
		t.Error("Key 99999|2025 should not be processed")
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

func TestBaseSyncService_FindOrphansFromPreloaded(t *testing.T) {
	tests := []struct {
		name           string
		syncSuccessful bool
		processedKeys  map[string]bool
		preloadedKeys  []string
		wantOrphanKeys []string
	}{
		{
			name:           "sync failed - no orphans returned",
			syncSuccessful: false,
			processedKeys:  map[string]bool{"key1": true},
			preloadedKeys:  []string{"key1", "key2"},
			wantOrphanKeys: []string{}, // Empty because sync failed
		},
		{
			name:           "empty preloaded map",
			syncSuccessful: true,
			processedKeys:  map[string]bool{"key1": true},
			preloadedKeys:  []string{},
			wantOrphanKeys: []string{},
		},
		{
			name:           "all records processed - no orphans",
			syncSuccessful: true,
			processedKeys:  map[string]bool{"key1": true, "key2": true, "key3": true},
			preloadedKeys:  []string{"key1", "key2", "key3"},
			wantOrphanKeys: []string{},
		},
		{
			name:           "some records not processed - orphans detected",
			syncSuccessful: true,
			processedKeys:  map[string]bool{"key1": true, "key3": true},
			preloadedKeys:  []string{"key1", "key2", "key3", "key4"},
			wantOrphanKeys: []string{"key2", "key4"},
		},
		{
			name:           "no records processed - all are orphans",
			syncSuccessful: true,
			processedKeys:  map[string]bool{},
			preloadedKeys:  []string{"key1", "key2"},
			wantOrphanKeys: []string{"key1", "key2"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := BaseSyncService{
				ProcessedKeys:  tt.processedKeys,
				SyncSuccessful: tt.syncSuccessful,
			}

			// Build preloaded map with string keys (simulating composite keys)
			preloaded := make(map[interface{}]any)
			for _, key := range tt.preloadedKeys {
				preloaded[key] = "pb-id-" + key // PB record ID (or *core.Record in real usage)
			}

			orphanKeys := service.FindOrphansFromPreloaded(preloaded)

			// Check count
			if len(orphanKeys) != len(tt.wantOrphanKeys) {
				t.Errorf("FindOrphansFromPreloaded() returned %d orphans, want %d",
					len(orphanKeys), len(tt.wantOrphanKeys))
				return
			}

			// Check each expected orphan is present
			orphanSet := make(map[string]bool)
			for _, key := range orphanKeys {
				orphanSet[key] = true
			}
			for _, wantKey := range tt.wantOrphanKeys {
				if !orphanSet[wantKey] {
					t.Errorf("Expected orphan key %q not found in result", wantKey)
				}
			}
		})
	}
}
