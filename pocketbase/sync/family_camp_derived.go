package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
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
	Stats          Stats
	SyncSuccessful bool
}

// NewFamilyCampDerivedSync creates a new family camp derived sync service
func NewFamilyCampDerivedSync(app core.App) *FamilyCampDerivedSync {
	return &FamilyCampDerivedSync{
		App:    app,
		Year:   0,
		DryRun: false,
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
			year = 2025 // Default fallback
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

	// Step 8: Clear existing records
	deleted, err := s.clearExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("clearing existing records: %w", err)
	}
	s.Stats.Deleted = deleted
	slog.Info("Cleared existing records", "deleted", deleted)

	// Step 9: Write adults
	created, errors := s.writeAdults(ctx, adults, year)
	s.Stats.Created += created
	s.Stats.Errors += errors

	// Step 10: Write registrations
	created, errors = s.writeRegistrations(ctx, registrations, year)
	s.Stats.Created += created
	s.Stats.Errors += errors

	// Step 11: Write medical
	created, errors = s.writeMedical(ctx, medical, year)
	s.Stats.Created += created
	s.Stats.Errors += errors

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	s.SyncSuccessful = true
	slog.Info("Family camp derived computation completed",
		"year", year,
		"created", s.Stats.Created,
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
		name := record.GetString("name")
		if isFamilyCampField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
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

		if v.fieldName == "Family Camp Cabin" && reg.cabinAssignment == "" {
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
		case "Family Camp-Goals Attending":
			if reg.goals == "" {
				reg.goals = v.value
			}
		case "Family Camp-Anything else":
			if reg.notes == "" {
				reg.notes = v.value
			}
		case "FAM Camp-Accommodation":
			reg.needsAccommodation = parseBoolFieldValue(v.value)
		case "FAM CAMP-Opt Out VIP":
			reg.optOutVIP = parseBoolFieldValue(v.value)
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

// clearExistingRecords deletes all family camp derived records for a year
func (s *FamilyCampDerivedSync) clearExistingRecords(ctx context.Context, year int) (int, error) {
	deleted := 0

	tables := []string{"family_camp_adults", "family_camp_registrations", "family_camp_medical"}
	filter := fmt.Sprintf("year = %d", year)

	for _, table := range tables {
		for {
			select {
			case <-ctx.Done():
				return deleted, ctx.Err()
			default:
			}

			records, err := s.App.FindRecordsByFilter(table, filter, "", 100, 0)
			if err != nil {
				return deleted, fmt.Errorf("querying %s: %w", table, err)
			}

			if len(records) == 0 {
				break
			}

			for _, record := range records {
				if err := s.App.Delete(record); err != nil {
					slog.Error("Error deleting record", "table", table, "id", record.Id, "error", err)
					continue
				}
				deleted++
			}
		}
	}

	return deleted, nil
}

// writeAdults writes adult records to the database
func (s *FamilyCampDerivedSync) writeAdults(ctx context.Context, adults []*adultData, year int) (created, errors int) {
	created = 0
	errors = 0

	col, err := s.App.FindCollectionByNameOrId("family_camp_adults")
	if err != nil {
		slog.Error("Error finding family_camp_adults collection", "error", err)
		return 0, len(adults)
	}

	for _, adult := range adults {
		select {
		case <-ctx.Done():
			return created, errors
		default:
		}

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

	return created, errors
}

// writeRegistrations writes registration records to the database
func (s *FamilyCampDerivedSync) writeRegistrations(
	ctx context.Context, registrations []*registrationData, year int,
) (created, errors int) {
	created = 0
	errors = 0

	col, err := s.App.FindCollectionByNameOrId("family_camp_registrations")
	if err != nil {
		slog.Error("Error finding family_camp_registrations collection", "error", err)
		return 0, len(registrations)
	}

	for _, reg := range registrations {
		select {
		case <-ctx.Done():
			return created, errors
		default:
		}

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

	return created, errors
}

// writeMedical writes medical records to the database
func (s *FamilyCampDerivedSync) writeMedical(
	ctx context.Context, medical []*medicalData, year int,
) (created, errors int) {
	created = 0
	errors = 0

	col, err := s.App.FindCollectionByNameOrId("family_camp_medical")
	if err != nil {
		slog.Error("Error finding family_camp_medical collection", "error", err)
		return 0, len(medical)
	}

	for _, med := range medical {
		select {
		case <-ctx.Done():
			return created, errors
		default:
		}

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

	return created, errors
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

// parseBoolFieldValue parses boolean values from custom field strings
func parseBoolFieldValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == "yes" || lower == "true" || lower == "1"
}
