package sync

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameFamilyCampDerived is the canonical name for this sync service
const serviceNameFamilyCampDerived = "family_camp_derived"

// FamilyCampDerivedSync computes derived family camp tables from custom values.
// This service reads from person_custom_values and household_custom_values
// and populates family_camp_adults, family_camp_registrations, and family_camp_medical.
//
// Unlike CampMinder API syncs, this doesn't call external APIs - it computes
// derived/aggregated data from existing PocketBase records.
type FamilyCampDerivedSync struct {
	App            core.App
	Year           int  // Year to compute for (0 = current year from env)
	DryRun         bool // Dry run mode (compute but don't write)
	Debug          bool // Enable verbose debug logging
	Stats          Stats
	SyncSuccessful bool

	// Track processed keys for orphan detection
	ProcessedAdultKeys   map[string]bool
	ProcessedRegKeys     map[string]bool
	ProcessedMedicalKeys map[string]bool
}

// NewFamilyCampDerivedSync creates a new family camp derived sync service
func NewFamilyCampDerivedSync(app core.App) *FamilyCampDerivedSync {
	return &FamilyCampDerivedSync{
		App:                  app,
		Year:                 0,
		DryRun:               false,
		ProcessedAdultKeys:   make(map[string]bool),
		ProcessedRegKeys:     make(map[string]bool),
		ProcessedMedicalKeys: make(map[string]bool),
	}
}

// Name returns the service name
func (s *FamilyCampDerivedSync) Name() string {
	return "family_camp_derived"
}

// GetStats returns the current stats
func (s *FamilyCampDerivedSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *FamilyCampDerivedSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this sync service
func (s *FamilyCampDerivedSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *FamilyCampDerivedSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// adultData holds extracted adult information
type adultData struct {
	householdPBID string
	adultNumber   int
	name          string
	firstName     string
	lastName      string
	email         string
	pronouns      string
	gender        string
	dateOfBirth   string
	relationship  string
}

// registrationData holds extracted registration information
type registrationData struct {
	householdPBID        string
	cabinAssignment      string
	shareCabinPreference string
	sharedCabinWith      string
	arrivalETA           string
	specialOccasions     string
	goals                string
	notes                string
	needsAccommodation   bool
	optOutVIP            bool
}

// medicalData holds extracted medical information
type medicalData struct {
	householdPBID    string
	cpapInfo         string
	physicianInfo    string
	specialNeedsInfo string
	allergyInfo      string
	dietaryInfo      string
	additionalInfo   string
}

// Sync executes the family camp derived computation
func (s *FamilyCampDerivedSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.ProcessedAdultKeys = make(map[string]bool)
	s.ProcessedRegKeys = make(map[string]bool)
	s.ProcessedMedicalKeys = make(map[string]bool)

	// Determine year
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	// Validate year
	if year < 2017 || year > 2050 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2050", year)
	}

	slog.Info("Starting family camp derived computation",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping (field_definition PB ID -> field name)
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person to household mapping (person PB ID -> household PB ID)
	personToHousehold, err := s.loadPersonHouseholdMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-household mapping: %w", err)
	}
	slog.Info("Loaded person-household mapping", "count", len(personToHousehold))

	// Step 3: Load household custom values
	householdValues, err := s.loadHouseholdCustomValues(ctx, year, fieldNameMap)
	if err != nil {
		return fmt.Errorf("loading household custom values: %w", err)
	}
	slog.Info("Loaded household custom values", "count", len(householdValues))

	// Step 4: Load person custom values
	personValues, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToHousehold)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Loaded person custom values", "count", len(personValues))

	// Step 5: Process adults data
	adults := s.processAdults(householdValues, personValues)
	slog.Info("Processed adults", "count", len(adults))

	// Step 6: Process registrations data
	registrations := s.processRegistrations(householdValues, personValues)
	slog.Info("Processed registrations", "count", len(registrations))

	// Step 7: Process medical data
	medical := s.processMedical(personValues)
	slog.Info("Processed medical", "count", len(medical))

	if s.DryRun {
		slog.Info("Dry run mode - computed but not writing",
			"adults", len(adults),
			"registrations", len(registrations),
			"medical", len(medical),
		)
		s.Stats.Created = len(adults) + len(registrations) + len(medical)
		s.SyncSuccessful = true
		return nil
	}

	// Step 8: Preload existing records for upsert
	existingAdults, err := s.preloadExistingAdults(year)
	if err != nil {
		return fmt.Errorf("preloading existing adults: %w", err)
	}
	existingRegs, err := s.preloadExistingRegistrations(year)
	if err != nil {
		return fmt.Errorf("preloading existing registrations: %w", err)
	}
	existingMedical, err := s.preloadExistingMedical(year)
	if err != nil {
		return fmt.Errorf("preloading existing medical: %w", err)
	}
	slog.Info("Preloaded existing records",
		"adults", len(existingAdults),
		"registrations", len(existingRegs),
		"medical", len(existingMedical),
	)

	// Step 9: Upsert adults
	created, updated, skipped, errors := s.upsertAdults(ctx, adults, year, existingAdults)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errors

	// Step 10: Upsert registrations
	created, updated, skipped, errors = s.upsertRegistrations(ctx, registrations, year, existingRegs)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errors

	// Step 11: Upsert medical
	created, updated, skipped, errors = s.upsertMedical(ctx, medical, year, existingMedical)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errors

	// Mark sync as successful before orphan deletion
	s.SyncSuccessful = true

	// Step 12: Delete orphaned records (no longer in source data)
	s.Stats.Deleted += s.deleteOrphanedAdults(existingAdults)
	s.Stats.Deleted += s.deleteOrphanedRegistrations(existingRegs)
	s.Stats.Deleted += s.deleteOrphanedMedical(existingMedical)

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	slog.Info("Family camp derived computation completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"skipped", s.Stats.Skipped,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
func (s *FamilyCampDerivedSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	// Query all family camp related field definitions
	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := normalizeFieldName(record.GetString("name"))
		if isFamilyCampField(name) || extraFieldCMIDs[record.GetInt("cm_id")] {
			result[record.Id] = name
		}
	}

	return result, nil
}

// extraFieldCMIDs lists source fields the family-camp NAME heuristic cannot see,
// matched on custom_field_defs.cm_id per spec 4.4 ("Source fields are matched on
// custom_field_defs.cm_id, not the user-editable display name").
//
// Two reasons a field lands here: it dropped the "Family Camp" prefix in a later
// generation (Housing Accommodation succeeded FAM Camp-Accommodation in 2025), or
// CampMinder spelled it inconsistently (Housing Accomodation, one m, is the
// Adult-partition twin of Housing Accommodation).
//
// Scope: these ids govern only whether a definition is ADMITTED into the field
// map, so admission survives a rename. Semantic routing downstream still
// switches on the display name, so a rename in CampMinder would silently stop
// an answer reaching its column — the same failure this allowlist exists to
// fix. Closing that half needs the cm_id-keyed registry in lodging_fields.go
// (Phase B); until it lands, the names below are load-bearing, not decorative.
var extraFieldCMIDs = map[int]bool{
	274057: true, // Housing Accommodation        (Camper) — successor to FAM Camp-Accommodation
	274055: true, // Housing Accomodation  (sic)  (Adult)
	274058: true, // Housing Accommodation-Yes    (Camper)
	274059: true, // Housing-Bathroom             (Camper) — PHI narrative, spec 5
	274053: true, // Adult-Bathroom               (Adult)
	274054: true, // Bathroom-Yes                 (Adult)  — PHI narrative, spec 5
	256933: true, // Adult-CPAP                   (Adult)
	257248: true, // Adult-Infant                 (Adult)
	256935: true, // Adult-Opt Out                (Adult)
	274133: true, // Shared-request               (Camper) — request free text, spec 4.1
	206286: true, // COVID-19 Bunking Requests    (Camper) — 2nd request detail, misleading legacy name
}

// normalizeFieldName trims a CampMinder custom-field display name.
//
// CampMinder does not validate these names, and at least one shipped field
// carries a trailing space: "Family Camp-Physician " (cm_id 39680). The
// switch and map lookups in this file compare field names by exact string
// equality (the substring checks in isFamilyCampField and processAdults are
// unaffected), so an untrimmed name silently matches nothing. Trim once, at
// the load boundary, so every downstream comparison is against a canonical
// name.
func normalizeFieldName(name string) string {
	return strings.TrimSpace(name)
}

// isFamilyCampField checks if a field name is related to family camp
func isFamilyCampField(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "family camp") ||
		strings.Contains(lower, "fam camp") ||
		strings.Contains(lower, "family medical")
}

// loadPersonHouseholdMapping builds a map of person PB ID -> household PB ID
func (s *FamilyCampDerivedSync) loadPersonHouseholdMapping(ctx context.Context, year int) (map[string]string, error) {
	result := make(map[string]string)

	filter := fmt.Sprintf("year = %d && household != ''", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("persons", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				result[record.Id] = householdID
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// customValueEntry represents a loaded custom value
type customValueEntry struct {
	householdPBID string
	fieldName     string
	value         string
}

// loadHouseholdCustomValues loads household custom values for family camp fields
func (s *FamilyCampDerivedSync) loadHouseholdCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string,
) ([]customValueEntry, error) {
	var result []customValueEntry

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("household_custom_values", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying household custom values page %d: %w", page, err)
		}

		for _, record := range records {
			fieldDefID := record.GetString("field_definition")
			fieldName, ok := fieldNameMap[fieldDefID]
			if !ok {
				continue // Not a family camp field
			}

			householdID := record.GetString("household")
			value := record.GetString("value")
			if householdID != "" && value != "" {
				result = append(result, customValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// loadPersonCustomValues loads person custom values for family camp fields
func (s *FamilyCampDerivedSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToHousehold map[string]string,
) ([]customValueEntry, error) {
	var result []customValueEntry

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying person custom values page %d: %w", page, err)
		}

		for _, record := range records {
			fieldDefID := record.GetString("field_definition")
			fieldName, ok := fieldNameMap[fieldDefID]
			if !ok {
				continue // Not a family camp field
			}

			personID := record.GetString("person")
			householdID := personToHousehold[personID]
			value := record.GetString("value")

			if householdID != "" && value != "" {
				result = append(result, customValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// processAdults extracts adult data from custom values
func (s *FamilyCampDerivedSync) processAdults(
	householdValues []customValueEntry, personValues []customValueEntry,
) []*adultData {
	// Map: household -> adult_number -> adult
	adultMap := make(map[string]map[int]*adultData)

	// Process household values for adult names (Family Camp Adult 1-5)
	for _, v := range householdValues {
		adultNum := extractAdultNumberFromField(v.fieldName)
		if adultNum == 0 {
			continue
		}

		// Only process "Family Camp Adult X" for names
		if !strings.HasPrefix(v.fieldName, "Family Camp Adult ") {
			continue
		}

		if adultMap[v.householdPBID] == nil {
			adultMap[v.householdPBID] = make(map[int]*adultData)
		}

		if adultMap[v.householdPBID][adultNum] == nil {
			adultMap[v.householdPBID][adultNum] = &adultData{
				householdPBID: v.householdPBID,
				adultNumber:   adultNum,
			}
		}

		adultMap[v.householdPBID][adultNum].name = v.value
	}

	// Process person values for adult details
	for _, v := range personValues {
		adultNum := extractAdultNumberFromField(v.fieldName)
		if adultNum == 0 || adultNum > 2 {
			continue // Person fields only have Adult 1 and 2
		}

		if adultMap[v.householdPBID] == nil {
			adultMap[v.householdPBID] = make(map[int]*adultData)
		}

		if adultMap[v.householdPBID][adultNum] == nil {
			adultMap[v.householdPBID][adultNum] = &adultData{
				householdPBID: v.householdPBID,
				adultNumber:   adultNum,
			}
		}

		adult := adultMap[v.householdPBID][adultNum]

		// Only set if empty (first non-empty wins for deduplication)
		switch {
		case strings.Contains(v.fieldName, "First Name") && adult.firstName == "":
			adult.firstName = v.value
		case strings.Contains(v.fieldName, "Last Name") && adult.lastName == "":
			adult.lastName = v.value
		case strings.Contains(v.fieldName, "Email") && adult.email == "":
			adult.email = v.value
		case strings.Contains(v.fieldName, "Pronouns") && adult.pronouns == "":
			adult.pronouns = v.value
		case strings.Contains(v.fieldName, "Gender") && adult.gender == "":
			adult.gender = v.value
		case strings.Contains(v.fieldName, "DOB") && adult.dateOfBirth == "":
			adult.dateOfBirth = v.value
		case strings.Contains(v.fieldName, "Relationship") && adult.relationship == "":
			adult.relationship = v.value
		}
	}

	// Convert map to slice, only include adults with data
	var result []*adultData
	for _, adults := range adultMap {
		for _, adult := range adults {
			if adult.name != "" || adult.firstName != "" || adult.lastName != "" ||
				adult.email != "" || adult.gender != "" {
				result = append(result, adult)
			}
		}
	}

	return result
}

// processRegistrations extracts registration data from custom values
func (s *FamilyCampDerivedSync) processRegistrations(
	householdValues []customValueEntry, personValues []customValueEntry,
) []*registrationData {
	// Map: household -> registration
	regMap := make(map[string]*registrationData)

	// Process household values for cabin assignment
	for _, v := range householdValues {
		if regMap[v.householdPBID] == nil {
			regMap[v.householdPBID] = &registrationData{
				householdPBID: v.householdPBID,
			}
		}

		reg := regMap[v.householdPBID]

		if v.fieldName == fieldNameFamilyCampCabin && reg.cabinAssignment == "" {
			reg.cabinAssignment = v.value
		}
	}

	// Process person values for registration details
	for _, v := range personValues {
		if regMap[v.householdPBID] == nil {
			regMap[v.householdPBID] = &registrationData{
				householdPBID: v.householdPBID,
			}
		}

		reg := regMap[v.householdPBID]

		// Map fields (first non-empty wins)
		switch v.fieldName {
		case "FAM CAMP-Share Cabins":
			if reg.shareCabinPreference == "" {
				reg.shareCabinPreference = v.value
			}
		case "FAM CAMP-Shared Cabin":
			if reg.sharedCabinWith == "" {
				reg.sharedCabinWith = v.value
			}
		case "Family Camp-Trans ETA":
			if reg.arrivalETA == "" {
				reg.arrivalETA = v.value
			}
		case "Family Camp-Special occasions":
			if reg.specialOccasions == "" {
				reg.specialOccasions = v.value
			}
		// Retired after 2024 (645 values that year, 0 since) and no successor
		// exists. Kept because spec 4.4 forbids auto-inferring retirement and
		// because this plan backfills 2024. The passive "0 values this year"
		// warning lives in lodging_field_mappings (migration 1500000122), which
		// UpsertFieldMappingStatus in lodging_fields.go populates.
		case "Family Camp-Goals Attending":
			if reg.goals == "" {
				reg.goals = v.value
			}
		case "Family Camp-Anything else":
			if reg.notes == "" {
				reg.notes = v.value
			}
		// Three generations of the same question. FAM Camp-Accommodation retired
		// after 2024 (5 values in 2025, 0 in 2026); Housing Accommodation is the
		// Camper successor and Housing Accomodation (one m) the Adult twin. Any
		// "yes" among them means the household needs an accommodation, so this
		// arm ORs rather than first-wins.
		case "FAM Camp-Accommodation", "Housing Accommodation", "Housing Accomodation":
			reg.needsAccommodation = reg.needsAccommodation || parseBoolFieldValue(v.value)
		case "FAM CAMP-Opt Out VIP", "Adult-Opt Out":
			reg.optOutVIP = reg.optOutVIP || parseBoolFieldValue(v.value)
		}
	}

	// Convert to slice
	var result []*registrationData
	for _, reg := range regMap {
		// Only include if has some data
		if reg.cabinAssignment != "" || reg.shareCabinPreference != "" ||
			reg.sharedCabinWith != "" || reg.arrivalETA != "" ||
			reg.specialOccasions != "" || reg.goals != "" ||
			reg.notes != "" || reg.needsAccommodation || reg.optOutVIP {
			result = append(result, reg)
		}
	}

	return result
}

// processMedical extracts medical data from person custom values
func (s *FamilyCampDerivedSync) processMedical(personValues []customValueEntry) []*medicalData {
	// Map: household -> field_name -> value (for concatenation)
	fieldsByHousehold := make(map[string]map[string]string)

	for _, v := range personValues {
		if fieldsByHousehold[v.householdPBID] == nil {
			fieldsByHousehold[v.householdPBID] = make(map[string]string)
		}

		// First non-empty wins
		if _, exists := fieldsByHousehold[v.householdPBID][v.fieldName]; !exists {
			fieldsByHousehold[v.householdPBID][v.fieldName] = v.value
		}
	}

	// Process each household
	var result []*medicalData
	for householdID, fields := range fieldsByHousehold {
		med := &medicalData{
			householdPBID: householdID,
		}

		// CPAP info
		cpapParts := []string{}
		for _, key := range []string{"Family Camp-CPAP", "FAM CAMP-CPAP"} {
			if v, ok := fields[key]; ok && v != "" {
				cpapParts = append(cpapParts, v)
				break
			}
		}
		if v, ok := fields["Family Medical-CPAP Explain"]; ok && v != "" {
			cpapParts = append(cpapParts, v)
		}
		med.cpapInfo = strings.Join(cpapParts, "; ")

		// Physician info
		physicianParts := []string{}
		if v, ok := fields["Family Camp-Physician"]; ok && v != "" {
			physicianParts = append(physicianParts, v)
		}
		if v, ok := fields["Family Camp-Physician If Yes"]; ok && v != "" {
			physicianParts = append(physicianParts, v)
		}
		med.physicianInfo = strings.Join(physicianParts, "; ")

		// Special needs info
		specialParts := []string{}
		if v, ok := fields["Family Camp-Special Needs"]; ok && v != "" {
			specialParts = append(specialParts, v)
		}
		if v, ok := fields["Family Camp-Special Needs Yes"]; ok && v != "" {
			specialParts = append(specialParts, v)
		}
		med.specialNeedsInfo = strings.Join(specialParts, "; ")

		// Allergy info
		allergyParts := []string{}
		if v, ok := fields["Family Medical-Allergies"]; ok && v != "" {
			allergyParts = append(allergyParts, v)
		}
		if v, ok := fields["Family Medical-Allergy Info"]; ok && v != "" {
			allergyParts = append(allergyParts, v)
		}
		med.allergyInfo = strings.Join(allergyParts, "; ")

		// Dietary info
		dietaryParts := []string{}
		if v, ok := fields["Family Medical-Dietary Needs"]; ok && v != "" {
			dietaryParts = append(dietaryParts, v)
		}
		if v, ok := fields["Family Medical-Dietary Explain"]; ok && v != "" {
			dietaryParts = append(dietaryParts, v)
		}
		med.dietaryInfo = strings.Join(dietaryParts, "; ")

		// Additional info
		if v, ok := fields["Family Medical-Additional"]; ok && v != "" {
			med.additionalInfo = v
		}

		// Only include if has some data
		if med.cpapInfo != "" || med.physicianInfo != "" ||
			med.specialNeedsInfo != "" || med.allergyInfo != "" ||
			med.dietaryInfo != "" || med.additionalInfo != "" {
			result = append(result, med)
		}
	}

	return result
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (s *FamilyCampDerivedSync) forceWALCheckpoint() error {
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

// extractAdultNumberFromField extracts the adult number (1-5) from a field name
var adultNumberRegex = regexp.MustCompile(`(?:Adult |Gender |DOB |-P)(\d)`)

func extractAdultNumberFromField(fieldName string) int {
	// Handle explicit patterns
	if strings.Contains(fieldName, "Adult 1") || strings.Contains(fieldName, "1 Email") ||
		strings.Contains(fieldName, "1-Pronouns") || strings.Contains(fieldName, "Gender 1") ||
		strings.Contains(fieldName, "DOB 1") || strings.Contains(fieldName, "-P1 ") ||
		strings.Contains(fieldName, "to 1") {
		return 1
	}
	if strings.Contains(fieldName, "Adult 2") || strings.Contains(fieldName, "2 Email") ||
		strings.Contains(fieldName, "2-Pronouns") || strings.Contains(fieldName, "Gender 2") ||
		strings.Contains(fieldName, "DOB 2") || strings.Contains(fieldName, "-P2 ") ||
		strings.Contains(fieldName, "to 2") {
		return 2
	}
	if strings.Contains(fieldName, "Adult 3") {
		return 3
	}
	if strings.Contains(fieldName, "Adult 4") {
		return 4
	}
	if strings.Contains(fieldName, "Adult 5") {
		return 5
	}

	// Fallback to regex
	matches := adultNumberRegex.FindStringSubmatch(fieldName)
	if len(matches) > 1 {
		num, _ := strconv.Atoi(matches[1])
		return num
	}

	return 0
}

// parseBoolFieldValue parses boolean values from custom field strings.
//
// CampMinder single-select fields store the FULL option text, not a token, so a
// yes/no question can arrive as a whole sentence:
//
//	"Yes, please register regardless of cabin type"          -> true
//	"No, I am only able to attend with this accommodation..."  -> false
//
// Anchoring on the leading word rather than the whole string is what makes both
// shapes work. It must stay an anchor and not a substring search: "No, yes is
// not my answer" and "Not yes" are both false, and "Yesterday" is not a yes.
//
// The bare tokens "yes", "y", "true" and "1" also return true, so plain-answer
// fields (FAM Camp-Accommodation and both Housing Accommodation spellings all
// store a bare "Yes"/"No") work unchanged.
func parseBoolFieldValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case boolYes, boolTrueStr, "1", "y":
		return true
	case "":
		return false
	}

	// Leading-token match: "yes" followed by a separator, never mid-word.
	const yesPrefix = boolYes
	if !strings.HasPrefix(lower, yesPrefix) {
		return false
	}
	rest := lower[len(yesPrefix):]
	if rest == "" {
		return true
	}
	switch rest[0] {
	case ' ', ',', '.', ';', ':', '-', '(':
		return true
	}
	return false
}

// ============================================================================
// Upsert helpers: preload existing records
// ============================================================================

// preloadExistingAdults loads all existing family_camp_adults records for the year
// Returns a map keyed by "householdPBID:year:adultNumber"
func (s *FamilyCampDerivedSync) preloadExistingAdults(year int) (map[string]*core.Record, error) {
	result := make(map[string]*core.Record)
	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		records, err := s.App.FindRecordsByFilter("family_camp_adults", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying family_camp_adults page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			adultNum := 0
			if num, ok := record.Get("adult_number").(float64); ok {
				adultNum = int(num)
			}
			if householdID != "" && adultNum > 0 {
				key := fmt.Sprintf("%s:%d:%d", householdID, year, adultNum)
				result[key] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// preloadExistingRegistrations loads all existing family_camp_registrations records for the year
// Returns a map keyed by "householdPBID:year"
func (s *FamilyCampDerivedSync) preloadExistingRegistrations(year int) (map[string]*core.Record, error) {
	result := make(map[string]*core.Record)
	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		records, err := s.App.FindRecordsByFilter("family_camp_registrations", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying family_camp_registrations page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				key := fmt.Sprintf("%s:%d", householdID, year)
				result[key] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// preloadExistingMedical loads all existing family_camp_medical records for the year
// Returns a map keyed by "householdPBID:year"
func (s *FamilyCampDerivedSync) preloadExistingMedical(year int) (map[string]*core.Record, error) {
	result := make(map[string]*core.Record)
	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		records, err := s.App.FindRecordsByFilter("family_camp_medical", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying family_camp_medical page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				key := fmt.Sprintf("%s:%d", householdID, year)
				result[key] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// ============================================================================
// Upsert helpers: comparison functions
// ============================================================================

// adultNeedsUpdate checks if an adult record needs updating
func (s *FamilyCampDerivedSync) adultNeedsUpdate(existing *core.Record, adult *adultData) bool {
	return existing.GetString("name") != adult.name ||
		existing.GetString("first_name") != adult.firstName ||
		existing.GetString("last_name") != adult.lastName ||
		existing.GetString("email") != adult.email ||
		existing.GetString("pronouns") != adult.pronouns ||
		existing.GetString("gender") != adult.gender ||
		existing.GetString("date_of_birth") != adult.dateOfBirth ||
		existing.GetString("relationship_to_camper") != adult.relationship
}

// registrationNeedsUpdate checks if a registration record needs updating
func (s *FamilyCampDerivedSync) registrationNeedsUpdate(existing *core.Record, reg *registrationData) bool {
	return existing.GetString("cabin_assignment") != reg.cabinAssignment ||
		existing.GetString("share_cabin_preference") != reg.shareCabinPreference ||
		existing.GetString("shared_cabin_with") != reg.sharedCabinWith ||
		existing.GetString("arrival_eta") != reg.arrivalETA ||
		existing.GetString("special_occasions") != reg.specialOccasions ||
		existing.GetString("goals") != reg.goals ||
		existing.GetString("notes") != reg.notes ||
		existing.GetBool("needs_accommodation") != reg.needsAccommodation ||
		existing.GetBool("opt_out_vip") != reg.optOutVIP
}

// medicalNeedsUpdate checks if a medical record needs updating
func (s *FamilyCampDerivedSync) medicalNeedsUpdate(existing *core.Record, med *medicalData) bool {
	return existing.GetString("cpap_info") != med.cpapInfo ||
		existing.GetString("physician_info") != med.physicianInfo ||
		existing.GetString("special_needs_info") != med.specialNeedsInfo ||
		existing.GetString("allergy_info") != med.allergyInfo ||
		existing.GetString("dietary_info") != med.dietaryInfo ||
		existing.GetString("additional_info") != med.additionalInfo
}

// ============================================================================
// Upsert functions
// ============================================================================

// upsertAdults performs upsert for adult records
func (s *FamilyCampDerivedSync) upsertAdults(
	ctx context.Context, adults []*adultData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errors int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_adults")
	if err != nil {
		slog.Error("Error finding family_camp_adults collection", "error", err)
		return 0, 0, 0, len(adults)
	}

	for _, adult := range adults {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errors
		default:
		}

		key := fmt.Sprintf("%s:%d:%d", adult.householdPBID, year, adult.adultNumber)
		s.ProcessedAdultKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			// Record exists - check if update needed
			if s.adultNeedsUpdate(existingRecord, adult) {
				existingRecord.Set("name", adult.name)
				existingRecord.Set("first_name", adult.firstName)
				existingRecord.Set("last_name", adult.lastName)
				existingRecord.Set("email", adult.email)
				existingRecord.Set("pronouns", adult.pronouns)
				existingRecord.Set("gender", adult.gender)
				existingRecord.Set("date_of_birth", adult.dateOfBirth)
				existingRecord.Set("relationship_to_camper", adult.relationship)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating adult record", "household", adult.householdPBID, "error", err)
					errors++
					continue
				}
				updated++
			} else {
				skipped++
			}
		} else {
			// New record - create
			record := core.NewRecord(col)
			record.Set("household", adult.householdPBID)
			record.Set("year", year)
			record.Set("adult_number", adult.adultNumber)
			record.Set("name", adult.name)
			record.Set("first_name", adult.firstName)
			record.Set("last_name", adult.lastName)
			record.Set("email", adult.email)
			record.Set("pronouns", adult.pronouns)
			record.Set("gender", adult.gender)
			record.Set("date_of_birth", adult.dateOfBirth)
			record.Set("relationship_to_camper", adult.relationship)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating adult record", "household", adult.householdPBID, "error", err)
				errors++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errors
}

// upsertRegistrations performs upsert for registration records
func (s *FamilyCampDerivedSync) upsertRegistrations(
	ctx context.Context, registrations []*registrationData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errors int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_registrations")
	if err != nil {
		slog.Error("Error finding family_camp_registrations collection", "error", err)
		return 0, 0, 0, len(registrations)
	}

	for _, reg := range registrations {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errors
		default:
		}

		key := fmt.Sprintf("%s:%d", reg.householdPBID, year)
		s.ProcessedRegKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			// Record exists - check if update needed
			if s.registrationNeedsUpdate(existingRecord, reg) {
				existingRecord.Set("cabin_assignment", reg.cabinAssignment)
				existingRecord.Set("share_cabin_preference", reg.shareCabinPreference)
				existingRecord.Set("shared_cabin_with", reg.sharedCabinWith)
				existingRecord.Set("arrival_eta", reg.arrivalETA)
				existingRecord.Set("special_occasions", reg.specialOccasions)
				existingRecord.Set("goals", reg.goals)
				existingRecord.Set("notes", reg.notes)
				existingRecord.Set("needs_accommodation", reg.needsAccommodation)
				existingRecord.Set("opt_out_vip", reg.optOutVIP)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating registration record", "household", reg.householdPBID, "error", err)
					errors++
					continue
				}
				updated++
			} else {
				skipped++
			}
		} else {
			// New record - create
			record := core.NewRecord(col)
			record.Set("household", reg.householdPBID)
			record.Set("year", year)
			record.Set("cabin_assignment", reg.cabinAssignment)
			record.Set("share_cabin_preference", reg.shareCabinPreference)
			record.Set("shared_cabin_with", reg.sharedCabinWith)
			record.Set("arrival_eta", reg.arrivalETA)
			record.Set("special_occasions", reg.specialOccasions)
			record.Set("goals", reg.goals)
			record.Set("notes", reg.notes)
			record.Set("needs_accommodation", reg.needsAccommodation)
			record.Set("opt_out_vip", reg.optOutVIP)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating registration record", "household", reg.householdPBID, "error", err)
				errors++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errors
}

// upsertMedical performs upsert for medical records
func (s *FamilyCampDerivedSync) upsertMedical(
	ctx context.Context, medical []*medicalData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errors int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_medical")
	if err != nil {
		slog.Error("Error finding family_camp_medical collection", "error", err)
		return 0, 0, 0, len(medical)
	}

	for _, med := range medical {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errors
		default:
		}

		key := fmt.Sprintf("%s:%d", med.householdPBID, year)
		s.ProcessedMedicalKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			// Record exists - check if update needed
			if s.medicalNeedsUpdate(existingRecord, med) {
				existingRecord.Set("cpap_info", med.cpapInfo)
				existingRecord.Set("physician_info", med.physicianInfo)
				existingRecord.Set("special_needs_info", med.specialNeedsInfo)
				existingRecord.Set("allergy_info", med.allergyInfo)
				existingRecord.Set("dietary_info", med.dietaryInfo)
				existingRecord.Set("additional_info", med.additionalInfo)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating medical record", "household", med.householdPBID, "error", err)
					errors++
					continue
				}
				updated++
			} else {
				skipped++
			}
		} else {
			// New record - create
			record := core.NewRecord(col)
			record.Set("household", med.householdPBID)
			record.Set("year", year)
			record.Set("cpap_info", med.cpapInfo)
			record.Set("physician_info", med.physicianInfo)
			record.Set("special_needs_info", med.specialNeedsInfo)
			record.Set("allergy_info", med.allergyInfo)
			record.Set("dietary_info", med.dietaryInfo)
			record.Set("additional_info", med.additionalInfo)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating medical record", "household", med.householdPBID, "error", err)
				errors++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errors
}

// ============================================================================
// Orphan deletion functions
// ============================================================================

// deleteOrphanedAdults removes adult records that weren't processed
func (s *FamilyCampDerivedSync) deleteOrphanedAdults(existing map[string]*core.Record) int {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for adults due to sync failure")
		return 0
	}

	orphanCount := 0
	for key, record := range existing {
		if s.ProcessedAdultKeys[key] {
			continue
		}

		householdID := record.GetString("household")
		adultNum := record.Get("adult_number")
		slog.Info("Deleting orphaned family_camp_adults record",
			"household", householdID,
			"adult_number", adultNum)

		if err := s.App.Delete(record); err != nil {
			slog.Error("Error deleting orphan adult", "id", record.Id, "error", err)
			s.Stats.Errors++
			continue
		}
		orphanCount++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned family_camp_adults records", "count", orphanCount)
	}

	return orphanCount
}

// deleteOrphanedRegistrations removes registration records that weren't processed
func (s *FamilyCampDerivedSync) deleteOrphanedRegistrations(existing map[string]*core.Record) int {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for registrations due to sync failure")
		return 0
	}

	orphanCount := 0
	for key, record := range existing {
		if s.ProcessedRegKeys[key] {
			continue
		}

		householdID := record.GetString("household")
		slog.Info("Deleting orphaned family_camp_registrations record",
			"household", householdID)

		if err := s.App.Delete(record); err != nil {
			slog.Error("Error deleting orphan registration", "id", record.Id, "error", err)
			s.Stats.Errors++
			continue
		}
		orphanCount++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned family_camp_registrations records", "count", orphanCount)
	}

	return orphanCount
}

// deleteOrphanedMedical removes medical records that weren't processed
func (s *FamilyCampDerivedSync) deleteOrphanedMedical(existing map[string]*core.Record) int {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for medical due to sync failure")
		return 0
	}

	orphanCount := 0
	for key, record := range existing {
		if s.ProcessedMedicalKeys[key] {
			continue
		}

		householdID := record.GetString("household")
		slog.Info("Deleting orphaned family_camp_medical record",
			"household", householdID)

		if err := s.App.Delete(record); err != nil {
			slog.Error("Error deleting orphan medical", "id", record.Id, "error", err)
			s.Stats.Errors++
			continue
		}
		orphanCount++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned family_camp_medical records", "count", orphanCount)
	}

	return orphanCount
}
