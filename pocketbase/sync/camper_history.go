package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
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

// Session type constants for retention context groupings
var (
	summerSessionTypes = []string{"main", "embedded", "ag", "quest", "teen", "tli", "training"}
	familySessionTypes = []string{"family", "adult"}
)

// CamperHistorySync computes camper history records with retention metrics.
// V2: Creates one record per (person_id, session_cm_id, year) - not deduplicated per person.
//
// This is a pure Go implementation that reads from PocketBase collections
// (attendees, persons, bunk_assignments, camp_sessions) and writes to camper_history.
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
	return serviceNameCamperHistory
}

// GetStats returns the current stats
func (c *CamperHistorySync) GetStats() Stats {
	return c.Stats
}

// attendeeRecord holds raw attendee data from the database
type attendeeRecord struct {
	personCMID     int
	personPBID     string // PocketBase ID for person relation
	sessionCMID    int
	sessionPBID    string // PocketBase ID for session relation
	sessionName    string
	sessionType    string
	year           int
	status         string
	enrollmentDate string
}

// personDemographics holds person record data (cached by CM ID)
type personDemographics struct {
	pbID         string // PocketBase record ID for relation
	firstName    string
	lastName     string
	school       string
	city         string
	grade        int
	age          float64 // CampMinder's age value (can be decimal)
	householdID  int     // CampMinder household ID
	gender       string  // M, F, etc.
	divisionID   string  // PocketBase ID for division relation
	divisionName string  // Resolved division name
	yearsAtCamp  int     // CampMinder's YearsAtCamp value
}

// bunkAssignmentKey uniquely identifies a bunk assignment by (person PB ID, session PB ID, year)
type bunkAssignmentKey struct {
	personPBID  string
	sessionPBID string
	year        int
}

// bunkAssignment holds bunk data for a specific person-session-year
type bunkAssignment struct {
	bunkName string
	bunkCMID int
}

// historicalEnrollment holds a single historical enrollment record
type historicalEnrollment struct {
	year        int
	sessionType string
	status      string
}

// Sync executes the camper history computation (V2: per-attendee records)
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

	slog.Info("Starting camper history v2 computation",
		"year", year,
		"dry_run", c.DryRun,
	)

	// Step 1: Load all attendees for the year (not grouped - each is a separate record)
	attendees, err := c.loadAttendeesForYear(ctx, year)
	if err != nil {
		return fmt.Errorf("loading attendees: %w", err)
	}

	if len(attendees) == 0 {
		slog.Info("No attendees found for year", "year", year)
		c.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded attendee records", "count", len(attendees), "year", year)

	// Extract unique person CM IDs for batch lookups
	personCMIDSet := make(map[int]bool)
	for _, a := range attendees {
		personCMIDSet[a.personCMID] = true
	}
	personCMIDs := make([]int, 0, len(personCMIDSet))
	for cmID := range personCMIDSet {
		personCMIDs = append(personCMIDs, cmID)
	}

	// Step 2: Load person demographics (batched)
	demographics, err := c.loadPersonDemographics(ctx, personCMIDs, year)
	if err != nil {
		return fmt.Errorf("loading person demographics: %w", err)
	}
	slog.Info("Loaded person demographics", "count", len(demographics))

	// Step 3: Load bunk assignments keyed by (person, session, year)
	bunkAssignments, err := c.loadBunkAssignmentsBySession(ctx, year)
	if err != nil {
		return fmt.Errorf("loading bunk assignments: %w", err)
	}
	slog.Info("Loaded bunk assignments", "count", len(bunkAssignments))

	// Step 4: Load historical enrollments for retention metrics (all years for these persons)
	historicalEnrollments, err := c.loadHistoricalEnrollments(ctx, personCMIDs, year)
	if err != nil {
		return fmt.Errorf("loading historical enrollments: %w", err)
	}
	slog.Info("Loaded historical enrollment data")

	// Step 5: Load synagogue data from household custom values
	synagogueByHousehold, err := c.loadSynagogueByHousehold(ctx, year)
	if err != nil {
		slog.Warn("Error loading synagogue data, continuing without", "error", err)
		synagogueByHousehold = make(map[int]string)
	}

	// Step 6: Compute and write records
	if c.DryRun {
		slog.Info("Dry run mode - computing but not writing", "records", len(attendees))
		c.Stats.Created = len(attendees)
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

	// Deduplicate by unique key (person_id, session_cm_id, year) in case of dupe attendee records
	seen := make(map[string]bool)

	// Write one record per attendee
	for _, attendee := range attendees {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Deduplicate by unique key
		key := fmt.Sprintf("%d-%d-%d", attendee.personCMID, attendee.sessionCMID, attendee.year)
		if seen[key] {
			continue
		}
		seen[key] = true

		demo := demographics[attendee.personCMID]
		hist := historicalEnrollments[attendee.personCMID]

		// Look up bunk assignment for this specific (person, session, year)
		bunkKey := bunkAssignmentKey{
			personPBID:  attendee.personPBID,
			sessionPBID: attendee.sessionPBID,
			year:        year,
		}
		bunk := bunkAssignments[bunkKey]

		// Compute context-aware retention metrics
		isReturningSummer := c.computeIsReturningSummer(year, hist)
		isReturningFamily := c.computeIsReturningFamily(year, hist)
		firstYearSummer := c.computeFirstYearSummer(year, hist)
		firstYearFamily := c.computeFirstYearFamily(hist)

		// Use CampMinder's authoritative years_at_camp
		yearsAtCamp := demo.yearsAtCamp
		if yearsAtCamp == 0 {
			// Fall back to computed if not available
			yearsAtCamp = c.computeYearsAtCamp(hist)
		}

		// Lookup synagogue by household
		synagogue := ""
		if demo.householdID > 0 {
			synagogue = synagogueByHousehold[demo.householdID]
		}

		// Build record
		record := core.NewRecord(col)

		// Identity fields
		record.Set("person_id", attendee.personCMID)
		if demo.pbID != "" {
			record.Set("person", demo.pbID)
		}
		record.Set("session_cm_id", attendee.sessionCMID)
		if attendee.sessionPBID != "" {
			record.Set("session", attendee.sessionPBID)
		}
		record.Set("year", year)

		// Session context (denormalized)
		record.Set("session_name", attendee.sessionName)
		if attendee.sessionType != "" {
			record.Set("session_type", attendee.sessionType)
		}

		// Person demographics (denormalized)
		record.Set("first_name", demo.firstName)
		record.Set("last_name", demo.lastName)
		if demo.gender != "" {
			record.Set("gender", demo.gender)
		}
		if demo.grade > 0 {
			record.Set("grade", demo.grade)
		}
		if demo.age > 0 {
			record.Set("age", demo.age)
		}
		record.Set("school", demo.school)
		record.Set("city", demo.city)
		if demo.householdID > 0 {
			record.Set("household_id", demo.householdID)
		}
		if demo.divisionName != "" {
			record.Set("division_name", demo.divisionName)
		}

		// Enrollment details
		if attendee.status != "" {
			record.Set("status", attendee.status)
		}
		if attendee.enrollmentDate != "" {
			record.Set("enrollment_date", attendee.enrollmentDate)
		}

		// Bunk assignment (session-specific)
		if bunk.bunkName != "" {
			record.Set("bunk_name", bunk.bunkName)
		}
		if bunk.bunkCMID > 0 {
			record.Set("bunk_cm_id", bunk.bunkCMID)
		}

		// Retention metrics (context-aware)
		record.Set("is_returning_summer", isReturningSummer)
		record.Set("is_returning_family", isReturningFamily)
		if firstYearSummer > 0 {
			record.Set("first_year_summer", firstYearSummer)
		}
		if firstYearFamily > 0 {
			record.Set("first_year_family", firstYearFamily)
		}
		record.Set("years_at_camp", yearsAtCamp)

		// Household extras
		if synagogue != "" {
			record.Set("synagogue", synagogue)
		}

		if err := c.App.Save(record); err != nil {
			slog.Error("Error creating camper history record",
				"personCMID", attendee.personCMID,
				"sessionCMID", attendee.sessionCMID,
				"error", err)
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
	slog.Info("Camper history v2 computation completed",
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

// loadAttendeesForYear loads all attendees for a year (not grouped - one record per attendee)
func (c *CamperHistorySync) loadAttendeesForYear(ctx context.Context, year int) ([]attendeeRecord, error) {
	var result []attendeeRecord

	filter := fmt.Sprintf("year = %d", year)

	page := 1
	perPage := 500

	// Cache session lookups to avoid repeated queries
	sessionCache := make(map[string]struct {
		name        string
		sessionType string
		cmID        int
	})

	// Cache person PB ID lookups
	personPBIDCache := make(map[int]string)

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

			// Get person PB ID (via person relation)
			personPBID := ""
			if personRel := record.GetString("person"); personRel != "" {
				personPBID = personRel
				personPBIDCache[personCMID] = personPBID
			} else if cached, ok := personPBIDCache[personCMID]; ok {
				personPBID = cached
			}

			// Get session info
			sessionPBID := record.GetString("session")
			sessionName := ""
			sessionType := ""
			sessionCMID := 0

			if sessionPBID != "" {
				if cached, ok := sessionCache[sessionPBID]; ok {
					sessionName = cached.name
					sessionType = cached.sessionType
					sessionCMID = cached.cmID
				} else {
					// Look up session
					sessionFilter := fmt.Sprintf("id = '%s'", sessionPBID)
					sessions, err := c.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
					if err == nil && len(sessions) > 0 {
						sessionName = sessions[0].GetString("name")
						sessionType = sessions[0].GetString("session_type")
						if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
							sessionCMID = int(cmID)
						}
						sessionCache[sessionPBID] = struct {
							name        string
							sessionType string
							cmID        int
						}{sessionName, sessionType, sessionCMID}
					}
				}
			}

			result = append(result, attendeeRecord{
				personCMID:     personCMID,
				personPBID:     personPBID,
				sessionCMID:    sessionCMID,
				sessionPBID:    sessionPBID,
				sessionName:    sessionName,
				sessionType:    sessionType,
				year:           year,
				status:         record.GetString("status"),
				enrollmentDate: record.GetString("enrollment_date"),
			})
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

			age := 0.0
			if a, ok := record.Get("age").(float64); ok {
				age = a
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
				pbID:        record.Id,
				firstName:   record.GetString("first_name"),
				lastName:    record.GetString("last_name"),
				school:      record.GetString("school"),
				city:        record.GetString("city"),
				grade:       grade,
				age:         age,
				householdID: householdID,
				gender:      record.GetString("gender"),
				divisionID:  record.GetString("division"),
				yearsAtCamp: yearsAtCamp,
			}
		}
	}

	// Resolve division names for persons with division relations
	divisionNames, err := c.loadDivisionNames(ctx)
	if err != nil {
		slog.Warn("Error loading division names", "error", err)
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

// loadBunkAssignmentsBySession loads bunk assignments keyed by (person PB ID, session PB ID, year)
func (c *CamperHistorySync) loadBunkAssignmentsBySession(
	ctx context.Context, year int,
) (map[bunkAssignmentKey]bunkAssignment, error) {
	result := make(map[bunkAssignmentKey]bunkAssignment)

	filter := fmt.Sprintf("year = %d && is_deleted = false", year)

	page := 1
	perPage := 500

	// Cache bunk lookups
	bunkCache := make(map[string]struct {
		name string
		cmID int
	})

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
			personPBID := record.GetString("person")
			sessionPBID := record.GetString("session")
			bunkPBID := record.GetString("bunk")

			if personPBID == "" || sessionPBID == "" || bunkPBID == "" {
				continue
			}

			// Get bunk info
			bunkName := ""
			bunkCMID := 0
			if cached, ok := bunkCache[bunkPBID]; ok {
				bunkName = cached.name
				bunkCMID = cached.cmID
			} else {
				bunkFilter := fmt.Sprintf("id = '%s'", bunkPBID)
				bunks, err := c.App.FindRecordsByFilter("bunks", bunkFilter, "", 1, 0)
				if err == nil && len(bunks) > 0 {
					bunkName = bunks[0].GetString("name")
					if cmID, ok := bunks[0].Get("cm_id").(float64); ok {
						bunkCMID = int(cmID)
					}
					bunkCache[bunkPBID] = struct {
						name string
						cmID int
					}{bunkName, bunkCMID}
				}
			}

			key := bunkAssignmentKey{
				personPBID:  personPBID,
				sessionPBID: sessionPBID,
				year:        year,
			}

			result[key] = bunkAssignment{
				bunkName: bunkName,
				bunkCMID: bunkCMID,
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// loadHistoricalEnrollments loads ALL historical enrollments for persons (for retention calculation)
func (c *CamperHistorySync) loadHistoricalEnrollments(
	ctx context.Context, personCMIDs []int, currentYear int,
) (map[int][]historicalEnrollment, error) {
	result := make(map[int][]historicalEnrollment)

	// Initialize for all persons
	for _, cmID := range personCMIDs {
		result[cmID] = []historicalEnrollment{}
	}

	// Query historical attendees in batches
	batches := c.splitIntoBatches(personCMIDs, personBatchSize)

	// Cache session type lookups
	sessionTypeCache := make(map[string]string)

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

		// Query ALL years (including current) with enrolled status for retention calculation
		filter := fmt.Sprintf("(%s) && year <= %d && status = 'enrolled'",
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

			// Get session type
			sessionType := ""
			if sessionPBID := record.GetString("session"); sessionPBID != "" {
				if cached, ok := sessionTypeCache[sessionPBID]; ok {
					sessionType = cached
				} else {
					sessionFilter := fmt.Sprintf("id = '%s'", sessionPBID)
					sessions, err := c.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
					if err == nil && len(sessions) > 0 {
						sessionType = sessions[0].GetString("session_type")
						sessionTypeCache[sessionPBID] = sessionType
					}
				}
			}

			result[personCMID] = append(result[personCMID], historicalEnrollment{
				year:        yr,
				sessionType: sessionType,
				status:      record.GetString("status"),
			})
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
func (c *CamperHistorySync) loadSynagogueByHousehold(ctx context.Context, year int) (map[int]string, error) {
	result := make(map[int]string)

	// First, find the custom field definition for "Synagogue"
	fieldFilter := `name = "Synagogue"`
	fieldDefs, err := c.App.FindRecordsByFilter("custom_field_defs", fieldFilter, "", 1, 0)
	if err != nil || len(fieldDefs) == 0 {
		slog.Debug("Synagogue custom field not found", "error", err)
		return result, nil
	}
	synagogueFieldID := fieldDefs[0].Id

	// Query household_custom_values for synagogue field
	filter := fmt.Sprintf("field_definition = '%s' && year = %d", synagogueFieldID, year)

	page := 1
	perPage := 500

	// Cache household CM ID lookups
	householdCMIDCache := make(map[string]int)

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

			householdPBID := record.GetString("household")
			if householdPBID == "" {
				continue
			}

			// Get household CM ID
			householdCMID := 0
			if cached, ok := householdCMIDCache[householdPBID]; ok {
				householdCMID = cached
			} else {
				householdFilter := fmt.Sprintf("id = '%s'", householdPBID)
				households, err := c.App.FindRecordsByFilter("households", householdFilter, "", 1, 0)
				if err != nil || len(households) == 0 {
					continue
				}
				if hcmid, ok := households[0].Get("cm_id").(float64); ok {
					householdCMID = int(hcmid)
					householdCMIDCache[householdPBID] = householdCMID
				}
			}

			if householdCMID > 0 {
				result[householdCMID] = value
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded synagogue data", "householdsWithSynagogue", len(result))
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

// ============================================================================
// Context-aware retention metric computation functions
// ============================================================================

// computeIsReturningSummer checks if person was enrolled in a summer session in prior year
func (c *CamperHistorySync) computeIsReturningSummer(currentYear int, enrollments []historicalEnrollment) bool {
	priorYear := currentYear - 1
	for _, e := range enrollments {
		if e.year == priorYear && e.status == statusEnrolled && c.isSummerSessionType(e.sessionType) {
			return true
		}
	}
	return false
}

// computeIsReturningFamily checks if person was enrolled in a family/adult session in prior year
func (c *CamperHistorySync) computeIsReturningFamily(currentYear int, enrollments []historicalEnrollment) bool {
	priorYear := currentYear - 1
	for _, e := range enrollments {
		if e.year == priorYear && e.status == statusEnrolled && c.isFamilySessionType(e.sessionType) {
			return true
		}
	}
	return false
}

// computeFirstYearSummer returns the first year a person attended a summer session
func (c *CamperHistorySync) computeFirstYearSummer(currentYear int, enrollments []historicalEnrollment) int {
	minYear := 0
	for _, e := range enrollments {
		if e.status == statusEnrolled && c.isSummerSessionType(e.sessionType) {
			if minYear == 0 || e.year < minYear {
				minYear = e.year
			}
		}
	}
	if minYear == 0 {
		return currentYear // New summer camper
	}
	return minYear
}

// computeFirstYearFamily returns the first year a person attended a family session
func (c *CamperHistorySync) computeFirstYearFamily(enrollments []historicalEnrollment) int {
	minYear := 0
	for _, e := range enrollments {
		if e.status == statusEnrolled && c.isFamilySessionType(e.sessionType) {
			if minYear == 0 || e.year < minYear {
				minYear = e.year
			}
		}
	}
	return minYear // 0 if never attended family
}

// computeYearsAtCamp counts distinct enrollment years
func (c *CamperHistorySync) computeYearsAtCamp(enrollments []historicalEnrollment) int {
	yearSet := make(map[int]bool)
	for _, e := range enrollments {
		if e.status == statusEnrolled {
			yearSet[e.year] = true
		}
	}
	if len(yearSet) == 0 {
		return 1 // At least current year
	}
	return len(yearSet)
}

// isSummerSessionType checks if session type is a summer type
func (c *CamperHistorySync) isSummerSessionType(sessionType string) bool {
	for _, st := range summerSessionTypes {
		if sessionType == st {
			return true
		}
	}
	return false
}

// isFamilySessionType checks if session type is a family type
func (c *CamperHistorySync) isFamilySessionType(sessionType string) bool {
	for _, ft := range familySessionTypes {
		if sessionType == ft {
			return true
		}
	}
	return false
}

// ============================================================================
// Utility functions
// ============================================================================

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
