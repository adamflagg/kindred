package sync

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameQuestRegistrations is the canonical name for this sync service
const serviceNameQuestRegistrations = "quest_registrations"

// Column name constants for quest_registrations table
const (
	colParentSignature     = "parent_signature"
	colQuesterSignature    = "quester_signature"
	colPreferredName       = "preferred_name"
	colWhyCome             = "why_come"
	colMostLookingForward  = "most_looking_forward"
	colLeastLookingForward = "least_looking_forward"
	colBiggestHope         = "biggest_hope"
	colBiggestConcern      = "biggest_concern"
	colBarMitzvahYear      = "bar_mitzvah_year"
	colBarMitzvahWhere     = "bar_mitzvah_where"
	colBarMitzvahMonth     = "bar_mitzvah_month"
)

// QuestRegistrationsSync extracts Quest-* and Q-* custom fields for Quest program participants.
// This service reads from person_custom_values and populates the quest_registrations table.
//
// Unique key: (person_id, year) - one record per Quest participant per year
// Links to: attendees
//
// Field mapping: 45+ Quest-* and Q-* prefixed fields covering signatures, preferences,
// parent questionnaires, and transportation details.
//
// Rows persist after a participant cancels; this table is never swept by deletion. A future
// reader (e.g. a staff dashboard) must filter by active enrollment for the view's own year -- an
// `attendees` row with status_id = 2 for that person and year -- and must not filter across
// years. See "Reading Derived Informational Tables (Active-Enrollment Filtering)" in
// docs/architecture/sync-layer.md.
type QuestRegistrationsSync struct {
	App    core.App
	Year   int
	DryRun bool
	Debug  bool
	Stats  Stats
	// SyncSuccessful reports whether this run's extraction produced any rows.
	// Set immediately after extraction, NOT at the end of Sync(), because its
	// one consumer is the orphan sweep, which runs before Sync() returns.
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

// SetDebug enables or disables debug logging
func (s *QuestRegistrationsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this sync service
func (s *QuestRegistrationsSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *QuestRegistrationsSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// questRegistrationRecord holds the extracted Quest info for a participant
type questRegistrationRecord struct {
	personID int
	year     int

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
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
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

	// Step 2: Load the admission set (person CM IDs with any attendees row this
	// year) and the multi-enrollment tripwire count.
	personHasAttendee, multiQuest, err := s.loadPersonsWithAttendee(ctx, year)
	if err != nil {
		return fmt.Errorf("loading persons with an attendee row: %w", err)
	}
	slog.Info("Loaded admission set", "count", len(personHasAttendee))
	if multiQuest > 0 {
		// Zero on every year 2021-2026. If this ever fires, the assumption behind
		// kindred#2261 -- that the questionnaire is person x year -- has changed
		// upstream, and the table needs a session dimension before anyone trusts it.
		// Deliberately a log line and not a Stats counter. Adding a field to Stats
		// means editing orchestrator.go, which every sync shares and which
		// kindred#2257's guardrail work already serializes on; and the counter that
		// would actually belong there (Rejected) is blocked on kindred#2292's typed
		// errors. A tripwire that has never fired does not justify that collision.
		slog.Warn("people hold more than one active Quest enrollment; kindred#2261's person-year grain may no longer hold",
			"year", year, "people", multiQuest)
	}

	// Step 3: Load person custom values (Quest-* and Q-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personHasAttendee)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted Quest registration records", "count", len(records))

	// The extraction finished without error, so len(records) is now a fact about
	// the SOURCE rather than about whether this run worked. Gate the sweep on it:
	// a year in which nobody answered is a legitimately empty upstream, not a
	// collapse, and refusing there wedged the table -- a refused sweep never
	// clears the rows, so `existing` stayed high and every later run refused
	// again. This is the policy BaseSyncService.DeleteOrphans already applies
	// ("Only delete orphans if the sync was successful", with SyncSuccessful set
	// mid-fetch and gated on rows arriving); these four declared their own
	// SyncSuccessful at the END of Sync(), where it was always false during
	// their own sweep and nothing ever read it (kindred#2283).
	s.SyncSuccessful = len(records) > 0

	if s.DryRun {
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
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
	deleted, orphanErr := s.deleteOrphans(ctx, records, existingRecords, year)
	s.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below -- upsertRecords has already
	// written by this point, and the refusal path can fire on a non-empty
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
		name := normalizeFieldName(record.GetString("name"))
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

// loadPersonsWithAttendee returns the set of person CM IDs holding at least one
// `attendees` row for the year, plus a count of people holding two or more
// ACTIVE (status_id = 2) Quest enrollments.
//
// It used to return person -> attendee PB ID, and that map did two jobs: it
// admitted a person into the table, and it supplied a stored `attendee`
// relation. The relation is gone (kindred#2261) because it could never answer
// the question a reader would ask it -- kindred#2159 requires enrollment to be
// established by joining `(person_id, year)` on `status_id = 2`, not by
// traversing a link. Picking one of a person's several attendee rows to store
// was therefore arbitrary AND unusable; measured on the production snapshot,
// 125 of 679 rows pointed at a non-enrolled attendee and 71 of those discarded
// an enrolled candidate.
//
// The ADMISSION half is preserved exactly. A person with Quest values but no
// attendees row for the year is still excluded. On the production snapshot that
// exclusion currently admits everyone (0 people in 2024-2026 hold Quest values
// without an attendees row), which is precisely why it is pinned by a test
// rather than left as an assumption.
//
// Membership is order-independent by construction: a set has no first element,
// so the empty `sort` argument below can no longer decide anything. That is the
// order-independence probe kindred#2257 asks for, satisfied structurally.
// isCountableQuestEnrollment decides whether one attendees row counts toward the
// multi-Quest tripwire. Pure so the rule is testable without a database -- the
// bug it exists to prevent (counting every session type, not just Quest) would
// have fired on 201-338 people a year instead of 0, i.e. on every single run.
func isCountableQuestEnrollment(statusID int, sessionID string, questSessionIDs map[string]bool) bool {
	// Only ACTIVE enrollments: a cancelled Quest followed by a different one is
	// one Quest, not two.
	if statusID != statusIDActiveEnrolled {
		return false
	}
	if sessionID == "" {
		return false
	}
	return questSessionIDs[sessionID]
}

// loadQuestSessionIDs returns the PB ids of every Quest session, across all years.
//
// Two deliberate choices, both about not coupling an observational tripwire to
// things it does not need:
//
//   - NOT year-filtered. A session PB id is unique per row and the attendees rows
//     this set is matched against are already scoped to one year, so a year
//     predicate would change nothing.
//   - Filtered in Go rather than in the query. The shared test fixtures for
//     camp_sessions declare neither `year` nor `session_type`, and a filter naming
//     an undeclared field is a hard error in PocketBase, not an empty result. In a
//     fixture without the field every GetString returns "", so the Quest set comes
//     back empty and the tripwire simply never fires -- which is the right failure
//     mode for a counter that only warns. The rule itself is unit-tested directly
//     in isCountableQuestEnrollment, so nothing goes uncovered.
//
// A few hundred rows all-time; read once per run.
// sessionTypeQuest is the camp_sessions.session_type value for a Quest session.
const sessionTypeQuest = "quest"

func (s *QuestRegistrationsSync) loadQuestSessionIDs() (map[string]bool, error) {
	ids := make(map[string]bool)
	records, err := s.App.FindRecordsByFilter("camp_sessions", "", "id", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying camp sessions: %w", err)
	}
	for _, r := range records {
		if r.GetString("session_type") == sessionTypeQuest {
			ids[r.Id] = true
		}
	}
	return ids, nil
}

func (s *QuestRegistrationsSync) loadPersonsWithAttendee(
	ctx context.Context, year int,
) (hasAttendee map[int]bool, multiEnrolled int, err error) {
	questSessionIDs, err := s.loadQuestSessionIDs()
	if err != nil {
		return nil, 0, err
	}
	hasAttendee = make(map[int]bool)
	// person CM ID -> the distinct quest sessions they are ACTIVELY enrolled in
	questSessions := make(map[int][]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("attendees", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, 0, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			if personID <= 0 {
				continue
			}
			hasAttendee[personID] = true

			sessionID := record.GetString("session")
			if !isCountableQuestEnrollment(record.GetInt("status_id"), sessionID, questSessionIDs) {
				continue
			}
			if !slices.Contains(questSessions[personID], sessionID) {
				questSessions[personID] = append(questSessions[personID], sessionID)
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return hasAttendee, countMultiQuestEnrollments(questSessions), nil
}

// countMultiQuestEnrollments counts people holding two or more distinct active
// enrollments in one year.
//
// This guards the assumption the kindred#2261 fix rests on, and it exists
// because "has never happened" is not "cannot happen". Nobody has held two
// Quest enrollments in any year from 2021 to 2026 (max 1, every year), and the
// questionnaire is person x year AT THE SOURCE -- `person_custom_values` is
// UNIQUE(year, person, field_definition), so a second Quest could not carry a
// second set of answers even in principle. Adding a session dimension would
// therefore fan one questionnaire across N rows, inventing answers rather than
// recovering them.
//
// So the correct protection is not a schema dimension, it is a tripwire: if the
// registration form ever starts allowing two, this counter is how we find out,
// instead of silently storing one questionnaire against an arbitrary session.
func countMultiQuestEnrollments(sessionsByPerson map[int][]string) int {
	n := 0
	for _, sessions := range sessionsByPerson {
		if len(sessions) > 1 {
			n++
		}
	}
	return n
}

// questValueEntry represents a loaded Quest custom value
type questValueEntry struct {
	personID  int
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for Quest fields
func (s *QuestRegistrationsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personHasAttendee map[int]bool,
) (map[string]*questRegistrationRecord, error) {
	var entries []questValueEntry

	// Cache for person PB ID -> CM ID lookups
	personCache := make(map[string]int)

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

			// person_custom_values has "person" relation field (PB ID), not "person_id"
			personPBID := record.GetString("person")
			if personPBID == "" {
				continue
			}

			// Look up CM ID from cache or persons table
			personID := 0
			if cached, ok := personCache[personPBID]; ok {
				personID = cached
			} else {
				personFilter := fmt.Sprintf("id = '%s'", personPBID)
				persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
				if err == nil && len(persons) > 0 {
					if cmID, ok := persons[0].Get("cm_id").(float64); ok {
						personID = int(cmID)
						personCache[personPBID] = personID
					}
				}
			}

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

	return aggregateQuestEntries(entries, year, personHasAttendee), nil
}

// aggregateQuestEntries folds Quest custom values into one record per person-year.
//
// Pure and exported to the test package deliberately. The tests that previously
// covered this shape (TestQuestRecordBuilding) drove `buildQuestRecords`, a
// reimplementation living in the _test file, so they could not fail when this
// code changed. This is the real seam.
//
// `personHasAttendee` is an ADMISSION filter and nothing more -- see
// loadPersonsWithAttendee. Because it is a set rather than a chosen row, the
// result cannot depend on the order entries arrive in.
func aggregateQuestEntries(
	entries []questValueEntry, year int, personHasAttendee map[int]bool,
) map[string]*questRegistrationRecord {
	result := make(map[string]*questRegistrationRecord)

	for _, entry := range entries {
		if !personHasAttendee[entry.personID] {
			continue
		}

		key := makeQuestRegistrationKey(entry.personID, year)
		rec := result[key]
		if rec == nil {
			rec = &questRegistrationRecord{
				personID: entry.personID,
				year:     year,
			}
			result[key] = rec
		}

		mapQuestFieldToRecord(rec, entry.fieldName, entry.value)
	}

	return result
}

// mapQuestFieldToRecord maps a Quest-*/Q-* field to the record
func mapQuestFieldToRecord(rec *questRegistrationRecord, fieldName, value string) {
	column := MapQuestFieldToColumn(fieldName)
	if column == "" {
		return
	}

	switch column {
	// Signatures
	case colParentSignature:
		if rec.parentSignature == "" {
			rec.parentSignature = value
		}
	case colQuesterSignature:
		if rec.questerSignature == "" {
			rec.questerSignature = value
		}
	case colPreferredName:
		if rec.preferredName == "" {
			rec.preferredName = value
		}

	// Questionnaire
	case colWhyCome:
		if rec.whyCome == "" {
			rec.whyCome = value
		}
	case colMostLookingForward:
		if rec.mostLookingForward == "" {
			rec.mostLookingForward = value
		}
	case colLeastLookingForward:
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
	case colBiggestHope:
		if rec.biggestHope == "" {
			rec.biggestHope = value
		}
	case colBiggestConcern:
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
	case colBarMitzvahYear:
		rec.barMitzvahYear = parseQuestBool(value)
	case colBarMitzvahWhere:
		if rec.barMitzvahWhere == "" {
			rec.barMitzvahWhere = value
		}
	case colBarMitzvahMonth:
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
		return colParentSignature
	case "Quest-Signature of Quester":
		return colQuesterSignature
	case "Quest-prefer to be called":
		return colPreferredName

	// Questionnaire
	case "Q-Why come?":
		return colWhyCome
	case "Q-Most looking forward to":
		return colMostLookingForward
	case "Q-least looking forward to":
		return colLeastLookingForward
	case "Q-biggest accomplishment":
		return "biggest_accomplishment"
	case "Q-biggest disappointment":
		return "biggest_disappointment"
	case "Q-Whose decision":
		return "whose_decision"
	case "Q-If returning":
		return "if_returning"
	case "Quest-biggest hope":
		return colBiggestHope
	case "Quest-biggest concern":
		return colBiggestConcern

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
		return colBarMitzvahYear
	case "Quest-Bar/BatMitzvah where":
		return colBarMitzvahWhere
	case "Quest-Bar mitzvah month":
		return colBarMitzvahMonth

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
	case boolYes, boolTrue, "1", "y", "this year":
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

// deleteOrphans removes records that exist in DB but not in computed set.
//
// Refuses when the computed set is too small to be believed against the rows
// on disk: that combination is always a broken input, and sweeping on it
// deletes the year and reports success (kindred#2257, kindred#2283). The rule
// lives in OrphanSweepGuard so there is one implementation, not an eighth copy.
func (s *QuestRegistrationsSync) deleteOrphans(
	ctx context.Context,
	records map[string]*questRegistrationRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	// An empty source is not a collapse. Sync() sets SyncSuccessful from the
	// size of this run's extraction, so a year nobody answered skips the sweep
	// and succeeds rather than refusing forever (kindred#2283). The guard below
	// still owns the case that matters: a source that came back SHORT.
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion: the source returned no rows for this year",
			"entity", "quest_registrations", "year", year)
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "quest_registrations",
		Year:     year,
		Computed: len(records),
		Hint:     "check that the attendee mapping and the Quest-/Q-* field definitions still exist upstream",
	}
	if err := guard.Check(len(existingRecords)); err != nil {
		return 0, err
	}

	deleted := 0

	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted, ctx.Err()
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

	return deleted, nil
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
