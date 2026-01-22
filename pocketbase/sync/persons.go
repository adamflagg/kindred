// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"unicode"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// PersonsSync handles syncing person records from CampMinder
type PersonsSync struct {
	BaseSyncService

	// Track data quality issues
	missingDataStats map[string]int
	skippedStaff     int

	// Sub-entity stats for combined sync (households, person_tags)
	householdStats *Stats
	personTagStats *Stats
}

// personHouseholdIDs holds the CampMinder IDs for a person's households
// Used temporarily during sync to populate relation fields
type personHouseholdIDs struct {
	PrincipalID        int
	PrimaryChildhoodID int
	AlternateChildhoodID int
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
	return "persons"
}

// GetStats returns stats for this sync, including sub-entity stats for combined sync
func (s *PersonsSync) GetStats() Stats {
	stats := s.Stats
	if s.householdStats != nil || s.personTagStats != nil {
		stats.SubStats = make(map[string]Stats)
		if s.householdStats != nil {
			stats.SubStats["households"] = *s.householdStats
		}
		if s.personTagStats != nil {
			stats.SubStats["person_tags"] = *s.personTagStats
		}
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

// Sync performs the combined persons/households/person_tags synchronization
// This is a combined sync that fetches persons data once and populates all three tables:
// 1. persons - Core person data with CamperDetails fields
// 2. households - Deduplicated household records (shared across family members)
// 3. person_tags - Tag assignments with proper relations
func (s *PersonsSync) Sync(ctx context.Context) error {
	s.LogSyncStart("persons (combined: persons + households + person_tags)")
	s.Stats = Stats{}        // Reset stats
	s.SyncSuccessful = false // Reset sync status
	s.ClearProcessedKeys()   // Reset processed tracking

	// Get the year we're syncing for
	year := s.Client.GetSeasonID()

	// Get unique person IDs from attendees for this year
	personIDs, err := s.getPersonIDsFromAttendees(year)
	if err != nil {
		return fmt.Errorf("getting person IDs from attendees: %w", err)
	}

	if len(personIDs) == 0 {
		slog.Info("No attendees found, skipping persons sync", "year", year)
		s.SyncSuccessful = true
		return nil
	}

	slog.Info("Found unique persons from attendees", "count", len(personIDs), "year", year)
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load all existing persons by cm_id for this year
	existingPersons := make(map[int]*core.Record)
	allPersons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing persons", "year", year, "error", err)
	} else {
		for _, record := range allPersons {
			if cmID, ok := record.Get("cm_id").(float64); ok {
				existingPersons[int(cmID)] = record
			}
		}
		slog.Info("Loaded existing persons from database", "count", len(existingPersons), "year", year)
	}

	// Pre-load existing households by cm_id for this year
	existingHouseholds := make(map[int]*core.Record)
	allHouseholds, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing households", "year", year, "error", err)
	} else {
		for _, record := range allHouseholds {
			if cmID, ok := record.Get("cm_id").(float64); ok {
				existingHouseholds[int(cmID)] = record
			}
		}
		slog.Info("Loaded existing households from database", "count", len(existingHouseholds), "year", year)
	}

	// Pre-load existing person_tags by composite key for this year
	existingPersonTags := make(map[string]*core.Record)
	allPersonTags, err := s.App.FindRecordsByFilter("person_tags", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing person_tags", "year", year, "error", err)
	} else {
		for _, record := range allPersonTags {
			personID, personOK := record.Get("person_id").(float64)
			tagName, tagOK := record.Get("tag_name").(string)
			yr, yearOK := record.Get("year").(float64)
			if personOK && tagOK && yearOK {
				key := fmt.Sprintf("%d:%s:%d", int(personID), tagName, int(yr))
				existingPersonTags[key] = record
			}
		}
		slog.Info("Loaded existing person_tags from database", "count", len(existingPersonTags), "year", year)
	}

	// Pre-load tag definitions for relation lookups (global - no year filter)
	tagDefsByName := make(map[string]*core.Record)
	tagDefs, err := s.App.FindRecordsByFilter("person_tag_defs", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading tag definitions", "error", err)
	} else {
		for _, td := range tagDefs {
			if name, ok := td.Get("name").(string); ok && name != "" {
				tagDefsByName[name] = td
			}
		}
		slog.Info("Loaded tag definitions for relation lookup", "count", len(tagDefsByName))
	}

	// Track unique households across all batches
	allExtractedHouseholds := make(map[int]map[string]any)
	// Track processed household IDs for orphan detection
	processedHouseholdIDs := make(map[int]bool)
	// Track processed person_tag keys for orphan detection
	processedPersonTagKeys := make(map[string]bool)
	// Track household IDs for each person (for relation population)
	personHouseholdIDMap := make(map[int]personHouseholdIDs)

	// Stats for combined sync
	householdStats := Stats{}
	personTagStats := Stats{}

	// Process persons in batches (CampMinder API can handle multiple IDs)
	batchSize := 500
	for i := 0; i < len(personIDs); i += batchSize {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Get batch
		end := i + batchSize
		if end > len(personIDs) {
			end = len(personIDs)
		}
		batch := personIDs[i:end]

		slog.Info("Processing persons batch", "start", i+1, "end", end, "total", len(personIDs))

		// Fetch persons for this batch (includes households and tags via include flags)
		persons, err := s.Client.GetPersons(batch)
		if err != nil {
			return fmt.Errorf("fetching persons batch: %w", err)
		}

		// Mark sync as successful once we've successfully fetched data
		if i == 0 && len(persons) > 0 {
			s.SyncSuccessful = true
		}

		// Process each person and extract households/tags
		for _, personData := range persons {
			// 1. Process person record
			if err := s.processPerson(personData, existingPersons, year); err != nil {
				slog.Error("Error processing person", "error", err)
				s.Stats.Errors++
			}

			// 2. Extract households (deduplicated across batches)
			batchHouseholds := s.extractUniqueHouseholds([]map[string]any{personData})
			for _, household := range batchHouseholds {
				if id, ok := household["ID"].(float64); ok && id > 0 {
					allExtractedHouseholds[int(id)] = household
				}
			}

			// 3. Track household IDs for this person (for relation population later)
			personID, ok := personData["ID"].(float64)
			if !ok {
				continue
			}
			personHouseholdIDMap[int(personID)] = s.extractHouseholdIDsFromPerson(personData)

			// 4. Extract and process person_tags immediately
			tags := s.extractTagsFromPerson(personData)
			for _, tagData := range tags {
				pbData, err := s.transformPersonTagToPB(tagData, int(personID), year)
				if err != nil {
					slog.Debug("Error transforming person tag", "personID", int(personID), "error", err)
					personTagStats.Errors++
					continue
				}

				// Look up relations
				tagName, _ := pbData["tag_name"].(string)
				if tagDef, exists := tagDefsByName[tagName]; exists {
					pbData["tag_definition"] = tagDef.Id
				}
				// Person relation will be set after persons are saved
				if person, exists := existingPersons[int(personID)]; exists {
					pbData["person"] = person.Id
				}

				// Create composite key
				compositeKey := fmt.Sprintf("%d:%s:%d", int(personID), tagName, year)
				processedPersonTagKeys[compositeKey] = true

				// Process the record
				if err := s.processPersonTagRecord(compositeKey, pbData, existingPersonTags, &personTagStats); err != nil {
					slog.Error("Error processing person tag", "personID", int(personID), "tagName", tagName, "error", err)
					personTagStats.Errors++
				}
			}
		}
	}

	slog.Info("Extracted unique households from persons", "count", len(allExtractedHouseholds))

	// Process all unique households
	householdCompareFields := []string{"cm_id", "greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title", "household_phone", "billing_address", "last_updated_utc"}
	for householdID, householdData := range allExtractedHouseholds {
		pbData, err := s.transformHouseholdToPB(householdData, year)
		if err != nil {
			slog.Error("Error transforming household", "id", householdID, "error", err)
			householdStats.Errors++
			continue
		}

		processedHouseholdIDs[householdID] = true

		if err := s.processHouseholdRecord(householdID, pbData, existingHouseholds, householdCompareFields, &householdStats); err != nil {
			slog.Error("Error processing household", "id", householdID, "error", err)
			householdStats.Errors++
		}
	}

	// Reload households after saving to get PocketBase IDs for relations
	householdsByID := make(map[int]*core.Record)
	updatedHouseholds, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error reloading households for relation update", "error", err)
	} else {
		for _, record := range updatedHouseholds {
			if cmID, ok := record.Get("cm_id").(float64); ok {
				householdsByID[int(cmID)] = record
			}
		}
	}

	// Update person-household relations (uses tracked IDs from sync)
	if err := s.updatePersonHouseholdRelations(year, householdsByID, personHouseholdIDMap); err != nil {
		slog.Warn("Failed to update person-household relations", "error", err)
	}

	// Update person relations in person_tags (person records may be newly created)
	if err := s.updatePersonTagRelations(year, existingPersons); err != nil {
		slog.Warn("Failed to update person_tag relations", "error", err)
	}

	// Delete orphans for persons
	if err := s.deleteOrphans(year); err != nil {
		slog.Warn("Failed to delete orphaned persons", "error", err)
	}

	// Delete orphans for households
	if err := s.deleteHouseholdOrphans(year, processedHouseholdIDs); err != nil {
		slog.Warn("Failed to delete orphaned households", "error", err)
	}

	// Delete orphans for person_tags
	if err := s.deletePersonTagOrphans(year, processedPersonTagKeys); err != nil {
		slog.Warn("Failed to delete orphaned person_tags", "error", err)
	}

	// Force WAL checkpoint to ensure data is flushed
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	// Store sub-entity stats for combined sync output
	s.householdStats = &householdStats
	s.personTagStats = &personTagStats

	// Report results
	s.printDataQualitySummary()
	slog.Info("Combined sync complete",
		"persons_created", s.Stats.Created,
		"persons_updated", s.Stats.Updated,
		"persons_skipped", s.Stats.Skipped,
		"persons_errors", s.Stats.Errors,
		"households_created", householdStats.Created,
		"households_updated", householdStats.Updated,
		"households_skipped", householdStats.Skipped,
		"households_errors", householdStats.Errors,
		"person_tags_created", personTagStats.Created,
		"person_tags_updated", personTagStats.Updated,
		"person_tags_skipped", personTagStats.Skipped,
		"person_tags_errors", personTagStats.Errors,
	)
	s.LogSyncComplete("Persons (combined)")

	// Update attendee relations now that persons are synced
	if err := s.updateAttendeeRelations(year); err != nil {
		slog.Warn("Failed to update attendee relations", "error", err)
	}

	return nil
}

// processPerson processes a single person using pre-loaded existing persons
func (s *PersonsSync) processPerson(
	personData map[string]interface{},
	existingPersons map[int]*core.Record,
	year int,
) error {
	// Transform to PocketBase format
	pbData, err := s.transformPersonToPB(personData, year)
	if err != nil {
		return err
	}

	// Skip if transformation returned nil (e.g., staff member)
	if pbData == nil {
		s.skippedStaff++
		s.Stats.Skipped++
		return nil
	}

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

	// Fields to compare for updates (includes expanded CamperDetails fields and household relations)
	// Note: Household relations are populated after save via updatePersonHouseholdRelations
	compareFields := []string{"cm_id", "first_name", "last_name", "preferred_name",
		"birthdate", "gender", "age", "grade", "school", "years_at_camp",
		"last_year_attended", "gender_identity_id", "gender_identity_name", "gender_identity_write_in",
		"gender_pronoun_id", "gender_pronoun_name", "gender_pronoun_write_in", "phone_numbers",
		"email_addresses", "address", "household_id", "is_camper", "year", "parent_names",
		"division_id", "partition_id", "lead_date", "tshirt_size",
		// Household relations (populated after households are saved)
		"household", "primary_childhood_household", "alternate_childhood_household"}

	if existing != nil {
		// Check if update is needed
		needsUpdate := false
		for _, field := range compareFields {
			if value, exists := pbData[field]; exists {
				if !s.FieldEquals(existing.Get(field), value) {
					slog.Debug("Person field differs",
						"personID", personIDInt,
						"field", field,
						"existing", existing.Get(field),
						"new", value,
					)
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
//
//nolint:gocyclo // data transform function with many field mappings
func (s *PersonsSync) transformPersonToPB(cmPerson map[string]interface{}, year int) (map[string]interface{}, error) {
	// Skip if no CamperDetails (means they're not a camper)
	camperDetails, ok := cmPerson["CamperDetails"].(map[string]interface{})
	if !ok || camperDetails == nil {
		name := s.getPersonName(cmPerson)
		slog.Debug("Skipping person - no CamperDetails (not a camper)",
			"name", name,
			"personID", cmPerson["ID"],
		)
		s.missingDataStats["skipped_no_camper_details"]++
		return nil, nil
	}

	pbData := make(map[string]interface{})

	// Extract base fields
	if id, ok := cmPerson["ID"].(float64); ok {
		pbData["cm_id"] = int(id)
	}

	// Name fields - fix ALL CAPS names from CampMinder while preserving mixed-case
	if nameData, ok := cmPerson["Name"].(map[string]interface{}); ok {
		firstName := s.getString(nameData, "First", fmt.Sprintf("MISSING_FIRST_%.0f", cmPerson["ID"]))
		lastName := s.getString(nameData, "Last", fmt.Sprintf("MISSING_LAST_%.0f", cmPerson["ID"]))

		// Only convert ALL CAPS to Title Case - preserves McDonald, DeVos, O'Brien, etc.
		pbData["first_name"] = s.fixAllCapsName(firstName)
		pbData["last_name"] = s.fixAllCapsName(lastName)

		if preferred := s.getString(nameData, "Preferred", ""); preferred != "" {
			pbData["preferred_name"] = s.fixAllCapsName(preferred)
		}

		if pbData["first_name"] == "" || strings.HasPrefix(pbData["first_name"].(string), "MISSING_") {
			s.missingDataStats["missing_name"]++
		}
		if pbData["last_name"] == "" || strings.HasPrefix(pbData["last_name"].(string), "MISSING_") {
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

	// Age - preserve full float precision for CampMinder format (e.g., 12.03 = 12 years, 3 months)
	// Adjust age for historical years (e.g., if current age is 12.03 in 2025, it should be 11.03 for 2024)
	if age, ok := cmPerson["Age"].(float64); ok && age > 0 {
		// Calculate year difference and adjust age accordingly
		currentYear := s.Client.GetSeasonID() // This is the current CampMinder year
		yearDiff := float64(currentYear - year)
		adjustedAge := age - yearDiff

		if adjustedAge < 6 {
			pbData["age"] = 6.0 // Clamp to minimum
		} else {
			pbData["age"] = adjustedAge // Store year-appropriate age
		}
	} else {
		pbData["age"] = 10.0 // Default age
		s.missingDataStats["missing_age"]++
	}

	// Grade from CamperDetails
	grade := s.getFloat(camperDetails, "CampGradeID", 0)
	if grade == 0 {
		grade = s.getFloat(camperDetails, "SchoolGradeID", 0)
	}

	if grade > 0 {
		// CampMinder uses 0-indexed grade IDs where 0=K, 1=1st, 2=2nd, etc.
		actualGrade := int(grade) - 1
		pbData["grade"] = max(1, min(actualGrade, 12)) // Grades 1-12
	} else {
		pbData["grade"] = 0 // Default for missing grades
		s.missingDataStats["missing_grade"]++
	}

	// Extract V2 fields from CamperDetails
	pbData["school"] = s.getString(camperDetails, "School", "")
	pbData["years_at_camp"] = s.getInt(camperDetails, "YearsAtCamp", 0)

	// Extract expanded CamperDetails fields (database expansion)
	pbData["division_id"] = s.getInt(camperDetails, "DivisionID", 0)
	pbData["partition_id"] = s.getInt(camperDetails, "PartitionID", 0)
	pbData["lead_date"] = s.getString(camperDetails, "LeadDate", "")
	pbData["tshirt_size"] = s.getString(camperDetails, "TShirtSize", "")

	// Cap last_year_attended at current year (since we only sync enrolled attendees)
	lastYear := s.getInt(camperDetails, "LastYearAttended", 0)
	if lastYear > year {
		pbData["last_year_attended"] = year
	} else {
		pbData["last_year_attended"] = lastYear
	}

	// Gender identity and pronouns
	pbData["gender_identity_id"] = s.getInt(cmPerson, "GenderIdentityID", 0)
	pbData["gender_identity_name"] = s.getString(cmPerson, "GenderIdentityName", "")
	pbData["gender_identity_write_in"] = s.getString(cmPerson, "GenderIdentityWriteIn", "")
	pbData["gender_pronoun_id"] = s.getInt(cmPerson, "GenderPronounID", 0)
	pbData["gender_pronoun_name"] = s.getString(cmPerson, "GenderPronounName", "")
	pbData["gender_pronoun_write_in"] = s.getString(cmPerson, "GenderPronounWriteIn", "")

	// Contact details
	if contactDetails, ok := cmPerson["ContactDetails"].(map[string]interface{}); ok {
		// Store phone numbers and emails as JSON
		if phones := contactDetails["PhoneNumbers"]; phones != nil {
			if phoneJSON, err := json.Marshal(phones); err == nil {
				pbData["phone_numbers"] = string(phoneJSON)
			}
		}
		if emails := contactDetails["Emails"]; emails != nil {
			if emailJSON, err := json.Marshal(emails); err == nil {
				pbData["email_addresses"] = string(emailJSON)
			}
		}
	}

	// Extract address from Households object
	// Note: Household CampMinder IDs are extracted separately in extractHouseholdIDsFromPerson
	// and used to populate relation fields after households are saved
	if households, ok := cmPerson["Households"].(map[string]interface{}); ok {
		// Extract address from primary childhood household
		if primary, ok := households["PrimaryChildhoodHousehold"].(map[string]interface{}); ok {
			if billing, ok := primary["BillingAddress"].(map[string]interface{}); ok {
				address := s.extractAddress(billing)
				if address != nil {
					if addressJSON, err := json.Marshal(address); err == nil {
						pbData["address"] = string(addressJSON)
					}
				}
			}
		}
	}

	// Extract household ID from FamilyPersons (legacy field, kept for backward compatibility)
	if familyPersons, ok := cmPerson["FamilyPersons"].([]interface{}); ok {
		for _, fp := range familyPersons {
			if fpMap, ok := fp.(map[string]interface{}); ok {
				if familyID, ok := fpMap["FamilyID"].(float64); ok && familyID > 0 {
					pbData["household_id"] = int(familyID)
					break
				}
			}
		}
	}

	// Extract parent/guardian names from Relatives array
	// Used for name resolution when bunk requests reference parents' last names
	if relatives, ok := cmPerson["Relatives"].([]interface{}); ok {
		parents := make([]map[string]interface{}, 0)
		for _, rel := range relatives {
			if relMap, ok := rel.(map[string]interface{}); ok {
				// Only include guardians (parents, legal guardians, etc.)
				isGuardian, _ := relMap["IsGuardian"].(bool)
				if !isGuardian {
					continue
				}

				parentData := make(map[string]interface{})

				// Extract name
				if nameData, ok := relMap["Name"].(map[string]interface{}); ok {
					firstName := s.getString(nameData, "First", "")
					lastName := s.getString(nameData, "Last", "")
					if firstName != "" || lastName != "" {
						parentData["first"] = s.fixAllCapsName(firstName)
						parentData["last"] = s.fixAllCapsName(lastName)
					}
				}

				// Extract relationship type (Mother, Father, Guardian, etc.)
				if relType := s.getString(relMap, "RelationshipType", ""); relType != "" {
					parentData["relationship"] = relType
				}

				// Extract primary flag
				isPrimary, _ := relMap["IsPrimary"].(bool)
				parentData["is_primary"] = isPrimary

				// Only add if we have name data
				if _, hasFirst := parentData["first"]; hasFirst {
					parents = append(parents, parentData)
				}
			}
		}

		if len(parents) > 0 {
			if parentsJSON, err := json.Marshal(parents); err == nil {
				pbData["parent_names"] = string(parentsJSON)
			}
		}
	}

	// Mark as camper (since we filtered out staff already)
	pbData["is_camper"] = true

	// Add year to make persons year-scoped
	pbData["year"] = year

	s.missingDataStats["total_campers"]++

	return pbData, nil
}

// Helper methods

func (s *PersonsSync) getPersonName(person map[string]interface{}) string {
	if nameData, ok := person["Name"].(map[string]interface{}); ok {
		first := s.getString(nameData, "First", "")
		last := s.getString(nameData, "Last", "")
		return fmt.Sprintf("%s %s", first, last)
	}
	return "Unknown"
}

func (s *PersonsSync) getString(data map[string]interface{}, key, defaultValue string) string {
	if val, ok := data[key].(string); ok {
		return val
	}
	return defaultValue
}

func (s *PersonsSync) getInt(data map[string]interface{}, key string, defaultValue int) int {
	if val, ok := data[key].(float64); ok {
		return int(val)
	}
	return defaultValue
}

func (s *PersonsSync) getFloat(data map[string]interface{}, key string, defaultValue float64) float64 {
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
		if len(word) > 0 {
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
	}
	return strings.Join(words, " ")
}

func (s *PersonsSync) extractAddress(billing map[string]interface{}) map[string]interface{} {
	address := make(map[string]interface{})
	hasData := false

	if street := s.getString(billing, "Street1", ""); street != "" {
		address["street"] = street
		hasData = true
	}
	if city := s.getString(billing, "City", ""); city != "" {
		address["city"] = city
		hasData = true
	}

	// Try both State and StateProvince field names
	state := s.getString(billing, "State", "")
	if state == "" {
		state = s.getString(billing, "StateProvince", "")
	}
	if state != "" {
		address["state"] = state
		hasData = true
	}

	if zip := s.getString(billing, "Zip", ""); zip != "" {
		address["zip"] = zip
		hasData = true
	}

	if hasData {
		return address
	}
	return nil
}

func (s *PersonsSync) printDataQualitySummary() {
	slog.Info("Data Quality Summary",
		"totalCampers", s.missingDataStats["total_campers"],
		"staffSkipped", s.skippedStaff,
		"noCamperDetails", s.missingDataStats["skipped_no_camper_details"],
		"missingNames", s.missingDataStats["missing_name"],
		"missingAges", s.missingDataStats["missing_age"],
		"missingGrades", s.missingDataStats["missing_grade"],
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
func (s *PersonsSync) extractUniqueHouseholds(personsData []map[string]interface{}) []map[string]interface{} {
	householdMap := make(map[int]map[string]interface{})

	for _, person := range personsData {
		// Get Households object from person
		householdsObj, ok := person["Households"].(map[string]interface{})
		if !ok {
			continue
		}

		// Extract households from all three possible locations
		householdTypes := []string{"PrincipalHousehold", "PrimaryChildhoodHousehold", "AlternateChildhoodHousehold"}
		for _, hType := range householdTypes {
			if household, ok := householdsObj[hType].(map[string]interface{}); ok {
				if id, idOK := household["ID"].(float64); idOK && id > 0 {
					// Store household, deduplicating by ID
					householdMap[int(id)] = household
				}
			}
		}
	}

	// Convert map to slice
	result := make([]map[string]interface{}, 0, len(householdMap))
	for _, household := range householdMap {
		result = append(result, household)
	}

	return result
}

// extractHouseholdIDsFromPerson extracts the CampMinder IDs for all three household types
// Returns a struct with the IDs (0 if not present)
func (s *PersonsSync) extractHouseholdIDsFromPerson(personData map[string]interface{}) personHouseholdIDs {
	result := personHouseholdIDs{}

	householdsObj, ok := personData["Households"].(map[string]interface{})
	if !ok {
		return result
	}

	if principal, ok := householdsObj["PrincipalHousehold"].(map[string]interface{}); ok {
		if id, ok := principal["ID"].(float64); ok && id > 0 {
			result.PrincipalID = int(id)
		}
	}

	if primary, ok := householdsObj["PrimaryChildhoodHousehold"].(map[string]interface{}); ok {
		if id, ok := primary["ID"].(float64); ok && id > 0 {
			result.PrimaryChildhoodID = int(id)
		}
	}

	if alternate, ok := householdsObj["AlternateChildhoodHousehold"].(map[string]interface{}); ok {
		if id, ok := alternate["ID"].(float64); ok && id > 0 {
			result.AlternateChildhoodID = int(id)
		}
	}

	return result
}

// extractTagsFromPerson extracts tags from person data (combined sync)
func (s *PersonsSync) extractTagsFromPerson(personData map[string]interface{}) []map[string]interface{} {
	tagsRaw, ok := personData["Tags"]
	if !ok || tagsRaw == nil {
		return nil
	}

	tagsArray, ok := tagsRaw.([]interface{})
	if !ok {
		return nil
	}

	result := make([]map[string]interface{}, 0, len(tagsArray))
	for _, tagRaw := range tagsArray {
		if tag, ok := tagRaw.(map[string]interface{}); ok {
			result = append(result, tag)
		}
	}

	return result
}

// transformHouseholdToPB transforms CampMinder household data to PocketBase format (combined sync)
func (s *PersonsSync) transformHouseholdToPB(data map[string]interface{}, year int) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

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

	// Extract billing address as JSON
	pbData["billing_address"] = data["BillingAddress"]

	// Extract last updated
	pbData["last_updated_utc"] = data["LastUpdatedUTC"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}

// transformPersonTagToPB transforms CampMinder tag data to PocketBase format (combined sync)
func (s *PersonsSync) transformPersonTagToPB(data map[string]interface{}, personID int, year int) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract tag name (required)
	tagName, ok := data["Name"].(string)
	if !ok || tagName == "" {
		return nil, fmt.Errorf("invalid or missing tag Name")
	}
	pbData["tag_name"] = tagName

	// Set person ID
	pbData["person_id"] = personID

	// Extract last updated
	pbData["last_updated_utc"] = data["LastUpdatedUTC"]

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

// processPersonTagRecord processes a single person tag record (combined sync)
func (s *PersonsSync) processPersonTagRecord(
	compositeKey string,
	pbData map[string]any,
	existingPersonTags map[string]*core.Record,
	stats *Stats,
) error {
	compareFields := []string{"person_id", "tag_name", "year", "last_updated_utc", "person", "tag_definition"}
	existing := existingPersonTags[compositeKey]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false
		for _, field := range compareFields {
			if value, exists := pbData[field]; exists {
				if !s.FieldEquals(existing.Get(field), value) {
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			// Log which fields differ to diagnose idempotency issues
			for _, field := range compareFields {
				if value, exists := pbData[field]; exists {
					existingVal := existing.Get(field)
					if !s.FieldEquals(existingVal, value) {
						slog.Debug("person_tag field mismatch triggering update",
							"compositeKey", compositeKey,
							"field", field,
							"existingValue", existingVal,
							"existingType", fmt.Sprintf("%T", existingVal),
							"newValue", value,
							"newType", fmt.Sprintf("%T", value))
					}
				}
			}

			for field, value := range pbData {
				existing.Set(field, value)
			}
			if err := s.App.Save(existing); err != nil {
				return fmt.Errorf("updating person_tag: %w", err)
			}
			stats.Updated++
		} else {
			stats.Skipped++
		}
	} else {
		// Create new record
		collection, err := s.App.FindCollectionByNameOrId("person_tags")
		if err != nil {
			return fmt.Errorf("finding person_tags collection: %w", err)
		}

		record := core.NewRecord(collection)
		for field, value := range pbData {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			return fmt.Errorf("creating person_tag: %w", err)
		}
		stats.Created++
	}

	return nil
}

// updatePersonHouseholdRelations updates person records to populate all three household relation fields
// Uses the personHouseholdIDMap collected during sync to know which households to link
func (s *PersonsSync) updatePersonHouseholdRelations(year int, householdsByID map[int]*core.Record, personHouseholdIDMap map[int]personHouseholdIDs) error {
	slog.Info("Updating person household relations", "personsWithHouseholds", len(personHouseholdIDMap))

	if len(personHouseholdIDMap) == 0 {
		slog.Info("No person household relations to update")
		return nil
	}

	// Query all persons for this year that might need household relations updated
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

		// Look up the household IDs we extracted during sync
		hhIDs, exists := personHouseholdIDMap[int(personCMID)]
		if !exists {
			continue
		}

		needsSave := false

		// Principal household (stored in 'household' relation field)
		if hhIDs.PrincipalID > 0 && person.GetString("household") == "" {
			if householdRecord, exists := householdsByID[hhIDs.PrincipalID]; exists {
				person.Set("household", householdRecord.Id)
				needsSave = true
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

// updatePersonTagRelations updates person_tag records to populate the person relation field
func (s *PersonsSync) updatePersonTagRelations(year int, _ map[int]*core.Record) error {
	slog.Info("Updating person_tag person relations")

	// Reload persons to get any newly created records
	filter := fmt.Sprintf("year = %d", year)
	allPersons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("reloading persons for relation update: %w", err)
	}

	personsByCMID := make(map[int]*core.Record)
	for _, record := range allPersons {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			personsByCMID[int(cmID)] = record
		}
	}

	// Query person_tags with person_id but no person relation
	tagFilter := fmt.Sprintf("year = %d && person_id > 0 && person = ''", year)
	records, err := s.App.FindRecordsByFilter("person_tags", tagFilter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("querying person_tags for relation update: %w", err)
	}

	if len(records) == 0 {
		slog.Info("No person_tag relations to update")
		return nil
	}

	updated := 0
	errors := 0
	for _, tag := range records {
		personCMID, _ := tag.Get("person_id").(float64)
		if personCMID > 0 {
			if personRecord, exists := personsByCMID[int(personCMID)]; exists {
				tag.Set("person", personRecord.Id)
				if err := s.App.Save(tag); err != nil {
					slog.Error("Error updating person_tag relation", "personCMID", int(personCMID), "error", err)
					errors++
				} else {
					updated++
				}
			}
		}
	}

	slog.Info("Updated person_tag person relations", "updated", updated, "errors", errors)
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

// deletePersonTagOrphans deletes person_tags that exist in PocketBase but weren't processed from CampMinder
func (s *PersonsSync) deletePersonTagOrphans(year int, processedKeys map[string]bool) error {
	slog.Info("Checking for orphaned person_tags")

	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("person_tags", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("querying person_tags for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		personID, personOK := record.Get("person_id").(float64)
		tagName, tagOK := record.Get("tag_name").(string)
		yr, yearOK := record.Get("year").(float64)

		if !personOK || !tagOK || !yearOK {
			continue
		}

		key := fmt.Sprintf("%d:%s:%d", int(personID), tagName, int(yr))
		if !processedKeys[key] {
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphaned person_tag", "key", key, "error", err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		slog.Info("Deleted orphaned person_tags", "count", deleted)
	}
	return nil
}
