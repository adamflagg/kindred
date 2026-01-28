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

// serviceNameCamperHistory is the canonical name for this sync service
const serviceNameCamperHistory = "camper_history"

// statusEnrolled is the enrolled status string used in comparisons
const statusEnrolled = "enrolled"

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
	personCMID      int
	sessionNames    []string
	sessionTypes    []string // Session types (main, ag, embedded, family, etc.)
	bunkNames       []string
	statuses        []string
	enrollmentDates []string // Track enrollment dates for earliest calculation
}

// personDemographics holds person record data
type personDemographics struct {
	firstName    string
	lastName     string
	school       string
	city         string
	grade        int
	householdID  int    // CampMinder household ID
	gender       string // M, F, etc.
	divisionID   string // PocketBase ID for division relation
	divisionName string // Resolved division name
	yearsAtCamp  int    // CampMinder's YearsAtCamp value
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

	// Step 5: Load synagogue data from household custom values
	synagogueByHousehold, err := c.loadSynagogueByHousehold(ctx, year)
	if err != nil {
		slog.Warn("Error loading synagogue data, continuing without", "error", err)
		synagogueByHousehold = make(map[int]string) // Use empty map
	}

	// Step 6: Compute and write records
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
		// Use CampMinder's authoritative years_at_camp, fall back to computed if not available
		yearsAtCamp := demo.yearsAtCamp
		if yearsAtCamp == 0 {
			yearsAtCamp = c.computeYearsAtCamp(hist.enrolledYears)
		}
		firstYearAttended := c.computeFirstYearAttended(year, hist.enrolledYears)

		// Prior year data
		priorYearSessions := joinStrings(hist.priorYearSessions)
		priorYearBunks := joinStrings(hist.priorYearBunks)

		// Compute new aggregated fields
		aggregatedStatus := c.computeAggregatedStatus(pd.statuses)
		earliestEnrollmentDate := c.computeEarliestEnrollmentDate(pd.enrollmentDates)

		// Lookup synagogue by household
		synagogue := ""
		if demo.householdID > 0 {
			synagogue = synagogueByHousehold[demo.householdID]
		}

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

		// New fields (v2)
		if demo.householdID > 0 {
			record.Set("household_id", demo.householdID)
		}
		if demo.gender != "" {
			record.Set("gender", demo.gender)
		}
		if demo.divisionName != "" {
			record.Set("division_name", demo.divisionName)
		}
		if earliestEnrollmentDate != "" {
			record.Set("enrollment_date", earliestEnrollmentDate)
		}
		if aggregatedStatus != "" {
			record.Set("status", aggregatedStatus)
		}
		if synagogue != "" {
			record.Set("synagogue", synagogue)
		}
		record.Set("first_year_attended", firstYearAttended)

		// Session types for filtering (e.g., exclude family camp from summer metrics)
		sessionTypes := joinStrings(pd.sessionTypes)
		if sessionTypes != "" {
			record.Set("session_types", sessionTypes)
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

			// Get session name and type via relation
			sessionName := ""
			sessionType := ""
			if sessionID := record.GetString("session"); sessionID != "" {
				sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
				sessions, err := c.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
				if err == nil && len(sessions) > 0 {
					sessionName = sessions[0].GetString("name")
					sessionType = sessions[0].GetString("session_type")
				}
			}

			// Get enrollment date
			enrollmentDate := record.GetString("enrollment_date")

			// Add or update person data
			if _, exists := result[personCMID]; !exists {
				result[personCMID] = &personData{
					personCMID:      personCMID,
					sessionNames:    []string{},
					sessionTypes:    []string{},
					bunkNames:       []string{},
					statuses:        []string{},
					enrollmentDates: []string{},
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

			// Add session type if not already present
			if sessionType != "" {
				found := false
				for _, t := range pd.sessionTypes {
					if t == sessionType {
						found = true
						break
					}
				}
				if !found {
					pd.sessionTypes = append(pd.sessionTypes, sessionType)
				}
			}

			// Track status and enrollment date
			pd.statuses = append(pd.statuses, status)
			pd.enrollmentDates = append(pd.enrollmentDates, enrollmentDate)
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

			householdID := 0
			if hid, ok := record.Get("household_id").(float64); ok {
				householdID = int(hid)
			}

			yearsAtCamp := 0
			if yac, ok := record.Get("years_at_camp").(float64); ok {
				yearsAtCamp = int(yac)
			}

			result[cmID] = personDemographics{
				firstName:   record.GetString("first_name"),
				lastName:    record.GetString("last_name"),
				school:      record.GetString("school"),
				city:        record.GetString("city"),
				grade:       grade,
				householdID: householdID,
				gender:      record.GetString("gender"),
				divisionID:  record.GetString("division"), // PocketBase relation ID
				yearsAtCamp: yearsAtCamp,
			}
		}
	}

	// Resolve division names for persons with division relations
	divisionNames, err := c.loadDivisionNames(ctx)
	if err != nil {
		slog.Warn("Error loading division names", "error", err)
		// Continue without division names
	} else {
		for cmID := range result {
			demo := result[cmID]
			if demo.divisionID != "" {
				if name, ok := divisionNames[demo.divisionID]; ok {
					demo.divisionName = name
					result[cmID] = demo
				}
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

// loadDivisionNames loads all divisions and returns a map of PB ID -> name
func (c *CamperHistorySync) loadDivisionNames(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := c.App.FindRecordsByFilter("divisions", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying divisions: %w", err)
	}

	for _, record := range records {
		result[record.Id] = record.GetString("name")
	}

	return result, nil
}

// loadSynagogueByHousehold loads synagogue values from household_custom_values
// Returns a map of household CM ID -> synagogue name
func (c *CamperHistorySync) loadSynagogueByHousehold(ctx context.Context, year int) (map[int]string, error) {
	result := make(map[int]string)

	// First, find the custom field definition for "Synagogue"
	fieldFilter := `name = "Synagogue"`
	fieldDefs, err := c.App.FindRecordsByFilter("custom_field_defs", fieldFilter, "", 1, 0)
	if err != nil || len(fieldDefs) == 0 {
		slog.Debug("Synagogue custom field not found", "error", err)
		return result, nil // Return empty map if field doesn't exist
	}
	synagogueFieldID := fieldDefs[0].Id

	// Query household_custom_values for synagogue field
	filter := fmt.Sprintf("field_definition = '%s' && year = %d", synagogueFieldID, year)

	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := c.App.FindRecordsByFilter(
			"household_custom_values",
			filter,
			"",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return nil, fmt.Errorf("querying household_custom_values page %d: %w", page, err)
		}

		for _, record := range records {
			value := record.GetString("value")
			if value == "" {
				continue
			}

			// Get household CM ID via relation
			householdID := record.GetString("household")
			if householdID == "" {
				continue
			}

			// Look up household CM ID
			householdFilter := fmt.Sprintf("id = '%s'", householdID)
			households, err := c.App.FindRecordsByFilter("households", householdFilter, "", 1, 0)
			if err != nil || len(households) == 0 {
				continue
			}

			householdCMID := 0
			if hcmid, ok := households[0].Get("cm_id").(float64); ok {
				householdCMID = int(hcmid)
			}
			if householdCMID == 0 {
				continue
			}

			result[householdCMID] = value
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded synagogue data", "householdsWithSynagogue", len(result))
	return result, nil
}

// computeAggregatedStatus returns "enrolled" if any status is enrolled, otherwise first non-empty
func (c *CamperHistorySync) computeAggregatedStatus(statuses []string) string {
	if len(statuses) == 0 {
		return ""
	}
	// Check for enrolled first (highest priority)
	for _, s := range statuses {
		if s == statusEnrolled {
			return statusEnrolled
		}
	}
	// Return first non-empty status
	for _, s := range statuses {
		if s != "" {
			return s
		}
	}
	return ""
}

// computeEarliestEnrollmentDate returns the earliest non-empty date from a list
func (c *CamperHistorySync) computeEarliestEnrollmentDate(dates []string) string {
	earliest := ""
	for _, d := range dates {
		if d == "" {
			continue
		}
		if earliest == "" || d < earliest {
			earliest = d
		}
	}
	return earliest
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

// computeFirstYearAttended returns the first year a camper attended camp
// For new campers (no history), returns current year
// For returning campers, returns the minimum of enrolled years
func (c *CamperHistorySync) computeFirstYearAttended(currentYear int, enrolledYears []int) int {
	if len(enrolledYears) == 0 {
		return currentYear // New camper, this is their first year
	}
	minYear := enrolledYears[0]
	for _, y := range enrolledYears[1:] {
		if y < minYear {
			minYear = y
		}
	}
	return minYear
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
