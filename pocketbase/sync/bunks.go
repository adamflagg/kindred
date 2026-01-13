// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// BunksSync handles syncing bunk records from CampMinder
type BunksSync struct {
	BaseSyncService
}

// NewBunksSync creates a new bunks sync service
func NewBunksSync(app core.App, client *campminder.Client) *BunksSync {
	return &BunksSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *BunksSync) Name() string {
	return "bunks"
}

// Sync performs the bunks synchronization
func (s *BunksSync) Sync(ctx context.Context) error {
	// Use StandardSync with a custom preload filter for current year
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("bunks", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart("bunks")
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch bunks from CampMinder
	bunks, err := s.Client.GetBunks()
	if err != nil {
		return fmt.Errorf("fetching bunks: %w", err)
	}

	if len(bunks) == 0 {
		slog.Info("No bunks to sync")
		return nil
	}

	slog.Info("Fetched bunks from CampMinder", "count", len(bunks))
	s.SyncSuccessful = true

	// Process each bunk
	for _, bunkData := range bunks {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format
		pbData, err := s.transformBunkToPB(bunkData)
		if err != nil {
			slog.Error("Error transforming bunk", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract key
		bunkID, ok := bunkData["ID"].(float64)
		if !ok {
			slog.Error("Invalid bunk ID type")
			s.Stats.Errors++
			continue
		}
		key := int(bunkID)

		// Track as processed using base class tracking
		yearValue := pbData["year"]
		year, ok := yearValue.(int)
		if !ok {
			slog.Error("Invalid year type in pbData")
			s.Stats.Errors++
			continue
		}
		s.TrackProcessedKey(key, year)

		// Process the record - specify fields to compare (excluding year for idempotency)
		compareFields := []string{"cm_id", "name", "gender"}
		if err := s.ProcessSimpleRecord("bunks", key, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing bunk", "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans using base class tracking
	if err := s.DeleteOrphans(
		"bunks",
		func(record *core.Record) (string, bool) {
			// Build composite key from record for comparison
			cmIDValue := record.Get("cm_id")
			yearValue := record.Get("year")

			cmID, cmOK := cmIDValue.(float64)
			year, yearOK := yearValue.(float64)

			if cmOK && yearOK {
				// Return composite key for comparison
				return CompositeKey(int(cmID), int(year)), true
			}
			return "", false
		},
		"bunk",
		filter, // Use the same year filter
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Bunks")
	return nil
}

// transformBunkToPB transforms CampMinder bunk data to PocketBase format
func (s *BunksSync) transformBunkToPB(cmBunk map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract base fields
	if id, ok := cmBunk["ID"].(float64); ok {
		pbData["cm_id"] = int(id)
	} else {
		return nil, fmt.Errorf("missing bunk ID")
	}

	// Name field
	if name, ok := cmBunk["Name"].(string); ok {
		pbData["name"] = name

		// Initialize gender to empty string for consistent comparisons
		pbData["gender"] = ""

		// Determine gender based on bunk name prefix
		switch {
		case strings.HasPrefix(name, "B-"):
			pbData["gender"] = "M"
		case strings.HasPrefix(name, "G-"):
			pbData["gender"] = "F"
		case strings.HasPrefix(name, "AG-"):
			pbData["gender"] = "Mixed"
			// Default: leave as empty string for other bunks (family camp, etc.)
		}
	} else {
		return nil, fmt.Errorf("missing bunk name")
	}

	// Add year field from the season being synced
	pbData["year"] = s.Client.GetSeasonID()

	return pbData, nil
}
