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

// serviceNameQuestRegistrations is the canonical name for this sync service
const serviceNameQuestRegistrations = "quest_registrations"

// QuestRegistrationsSync extracts Quest-* and Q-* custom fields for Quest program participants.
// This service reads from person_custom_values and populates the quest_registrations table.
//
// Unique key: (person_id, year) - one record per Quest participant per year
// Links to: attendees
//
// Field mapping: 45+ Quest-* and Q-* prefixed fields covering signatures, preferences,
// parent questionnaires, and transportation details.
type QuestRegistrationsSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Stats          Stats
	SyncSuccessful bool
}

// NewQuestRegistrationsSync creates a new Quest registrations sync service
func NewQuestRegistrationsSync(app core.App) *QuestRegistrationsSync {
	return &QuestRegistrationsSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *QuestRegistrationsSync) Name() string {
	return serviceNameQuestRegistrations
}

// GetStats returns the current stats
func (s *QuestRegistrationsSync) GetStats() Stats {
	return s.Stats
}

// questRegistrationRecord holds the extracted Quest info for a participant
type questRegistrationRecord struct {
	personID   int
	year       int
	attendeeID string

	// Signatures
	parentSignature  string
	questerSignature string
	preferredName    string

	// Questionnaire responses
	whyCome               string
	mostLookingForward    string
	leastLookingForward   string
	biggestAccomplishment string
	biggestDisappointment string
	whoseDecision         string
	ifReturning           string
	biggestHope           string
	biggestConcern        string

	// Social/emotional
	makeFriendsEase      string
	makeFriendsExplain   string
	separationReaction   string
	separationExplain    string
	awayBefore           string
	awayExplain          string
	expressFrustration   string
	whatMakesAngry       string
	cooperatesWithLimits string
	techniquesLimits     string

	// Medical/physical
	anyMedications        string
	physicalLimitations   string
	physicalLimitExplain  string
	fearsAnxieties        string
	situationsTransitions string
	badCampExperiences    string

	// Development/maturity
	childMatured        string
	changeSinceLastYear string
	extracurricular     string
	cookChores          string
	cookChoresExplain   string
	decisionAttend      string
	howCanHelp          string
	howMuchChild        string
	hasQuesterBefore    string
	specialNeeds        string
	concernsForChild    string
	anythingElse        string

	// Bar/Bat Mitzvah
	barMitzvahYear  bool
	barMitzvahWhere string
	barMitzvahMonth string

	// Other
	backpackInfo string

	// Quest bus info
	busPickupName         string
	busPickupPhone        string
	busPickupRelationship string
	busAltPickup          string
	busAltPhone           string
}

// Sync executes the Quest registrations extraction
func (s *QuestRegistrationsSync) Sync(ctx context.Context) error {
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
			year = 2025
		}
	}

	// Validate year
	if year < 2017 || year > 2099 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2099", year)
	}

	slog.Info("Starting Quest registrations extraction",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person -> attendee mapping
	personToAttendee, err := s.loadPersonAttendeeMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-attendee mapping: %w", err)
	}
	slog.Info("Loaded person-attendee mapping", "count", len(personToAttendee))

	// Step 3: Load person custom values (Quest-* and Q-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToAttendee)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted Quest registration records", "count", len(records))

	if s.DryRun {
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
		s.SyncSuccessful = true
		return nil
	}

	// Step 4: Load existing records
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 5: Upsert records
	created, updated, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Errors = errors

	// Step 6: Delete orphans
	deleted := s.deleteOrphans(ctx, records, existingRecords)
	s.Stats.Deleted = deleted

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	s.SyncSuccessful = true
	slog.Info("Quest registrations extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
func (s *QuestRegistrationsSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := record.GetString("name")
		if isQuestRegistrationField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isQuestRegistrationField checks if a field is relevant for Quest registrations
func isQuestRegistrationField(name string) bool {
	return strings.HasPrefix(name, "Quest-") || strings.HasPrefix(name, "Q-") ||
		strings.HasPrefix(name, "Quest ")
}

// loadPersonAttendeeMapping builds a map of person CM ID -> attendee PB ID
func (s *QuestRegistrationsSync) loadPersonAttendeeMapping(
	ctx context.Context, year int,
) (map[int]string, error) {
	result := make(map[int]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("attendees", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			if personID > 0 {
				if _, exists := result[personID]; !exists {
					result[personID] = record.Id
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

// questValueEntry represents a loaded Quest custom value
type questValueEntry struct {
	personID  int
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for Quest fields
func (s *QuestRegistrationsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToAttendee map[int]string,
) (map[string]*questRegistrationRecord, error) {
	var entries []questValueEntry

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
				continue
			}

			personID := record.GetInt("person_id")
			value := record.GetString("value")

			if personID > 0 && value != "" {
				entries = append(entries, questValueEntry{
					personID:  personID,
					fieldName: fieldName,
					value:     value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	// Aggregate to person level
	result := make(map[string]*questRegistrationRecord)

	for _, entry := range entries {
		attendeeID, hasAttendee := personToAttendee[entry.personID]
		if !hasAttendee {
			continue
		}

		key := makeQuestRegistrationKey(entry.personID, year)
		rec := result[key]
		if rec == nil {
			rec = &questRegistrationRecord{
				personID:   entry.personID,
				year:       year,
				attendeeID: attendeeID,
			}
			result[key] = rec
		}

		mapQuestFieldToRecord(rec, entry.fieldName, entry.value)
	}

	return result, nil
}

// mapQuestFieldToRecord maps a Quest-*/Q-* field to the record
func mapQuestFieldToRecord(rec *questRegistrationRecord, fieldName, value string) {
	column := MapQuestFieldToColumn(fieldName)
	if column == "" {
		return
	}

	switch column {
	// Signatures
	case "parent_signature":
		if rec.parentSignature == "" {
			rec.parentSignature = value
		}
	case "quester_signature":
		if rec.questerSignature == "" {
			rec.questerSignature = value
		}
	case "preferred_name":
		if rec.preferredName == "" {
			rec.preferredName = value
		}

	// Questionnaire
	case "why_come":
		if rec.whyCome == "" {
			rec.whyCome = value
		}
	case "most_looking_forward":
		if rec.mostLookingForward == "" {
			rec.mostLookingForward = value
		}
	case "least_looking_forward":
		if rec.leastLookingForward == "" {
			rec.leastLookingForward = value
		}
	case "biggest_accomplishment":
		if rec.biggestAccomplishment == "" {
			rec.biggestAccomplishment = value
		}
	case "biggest_disappointment":
		if rec.biggestDisappointment == "" {
			rec.biggestDisappointment = value
		}
	case "whose_decision":
		if rec.whoseDecision == "" {
			rec.whoseDecision = value
		}
	case "if_returning":
		if rec.ifReturning == "" {
			rec.ifReturning = value
		}
	case "biggest_hope":
		if rec.biggestHope == "" {
			rec.biggestHope = value
		}
	case "biggest_concern":
		if rec.biggestConcern == "" {
			rec.biggestConcern = value
		}

	// Social/emotional
	case "make_friends_ease":
		if rec.makeFriendsEase == "" {
			rec.makeFriendsEase = value
		}
	case "make_friends_explain":
		if rec.makeFriendsExplain == "" {
			rec.makeFriendsExplain = value
		}
	case "separation_reaction":
		if rec.separationReaction == "" {
			rec.separationReaction = value
		}
	case "separation_explain":
		if rec.separationExplain == "" {
			rec.separationExplain = value
		}
	case "away_before":
		if rec.awayBefore == "" {
			rec.awayBefore = value
		}
	case "away_explain":
		if rec.awayExplain == "" {
			rec.awayExplain = value
		}
	case "express_frustration":
		if rec.expressFrustration == "" {
			rec.expressFrustration = value
		}
	case "what_makes_angry":
		if rec.whatMakesAngry == "" {
			rec.whatMakesAngry = value
		}
	case "cooperates_with_limits":
		if rec.cooperatesWithLimits == "" {
			rec.cooperatesWithLimits = value
		}
	case "techniques_limits":
		if rec.techniquesLimits == "" {
			rec.techniquesLimits = value
		}

	// Medical/physical
	case "any_medications":
		if rec.anyMedications == "" {
			rec.anyMedications = value
		}
	case "physical_limitations":
		if rec.physicalLimitations == "" {
			rec.physicalLimitations = value
		}
	case "physical_limit_explain":
		if rec.physicalLimitExplain == "" {
			rec.physicalLimitExplain = value
		}
	case "fears_anxieties":
		if rec.fearsAnxieties == "" {
			rec.fearsAnxieties = value
		}
	case "situations_transitions":
		if rec.situationsTransitions == "" {
			rec.situationsTransitions = value
		}
	case "bad_camp_experiences":
		if rec.badCampExperiences == "" {
			rec.badCampExperiences = value
		}

	// Development/maturity
	case "child_matured":
		if rec.childMatured == "" {
			rec.childMatured = value
		}
	case "change_since_last_year":
		if rec.changeSinceLastYear == "" {
			rec.changeSinceLastYear = value
		}
	case "extracurricular":
		if rec.extracurricular == "" {
			rec.extracurricular = value
		}
	case "cook_chores":
		if rec.cookChores == "" {
			rec.cookChores = value
		}
	case "cook_chores_explain":
		if rec.cookChoresExplain == "" {
			rec.cookChoresExplain = value
		}
	case "decision_attend":
		if rec.decisionAttend == "" {
			rec.decisionAttend = value
		}
	case "how_can_help":
		if rec.howCanHelp == "" {
			rec.howCanHelp = value
		}
	case "how_much_child":
		if rec.howMuchChild == "" {
			rec.howMuchChild = value
		}
	case "has_quester_before":
		if rec.hasQuesterBefore == "" {
			rec.hasQuesterBefore = value
		}
	case "special_needs":
		if rec.specialNeeds == "" {
			rec.specialNeeds = value
		}
	case "concerns_for_child":
		if rec.concernsForChild == "" {
			rec.concernsForChild = value
		}
	case "anything_else":
		if rec.anythingElse == "" {
			rec.anythingElse = value
		}

	// Bar/Bat Mitzvah
	case "bar_mitzvah_year":
		rec.barMitzvahYear = parseQuestBool(value)
	case "bar_mitzvah_where":
		if rec.barMitzvahWhere == "" {
			rec.barMitzvahWhere = value
		}
	case "bar_mitzvah_month":
		if rec.barMitzvahMonth == "" {
			rec.barMitzvahMonth = value
		}

	// Other
	case "backpack_info":
		if rec.backpackInfo == "" {
			rec.backpackInfo = value
		}

	// Quest bus
	case "bus_pickup_name":
		if rec.busPickupName == "" {
			rec.busPickupName = value
		}
	case "bus_pickup_phone":
		if rec.busPickupPhone == "" {
			rec.busPickupPhone = value
		}
	case "bus_pickup_relationship":
		if rec.busPickupRelationship == "" {
			rec.busPickupRelationship = value
		}
	case "bus_alt_pickup":
		if rec.busAltPickup == "" {
			rec.busAltPickup = value
		}
	case "bus_alt_phone":
		if rec.busAltPhone == "" {
			rec.busAltPhone = value
		}
	}
}

// MapQuestFieldToColumn maps CampMinder field names to database column names
func MapQuestFieldToColumn(fieldName string) string {
	switch fieldName {
	// Signatures
	case "Quest-Parent Signature":
		return "parent_signature"
	case "Quest-Signature of Quester":
		return "quester_signature"
	case "Quest-prefer to be called":
		return "preferred_name"

	// Questionnaire
	case "Q-Why come?":
		return "why_come"
	case "Q-Most looking forward to":
		return "most_looking_forward"
	case "Q-least looking forward to":
		return "least_looking_forward"
	case "Q-biggest accomplishment":
		return "biggest_accomplishment"
	case "Q-biggest disappointment":
		return "biggest_disappointment"
	case "Q-Whose decision":
		return "whose_decision"
	case "Q-If returning":
		return "if_returning"
	case "Quest-biggest hope":
		return "biggest_hope"
	case "Quest-biggest concern":
		return "biggest_concern"

	// Social/emotional
	case "Quest-How easily make friends":
		return "make_friends_ease"
	case "Quest-Make friends - explain":
		return "make_friends_explain"
	case "Quest-React to Separation":
		return "separation_reaction"
	case "Quest-React to Separat explain":
		return "separation_explain"
	case "Quest-away from home before?":
		return "away_before"
	case "Quest-away from home explain":
		return "away_explain"
	case "Quest-Expressfrustration/anger":
		return "express_frustration"
	case "Quest-What makes child angry":
		return "what_makes_angry"
	case "Quest-cooperate with limits":
		return "cooperates_with_limits"
	case "Quest-techniques to set limits":
		return "techniques_limits"

	// Medical/physical
	case "Quest-any medications":
		return "any_medications"
	case "Quest-Physical Limitations":
		return "physical_limitations"
	case "Quest-Physical limit explain":
		return "physical_limit_explain"
	case "Quest-fears or anxieties":
		return "fears_anxieties"
	case "Quest-situations/transitions":
		return "situations_transitions"
	case "Quest-Bad camp experiences":
		return "bad_camp_experiences"

	// Development/maturity
	case "Quest-child matured":
		return "child_matured"
	case "Quest-Change since last year":
		return "change_since_last_year"
	case "Quest-Extracurricular activiti":
		return "extracurricular"
	case "Quest-Cook/chores around house":
		return "cook_chores"
	case "Quest-Cook/Chores Explain":
		return "cook_chores_explain"
	case "Quest-decision attend Tawonga":
		return "decision_attend"
	case "Quest-How can we help?":
		return "how_can_help"
	case "Quest-How much does child":
		return "how_much_child"
	case "Quest-Has your quester":
		return "has_quester_before"
	case "Quest-Special Needs":
		return "special_needs"
	case "Quest-Concerns for child":
		return "concerns_for_child"
	case "Quest-Anything else":
		return "anything_else"

	// Bar/Bat Mitzvah
	case "Quest-Bar/BatMitzvah this year":
		return "bar_mitzvah_year"
	case "Quest-Bar/BatMitzvah where":
		return "bar_mitzvah_where"
	case "Quest-Bar mitzvah month":
		return "bar_mitzvah_month"

	// Other
	case "Quest-Backpack":
		return "backpack_info"

	// Quest bus
	case "Quest BUS-person picking up":
		return "bus_pickup_name"
	case "Quest BUS-phone person picking up":
		return "bus_pickup_phone"
	case "Quest BUS-relationship to camper pick up":
		return "bus_pickup_relationship"
	case "Quest BUS-alternate pick up":
		return "bus_alt_pickup"
	case "Quest BUS-alternate phone":
		return "bus_alt_phone"
	}
	return ""
}

// parseQuestBool parses Yes/No/This year values to boolean
func parseQuestBool(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case "yes", "true", "1", "y", "this year":
		return true
	}
	return false
}

// makeQuestRegistrationKey creates the composite key for upsert logic
func makeQuestRegistrationKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// loadExistingRecords loads existing quest_registrations records for a year
func (s *QuestRegistrationsSync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
	result := make(map[string]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("quest_registrations", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying quest_registrations page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			key := makeQuestRegistrationKey(personID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates Quest registration records
func (s *QuestRegistrationsSync) upsertRecords(
	ctx context.Context,
	records map[string]*questRegistrationRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("quest_registrations")
	if err != nil {
		slog.Error("Error finding quest_registrations collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		key := makeQuestRegistrationKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("quest_registrations", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}
		} else {
			record = core.NewRecord(col)
		}

		// Set all fields
		record.Set("attendee", rec.attendeeID)
		record.Set("person_id", rec.personID)
		record.Set("year", rec.year)

		// Signatures
		record.Set("parent_signature", rec.parentSignature)
		record.Set("quester_signature", rec.questerSignature)
		record.Set("preferred_name", rec.preferredName)

		// Questionnaire
		record.Set("why_come", rec.whyCome)
		record.Set("most_looking_forward", rec.mostLookingForward)
		record.Set("least_looking_forward", rec.leastLookingForward)
		record.Set("biggest_accomplishment", rec.biggestAccomplishment)
		record.Set("biggest_disappointment", rec.biggestDisappointment)
		record.Set("whose_decision", rec.whoseDecision)
		record.Set("if_returning", rec.ifReturning)
		record.Set("biggest_hope", rec.biggestHope)
		record.Set("biggest_concern", rec.biggestConcern)

		// Social/emotional
		record.Set("make_friends_ease", rec.makeFriendsEase)
		record.Set("make_friends_explain", rec.makeFriendsExplain)
		record.Set("separation_reaction", rec.separationReaction)
		record.Set("separation_explain", rec.separationExplain)
		record.Set("away_before", rec.awayBefore)
		record.Set("away_explain", rec.awayExplain)
		record.Set("express_frustration", rec.expressFrustration)
		record.Set("what_makes_angry", rec.whatMakesAngry)
		record.Set("cooperates_with_limits", rec.cooperatesWithLimits)
		record.Set("techniques_limits", rec.techniquesLimits)

		// Medical/physical
		record.Set("any_medications", rec.anyMedications)
		record.Set("physical_limitations", rec.physicalLimitations)
		record.Set("physical_limit_explain", rec.physicalLimitExplain)
		record.Set("fears_anxieties", rec.fearsAnxieties)
		record.Set("situations_transitions", rec.situationsTransitions)
		record.Set("bad_camp_experiences", rec.badCampExperiences)

		// Development/maturity
		record.Set("child_matured", rec.childMatured)
		record.Set("change_since_last_year", rec.changeSinceLastYear)
		record.Set("extracurricular", rec.extracurricular)
		record.Set("cook_chores", rec.cookChores)
		record.Set("cook_chores_explain", rec.cookChoresExplain)
		record.Set("decision_attend", rec.decisionAttend)
		record.Set("how_can_help", rec.howCanHelp)
		record.Set("how_much_child", rec.howMuchChild)
		record.Set("has_quester_before", rec.hasQuesterBefore)
		record.Set("special_needs", rec.specialNeeds)
		record.Set("concerns_for_child", rec.concernsForChild)
		record.Set("anything_else", rec.anythingElse)

		// Bar/Bat Mitzvah
		record.Set("bar_mitzvah_year", rec.barMitzvahYear)
		record.Set("bar_mitzvah_where", rec.barMitzvahWhere)
		record.Set("bar_mitzvah_month", rec.barMitzvahMonth)

		// Other
		record.Set("backpack_info", rec.backpackInfo)

		// Quest bus
		record.Set("bus_pickup_name", rec.busPickupName)
		record.Set("bus_pickup_phone", rec.busPickupPhone)
		record.Set("bus_pickup_relationship", rec.busPickupRelationship)
		record.Set("bus_alt_pickup", rec.busAltPickup)
		record.Set("bus_alt_phone", rec.busAltPhone)

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving quest_registrations record",
				"person_id", rec.personID,
				"year", rec.year,
				"error", err,
			)
			errors++
			continue
		}

		if exists {
			updated++
		} else {
			created++
		}
	}

	return created, updated, errors
}

// deleteOrphans removes records that exist in DB but not in computed set
func (s *QuestRegistrationsSync) deleteOrphans(
	ctx context.Context,
	records map[string]*questRegistrationRecord,
	existingRecords map[string]string,
) int {
	deleted := 0

	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted
		default:
		}

		if _, exists := records[key]; !exists {
			record, err := s.App.FindRecordById("quest_registrations", recordID)
			if err != nil {
				slog.Warn("Error finding orphan record", "id", recordID, "error", err)
				continue
			}

			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan record", "id", recordID, "error", err)
				continue
			}
			deleted++
		}
	}

	return deleted
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (s *QuestRegistrationsSync) forceWALCheckpoint() error {
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
