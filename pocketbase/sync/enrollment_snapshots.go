package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameEnrollmentSnapshots is the canonical name for this sync service
const serviceNameEnrollmentSnapshots = "enrollment_snapshots"

// EnrollmentSnapshotsSync captures daily enrollment counts per session.
// This is a Transform phase job: reads PocketBase, writes PocketBase, no CampMinder API calls.
type EnrollmentSnapshotsSync struct {
	App    core.App
	Year   int
	DryRun bool
	Debug  bool
	Stats  Stats
}

// NewEnrollmentSnapshotsSync creates a new enrollment snapshots sync service
func NewEnrollmentSnapshotsSync(app core.App) *EnrollmentSnapshotsSync {
	return &EnrollmentSnapshotsSync{
		App: app,
	}
}

// Name returns the service name
func (s *EnrollmentSnapshotsSync) Name() string {
	return serviceNameEnrollmentSnapshots
}

// GetStats returns the current stats
func (s *EnrollmentSnapshotsSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *EnrollmentSnapshotsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this sync service
func (s *EnrollmentSnapshotsSync) SetYear(year int) {
	s.Year = year
}

// Sync executes the enrollment snapshot capture
func (s *EnrollmentSnapshotsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}

	// Determine year
	year := s.Year
	if year == 0 {
		yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil {
				year = y
			}
		}
		if year == 0 {
			year = 2025
		}
	}

	slog.Info("Starting enrollment snapshots",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Get today's snapshot date (midnight UTC)
	now := time.Now().UTC()
	snapshotDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	snapshotDateStr := snapshotDate.Format("2006-01-02 15:04:05.000Z")

	// Fetch all sessions for the year
	sessionFilter := fmt.Sprintf(
		"year = %d && (session_type = 'main' || session_type = 'embedded' || session_type = 'ag')", year)
	sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("loading sessions: %w", err)
	}

	if len(sessions) == 0 {
		slog.Info("No sessions found for year", "year", year)
		return nil
	}

	slog.Info("Found sessions for enrollment snapshots", "count", len(sessions), "year", year)

	// Get the enrollment_snapshots collection
	col, err := s.App.FindCollectionByNameOrId("enrollment_snapshots")
	if err != nil {
		return fmt.Errorf("finding enrollment_snapshots collection: %w", err)
	}

	for _, session := range sessions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		sessionPBID := session.Id
		sessionCMID := 0
		if cmID, ok := session.Get("cm_id").(float64); ok {
			sessionCMID = int(cmID)
		}
		if sessionCMID == 0 {
			continue
		}

		// Count enrolled: is_active = 1 AND status_id = 2
		enrolledFilter := fmt.Sprintf("year = %d && session = '%s' && is_active = 1 && status_id = 2", year, sessionPBID)
		enrolledRecords, err := s.App.FindRecordsByFilter("attendees", enrolledFilter, "", 0, 0)
		if err != nil {
			slog.Error("Error counting enrolled attendees", "session", sessionCMID, "error", err)
			s.Stats.Errors++
			continue
		}
		enrolledCount := len(enrolledRecords)

		// Count waitlisted
		waitlistedFilter := fmt.Sprintf("year = %d && session = '%s' && status = 'waitlisted'", year, sessionPBID)
		waitlistedRecords, err := s.App.FindRecordsByFilter("attendees", waitlistedFilter, "", 0, 0)
		if err != nil {
			slog.Error("Error counting waitlisted attendees", "session", sessionCMID, "error", err)
			s.Stats.Errors++
			continue
		}
		waitlistedCount := len(waitlistedRecords)

		// Count canceled
		canceledFilter := fmt.Sprintf("year = %d && session = '%s' && status = 'canceled'", year, sessionPBID)
		canceledRecords, err := s.App.FindRecordsByFilter("attendees", canceledFilter, "", 0, 0)
		if err != nil {
			slog.Error("Error counting canceled attendees", "session", sessionCMID, "error", err)
			s.Stats.Errors++
			continue
		}
		canceledCount := len(canceledRecords)

		if s.Debug {
			slog.Info("Enrollment counts",
				"session_cm_id", sessionCMID,
				"enrolled", enrolledCount,
				"waitlisted", waitlistedCount,
				"canceled", canceledCount,
			)
		}

		if s.DryRun {
			s.Stats.Created++
			continue
		}

		// Upsert: find existing by snapshot_date + session_cm_id + year
		existingFilter := fmt.Sprintf(
			"snapshot_date = '%s' && session_cm_id = %d && year = %d",
			snapshotDateStr, sessionCMID, year,
		)
		existing, _ := s.App.FindFirstRecordByFilter("enrollment_snapshots", existingFilter)

		if existing != nil {
			// Update existing record
			existing.Set("enrolled_count", enrolledCount)
			existing.Set("waitlisted_count", waitlistedCount)
			existing.Set("cancelled_count", canceledCount)
			existing.Set("session", sessionPBID)

			if err := s.App.Save(existing); err != nil {
				slog.Error("Error updating enrollment snapshot",
					"session_cm_id", sessionCMID,
					"error", err,
				)
				s.Stats.Errors++
				continue
			}
			s.Stats.Updated++
		} else {
			// Create new record
			record := core.NewRecord(col)
			record.Set("snapshot_date", snapshotDateStr)
			record.Set("year", year)
			record.Set("session_cm_id", sessionCMID)
			record.Set("session", sessionPBID)
			record.Set("enrolled_count", enrolledCount)
			record.Set("waitlisted_count", waitlistedCount)
			record.Set("cancelled_count", canceledCount)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating enrollment snapshot",
					"session_cm_id", sessionCMID,
					"error", err,
				)
				s.Stats.Errors++
				continue
			}
			s.Stats.Created++
		}
	}

	slog.Info("Enrollment snapshots completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"errors", s.Stats.Errors,
	)

	return nil
}
