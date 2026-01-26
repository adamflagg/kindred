package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// personBatchSize is the number of persons to process per batch for lookups
const personBatchSize = 100

// CamperHistorySync computes camper history records with retention metrics.
// This is a pure Go implementation that reads from PocketBase collections
// (attendees, persons, bunk_assignments, camp_sessions) and writes to camper_history.
//
// Unlike other sync services, this doesn't call CampMinder API - it computes
// derived/aggregated data from existing PocketBase records.
type CamperHistorySync struct {
	App            core.App
	Year           int  // Year to compute history for (0 = current year from env)
	DryRun         bool // Dry run mode (compute but don't write)
	Stats          Stats
	SyncSuccessful bool
}

// NewCamperHistorySync creates a new camper history sync service
func NewCamperHistorySync(app core.App) *CamperHistorySync {
	return &CamperHistorySync{
		App:    app,
		Year:   0,     // Default: current year from env
		DryRun: false, // Default: write to database
	}
}

// Name returns the service name
func (c *CamperHistorySync) Name() string {
	return "camper_history"
}

// GetStats returns the current stats
func (c *CamperHistorySync) GetStats() Stats {
	return c.Stats
}

// personData aggregates data for a single person
type personData struct {
	personCMID   int
	sessionNames []string
	bunkNames    []string
	statuses     []string
}

// personDemographics holds person record data
type personDemographics struct {
	firstName string
	lastName  string
	school    string
	city      string
	grade     int
}

// historicalData holds enrollment history for a person
type historicalData struct {
	enrolledYears     []int
	priorYearSessions []string
	priorYearBunks    []string
}

// Sync executes the camper history computation
func (c *CamperHistorySync) Sync(ctx context.Context) error {
	c.Stats = Stats{}
	c.SyncSuccessful = false

	// Determine year
	year := c.Year
	if year == 0 {
		yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil {
				year = y
			}
		}
		if year == 0 {
			year = 2025 // Default fallback
		}
	}

	slog.Info("Starting camper history computation",
		"year", year,
		"dry_run", c.DryRun,
	)

	// Step 1: Load all attendees for the year (ALL statuses, not just enrolled)
	personsData, err := c.loadAttendeesForYear(ctx, year)
	if err != nil {
		return fmt.Errorf("loading attendees: %w", err)
	}

	if len(personsData) == 0 {
		slog.Info("No attendees found for year", "year", year)
		c.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded and grouped attendees", "uniquePersons", len(personsData), "year", year)

	// Extract person CM IDs for batch lookups
	personCMIDs := make([]int, 0, len(personsData))
	for personCMID := range personsData {
		personCMIDs = append(personCMIDs, personCMID)
	}

	// Step 2: Load person demographics (batched)
	demographics, err := c.loadPersonDemographics(ctx, personCMIDs, year)
	if err != nil {
		return fmt.Errorf("loading person demographics: %w", err)
	}
	slog.Info("Loaded person demographics", "count", len(demographics))

	// Step 3: Load bunk assignments for current year
	bunksByPerson, err := c.loadBunkAssignments(ctx, year)
	if err != nil {
		return fmt.Errorf("loading bunk assignments: %w", err)
	}
	slog.Info("Loaded bunk assignments", "personsWithBunks", len(bunksByPerson))

	// Step 4: Load historical enrollment data for retention metrics
	historical, err := c.loadHistoricalEnrollments(ctx, personCMIDs, year)
	if err != nil {
		return fmt.Errorf("loading historical enrollments: %w", err)
	}
	slog.Info("Loaded historical enrollment data")

	// Step 5: Compute and write records
	if c.DryRun {
		slog.Info("Dry run mode - computing but not writing", "records", len(personsData))
		c.Stats.Created = len(personsData)
		c.SyncSuccessful = true
		return nil
	}

	// Clear existing records for the year
	deleted, err := c.clearExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("clearing existing records: %w", err)
	}
	c.Stats.Deleted = deleted
	slog.Info("Cleared existing records", "deleted", deleted, "year", year)

	// Get collection for writing
	col, err := c.App.FindCollectionByNameOrId("camper_history")
	if err != nil {
		return fmt.Errorf("finding camper_history collection: %w", err)
	}

	// Write new records
	for personCMID, pd := range personsData {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		demo := demographics[personCMID]
		hist := historical[personCMID]
		bunks := bunksByPerson[personCMID]

		// Merge bunks from assignments
		for _, b := range bunks {
			found := false
			for _, existing := range pd.bunkNames {
				if existing == b {
					found = true
					break
				}
			}
			if !found {
				pd.bunkNames = append(pd.bunkNames, b)
			}
		}

		// Compute retention metrics
		isReturning := c.computeIsReturning(year, hist.enrolledYears)
		yearsAtCamp := c.computeYearsAtCamp(hist.enrolledYears)

		// Prior year data
		priorYearSessions := joinStrings(hist.priorYearSessions)
		priorYearBunks := joinStrings(hist.priorYearBunks)

		// Build record
		record := core.NewRecord(col)
		record.Set("person_id", personCMID)
		record.Set("first_name", demo.firstName)
		record.Set("last_name", demo.lastName)
		record.Set("year", year)
		record.Set("sessions", joinStrings(pd.sessionNames))
		record.Set("bunks", joinStrings(pd.bunkNames))
		record.Set("school", demo.school)
		record.Set("city", demo.city)
		if demo.grade > 0 {
			record.Set("grade", demo.grade)
		}
		record.Set("is_returning", isReturning)
		record.Set("years_at_camp", yearsAtCamp)
		if priorYearSessions != "" {
			record.Set("prior_year_sessions", priorYearSessions)
		}
		if priorYearBunks != "" {
			record.Set("prior_year_bunks", priorYearBunks)
		}

		if err := c.App.Save(record); err != nil {
			slog.Error("Error creating camper history record", "personCMID", personCMID, "error", err)
			c.Stats.Errors++
			continue
		}
		c.Stats.Created++
	}

	// WAL checkpoint
	if c.Stats.Created > 0 || c.Stats.Deleted > 0 {
		if err := c.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	c.SyncSuccessful = true
	slog.Info("Camper history computation completed",
		"year", year,
		"created", c.Stats.Created,
		"deleted", c.Stats.Deleted,
		"errors", c.Stats.Errors,
	)

	return nil
}

// SyncForYear computes history for a specific year
func (c *CamperHistorySync) SyncForYear(ctx context.Context, year int) error {
	c.Year = year
	return c.Sync(ctx)
}

// loadAttendeesForYear loads all attendees for a year and groups by person
// Includes ALL statuses (enrolled, canceled, withdrawn, etc.)
func (c *CamperHistorySync) loadAttendeesForYear(ctx context.Context, year int) (map[int]*personData, error) {
	result := make(map[int]*personData)

	// No status filter - include all attendees
	filter := fmt.Sprintf("year = %d", year)

	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := c.App.FindRecordsByFilter(
			"attendees",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		for _, record := range records {
			personCMID := 0
			if pid, ok := record.Get("person_id").(float64); ok {
				personCMID = int(pid)
			}
			if personCMID == 0 {
				continue
			}

			status := record.GetString("status")

			// Get session name via relation
			sessionName := ""
			if sessionID := record.GetString("session"); sessionID != "" {
				sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
				sessions, err := c.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
				if err == nil && len(sessions) > 0 {
					sessionName = sessions[0].GetString("name")
				}
			}

			// Add or update person data
			if _, exists := result[personCMID]; !exists {
				result[personCMID] = &personData{
					personCMID:   personCMID,
					sessionNames: []string{},
					bunkNames:    []string{},
					statuses:     []string{},
				}
			}
			pd := result[personCMID]

			// Add session name if not already present
			if sessionName != "" {
				found := false
				for _, s := range pd.sessionNames {
					if s == sessionName {
						found = true
						break
					}
				}
				if !found {
					pd.sessionNames = append(pd.sessionNames, sessionName)
				}
			}

			// Track status
			pd.statuses = append(pd.statuses, status)
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// loadPersonDemographics loads demographics for persons in batches
func (c *CamperHistorySync) loadPersonDemographics(
	ctx context.Context, personCMIDs []int, year int,
) (map[int]personDemographics, error) {
	result := make(map[int]personDemographics)

	// Split into batches
	batches := c.splitIntoBatches(personCMIDs, personBatchSize)

	for _, batch := range batches {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Build OR filter for this batch
		conditions := make([]string, len(batch))
		for i, cmID := range batch {
			conditions[i] = fmt.Sprintf("cm_id = %d", cmID)
		}
		filter := fmt.Sprintf("(%s) && year = %d", strings.Join(conditions, " || "), year)

		records, err := c.App.FindRecordsByFilter("persons", filter, "", 0, 0)
		if err != nil {
			slog.Warn("Error loading persons batch", "error", err)
			continue
		}

		for _, record := range records {
			cmID := 0
			if id, ok := record.Get("cm_id").(float64); ok {
				cmID = int(id)
			}
			if cmID == 0 {
				continue
			}

			grade := 0
			if g, ok := record.Get("grade").(float64); ok {
				grade = int(g)
			}

			result[cmID] = personDemographics{
				firstName: record.GetString("first_name"),
				lastName:  record.GetString("last_name"),
				school:    record.GetString("school"),
				city:      record.GetString("city"),
				grade:     grade,
			}
		}
	}

	return result, nil
}

// loadBunkAssignments loads bunk assignments grouped by person
func (c *CamperHistorySync) loadBunkAssignments(ctx context.Context, year int) (map[int][]string, error) {
	result := make(map[int][]string)

	filter := fmt.Sprintf("year = %d && is_deleted = false", year)

	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := c.App.FindRecordsByFilter(
			"bunk_assignments",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return nil, fmt.Errorf("querying bunk assignments page %d: %w", page, err)
		}

		for _, record := range records {
			// Get person CM ID via relation
			personCMID := 0
			if personID := record.GetString("person"); personID != "" {
				personFilter := fmt.Sprintf("id = '%s'", personID)
				persons, err := c.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
				if err == nil && len(persons) > 0 {
					if cmID, ok := persons[0].Get("cm_id").(float64); ok {
						personCMID = int(cmID)
					}
				}
			}
			if personCMID == 0 {
				continue
			}

			// Get bunk name via relation
			bunkName := ""
			if bunkID := record.GetString("bunk"); bunkID != "" {
				bunkFilter := fmt.Sprintf("id = '%s'", bunkID)
				bunks, err := c.App.FindRecordsByFilter("bunks", bunkFilter, "", 1, 0)
				if err == nil && len(bunks) > 0 {
					bunkName = bunks[0].GetString("name")
				}
			}

			if bunkName != "" {
				// Add bunk if not already present
				found := false
				for _, b := range result[personCMID] {
					if b == bunkName {
						found = true
						break
					}
				}
				if !found {
					result[personCMID] = append(result[personCMID], bunkName)
				}
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// loadHistoricalEnrollments loads historical data for retention metrics
func (c *CamperHistorySync) loadHistoricalEnrollments(
	ctx context.Context, personCMIDs []int, currentYear int,
) (map[int]*historicalData, error) {
	result := make(map[int]*historicalData)

	// Initialize for all persons
	for _, cmID := range personCMIDs {
		result[cmID] = &historicalData{
			enrolledYears:     []int{},
			priorYearSessions: []string{},
			priorYearBunks:    []string{},
		}
	}

	priorYear := currentYear - 1

	// Query historical attendees in batches
	batches := c.splitIntoBatches(personCMIDs, personBatchSize)

	for _, batch := range batches {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Build OR filter for persons
		personConditions := make([]string, len(batch))
		for i, cmID := range batch {
			personConditions[i] = fmt.Sprintf("person_id = %d", cmID)
		}

		// Query years before current year with enrolled status
		filter := fmt.Sprintf("(%s) && year < %d && status = 'enrolled'",
			strings.Join(personConditions, " || "), currentYear)

		records, err := c.App.FindRecordsByFilter("attendees", filter, "", 0, 0)
		if err != nil {
			slog.Warn("Error loading historical attendees", "error", err)
			continue
		}

		for _, record := range records {
			personCMID := 0
			if pid, ok := record.Get("person_id").(float64); ok {
				personCMID = int(pid)
			}
			if personCMID == 0 {
				continue
			}

			yr := 0
			if y, ok := record.Get("year").(float64); ok {
				yr = int(y)
			}
			if yr == 0 {
				continue
			}

			hist := result[personCMID]
			if hist == nil {
				continue
			}

			// Add year to enrolled years if not present
			found := false
			for _, ey := range hist.enrolledYears {
				if ey == yr {
					found = true
					break
				}
			}
			if !found {
				hist.enrolledYears = append(hist.enrolledYears, yr)
			}

			// If this is prior year, get session name
			if yr == priorYear {
				if sessionID := record.GetString("session"); sessionID != "" {
					sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
					sessions, err := c.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
					if err == nil && len(sessions) > 0 {
						sessionName := sessions[0].GetString("name")
						if sessionName != "" {
							found := false
							for _, s := range hist.priorYearSessions {
								if s == sessionName {
									found = true
									break
								}
							}
							if !found {
								hist.priorYearSessions = append(hist.priorYearSessions, sessionName)
							}
						}
					}
				}
			}
		}
	}

	// Load prior year bunk assignments
	priorBunkFilter := fmt.Sprintf("year = %d && is_deleted = false", priorYear)
	bunkRecords, err := c.App.FindRecordsByFilter("bunk_assignments", priorBunkFilter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading prior year bunk assignments", "error", err)
	} else {
		for _, record := range bunkRecords {
			// Get person CM ID
			personCMID := 0
			if personID := record.GetString("person"); personID != "" {
				personFilter := fmt.Sprintf("id = '%s'", personID)
				persons, err := c.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
				if err == nil && len(persons) > 0 {
					if cmID, ok := persons[0].Get("cm_id").(float64); ok {
						personCMID = int(cmID)
					}
				}
			}
			if personCMID == 0 {
				continue
			}

			hist := result[personCMID]
			if hist == nil {
				continue
			}

			// Get bunk name
			if bunkID := record.GetString("bunk"); bunkID != "" {
				bunkFilter := fmt.Sprintf("id = '%s'", bunkID)
				bunks, err := c.App.FindRecordsByFilter("bunks", bunkFilter, "", 1, 0)
				if err == nil && len(bunks) > 0 {
					bunkName := bunks[0].GetString("name")
					if bunkName != "" {
						found := false
						for _, b := range hist.priorYearBunks {
							if b == bunkName {
								found = true
								break
							}
						}
						if !found {
							hist.priorYearBunks = append(hist.priorYearBunks, bunkName)
						}
					}
				}
			}
		}
	}

	return result, nil
}

// clearExistingRecords deletes all camper_history records for a year
func (c *CamperHistorySync) clearExistingRecords(_ context.Context, year int) (int, error) {
	deleted := 0

	filter := fmt.Sprintf("year = %d", year)

	for {
		records, err := c.App.FindRecordsByFilter("camper_history", filter, "", 100, 0)
		if err != nil {
			return deleted, fmt.Errorf("querying existing records: %w", err)
		}

		if len(records) == 0 {
			break
		}

		for _, record := range records {
			if err := c.App.Delete(record); err != nil {
				slog.Error("Error deleting camper history record", "id", record.Id, "error", err)
				continue
			}
			deleted++
		}
	}

	return deleted, nil
}

// computeIsReturning checks if person was enrolled in the previous year
func (c *CamperHistorySync) computeIsReturning(currentYear int, enrolledYears []int) bool {
	priorYear := currentYear - 1
	for _, y := range enrolledYears {
		if y == priorYear {
			return true
		}
	}
	return false
}

// computeYearsAtCamp counts distinct enrollment years plus current year
func (c *CamperHistorySync) computeYearsAtCamp(enrolledYears []int) int {
	yearSet := make(map[int]bool)
	for _, y := range enrolledYears {
		yearSet[y] = true
	}
	// +1 for current year
	return len(yearSet) + 1
}

// splitIntoBatches splits a slice into batches
func (c *CamperHistorySync) splitIntoBatches(ids []int, batchSize int) [][]int {
	var batches [][]int
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batches = append(batches, ids[i:end])
	}
	return batches
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (c *CamperHistorySync) forceWALCheckpoint() error {
	db := c.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	return nil
}

// joinStrings sorts and joins strings with ", "
func joinStrings(strs []string) string {
	if len(strs) == 0 {
		return ""
	}
	sorted := make([]string, len(strs))
	copy(sorted, strs)
	sort.Strings(sorted)
	return strings.Join(sorted, ", ")
}
