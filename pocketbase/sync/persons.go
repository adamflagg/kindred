// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// personsCollection is the PocketBase collection name for persons.
const personsCollection = "persons"

// PersonsSync handles syncing person records from CampMinder
type PersonsSync struct {
	BaseSyncService

	// Track data quality issues
	missingDataStats map[string]int
	skippedStaff     int

	// Sub-entity stats for combined sync (households)
	// Note: person_tags removed - tags are now a multi-select relation on persons
	householdStats *Stats
}

// personHouseholdIDs holds the CampMinder IDs for a person's households
// Used temporarily during sync to populate relation fields
type personHouseholdIDs struct {
	PrincipalID          int
	PrimaryChildhoodID   int
	AlternateChildhoodID int
}

// gatherPersonIDsResult holds person IDs and their camper status from gatherPersonIDs
type gatherPersonIDsResult struct {
	personIDs    []int        // All unique person IDs (from attendees + staff)
	camperIDsSet map[int]bool // IDs from attendees (true campers)
}

// NewPersonsSync creates a new persons sync service
func NewPersonsSync(app core.App, client *campminder.Client) *PersonsSync {
	return &PersonsSync{
		BaseSyncService:  NewBaseSyncService(app, client),
		missingDataStats: make(map[string]int),
	}
}

// Name returns the name of this sync service
func (s *PersonsSync) Name() string {
	return personsCollection
}

// GetStats returns stats for this sync, including sub-entity stats for combined sync
func (s *PersonsSync) GetStats() Stats {
	stats := s.Stats
	if s.householdStats != nil {
		stats.SubStats = make(map[string]Stats)
		stats.SubStats["households"] = *s.householdStats
	}
	return stats
}

// getPersonIDsFromAttendees gets unique person IDs from attendees for a specific year
func (s *PersonsSync) getPersonIDsFromAttendees(year int) ([]int, error) {
	// Query attendees for this year
	filter := fmt.Sprintf("year = %d", year)
	attendees, err := s.App.FindRecordsByFilter("attendees", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Extract unique person IDs
	personIDMap := make(map[int]bool)
	for _, attendee := range attendees {
		if cmPersonID, ok := attendee.Get("person_id").(float64); ok {
			personIDMap[int(cmPersonID)] = true
		}
	}

	// Convert map to slice
	personIDs := make([]int, 0, len(personIDMap))
	for id := range personIDMap {
		personIDs = append(personIDs, id)
	}

	return personIDs, nil
}

// Sync performs the combined persons/households synchronization
// This is a combined sync that fetches persons data once and populates both tables:
// 1. persons - Core person data with CamperDetails fields (tags as multi-select relation)
// 2. households - Deduplicated household records (shared across family members)
func (s *PersonsSync) Sync(ctx context.Context) error {
	s.LogSyncStart("persons (combined: persons + households)")
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.ClearProcessedKeys()

	year := s.Client.GetSeasonID()

	// Gather person IDs from attendees and staff
	gatherResult, err := s.gatherPersonIDs(year)
	if err != nil {
		return err
	}
	if len(gatherResult.personIDs) == 0 {
		slog.Info("No attendees or staff found, skipping persons sync", "year", year)
		s.SyncSuccessful = true
		return nil
	}

	filter := fmt.Sprintf("year = %d", year)

	// Pre-load lookup data
	existingPersons := s.preloadExistingPersons(filter, year)
	existingHouseholds := s.preloadExistingHouseholds(filter, year)
	tagDefsByName := s.preloadTagDefinitions()
	divisionsByID := s.preloadDivisions()

	// Process persons and collect household data
	processResult, err := s.processPersonBatches(
		ctx, gatherResult.personIDs, gatherResult.camperIDsSet, existingPersons, tagDefsByName, divisionsByID, year)
	if err != nil {
		return err
	}

	// Process households
	householdStats := s.processHouseholds(processResult.extractedHouseholds, existingHouseholds, year)

	// Reload households for relation updates
	householdsByID := s.preloadExistingHouseholds(filter, year)

	// Update relations and cleanup
	s.updateRelationsAndCleanup(year, householdsByID, processResult.personHouseholdMap,
		processResult.processedHouseholdIDs)

	// Final reporting
	s.householdStats = &householdStats
	s.printDataQualitySummary()
	s.logSyncResults(householdStats)
	s.LogSyncComplete("Persons (combined)")

	if err := s.updateAttendeeRelations(year); err != nil {
		slog.Warn("Failed to update attendee relations", "error", err)
	}

	return nil
}

// gatherPersonIDs collects person IDs from both attendees and staff.
// Returns a result containing both the merged IDs and a set indicating which are campers (from attendees).
func (s *PersonsSync) gatherPersonIDs(year int) (*gatherPersonIDsResult, error) {
	attendeePersonIDs, err := s.getPersonIDsFromAttendees(year)
	if err != nil {
		return nil, fmt.Errorf("getting person IDs from attendees: %w", err)
	}

	// Build camper set from attendee IDs (before merging with staff)
	camperIDsSet := make(map[int]bool, len(attendeePersonIDs))
	for _, id := range attendeePersonIDs {
		camperIDsSet[id] = true
	}

	staffPersonIDs, err := s.getPersonIDsFromStaff()
	if err != nil {
		slog.Warn("Error getting staff person IDs, continuing with attendees only", "error", err)
		staffPersonIDs = nil
	}

	personIDs := s.mergePersonIDs(attendeePersonIDs, staffPersonIDs)
	slog.Info("Found unique persons",
		"attendees", len(attendeePersonIDs),
		"staff", len(staffPersonIDs),
		"total", len(personIDs),
		"year", year)

	return &gatherPersonIDsResult{
		personIDs:    personIDs,
		camperIDsSet: camperIDsSet,
	}, nil
}

// preloadExistingPersons loads existing person records indexed by cm_id.
func (s *PersonsSync) preloadExistingPersons(filter string, year int) map[int]*core.Record {
	result := make(map[int]*core.Record)
	records, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing persons", "year", year, "error", err)
		return result
	}
	for _, record := range records {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			result[int(cmID)] = record
		}
	}
	slog.Info("Loaded existing persons from database", "count", len(result), "year", year)
	return result
}

// preloadExistingHouseholds loads existing household records indexed by cm_id.
func (s *PersonsSync) preloadExistingHouseholds(filter string, year int) map[int]*core.Record {
	result := make(map[int]*core.Record)
	records, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing households", "year", year, "error", err)
		return result
	}
	for _, record := range records {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			result[int(cmID)] = record
		}
	}
	slog.Info("Loaded existing households from database", "count", len(result), "year", year)
	return result
}

// preloadTagDefinitions loads tag definitions indexed by name.
func (s *PersonsSync) preloadTagDefinitions() map[string]string {
	result := make(map[string]string)
	tagDefs, err := s.App.FindRecordsByFilter("person_tag_defs", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading tag definitions", "error", err)
		return result
	}
	for _, td := range tagDefs {
		if name, ok := td.Get("name").(string); ok && name != "" {
			result[name] = td.Id
		}
	}
	slog.Info("Loaded tag definitions for tags field", "count", len(result))
	return result
}

// preloadDivisions loads division records indexed by cm_id.
func (s *PersonsSync) preloadDivisions() map[int]string {
	result := make(map[int]string)
	divisions, err := s.App.FindRecordsByFilter("divisions", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading divisions", "error", err)
		return result
	}
	for _, div := range divisions {
		if cmID, ok := div.Get("cm_id").(float64); ok && cmID > 0 {
			result[int(cmID)] = div.Id
		}
	}
	slog.Info("Loaded divisions for division relation", "count", len(result))
	return result
}

// personBatchResult holds results from processing person batches.
type personBatchResult struct {
	extractedHouseholds   map[int]map[string]any
	processedHouseholdIDs map[int]bool
	personHouseholdMap    map[int]personHouseholdIDs
}

// processPersonBatches processes persons in batches and collects household data.
func (s *PersonsSync) processPersonBatches(
	ctx context.Context,
	personIDs []int,
	camperIDsSet map[int]bool,
	existingPersons map[int]*core.Record,
	tagDefsByName map[string]string,
	divisionsByID map[int]string,
	year int,
) (*personBatchResult, error) {
	result := &personBatchResult{
		extractedHouseholds:   make(map[int]map[string]any),
		processedHouseholdIDs: make(map[int]bool),
		personHouseholdMap:    make(map[int]personHouseholdIDs),
	}

	// batchSize bounds CampMinder GetPersons API calls — CM enforces a request
	// size limit, so keep at 500. Different from the smaller PocketBase filter
	// batches used elsewhere in this package.
	const batchSize = 500
	processed := 0
	for batch := range slices.Chunk(personIDs, batchSize) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		slog.Info("Processing persons batch", "start", processed+1, "end", processed+len(batch), "total", len(personIDs))

		persons, err := s.Client.GetPersons(batch)
		if err != nil {
			return nil, fmt.Errorf("fetching persons batch: %w", err)
		}

		if processed == 0 && len(persons) > 0 {
			s.SyncSuccessful = true
		}

		s.processBatchPersons(persons, camperIDsSet, existingPersons, tagDefsByName, divisionsByID, year, result)
		processed += len(batch)
	}

	slog.Info("Extracted unique households from persons", "count", len(result.extractedHouseholds))
	return result, nil
}

// processBatchPersons processes a batch of person records.
func (s *PersonsSync) processBatchPersons(
	persons []map[string]any,
	camperIDsSet map[int]bool,
	existingPersons map[int]*core.Record,
	tagDefsByName map[string]string,
	divisionsByID map[int]string,
	year int,
	result *personBatchResult,
) {
	for _, personData := range persons {
		// Determine if this person is a camper (from attendees) or staff-only
		personID, hasID := personData["ID"].(float64)
		isCamper := hasID && camperIDsSet[int(personID)]

		if err := s.processPerson(personData, isCamper, existingPersons, tagDefsByName, divisionsByID, year); err != nil {
			slog.Error("Error processing person", "error", err)
			s.Stats.Errors++
		}

		batchHouseholds := s.extractUniqueHouseholds([]map[string]any{personData})
		for _, household := range batchHouseholds {
			if id, ok := household["ID"].(float64); ok && id > 0 {
				result.extractedHouseholds[int(id)] = household
				result.processedHouseholdIDs[int(id)] = true
			}
		}

		if hasID {
			result.personHouseholdMap[int(personID)] = s.extractHouseholdIDsFromPerson(personData)
		}
	}
}

// processHouseholds processes all collected households.
func (s *PersonsSync) processHouseholds(
	households map[int]map[string]any,
	existingHouseholds map[int]*core.Record,
	year int,
) Stats {
	householdStats := Stats{}
	// billing_address JSON field removed - only discrete fields are compared
	compareFields := []string{
		"cm_id", "greeting", "mailing_title", "alternate_mailing_title",
		"billing_mailing_title", "household_phone",
		"billing_address1", "billing_address2", "billing_city", "billing_state",
		"billing_postal_code", "billing_country",
	}

	for householdID, householdData := range households {
		pbData, err := s.transformHouseholdToPB(householdData, year)
		if err != nil {
			slog.Error("Error transforming household", "id", householdID, "error", err)
			householdStats.Errors++
			continue
		}

		err = s.processHouseholdRecord(householdID, pbData, existingHouseholds, compareFields, &householdStats)
		if err != nil {
			slog.Error("Error processing household", "id", householdID, "error", err)
			householdStats.Errors++
		}
	}

	return householdStats
}

// updateRelationsAndCleanup handles relation updates and orphan deletion.
func (s *PersonsSync) updateRelationsAndCleanup(
	year int,
	householdsByID map[int]*core.Record,
	personHouseholdMap map[int]personHouseholdIDs,
	processedHouseholdIDs map[int]bool,
) {
	if err := s.updatePersonHouseholdRelations(year, householdsByID, personHouseholdMap); err != nil {
		slog.Warn("Failed to update person-household relations", "error", err)
	}

	if err := s.deleteOrphans(year); err != nil {
		slog.Warn("Failed to delete orphaned persons", "error", err)
	}

	if err := s.deleteHouseholdOrphans(year, processedHouseholdIDs); err != nil {
		slog.Warn("Failed to delete orphaned households", "error", err)
	}

	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}
}

// logSyncResults logs the final sync statistics.
func (s *PersonsSync) logSyncResults(householdStats Stats) {
	slog.Info("Combined sync complete",
		"persons_created", s.Stats.Created,
		"persons_updated", s.Stats.Updated,
		"persons_skipped", s.Stats.Skipped,
		"persons_errors", s.Stats.Errors,
		"households_created", householdStats.Created,
		"households_updated", householdStats.Updated,
		"households_skipped", householdStats.Skipped,
		"households_errors", householdStats.Errors)
}

// processPerson processes a single person using pre-loaded existing persons
func (s *PersonsSync) processPerson(
	personData map[string]any,
	isCamper bool,
	existingPersons map[int]*core.Record,
	tagDefsByName map[string]string,
	divisionsByID map[int]string,
	year int,
) error {
	// Transform to PocketBase format
	pbData, err := s.transformPersonToPB(personData, year, isCamper)
	if err != nil {
		return err
	}

	// Skip if transformation returned nil (e.g., staff member)
	if pbData == nil {
		s.skippedStaff++
		s.Stats.Skipped++
		return nil
	}

	// Extract tags and populate multi-select relation field
	// Use year-filtered extraction to exclude future-year tags (e.g., "2026 Early Registration" on 2025 records)
	if tagIDs := s.extractTagIDsWithYearFilter(personData, tagDefsByName, year); tagIDs != nil {
		pbData["tags"] = tagIDs
	}

	// Resolve division relation from DivisionID in CamperDetails
	if divisionCMID, ok := pbData["division_cm_id"].(int); ok && divisionCMID > 0 {
		if divisionPBID, exists := divisionsByID[divisionCMID]; exists {
			pbData["division"] = divisionPBID
		}
	}
	// Remove temporary field
	delete(pbData, "division_cm_id")

	// Get person ID
	personID, ok := personData["ID"].(float64)
	if !ok {
		return fmt.Errorf("missing person ID")
	}
	personIDInt := int(personID)

	// Check if person already exists
	existing := existingPersons[personIDInt]

	// Track this person as processed for orphan detection with year
	s.TrackProcessedKey(personIDInt, year)

	// Fields to compare for updates (includes expanded CamperDetails fields)
	// Note: Household relation fields (household, primary_childhood_household, alternate_childhood_household)
	// are excluded because they're populated separately in updatePersonHouseholdRelations after save.
	// Tags field IS included - FieldEquals normalizes []interface{} vs []string for proper comparison.
	// Removed: phone_numbers, email_addresses (JSON), address (JSON) - fields dropped from schema
	compareFields := []string{"cm_id", "first_name", "last_name", "preferred_name",
		"birthdate", "gender", "age", "grade", "school", "years_at_camp",
		"last_year_attended", "gender_identity_id", "gender_identity_name", "gender_identity_write_in",
		"gender_pronoun_id", "gender_pronoun_name", "gender_pronoun_write_in",
		"address_city", "address_state", "primary_email", "secondary_email",
		"household_id", "is_camper", "year", "parent_names",
		"division", "partition_id", "lead_date", "tshirt_size", "cm_lead_date",
		"tags"}

	if existing != nil {
		// Check if update is needed
		needsUpdate := false
		for _, field := range compareFields {
			if value, exists := pbData[field]; exists {
				if !s.FieldEquals(existing.Get(field), value) {
					// DIAGNOSTIC: Log field differences to identify false-positive updates
					slog.Debug("Person field differs",
						"personID", personIDInt,
						"field", field,
						"existingValue", existing.Get(field),
						"newValue", value)
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			// Update existing record
			for field, value := range pbData {
				existing.Set(field, value)
			}

			if err := s.App.Save(existing); err != nil {
				return fmt.Errorf("updating person %d: %w", personIDInt, err)
			}
			s.Stats.Updated++
		} else {
			s.Stats.Skipped++
		}
	} else {
		// Create new person record
		collection, err := s.App.FindCollectionByNameOrId("persons")
		if err != nil {
			return fmt.Errorf("finding persons collection: %w", err)
		}

		record := core.NewRecord(collection)
		for field, value := range pbData {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			return fmt.Errorf("creating person %d: %w", personIDInt, err)
		}
		s.Stats.Created++
	}

	return nil
}

// transformPersonToPB transforms CampMinder person data to PocketBase format
// isCamper indicates whether this person came from attendees (true) or staff-only (false)
//
//nolint:gocyclo // data transform function with many field mappings
func (s *PersonsSync) transformPersonToPB(
	cmPerson map[string]any,
	year int,
	isCamper bool,
) (map[string]any, error) {
	// Skip if no CamperDetails (means they're not a camper)
	camperDetails, ok := cmPerson["CamperDetails"].(map[string]any)
	if !ok || camperDetails == nil {
		name := s.getPersonName(cmPerson)
		slog.Debug("Skipping person - no CamperDetails (not a camper)",
			"name", name,
			"personID", cmPerson["ID"],
		)
		s.missingDataStats["skipped_no_camper_details"]++
		return nil, nil
	}

	pbData := make(map[string]any)

	// Extract base fields
	if id, ok := cmPerson["ID"].(float64); ok {
		pbData["cm_id"] = int(id)
	}

	// Name fields - fix ALL CAPS names from CampMinder while preserving mixed-case
	if nameData, ok := cmPerson["Name"].(map[string]any); ok {
		firstName := s.getString(nameData, "First", fmt.Sprintf("MISSING_FIRST_%.0f", cmPerson["ID"]))
		lastName := s.getString(nameData, "Last", fmt.Sprintf("MISSING_LAST_%.0f", cmPerson["ID"]))

		// Only convert ALL CAPS to Title Case - preserves McDonald, DeVos, O'Brien, etc.
		pbData["first_name"] = s.fixAllCapsName(firstName)
		pbData["last_name"] = s.fixAllCapsName(lastName)

		if preferred := s.getString(nameData, "Preferred", ""); preferred != "" {
			pbData["preferred_name"] = s.fixAllCapsName(preferred)
		}

		fnStr, _ := pbData["first_name"].(string)
		if fnStr == "" || strings.HasPrefix(fnStr, "MISSING_") {
			s.missingDataStats["missing_name"]++
		}
		lnStr, _ := pbData["last_name"].(string)
		if lnStr == "" || strings.HasPrefix(lnStr, "MISSING_") {
			s.missingDataStats["missing_name"]++
		}
	}

	// Date of birth - store as string directly from CampMinder
	if dob, ok := cmPerson["DateOfBirth"].(string); ok && dob != "" {
		pbData["birthdate"] = dob
	}

	// Gender
	if genderID, ok := cmPerson["GenderID"].(float64); ok {
		// Map gender (CampMinder: 0=Female, 1=Male, 3=Undefined)
		switch int(genderID) {
		case 1:
			pbData["gender"] = "M"
		case 0:
			pbData["gender"] = "F"
		default:
			pbData["gender"] = "Other"
		}
	}

	// Age - use CampMinder's age directly (already represents age as of that year's data)
	if age, ok := cmPerson["Age"].(float64); ok && age > 0 {
		pbData["age"] = age // Use CampMinder's age directly
	} else {
		// Don't set age if missing - let it be null
		s.missingDataStats["missing_age"]++
	}

	// Grade from CamperDetails
	grade := s.getFloat(camperDetails, "CampGradeID", 0)
	if grade == 0 {
		grade = s.getFloat(camperDetails, "SchoolGradeID", 0)
	}

	if grade > 0 {
		// CampMinder uses 1-indexed grade IDs where 1=K, 2=1st, 3=2nd, etc.
		// Convert to 0-indexed where 0=K, 1=1st, 2=2nd, etc.
		actualGrade := int(grade) - 1
		pbData["grade"] = actualGrade // No clamp - allow 0 for kindergarten
	} else {
		// Don't set grade if missing - let it be null
		s.missingDataStats["missing_grade"]++
	}

	// Extract V2 fields from CamperDetails
	pbData["school"] = s.getString(camperDetails, "School", "")
	pbData["years_at_camp"] = s.getInt(camperDetails, "YearsAtCamp", 0)

	// Extract expanded CamperDetails fields (database expansion)
	pbData["division_cm_id"] = s.getInt(camperDetails, "DivisionID", 0)
	pbData["partition_id"] = s.getInt(camperDetails, "PartitionID", 0)
	pbData["lead_date"] = s.getString(camperDetails, "LeadDate", "")
	pbData["tshirt_size"] = s.getString(camperDetails, "TShirtSize", "")
	pbData["cm_lead_date"] = s.getString(camperDetails, "LeadDate", "")

	// Cap last_year_attended at current year (since we only sync enrolled attendees)
	lastYear := s.getInt(camperDetails, "LastYearAttended", 0)
	pbData["last_year_attended"] = min(lastYear, year)

	// Gender identity and pronouns
	pbData["gender_identity_id"] = s.getInt(cmPerson, "GenderIdentityID", 0)
	pbData["gender_identity_name"] = s.getString(cmPerson, "GenderIdentityName", "")
	pbData["gender_identity_write_in"] = s.getString(cmPerson, "GenderIdentityWriteIn", "")
	pbData["gender_pronoun_id"] = s.getInt(cmPerson, "GenderPronounID", 0)
	pbData["gender_pronoun_name"] = s.getString(cmPerson, "GenderPronounName", "")
	pbData["gender_pronoun_write_in"] = s.getString(cmPerson, "GenderPronounWriteIn", "")

	// Contact details - extract emails to discrete fields
	// phone_numbers and email_addresses JSON fields removed (unused in application)
	pbData["primary_email"] = ""
	pbData["secondary_email"] = ""
	if contactDetails, ok := cmPerson["ContactDetails"].(map[string]any); ok {
		if emails := contactDetails["Emails"]; emails != nil {
			// Extract primary and secondary emails to discrete fields
			if emailList, ok := emails.([]any); ok && len(emailList) > 0 {
				primaryEmail, secondaryEmail := s.extractPrimarySecondaryEmails(emailList)
				pbData["primary_email"] = primaryEmail
				pbData["secondary_email"] = secondaryEmail
			}
		}
	}

	// Extract address fields from Households object
	// Note: Household CampMinder IDs are extracted separately in extractHouseholdIDsFromPerson
	// and used to populate relation fields after households are saved
	// address JSON field removed - only discrete fields are populated
	pbData["address_city"] = ""
	pbData["address_state"] = ""
	if households, ok := cmPerson["Households"].(map[string]any); ok {
		// Extract address from primary childhood household
		if primary, ok := households["PrimaryChildhoodHousehold"].(map[string]any); ok {
			if billing, ok := primary["BillingAddress"].(map[string]any); ok {
				// Extract discrete address fields for querying
				if city := s.getString(billing, "City", ""); city != "" {
					pbData["address_city"] = city
				}

				// Try StateProvince first, fall back to State
				state := s.getString(billing, "StateProvince", "")
				if state == "" {
					state = s.getString(billing, "State", "")
				}
				if state != "" {
					pbData["address_state"] = state
				}
			}
		}
	}

	// Extract household ID from FamilyPersons (legacy field, kept for backward compatibility)
	if familyPersons, ok := cmPerson["FamilyPersons"].([]any); ok {
		for _, fp := range familyPersons {
			if fpMap, ok := fp.(map[string]any); ok {
				if familyID, ok := fpMap["FamilyID"].(float64); ok && familyID > 0 {
					pbData["household_id"] = int(familyID)
					break
				}
			}
		}
	}

	// Extract parent/guardian names by parsing the household's MailingTitle
	// (e.g. "Sarah Johnson and David Garcia"). The Relatives array carries only
	// guardian IDs — no names — so a salutation parse is the only name source
	// available without a follow-up GetPersons call. See #1393.
	//
	// Always set parent_names (to "" on failure) so the upsert path clears any
	// stale value from a prior sync when the source MailingTitle changes to
	// something unparseable — the PB update loop skips fields not present in
	// pbData, so an unset key would freeze old data indefinitely.
	mailing, alternate := extractHouseholdSalutations(cmPerson)
	parents := s.parseHouseholdSalutation(mailing, alternate)
	if len(parents) > 0 {
		if parentsJSON, err := json.Marshal(parents); err == nil {
			pbData["parent_names"] = string(parentsJSON)
		} else {
			pbData["parent_names"] = ""
			s.missingDataStats["missing_parent_names"]++
		}
	} else {
		pbData["parent_names"] = ""
		s.missingDataStats["missing_parent_names"]++
	}

	// Set camper status based on whether this person came from attendees
	pbData["is_camper"] = isCamper

	// Add year to make persons year-scoped
	pbData["year"] = year

	s.missingDataStats["total_campers"]++

	return pbData, nil
}

// Helper methods

func (s *PersonsSync) getPersonName(person map[string]any) string {
	if nameData, ok := person["Name"].(map[string]any); ok {
		first := s.getString(nameData, "First", "")
		last := s.getString(nameData, "Last", "")
		return fmt.Sprintf("%s %s", first, last)
	}
	return "Unknown"
}

func (s *PersonsSync) getString(data map[string]any, key, defaultValue string) string {
	if val, ok := data[key].(string); ok {
		return val
	}
	return defaultValue
}

func (s *PersonsSync) getInt(data map[string]any, key string, defaultValue int) int {
	if val, ok := data[key].(float64); ok {
		return int(val)
	}
	return defaultValue
}

func (s *PersonsSync) getFloat(data map[string]any, key string, defaultValue float64) float64 {
	if val, ok := data[key].(float64); ok {
		return val
	}
	return defaultValue
}

// isAllUppercase checks if a string contains only uppercase letters (ignoring non-letters)
func (s *PersonsSync) isAllUppercase(name string) bool {
	hasLetter := false
	for _, r := range name {
		if unicode.IsLetter(r) {
			hasLetter = true
			if !unicode.IsUpper(r) {
				return false
			}
		}
	}
	return hasLetter // Must have at least one letter
}

// honorificsRe matches a leading honorific with or without trailing period and
// either followed by whitespace or end-of-string ("Mr.", "Mr. Smith", "Dr").
var honorificsRe = regexp.MustCompile(`(?i)^(mr|mrs|ms|miss|dr|rev|rabbi|father|sister|br|sr|prof)\.?(\s+|$)`)

// hasLetterRe checks that a string contains at least one ASCII alphabetic
// character — used to reject garbage like "???" or "..." that would otherwise
// slip through as a surname.
var hasLetterRe = regexp.MustCompile(`[A-Za-z]`)

// suffixesRe matches a trailing generational suffix (Jr/Sr/II/III/IV) with
// optional period and surrounding whitespace.
var suffixesRe = regexp.MustCompile(`(?i)\s+(jr|sr|ii|iii|iv)\.?$`)

// conjunctionRe splits on " and " or " & " (case-insensitive, whitespace-bounded).
var conjunctionRe = regexp.MustCompile(`(?i)\s+(?:and|&)\s+`)

// extractHouseholdSalutations pulls the primary childhood household's
// MailingTitle and AlternateMailingTitle from a CampMinder Person payload.
// Returns empty strings if the nested structure is missing.
func extractHouseholdSalutations(cmPerson map[string]any) (mailing, alternate string) {
	households, ok := cmPerson["Households"].(map[string]any)
	if !ok {
		return "", ""
	}
	pch, ok := households["PrimaryChildhoodHousehold"].(map[string]any)
	if !ok {
		return "", ""
	}
	mailing, _ = pch["MailingTitle"].(string)
	alternate, _ = pch["AlternateMailingTitle"].(string)
	return mailing, alternate
}

// parseHouseholdSalutation extracts parent records (first/last name pairs) from
// a household's MailingTitle string. Falls back to alternate when the primary
// is empty or doesn't yield any parents.
//
// Patterns handled:
//   - "Sarah Johnson and David Garcia"  → 2 parents, distinct surnames
//   - "Sarah and David Johnson"         → 2 parents, shared surname inferred
//   - "Mr. David Johnson"               → 1 parent, honorific stripped
//   - "Mr. and Mrs. Johnson"            → 2 parents, surname-only
//   - "Mr. Johnson and Mrs. Garcia"     → 2 parents, surname-only, distinct
//
// Output shape matches what Python's Person.parents consumer expects
// (bunking/sync/bunk_request_processor/core/models.py): each entry has
// first/last/relationship/is_primary keys. is_primary is left false since the
// salutation order is not reliably the same as Relatives[].IsPrimary.
func (s *PersonsSync) parseHouseholdSalutation(mailing, alternate string) []map[string]any {
	if parents := s.tryParseSalutation(mailing); len(parents) > 0 {
		return parents
	}
	return s.tryParseSalutation(alternate)
}

func (s *PersonsSync) tryParseSalutation(raw string) []map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	parts := conjunctionRe.Split(raw, 2)
	var out []map[string]any
	switch len(parts) {
	case 1:
		// Single parent: "Mr. David Johnson"
		if p := parseSingleParent(parts[0]); p != nil {
			out = []map[string]any{p}
		}
	case 2:
		left := strings.TrimSpace(parts[0])
		right := strings.TrimSpace(parts[1])
		out = parseJointSalutation(left, right)
	}

	// Reject the whole parse if any surname lacks alphabetic content
	// (catches "???", "...", and similar garbage).
	for _, p := range out {
		if last, _ := p["last"].(string); !hasLetterRe.MatchString(last) {
			return nil
		}
	}
	return out
}

// parseSingleParent parses one half of a salutation into a parent record.
// A bare single token without an explicit honorific prefix is rejected
// (e.g. "Smith" alone is ambiguous and likely not a parent salutation), but
// "Mr. Smith" yields {last: "Smith"} because the honorific anchors intent.
func parseSingleParent(raw string) map[string]any {
	stripped, hadHonorific := stripHonorificDetect(raw)
	cleaned := stripSuffix(stripped)
	tokens := strings.Fields(cleaned)

	switch len(tokens) {
	case 0:
		return nil
	case 1:
		// Single token — only treat as a surname if we saw an honorific.
		if !hadHonorific {
			return nil
		}
		return parent("", titleCase(tokens[0]), false)
	default:
		// 2+ tokens → first = everything but last, last = last token.
		first := titleCase(strings.Join(tokens[:len(tokens)-1], " "))
		last := titleCase(tokens[len(tokens)-1])
		return parent(first, last, false)
	}
}

// parseJointSalutation handles two parents separated by " and "/" & ".
// Infers a shared surname when one side is a single first name.
func parseJointSalutation(left, right string) []map[string]any {
	leftStripped, leftHadHonorific := stripHonorificDetect(left)
	rightStripped, _ := stripHonorificDetect(right)
	leftStripped = stripSuffix(leftStripped)
	rightStripped = stripSuffix(rightStripped)
	leftTokens := strings.Fields(leftStripped)
	rightTokens := strings.Fields(rightStripped)

	// Left strips to nothing (honorific-only): right side carries the shared
	// surname for both parents. Covers:
	//   "Mr. and Mrs. Garcia"        → both parents surname-only
	//   "Mr. and Mrs. David Garcia"  → left surname-only, right has first name
	if len(leftTokens) == 0 && len(rightTokens) >= 1 {
		sharedLast := titleCase(rightTokens[len(rightTokens)-1])
		rightFirst := ""
		if len(rightTokens) >= 2 {
			rightFirst = titleCase(strings.Join(rightTokens[:len(rightTokens)-1], " "))
		}
		return []map[string]any{
			parent("", sharedLast, false),
			parent(rightFirst, sharedLast, false),
		}
	}

	// "Sarah and David Johnson" — left is one first name (no honorific
	// stripped), right has first+last. Borrow the right's surname for the
	// left parent. The leftHadHonorific guard prevents misfiring on
	// "Mr. Garcia and Mrs. Sarah Johnson" where left's single token is
	// actually a surname.
	if len(leftTokens) == 1 && len(rightTokens) >= 2 && !leftHadHonorific {
		sharedLast := titleCase(rightTokens[len(rightTokens)-1])
		rightFirst := titleCase(strings.Join(rightTokens[:len(rightTokens)-1], " "))
		return []map[string]any{
			parent(titleCase(leftTokens[0]), sharedLast, false),
			parent(rightFirst, sharedLast, false),
		}
	}

	// Both sides have at least one token — parse each side independently.
	var out []map[string]any
	if p := parseSingleParent(left); p != nil {
		out = append(out, p)
	}
	if p := parseSingleParent(right); p != nil {
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parent(first, last string, isPrimary bool) map[string]any {
	return map[string]any{
		"first":        first,
		"last":         last,
		"relationship": "Guardian",
		"is_primary":   isPrimary,
	}
}

// stripHonorificDetect returns the input with any leading honorific removed
// and a boolean indicating whether the strip actually happened. Callers use
// the flag to decide whether a single-token remainder is meaningful.
func stripHonorificDetect(s string) (string, bool) {
	replaced := honorificsRe.ReplaceAllString(s, "")
	return strings.TrimSpace(replaced), replaced != s
}

func stripSuffix(s string) string {
	return strings.TrimSpace(suffixesRe.ReplaceAllString(s, ""))
}

// titleCase normalizes ALL CAPS tokens to Title Case without touching
// legitimately mixed-case names (McDonald, O'Brien, etc.).
func titleCase(s string) string {
	if s == "" || !isAllUpper(s) {
		return s
	}
	words := strings.Fields(strings.ToLower(s))
	for i, w := range words {
		if w != "" {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

func isAllUpper(s string) bool {
	hasLetter := false
	for _, r := range s {
		if r >= 'a' && r <= 'z' {
			return false
		}
		if r >= 'A' && r <= 'Z' {
			hasLetter = true
		}
	}
	return hasLetter
}

// fixAllCapsName converts ALL CAPS names to Title Case, preserving mixed-case names
func (s *PersonsSync) fixAllCapsName(name string) string {
	if name == "" {
		return ""
	}

	// Only convert if the name is ALL UPPERCASE
	// This preserves legitimate spellings like McDonald, DeVos, O'Brien
	if !s.isAllUppercase(name) {
		return name
	}

	// Convert to title case
	words := strings.Fields(strings.ToLower(name))
	for i, word := range words {
		if word != "" {
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
	}
	return strings.Join(words, " ")
}

// extractPrimarySecondaryEmails extracts primary and secondary emails from CampMinder emails array.
// Primary email is the one with IsLogin: true, or the first entry if none have IsLogin.
// Secondary email is the first email that isn't the primary, if one exists.
func (s *PersonsSync) extractPrimarySecondaryEmails(emailList []any) (primary, secondary string) {
	if len(emailList) == 0 {
		return "", ""
	}

	// First pass: find the email with IsLogin: true
	var loginEmail string
	var otherEmails []string

	for _, email := range emailList {
		emailMap, ok := email.(map[string]any)
		if !ok {
			continue
		}

		address := s.getString(emailMap, "Address", "")
		if address == "" {
			continue
		}

		isLogin, _ := emailMap["IsLogin"].(bool)
		if isLogin {
			loginEmail = address
		} else {
			otherEmails = append(otherEmails, address)
		}
	}

	// Determine primary email
	if loginEmail != "" {
		primary = loginEmail
		// Secondary is the first non-login email
		if len(otherEmails) > 0 {
			secondary = otherEmails[0]
		}
	} else if len(otherEmails) > 0 {
		// No IsLogin flag, use first email as primary
		primary = otherEmails[0]
		if len(otherEmails) > 1 {
			secondary = otherEmails[1]
		}
	}

	return primary, secondary
}

func (s *PersonsSync) printDataQualitySummary() {
	slog.Info("Data Quality Summary",
		"totalCampers", s.missingDataStats["total_campers"],
		"staffSkipped", s.skippedStaff,
		"noCamperDetails", s.missingDataStats["skipped_no_camper_details"],
		"missingNames", s.missingDataStats["missing_name"],
		"missingAges", s.missingDataStats["missing_age"],
		"missingGrades", s.missingDataStats["missing_grade"],
		"missingParentNames", s.missingDataStats["missing_parent_names"],
	)
}

// deleteOrphans deletes persons that exist in PocketBase but weren't processed from CampMinder
func (s *PersonsSync) deleteOrphans(year int) error {
	filter := fmt.Sprintf("year = %d", year)

	return s.DeleteOrphans(
		"persons",
		func(record *core.Record) (string, bool) {
			cmID, ok := record.Get("cm_id").(float64)
			if !ok || cmID == 0 {
				return "", false
			}

			// Use CompositeKey to match how we track processed persons
			return CompositeKey(int(cmID), year), true
		},
		"person",
		filter,
	)
}

// updateAttendeeRelations updates attendee records to populate the person relation field
func (s *PersonsSync) updateAttendeeRelations(year int) error {
	slog.Info("Updating attendee person relations")

	// Query attendees with person_id but no person relation
	filter := fmt.Sprintf("year = %d && person_id > 0 && person = ''", year)
	records, err := s.App.FindRecordsByFilter("attendees", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("querying attendees for relation update: %w", err)
	}

	if len(records) == 0 {
		slog.Info("No attendee relations to update")
		return nil
	}

	updated := 0
	errors := 0
	for _, attendee := range records {
		personCMID, _ := attendee.Get("person_id").(float64)
		if personCMID > 0 {
			// Lookup the person by CM ID and year
			personFilter := fmt.Sprintf("cm_id = %d && year = %d", int(personCMID), year)
			personRecords, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
			if err == nil && len(personRecords) > 0 {
				attendee.Set("person", personRecords[0].Id)
				if err := s.App.Save(attendee); err != nil {
					slog.Error("Error updating attendee relation", "personCMID", int(personCMID), "error", err)
					errors++
				} else {
					updated++
				}
			}
		}
	}

	slog.Info("Updated attendee person relations", "updated", updated, "errors", errors)
	return nil
}

// extractUniqueHouseholds extracts unique households from persons data (combined sync)
func (s *PersonsSync) extractUniqueHouseholds(personsData []map[string]any) []map[string]any {
	householdMap := make(map[int]map[string]any)

	for _, person := range personsData {
		// Get Households object from person
		householdsObj, ok := person["Households"].(map[string]any)
		if !ok {
			continue
		}

		// Extract households from all three possible locations
		householdTypes := []string{"PrincipalHousehold", "PrimaryChildhoodHousehold", "AlternateChildhoodHousehold"}
		for _, hType := range householdTypes {
			if household, ok := householdsObj[hType].(map[string]any); ok {
				if id, idOK := household["ID"].(float64); idOK && id > 0 {
					// Store household, deduplicating by ID
					householdMap[int(id)] = household
				}
			}
		}
	}

	// Convert map to slice
	result := make([]map[string]any, 0, len(householdMap))
	for _, household := range householdMap {
		result = append(result, household)
	}

	return result
}

// extractHouseholdIDsFromPerson extracts the CampMinder IDs for all three household types
// Returns a struct with the IDs (0 if not present)
func (s *PersonsSync) extractHouseholdIDsFromPerson(personData map[string]any) personHouseholdIDs {
	result := personHouseholdIDs{}

	householdsObj, ok := personData["Households"].(map[string]any)
	if !ok {
		return result
	}

	if principal, ok := householdsObj["PrincipalHousehold"].(map[string]any); ok {
		if id, ok := principal["ID"].(float64); ok && id > 0 {
			result.PrincipalID = int(id)
		}
	}

	if primary, ok := householdsObj["PrimaryChildhoodHousehold"].(map[string]any); ok {
		if id, ok := primary["ID"].(float64); ok && id > 0 {
			result.PrimaryChildhoodID = int(id)
		}
	}

	if alternate, ok := householdsObj["AlternateChildhoodHousehold"].(map[string]any); ok {
		if id, ok := alternate["ID"].(float64); ok && id > 0 {
			result.AlternateChildhoodID = int(id)
		}
	}

	return result
}

// shouldExcludeTag checks if a tag should be excluded based on future year references
// Tags with years greater than syncYear are excluded to prevent data leakage across years
// Example: "2026 Early Registration" should not appear on 2025 records
func (s *PersonsSync) shouldExcludeTag(tagName string, syncYear int) bool {
	// Regex to find 4-digit years (2000-2099)
	re := regexp.MustCompile(`\b(20\d{2})\b`)
	matches := re.FindAllString(tagName, -1)

	for _, match := range matches {
		year, err := strconv.Atoi(match)
		if err != nil {
			continue
		}
		if year > syncYear {
			return true // Exclude tags with future years
		}
	}
	return false
}

// extractTagIDsWithYearFilter extracts PocketBase tag definition IDs from person data,
// filtering out tags that reference future years relative to syncYear
// Returns nil if no tags, empty slice if Tags array is empty
// tagDefsByName maps tag name -> PocketBase ID
func (s *PersonsSync) extractTagIDsWithYearFilter(
	personData map[string]any,
	tagDefsByName map[string]string,
	syncYear int,
) []string {
	tagsRaw, ok := personData["Tags"]
	if !ok || tagsRaw == nil {
		return nil
	}

	tagsArray, ok := tagsRaw.([]any)
	if !ok {
		return nil
	}

	if len(tagsArray) == 0 {
		return []string{}
	}

	// Use map to deduplicate - CampMinder sometimes returns duplicate tags
	seen := make(map[string]bool)
	var tagIDs []string
	for _, tagRaw := range tagsArray {
		if tag, ok := tagRaw.(map[string]any); ok {
			name, nameOK := tag["Name"].(string)
			if !nameOK || name == "" {
				continue
			}

			// Filter out future-year tags
			if s.shouldExcludeTag(name, syncYear) {
				slog.Debug("Filtering out future-year tag", "tagName", name, "syncYear", syncYear)
				continue
			}

			if tagID, exists := tagDefsByName[name]; exists {
				if !seen[tagID] {
					seen[tagID] = true
					tagIDs = append(tagIDs, tagID)
				}
			}
		}
	}

	return tagIDs
}

// extractTagIDs extracts PocketBase tag definition IDs from person data
// Returns nil if no tags, empty slice if Tags array is empty
// tagDefsByName maps tag name -> PocketBase ID
// Note: CampMinder may return duplicate tags - we deduplicate here to match PocketBase behavior
func (s *PersonsSync) extractTagIDs(personData map[string]any, tagDefsByName map[string]string) []string {
	tagsRaw, ok := personData["Tags"]
	if !ok || tagsRaw == nil {
		return nil
	}

	tagsArray, ok := tagsRaw.([]any)
	if !ok {
		return nil
	}

	if len(tagsArray) == 0 {
		return []string{}
	}

	// Use map to deduplicate - CampMinder sometimes returns duplicate tags
	seen := make(map[string]bool)
	var tagIDs []string
	for _, tagRaw := range tagsArray {
		if tag, ok := tagRaw.(map[string]any); ok {
			if name, ok := tag["Name"].(string); ok && name != "" {
				if tagID, exists := tagDefsByName[name]; exists {
					if !seen[tagID] {
						seen[tagID] = true
						tagIDs = append(tagIDs, tagID)
					}
				}
			}
		}
	}

	return tagIDs
}

// transformHouseholdToPB transforms CampMinder household data to PocketBase format (combined sync)
func (s *PersonsSync) transformHouseholdToPB(data map[string]any, year int) (map[string]any, error) {
	pbData := make(map[string]any)

	// Extract ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing household ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract optional text fields
	if greeting, ok := data["Greeting"].(string); ok {
		pbData["greeting"] = greeting
	} else {
		pbData["greeting"] = nil
	}

	if mailingTitle, ok := data["MailingTitle"].(string); ok {
		pbData["mailing_title"] = mailingTitle
	} else {
		pbData["mailing_title"] = nil
	}

	if altMailingTitle, ok := data["AlternateMailingTitle"].(string); ok {
		pbData["alternate_mailing_title"] = altMailingTitle
	} else {
		pbData["alternate_mailing_title"] = nil
	}

	if billingMailingTitle, ok := data["BillingMailingTitle"].(string); ok {
		pbData["billing_mailing_title"] = billingMailingTitle
	} else {
		pbData["billing_mailing_title"] = nil
	}

	if phone, ok := data["HouseholdPhone"].(string); ok {
		pbData["household_phone"] = phone
	} else {
		pbData["household_phone"] = nil
	}

	// Extract discrete billing address fields for querying
	// billing_address JSON field removed - only discrete fields are populated
	pbData["billing_address1"] = ""
	pbData["billing_address2"] = ""
	pbData["billing_city"] = ""
	pbData["billing_state"] = ""
	pbData["billing_postal_code"] = ""
	pbData["billing_country"] = ""

	if billing, ok := data["BillingAddress"].(map[string]any); ok {
		hasAddressData := false

		if addr1 := s.getString(billing, "Address1", ""); addr1 != "" {
			pbData["billing_address1"] = addr1
			hasAddressData = true
		}
		if addr2 := s.getString(billing, "Address2", ""); addr2 != "" {
			pbData["billing_address2"] = addr2
			hasAddressData = true
		}
		if city := s.getString(billing, "City", ""); city != "" {
			pbData["billing_city"] = city
			hasAddressData = true
		}

		// Try StateProvince first, fall back to State
		state := s.getString(billing, "StateProvince", "")
		if state == "" {
			state = s.getString(billing, "State", "")
		}
		if state != "" {
			pbData["billing_state"] = state
			hasAddressData = true
		}

		// Try PostalCode first, fall back to Zip
		postalCode := s.getString(billing, "PostalCode", "")
		if postalCode == "" {
			postalCode = s.getString(billing, "Zip", "")
		}
		if postalCode != "" {
			pbData["billing_postal_code"] = postalCode
			hasAddressData = true
		}

		// Country field - default to "US" if address has data but no country specified
		country := s.getString(billing, "Country", "")
		if country != "" {
			pbData["billing_country"] = country
		} else if hasAddressData {
			pbData["billing_country"] = "US"
		}
	}

	// Set year
	pbData["year"] = year

	return pbData, nil
}

// processHouseholdRecord processes a single household record (combined sync)
func (s *PersonsSync) processHouseholdRecord(
	householdID int,
	pbData map[string]any,
	existingHouseholds map[int]*core.Record,
	compareFields []string,
	stats *Stats,
) error {
	existing := existingHouseholds[householdID]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false
		for _, field := range compareFields {
			if value, exists := pbData[field]; exists {
				if !s.FieldEquals(existing.Get(field), value) {
					slog.Debug("Household field differs", "householdID", householdID, "field", field)
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			for field, value := range pbData {
				existing.Set(field, value)
			}
			if err := s.App.Save(existing); err != nil {
				return fmt.Errorf("updating household: %w", err)
			}
			stats.Updated++
		} else {
			stats.Skipped++
		}
	} else {
		// Create new record
		collection, err := s.App.FindCollectionByNameOrId("households")
		if err != nil {
			return fmt.Errorf("finding households collection: %w", err)
		}

		record := core.NewRecord(collection)
		for field, value := range pbData {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			return fmt.Errorf("creating household: %w", err)
		}
		stats.Created++
	}

	return nil
}

// updatePersonHouseholdRelations updates person records to populate all three household relation fields
// Uses the personHouseholdIDMap collected during sync to know which households to link
// Also falls back to household_id (from FamilyPersons) when Households object is not available
func (s *PersonsSync) updatePersonHouseholdRelations(
	year int,
	householdsByID map[int]*core.Record,
	personHouseholdIDMap map[int]personHouseholdIDs,
) error {
	slog.Info("Updating person household relations", "personsWithHouseholds", len(personHouseholdIDMap))

	// Query all persons for this year that might need household relations updated
	// Include persons with household_id but no household relation (the bug we're fixing)
	filter := fmt.Sprintf(`year = %d && (
		household = '' ||
		primary_childhood_household = '' ||
		alternate_childhood_household = ''
	)`, year)
	records, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("querying persons for household relation update: %w", err)
	}

	if len(records) == 0 {
		slog.Info("No person household relations to update")
		return nil
	}

	updated := 0
	errCount := 0

	for _, person := range records {
		// Get person's CampMinder ID to look up their household IDs
		personCMID, ok := person.Get("cm_id").(float64)
		if !ok || personCMID <= 0 {
			continue
		}

		// Look up the household IDs we extracted during sync (from Households object)
		hhIDs := personHouseholdIDMap[int(personCMID)]

		needsSave := false

		// Principal household (stored in 'household' relation field)
		if person.GetString("household") == "" {
			householdCMID := hhIDs.PrincipalID

			// Fallback: If no PrincipalID from Households object, use household_id from FamilyPersons
			// This fixes the bug where persons have household_id but no household relation
			if householdCMID == 0 {
				if legacyHouseholdID, ok := person.Get("household_id").(float64); ok && legacyHouseholdID > 0 {
					householdCMID = int(legacyHouseholdID)
				}
			}

			if householdCMID > 0 {
				if householdRecord, exists := householdsByID[householdCMID]; exists {
					person.Set("household", householdRecord.Id)
					needsSave = true
				}
			}
		}

		// Primary childhood household
		if hhIDs.PrimaryChildhoodID > 0 && person.GetString("primary_childhood_household") == "" {
			if householdRecord, exists := householdsByID[hhIDs.PrimaryChildhoodID]; exists {
				person.Set("primary_childhood_household", householdRecord.Id)
				needsSave = true
			}
		}

		// Alternate childhood household
		if hhIDs.AlternateChildhoodID > 0 && person.GetString("alternate_childhood_household") == "" {
			if householdRecord, exists := householdsByID[hhIDs.AlternateChildhoodID]; exists {
				person.Set("alternate_childhood_household", householdRecord.Id)
				needsSave = true
			}
		}

		if needsSave {
			if err := s.App.Save(person); err != nil {
				slog.Error("Error updating person household relations", "personID", person.Id, "error", err)
				errCount++
			} else {
				updated++
			}
		}
	}

	slog.Info("Updated person household relations", "updated", updated, "errors", errCount)
	return nil
}

// deleteHouseholdOrphans deletes households that exist in PocketBase but weren't processed from CampMinder
func (s *PersonsSync) deleteHouseholdOrphans(year int, processedIDs map[int]bool) error {
	slog.Info("Checking for orphaned households")

	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("querying households for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		cmID, ok := record.Get("cm_id").(float64)
		if !ok || cmID == 0 {
			continue
		}

		if !processedIDs[int(cmID)] {
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphaned household", "cm_id", int(cmID), "error", err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		slog.Info("Deleted orphaned households", "count", deleted)
	}
	return nil
}

// =============================================================================
// Staff person ID extraction - enables staff members to have person records
// =============================================================================

// getPersonIDsFromStaff fetches staff records from CampMinder and extracts their person IDs
// This ensures staff members are included in the persons sync so their person relation
// can be populated in the staff table.
// Note: Uses the client's configured seasonID internally via GetStaffPage
func (s *PersonsSync) getPersonIDsFromStaff() ([]int, error) {
	slog.Debug("Fetching staff person IDs from CampMinder")

	pageSize := 500
	var allStaffRecords []map[string]any

	// Fetch staff across all statuses (active, resigned, dismissed, cancelled)
	for _, status := range allStaffStatuses {
		page := 1
		for {
			staffRecords, hasMore, err := s.Client.GetStaffPage(status, page, pageSize)
			if err != nil {
				return nil, fmt.Errorf("fetching staff page %d (status %d): %w", page, status, err)
			}

			allStaffRecords = append(allStaffRecords, staffRecords...)

			if !hasMore {
				break
			}
			page++
		}
	}

	personIDs := s.extractPersonIDsFromStaffRecords(allStaffRecords)
	slog.Debug("Extracted staff person IDs", "staffRecords", len(allStaffRecords), "uniquePersonIDs", len(personIDs))

	return personIDs, nil
}

// extractPersonIDsFromStaffRecords extracts unique person IDs from staff API records
// Handles deduplication and skips invalid/missing person IDs
func (s *PersonsSync) extractPersonIDsFromStaffRecords(staffRecords []map[string]any) []int {
	if len(staffRecords) == 0 {
		return []int{}
	}

	personIDMap := make(map[int]bool)

	for _, staff := range staffRecords {
		personIDValue, ok := staff["PersonID"].(float64)
		if !ok {
			continue // Skip if not a float64 (wrong type or missing)
		}

		personID := int(personIDValue)
		if personID > 0 {
			personIDMap[personID] = true
		}
	}

	// Convert map to slice
	personIDs := make([]int, 0, len(personIDMap))
	for id := range personIDMap {
		personIDs = append(personIDs, id)
	}

	return personIDs
}

// mergePersonIDs merges and deduplicates person IDs from attendees and staff
// Returns a single slice of unique person IDs
func (s *PersonsSync) mergePersonIDs(attendeeIDs, staffIDs []int) []int {
	personIDMap := make(map[int]bool)

	for _, id := range attendeeIDs {
		personIDMap[id] = true
	}
	for _, id := range staffIDs {
		personIDMap[id] = true
	}

	// Convert map to slice
	merged := make([]int, 0, len(personIDMap))
	for id := range personIDMap {
		merged = append(merged, id)
	}

	return merged
}
