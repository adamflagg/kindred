package sync

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// staffSkillsCompareFields lists the fields to compare for idempotency checks.
// Only these fields are checked when deciding whether an existing record needs updating.
// Excludes unique key fields (person_id, skill_cm_id, year) and PocketBase-managed fields.
var staffSkillsCompareFields = []string{
	"skill_name", "is_intermediate", "is_experienced", "can_teach",
	"is_certified", "raw_value", "first_name", "last_name", "person",
}

// partitionStaff is the partition value for staff-related custom fields
const partitionStaff = "Staff"

// StaffSkillsSync extracts Skills- fields from person_custom_values
// into a normalized staff_skills table for activity assignment queries.
//
// This is a derived table sync - reads from PocketBase collections
// (person_custom_values, custom_field_defs, persons) and writes to staff_skills.
//
// Proficiency levels parsed from pipe-delimited multi-select:
//   - Int. = Intermediate
//   - Exp. = Experienced
//   - Teach = Can teach
//   - Cert. = Certified
type StaffSkillsSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Debug          bool
	Stats          Stats
	SyncSuccessful bool
	ProcessedKeys  map[string]bool
}

// NewStaffSkillsSync creates a new staff skills sync service
func NewStaffSkillsSync(app core.App) *StaffSkillsSync {
	return &StaffSkillsSync{
		App:           app,
		Year:          0,
		DryRun:        false,
		ProcessedKeys: make(map[string]bool),
	}
}

// Name returns the service name

// GetStats returns the current stats
func (s *StaffSkillsSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *StaffSkillsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *StaffSkillsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *StaffSkillsSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *StaffSkillsSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// skillDefinition holds a skill field definition
type skillDefinition struct {
	pbID  string // PocketBase record ID
	cmID  int    // CampMinder custom field ID
	name  string // Field name (e.g., "Skills-Archery")
	skill string // Skill name without prefix (e.g., "Archery")
}

// staffSkillRecord holds data for one staff-skill record
type staffSkillRecord struct {
	personCMID     int
	personPBID     string
	skillCMID      int
	skillName      string
	isIntermediate bool
	isExperienced  bool
	canTeach       bool
	isCertified    bool
	rawValue       string
}

// Sync executes the staff skills extraction
func (s *StaffSkillsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.ProcessedKeys = make(map[string]bool)

	// Determine year
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	slog.Info("Starting staff skills extraction",
		"year", year,
		"dry_run", s.DryRun,
		"debug", s.Debug,
	)

	// Step 1: Load Skills- field definitions with Staff partition
	skillDefs, err := s.loadSkillDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading skill definitions: %w", err)
	}

	if len(skillDefs) == 0 {
		slog.Info("No Skills- field definitions found with Staff partition")
		s.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded skill definitions", "count", len(skillDefs))

	// Build maps for lookups
	skillDefByPBID := make(map[string]skillDefinition)
	for _, sd := range skillDefs {
		skillDefByPBID[sd.pbID] = sd
	}

	// Step 2: Load person_custom_values for these skill fields
	skillValues, err := s.loadSkillValues(ctx, skillDefByPBID, year)
	if err != nil {
		return fmt.Errorf("loading skill values: %w", err)
	}

	// An empty source is not a collapse, so this returns BEFORE loading existing
	// rows and before the sweep: nothing is deleted and the run succeeds. That is
	// the same policy the four records-map syncs got in kindred#2283 rows 3+4 and
	// the one BaseSyncService.DeleteOrphans applies -- expressed here as an early
	// return rather than a SyncSuccessful gate, because this file has nothing
	// left to do once there are no values. Leaving the sweep to refuse instead
	// would wedge the table: a refused sweep never clears the rows it refused
	// over, so the condition would not resolve on its own.
	if len(skillValues) == 0 {
		slog.Info("No skill values found for year", "year", year)
		s.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded skill values", "count", len(skillValues))

	// Extract unique person IDs for demographics lookup
	personCMIDSet := make(map[int]bool)
	for _, sv := range skillValues {
		personCMIDSet[sv.personCMID] = true
	}

	// Step 3: Load person demographics
	demographics, err := s.loadStaffDemographics(ctx, personCMIDSet, year)
	if err != nil {
		return fmt.Errorf("loading staff demographics: %w", err)
	}

	slog.Info("Loaded staff demographics", "count", len(demographics))

	// Step 4: Write records
	if s.DryRun {
		slog.Info("Dry run mode - not writing", "records", len(skillValues))
		s.Stats.Created = len(skillValues)
		s.SyncSuccessful = true
		return nil
	}

	// Preload existing records for upsert
	existingRecords, err := s.preloadExistingRecords(year)
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	// Get collection
	col, err := s.App.FindCollectionByNameOrId("staff_skills")
	if err != nil {
		return fmt.Errorf("finding staff_skills collection: %w", err)
	}

	// Process records
	for _, sv := range skillValues {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Build composite key
		key := fmt.Sprintf("%d:%d|%d", sv.personCMID, sv.skillCMID, year)

		// Skip duplicates
		if s.ProcessedKeys[key] {
			continue
		}
		s.ProcessedKeys[key] = true

		// Get demographics
		demo := demographics[sv.personCMID]

		// Build record data
		recordData := map[string]any{
			"person_id":       sv.personCMID,
			"skill_cm_id":     sv.skillCMID,
			"skill_name":      sv.skillName,
			"is_intermediate": sv.isIntermediate,
			"is_experienced":  sv.isExperienced,
			"can_teach":       sv.canTeach,
			"is_certified":    sv.isCertified,
			"raw_value":       sv.rawValue,
			"year":            year,
			"first_name":      demo.firstName,
			"last_name":       demo.lastName,
		}

		// Add optional relation
		if sv.personPBID != "" {
			recordData["person"] = sv.personPBID
		}

		// Upsert
		existing := existingRecords[key]

		if existing != nil {
			if s.recordNeedsUpdate(existing, recordData, staffSkillsCompareFields) {
				for field, value := range recordData {
					existing.Set(field, value)
				}
				if err := s.App.Save(existing); err != nil {
					slog.Error("Error updating staff_skills record",
						"personCMID", sv.personCMID,
						"skillCMID", sv.skillCMID,
						"error", err)
					s.Stats.Errors++
					continue
				}
				s.Stats.Updated++
			} else {
				s.Stats.Skipped++
			}
		} else {
			record := core.NewRecord(col)
			for field, value := range recordData {
				record.Set(field, value)
			}
			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating staff_skills record",
					"personCMID", sv.personCMID,
					"skillCMID", sv.skillCMID,
					"error", err)
				s.Stats.Errors++
				continue
			}
			s.Stats.Created++
		}
	}

	s.SyncSuccessful = true

	// Delete orphans
	deleted, orphanErr := s.deleteOrphans(existingRecords, year)
	s.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below -- the upsert loop above has
	// already written by this point, and the refusal path can fire on a non-empty
	// computed set (a PARTIAL collapse), which is exactly the case where writes
	// already happened.
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	if orphanErr != nil {
		return wrapOrphanSweepError(orphanErr)
	}

	slog.Info("Staff skills extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"skipped", s.Stats.Skipped,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// SyncForYear extracts skills for a specific year
func (s *StaffSkillsSync) SyncForYear(ctx context.Context, year int) error {
	s.Year = year
	return s.Sync(ctx)
}

// loadSkillDefinitions loads Skills- field definitions with Staff partition
func (s *StaffSkillsSync) loadSkillDefinitions(_ context.Context) ([]skillDefinition, error) {
	var result []skillDefinition

	// Find all custom field definitions
	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying custom_field_defs: %w", err)
	}

	for _, record := range records {
		name := normalizeFieldName(record.GetString("name"))

		// Filter: must be Skills- field with Staff partition
		if !strings.HasPrefix(name, "Skills-") {
			continue
		}
		// Use Get() for partition - PocketBase stores select fields as JSON arrays
		if !s.containsStaffPartitionFromRaw(record.Get("partition")) {
			continue
		}

		cmID := 0
		if id, ok := record.Get("cm_id").(float64); ok {
			cmID = int(id)
		}
		if cmID == 0 {
			continue
		}

		// Extract skill name (strip "Skills-" prefix)
		skillName := strings.TrimPrefix(name, "Skills-")

		result = append(result, skillDefinition{
			pbID:  record.Id,
			cmID:  cmID,
			name:  name,
			skill: skillName,
		})
		s.DebugLog("Found staff skill definition", "name", name, "skill", skillName, "cm_id", cmID)
	}

	return result, nil
}

// containsStaffPartitionFromRaw checks if partition contains "Staff".
// PocketBase stores select fields as JSON arrays, so record.Get() returns
// []any, not a comma-separated string.
func (s *StaffSkillsSync) containsStaffPartitionFromRaw(rawValue any) bool {
	if rawValue == nil {
		return false
	}

	// Handle as []any (JSON array from record.Get())
	if arr, ok := rawValue.([]any); ok {
		for _, v := range arr {
			if str, ok := v.(string); ok && str == partitionStaff {
				return true
			}
		}
		return false
	}

	// Handle as []string (alternative array type)
	if arr, ok := rawValue.([]string); ok {
		for _, v := range arr {
			if v == partitionStaff {
				return true
			}
		}
		return false
	}

	// Fallback to string handling (comma-separated, legacy)
	if str, ok := rawValue.(string); ok {
		if str == "" {
			return false
		}
		parts := strings.Split(str, ",")
		for _, p := range parts {
			if strings.TrimSpace(p) == partitionStaff {
				return true
			}
		}
	}

	return false
}

// loadSkillValues loads person_custom_values for skill fields
func (s *StaffSkillsSync) loadSkillValues(
	ctx context.Context,
	skillDefByPBID map[string]skillDefinition,
	year int,
) ([]staffSkillRecord, error) {
	var result []staffSkillRecord

	// Build field definition IDs for filter
	fieldIDs := make([]string, 0, len(skillDefByPBID))
	for pbID := range skillDefByPBID {
		fieldIDs = append(fieldIDs, fmt.Sprintf("field_definition = '%s'", pbID))
	}

	if len(fieldIDs) == 0 {
		return result, nil
	}

	filter := fmt.Sprintf("(%s) && year = %d", strings.Join(fieldIDs, " || "), year)

	page := 1
	perPage := 500

	// Cache person lookups
	personCache := make(map[string]struct {
		cmID int
	})

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter(
			"person_custom_values",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return nil, fmt.Errorf("querying person_custom_values page %d: %w", page, err)
		}

		for _, record := range records {
			value := record.GetString("value")
			if value == "" {
				continue
			}

			fieldDefPBID := record.GetString("field_definition")
			skillDef, ok := skillDefByPBID[fieldDefPBID]
			if !ok {
				continue
			}

			personPBID := record.GetString("person")
			if personPBID == "" {
				continue
			}

			// Get person CM ID
			personCMID := 0
			if cached, ok := personCache[personPBID]; ok {
				personCMID = cached.cmID
			} else {
				personFilter := fmt.Sprintf("id = '%s'", personPBID)
				persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
				if err == nil && len(persons) > 0 {
					if cmID, ok := persons[0].Get("cm_id").(float64); ok {
						personCMID = int(cmID)
						personCache[personPBID] = struct{ cmID int }{personCMID}
					}
				}
			}

			if personCMID == 0 {
				continue
			}

			// Parse proficiency values
			intermediate, experienced, canTeach, certified := s.parseProficiency(value)

			result = append(result, staffSkillRecord{
				personCMID:     personCMID,
				personPBID:     personPBID,
				skillCMID:      skillDef.cmID,
				skillName:      skillDef.skill,
				isIntermediate: intermediate,
				isExperienced:  experienced,
				canTeach:       canTeach,
				isCertified:    certified,
				rawValue:       value,
			})
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// parseProficiency parses pipe-delimited proficiency string
func (s *StaffSkillsSync) parseProficiency(rawValue string) (intermediate, experienced, canTeach, certified bool) {
	parts := strings.Split(rawValue, "|")
	for _, p := range parts {
		switch strings.TrimSpace(p) {
		case "Int.":
			intermediate = true
		case "Exp.":
			experienced = true
		case "Teach":
			canTeach = true
		case "Cert.":
			certified = true
		}
	}
	return
}

// staffDemographics holds basic person info for denormalization
type staffDemographics struct {
	firstName string
	lastName  string
}

// loadStaffDemographics loads person demographics
func (s *StaffSkillsSync) loadStaffDemographics(
	ctx context.Context,
	personCMIDs map[int]bool,
	year int,
) (map[int]staffDemographics, error) {
	result := make(map[int]staffDemographics)

	if len(personCMIDs) == 0 {
		return result, nil
	}

	// Convert to slice for batching
	ids := make([]int, 0, len(personCMIDs))
	for cmID := range personCMIDs {
		ids = append(ids, cmID)
	}

	// Process in batches.
	// batchSize bounds PocketBase filter-string length — each ID concatenates
	// into a `cm_id = X || ...` filter, so keep small to avoid SQLite filter
	// overflow. Distinct from the larger CampMinder API batches (500).
	const batchSize = 100
	for batch := range slices.Chunk(ids, batchSize) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Build OR filter
		conditions := make([]string, len(batch))
		for j, cmID := range batch {
			conditions[j] = fmt.Sprintf("cm_id = %d", cmID)
		}
		filter := fmt.Sprintf("(%s) && year = %d", strings.Join(conditions, " || "), year)

		records, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
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

			result[cmID] = staffDemographics{
				firstName: record.GetString("first_name"),
				lastName:  record.GetString("last_name"),
			}
		}
	}

	return result, nil
}

// preloadExistingRecords loads existing staff_skills records for upsert
func (s *StaffSkillsSync) preloadExistingRecords(year int) (map[string]*core.Record, error) {
	result := make(map[string]*core.Record)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		records, err := s.App.FindRecordsByFilter(
			"staff_skills",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return nil, fmt.Errorf("querying existing records page %d: %w", page, err)
		}

		for _, record := range records {
			personCMID := 0
			if pid, ok := record.Get("person_id").(float64); ok {
				personCMID = int(pid)
			}
			skillCMID := 0
			if sid, ok := record.Get("skill_cm_id").(float64); ok {
				skillCMID = int(sid)
			}

			if personCMID > 0 && skillCMID > 0 {
				key := fmt.Sprintf("%d:%d|%d", personCMID, skillCMID, year)
				result[key] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded existing staff_skills records", "count", len(result), "year", year)
	return result, nil
}

// recordNeedsUpdate checks if any compared field differs between existing record and new data.
// Uses compareFields (inclusion list): only the listed fields are checked for changes.
// Delegates to the shared compareRecordNeedsUpdate in base_sync.go.
func (s *StaffSkillsSync) recordNeedsUpdate(
	existing *core.Record, newData map[string]any, compareFields []string,
) bool {
	return compareRecordNeedsUpdate(existing, newData, compareFields)
}

// deleteOrphans removes records that weren't processed.
//
// Refuses when the computed set is too small to be believed against the rows
// on disk: that combination is always a broken input, and sweeping on it
// deletes the year and reports success (kindred#2257, kindred#2283). The rule
// lives in OrphanSweepGuard so there is one implementation, not an eighth copy.
func (s *StaffSkillsSync) deleteOrphans(existingRecords map[string]*core.Record, year int) (int, error) {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion due to sync failure")
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "staff_skills",
		Year:     year,
		Computed: len(s.ProcessedKeys),
		Hint:     "check that the CampMinder Skills- field feed returned this season",
	}
	if err := guard.Check(len(existingRecords)); err != nil {
		return 0, err
	}

	orphanCount := 0
	for key, record := range existingRecords {
		if s.ProcessedKeys[key] {
			continue
		}

		personCMID := record.Get("person_id")
		skillCMID := record.Get("skill_cm_id")
		slog.Info("Deleting orphaned staff_skills record",
			"person_id", personCMID,
			"skill_cm_id", skillCMID)

		if err := s.App.Delete(record); err != nil {
			slog.Error("Error deleting orphan", "id", record.Id, "error", err)
			s.Stats.Errors++
			continue
		}
		orphanCount++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned staff_skills records", "count", orphanCount)
	}

	return orphanCount, nil
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (s *StaffSkillsSync) forceWALCheckpoint() error {
	db := s.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	return nil
}
