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

// countByGender counts male and female attendees using a person gender map.
// Persons with gender other than "M" or "F" (or missing from the map) are excluded.
func countByGender(records []*core.Record, personGenderMap map[int]string) (male, female int) {
	for _, r := range records {
		pid := 0
		if v, ok := r.Get("person_id").(float64); ok {
			pid = int(v)
		}
		if pid == 0 {
			continue
		}
		switch personGenderMap[pid] {
		case "M":
			male++
		case "F":
			female++
		}
	}
	return male, female
}

// buildPersonGenderMap queries all persons for the year and returns a map of cm_id → gender.
func buildPersonGenderMap(app core.App, year int) (map[int]string, error) {
	filter := fmt.Sprintf("year = %d", year)
	persons, err := app.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading persons for gender map: %w", err)
	}

	genderMap := make(map[int]string, len(persons))
	for _, p := range persons {
		cmID := 0
		if v, ok := p.Get("cm_id").(float64); ok {
			cmID = int(v)
		}
		if cmID == 0 {
			continue
		}
		if g := p.GetString("gender"); g != "" {
			genderMap[cmID] = g
		}
	}
	return genderMap, nil
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

	// Build person gender map for gender counting
	personGenderMap, err := buildPersonGenderMap(s.App, year)
	if err != nil {
		slog.Warn("Could not build person gender map, gender counts will be zero", "error", err)
		personGenderMap = make(map[int]string)
	}

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

		// Count cancelled
		cancelledFilter := fmt.Sprintf("year = %d && session = '%s' && status = 'cancelled'", year, sessionPBID)
		cancelledRecords, err := s.App.FindRecordsByFilter("attendees", cancelledFilter, "", 0, 0)
		if err != nil {
			slog.Error("Error counting cancelled attendees", "session", sessionCMID, "error", err)
			s.Stats.Errors++
			continue
		}
		cancelledCount := len(cancelledRecords)

		// Count by gender using already-fetched record slices
		enrolledMale, enrolledFemale := countByGender(enrolledRecords, personGenderMap)
		waitlistedMale, waitlistedFemale := countByGender(waitlistedRecords, personGenderMap)
		cancelledMale, cancelledFemale := countByGender(cancelledRecords, personGenderMap)

		if s.Debug {
			slog.Info("Enrollment counts",
				"session_cm_id", sessionCMID,
				"enrolled", enrolledCount,
				"waitlisted", waitlistedCount,
				"cancelled", cancelledCount,
				"enrolled_m", enrolledMale,
				"enrolled_f", enrolledFemale,
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
			// Check if anything actually changed
			existingEnrolled, _ := existing.Get("enrolled_count").(float64)
			existingWaitlisted, _ := existing.Get("waitlisted_count").(float64)
			existingCancelled, _ := existing.Get("cancelled_count").(float64)
			existingEnrolledMale, _ := existing.Get("enrolled_male_count").(float64)
			existingEnrolledFemale, _ := existing.Get("enrolled_female_count").(float64)
			existingWaitlistedMale, _ := existing.Get("waitlisted_male_count").(float64)
			existingWaitlistedFemale, _ := existing.Get("waitlisted_female_count").(float64)
			existingCancelledMale, _ := existing.Get("cancelled_male_count").(float64)
			existingCancelledFemale, _ := existing.Get("cancelled_female_count").(float64)

			if int(existingEnrolled) == enrolledCount &&
				int(existingWaitlisted) == waitlistedCount &&
				int(existingCancelled) == cancelledCount &&
				int(existingEnrolledMale) == enrolledMale &&
				int(existingEnrolledFemale) == enrolledFemale &&
				int(existingWaitlistedMale) == waitlistedMale &&
				int(existingWaitlistedFemale) == waitlistedFemale &&
				int(existingCancelledMale) == cancelledMale &&
				int(existingCancelledFemale) == cancelledFemale {
				s.Stats.Skipped++
				continue
			}

			// Update existing record
			existing.Set("enrolled_count", enrolledCount)
			existing.Set("waitlisted_count", waitlistedCount)
			existing.Set("cancelled_count", cancelledCount)
			existing.Set("enrolled_male_count", enrolledMale)
			existing.Set("enrolled_female_count", enrolledFemale)
			existing.Set("waitlisted_male_count", waitlistedMale)
			existing.Set("waitlisted_female_count", waitlistedFemale)
			existing.Set("cancelled_male_count", cancelledMale)
			existing.Set("cancelled_female_count", cancelledFemale)
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
			record.Set("cancelled_count", cancelledCount)
			record.Set("enrolled_male_count", enrolledMale)
			record.Set("enrolled_female_count", enrolledFemale)
			record.Set("waitlisted_male_count", waitlistedMale)
			record.Set("waitlisted_female_count", waitlistedFemale)
			record.Set("cancelled_male_count", cancelledMale)
			record.Set("cancelled_female_count", cancelledFemale)

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
		"skipped", s.Stats.Skipped,
		"errors", s.Stats.Errors,
	)

	return nil
}
