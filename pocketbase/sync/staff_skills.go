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
func (s *StaffSkillsSync) Name() string {
	return "staff_skills"
}

// GetStats returns the current stats
func (s *StaffSkillsSync) GetStats() Stats {
	return s.Stats
}

// skillDefinition holds a skill field definition
type skillDefinition struct {
	pbID   string // PocketBase record ID
	cmID   int    // CampMinder custom field ID
	name   string // Field name (e.g., "Skills-Archery")
	skill  string // Skill name without prefix (e.g., "Archery")
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
	firstName      string
	lastName       string
}

// Sync executes the staff skills extraction
func (s *StaffSkillsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.ProcessedKeys = make(map[string]bool)

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

	slog.Info("Starting staff skills extraction",
		"year", year,
		"dry_run", s.DryRun,
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

	skipFields := map[string]bool{
		"person_id":   true,
		"skill_cm_id": true,
		"year":        true,
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
		recordData := map[string]interface{}{
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
			if s.recordNeedsUpdate(existing, recordData, skipFields) {
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
	s.deleteOrphans(existingRecords)

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
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
		name := record.GetString("name")
		partition := record.GetString("partition")

		// Filter: must be Skills- field with Staff partition
		if !strings.HasPrefix(name, "Skills-") {
			continue
		}
		if !s.containsStaffPartition(partition) {
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
	}

	return result, nil
}

// containsStaffPartition checks if partition string contains "Staff"
func (s *StaffSkillsSync) containsStaffPartition(partition string) bool {
	if partition == "" {
		return false
	}
	parts := strings.Split(partition, ",")
	for _, p := range parts {
		if strings.TrimSpace(p) == "Staff" {
			return true
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

	// Process in batches
	batchSize := 100
	for i := 0; i < len(ids); i += batchSize {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]

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

// fieldEquals compares two values for equality
func (s *StaffSkillsSync) fieldEquals(existing, newVal interface{}) bool {
	if (existing == nil && newVal == "") || (existing == "" && newVal == nil) {
		return true
	}
	if existing == nil && newVal == 0 {
		return true
	}
	if existing == 0 && newVal == nil {
		return true
	}
	if existingFloat, ok := existing.(float64); ok {
		if newInt, ok := newVal.(int); ok {
			return int(existingFloat) == newInt
		}
		if newFloat, ok := newVal.(float64); ok {
			return existingFloat == newFloat
		}
	}
	if existingInt, ok := existing.(int); ok {
		if newFloat, ok := newVal.(float64); ok {
			return existingInt == int(newFloat)
		}
	}
	if existingBool, ok := existing.(bool); ok {
		if newBool, ok := newVal.(bool); ok {
			return existingBool == newBool
		}
	}
	return existing == newVal
}

// recordNeedsUpdate checks if any field differs
func (s *StaffSkillsSync) recordNeedsUpdate(
	existing *core.Record, newData map[string]interface{}, skipFields map[string]bool,
) bool {
	for field, newValue := range newData {
		if skipFields[field] {
			continue
		}
		if !s.fieldEquals(existing.Get(field), newValue) {
			return true
		}
	}
	return false
}

// deleteOrphans removes records that weren't processed
func (s *StaffSkillsSync) deleteOrphans(existingRecords map[string]*core.Record) int {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion due to sync failure")
		return 0
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
		s.Stats.Deleted = orphanCount
		slog.Info("Deleted orphaned staff_skills records", "count", orphanCount)
	}

	return orphanCount
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
