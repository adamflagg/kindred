package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameStaffApplications is the canonical name for this sync service
const serviceNameStaffApplications = "staff_applications"

// StaffApplicationsSync extracts App-* custom fields for staff applications.
// This service reads from person_custom_values and populates the staff_applications table.
//
// Unique key: (person_id, year) - one record per staff applicant per year
// Links to: staff
//
// Field mapping: 40 App-* prefixed fields covering work availability, qualifications,
// position preferences, essays, references, and reflection prompts.
type StaffApplicationsSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Debug          bool
	Stats          Stats
	SyncSuccessful bool
}

// NewStaffApplicationsSync creates a new staff applications sync service
func NewStaffApplicationsSync(app core.App) *StaffApplicationsSync {
	return &StaffApplicationsSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *StaffApplicationsSync) Name() string {
	return serviceNameStaffApplications
}

// GetStats returns the current stats
func (s *StaffApplicationsSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *StaffApplicationsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *StaffApplicationsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *StaffApplicationsSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *StaffApplicationsSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// staffApplicationRecord holds the extracted application info for a staff member
type staffApplicationRecord struct {
	personID int
	year     int
	staffID  string // PocketBase ID of staff record

	// Work availability
	canWorkDates        string
	cantWorkExplain     string
	workDatesSupervisor string
	workDatesWild       string
	workDatesDriver     string

	// Qualifications
	workExpectations     string
	qualifications       string
	qualificationChanges string

	// Position preferences
	positionPref1 string
	positionPref2 string
	positionPref3 string

	// Essays
	whyTawonga               string
	whyWorkAgain             string
	jewishCommunity          string
	threeRules               string
	autobiography            string
	communityMeans           string
	workingAcrossDifferences string

	// Personal info
	languages    string
	dietaryNeeds string
	dietaryOther string
	over21       bool

	// Reference
	ref1Name         string
	ref1Phone        string
	ref1Email        string
	ref1Relationship string
	ref1Years        string

	// Reflection prompts
	stressSituation      string
	stressResponse       string
	spiritualMoment      string
	activityProgram      string
	someoneAdmire        string
	sinceCamp            string
	wishKnew             string
	lastSummerLearned    string
	favoriteCamperMoment string
	closestFriend        string
	tawongaMakesThink    string
	adviceWouldGive      string
	howLookAtCamp        string
}

// Sync executes the staff applications extraction
func (s *StaffApplicationsSync) Sync(ctx context.Context) error {
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

	slog.Info("Starting staff applications extraction",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person -> staff mapping
	personToStaff, err := s.loadPersonStaffMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-staff mapping: %w", err)
	}
	slog.Info("Loaded person-staff mapping", "count", len(personToStaff))

	// Step 3: Load person custom values (App-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToStaff)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted staff application records", "count", len(records))

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
	created, updated, upsertErrors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Errors = upsertErrors

	// Step 6: Delete orphans
	deleted, err := s.deleteOrphans(ctx, records, existingRecords, year)
	s.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below: upsertRecords has already
	// written by this point, and both error paths return with those writes still
	// in the WAL. That includes the refusal path -- widening the guard to catch a
	// PARTIAL collapse (kindred#2279) means it can refuse on a non-empty computed
	// set, which is exactly the case where upsertRecords did write.
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if cpErr := s.forceWALCheckpoint(); cpErr != nil {
			slog.Warn("WAL checkpoint failed", "error", cpErr)
		}
	}

	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("orphan sweep interrupted: %w", err)
		}
		return fmt.Errorf("orphan sweep refused: %w", err)
	}

	s.SyncSuccessful = true
	slog.Info("Staff applications extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"skipped", s.Stats.Skipped,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
func (s *StaffApplicationsSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := normalizeFieldName(record.GetString("name"))
		if isStaffApplicationField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isStaffApplicationField checks if a field is relevant for staff applications.
//
// This gate is deliberately wider than the routing switch: it admits 88
// definitions in the production snapshot, of which MapStaffAppFieldToColumn
// routes 40. The other 48 are enumerated with a reason each in
// retiredAppFieldReasons, and loadPersonCustomValues counts and logs every
// discard rather than dropping it in silence (kindred#2271).
//
// The gap is intentional, and the reason it is safe to leave it that way is
// that no downstream consumer reads staff_applications: `grep -rn
// "staff_applications" bunking/ api/` returns no hits, and every frontend
// reference is sync-admin plumbing (SyncTab.tsx, syncTypes.ts,
// useRunIndividualSync.ts, useSyncStatusAPI.ts, useSyncCompletionToasts.ts,
// useStaffApplicationsSync.ts) plus the generated pocketbase-types.ts -- no
// component reads a column. Nothing may assume that an absent answer here
// means the applicant did not answer; the source values all survive in
// person_custom_values. If a reader is ever added that does need to make that
// assumption, the four fields still receiving 2026 answers (see category G in
// retiredAppFieldReasons) are the ones that would need columns first.
func isStaffApplicationField(name string) bool {
	// App-* prefixed fields
	if strings.HasPrefix(name, "App-") {
		return true
	}
	// Position Preference fields (no App- prefix)
	if strings.HasPrefix(name, "Position Preference") {
		return true
	}
	return false
}

// loadPersonStaffMapping builds a map of person CM ID -> staff PB ID
func (s *StaffApplicationsSync) loadPersonStaffMapping(
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

		records, err := s.App.FindRecordsByFilter("staff", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying staff page %d: %w", page, err)
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

// appValueEntry represents a loaded application custom value
type appValueEntry struct {
	personID  int
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for App-* fields
func (s *StaffApplicationsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToStaff map[int]string,
) (map[string]*staffApplicationRecord, error) {
	var entries []appValueEntry

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

		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, sortByID, perPage, (page-1)*perPage)
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
				entries = append(entries, appValueEntry{
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
	result := make(map[string]*staffApplicationRecord)
	// unmappedCounts tracks discard events: an App-*/Position Preference field
	// accepted by isStaffApplicationField (the prefix test) that has no case in
	// MapStaffAppFieldToColumn. Keyed by field name so the eventual log line
	// names what was dropped, not just how much (kindred#2271).
	unmappedCounts := make(map[string]int)

	for _, entry := range entries {
		staffID, hasStaff := personToStaff[entry.personID]
		if !hasStaff {
			continue
		}

		key := makeStaffAppKey(entry.personID, year)
		rec := result[key]
		if rec == nil {
			rec = &staffApplicationRecord{
				personID: entry.personID,
				year:     year,
				staffID:  staffID,
			}
			result[key] = rec
		}

		if column := mapAppFieldToRecord(rec, entry.fieldName, entry.value); column == "" {
			unmappedCounts[entry.fieldName]++
		}
	}

	if len(unmappedCounts) > 0 {
		known, unexpected := classifyUnmappedAppFields(unmappedCounts)
		total := 0
		for _, n := range unmappedCounts {
			total += n
		}
		s.Stats.Skipped += total

		// One aggregated warning per run, not one per discarded value. unexpected
		// is the bucket that actually needs a human: a name not in
		// retiredAppFieldReasons is either a new CampMinder App-* field with no
		// routing case yet, or a retired one this list has not been told about.
		slog.Warn("Staff applications: discarding values for unmapped App-* fields",
			"year", year,
			"discard_events", total,
			"known_unmapped_fields", known,
			"unrecognized_fields", unexpected,
		)
	}

	return result, nil
}

// mapAppFieldToRecord maps an App-* field to the record. It returns the
// column the value was written to, or "" if MapStaffAppFieldToColumn has no
// case for fieldName. mapAppFieldToRecord is a package-level function with no
// receiver and no access to Stats, so the caller -- loadPersonCustomValues'
// aggregation loop, which does have the receiver -- is where an empty return
// gets counted and logged instead of silently dropped (kindred#2271).
func mapAppFieldToRecord(rec *staffApplicationRecord, fieldName, value string) string {
	column := MapStaffAppFieldToColumn(fieldName)
	if column == "" {
		return ""
	}

	switch column {
	// Work availability
	case "can_work_dates":
		if rec.canWorkDates == "" {
			rec.canWorkDates = value
		}
	case "cant_work_explain":
		if rec.cantWorkExplain == "" {
			rec.cantWorkExplain = value
		}
	case "work_dates_supervisor":
		if rec.workDatesSupervisor == "" {
			rec.workDatesSupervisor = value
		}
	case "work_dates_wild":
		if rec.workDatesWild == "" {
			rec.workDatesWild = value
		}
	case "work_dates_driver":
		if rec.workDatesDriver == "" {
			rec.workDatesDriver = value
		}

	// Qualifications
	case "work_expectations":
		if rec.workExpectations == "" {
			rec.workExpectations = value
		}
	case "qualifications":
		if rec.qualifications == "" {
			rec.qualifications = value
		}
	case "qualification_changes":
		if rec.qualificationChanges == "" {
			rec.qualificationChanges = value
		}

	// Position preferences
	case "position_pref_1":
		if rec.positionPref1 == "" {
			rec.positionPref1 = value
		}
	case "position_pref_2":
		if rec.positionPref2 == "" {
			rec.positionPref2 = value
		}
	case "position_pref_3":
		if rec.positionPref3 == "" {
			rec.positionPref3 = value
		}

	// Essays
	case "why_tawonga":
		if rec.whyTawonga == "" {
			rec.whyTawonga = value
		}
	case "why_work_again":
		if rec.whyWorkAgain == "" {
			rec.whyWorkAgain = value
		}
	case "jewish_community":
		if rec.jewishCommunity == "" {
			rec.jewishCommunity = value
		}
	case "three_rules":
		if rec.threeRules == "" {
			rec.threeRules = value
		}
	case "autobiography":
		if rec.autobiography == "" {
			rec.autobiography = value
		}
	case "community_means":
		if rec.communityMeans == "" {
			rec.communityMeans = value
		}
	case "working_across_differences":
		if rec.workingAcrossDifferences == "" {
			rec.workingAcrossDifferences = value
		}

	// Personal info
	case "languages":
		if rec.languages == "" {
			rec.languages = value
		}
	case "dietary_needs":
		if rec.dietaryNeeds == "" {
			rec.dietaryNeeds = value
		}
	case "dietary_needs_other":
		if rec.dietaryOther == "" {
			rec.dietaryOther = value
		}
	case "over_21":
		rec.over21 = parseStaffAppBool(value)

	// Reference
	case "ref_1_name":
		if rec.ref1Name == "" {
			rec.ref1Name = value
		}
	case "ref_1_phone":
		if rec.ref1Phone == "" {
			rec.ref1Phone = value
		}
	case "ref_1_email":
		if rec.ref1Email == "" {
			rec.ref1Email = value
		}
	case "ref_1_relationship":
		if rec.ref1Relationship == "" {
			rec.ref1Relationship = value
		}
	case "ref_1_years":
		if rec.ref1Years == "" {
			rec.ref1Years = value
		}

	// Reflection prompts
	case "stress_situation":
		if rec.stressSituation == "" {
			rec.stressSituation = value
		}
	case "stress_response":
		if rec.stressResponse == "" {
			rec.stressResponse = value
		}
	case "spiritual_moment":
		if rec.spiritualMoment == "" {
			rec.spiritualMoment = value
		}
	case "activity_program":
		if rec.activityProgram == "" {
			rec.activityProgram = value
		}
	case "someone_admire":
		if rec.someoneAdmire == "" {
			rec.someoneAdmire = value
		}
	case "since_camp":
		if rec.sinceCamp == "" {
			rec.sinceCamp = value
		}
	case "wish_knew":
		if rec.wishKnew == "" {
			rec.wishKnew = value
		}
	case "last_summer_learned":
		if rec.lastSummerLearned == "" {
			rec.lastSummerLearned = value
		}
	case "favorite_camper_moment":
		if rec.favoriteCamperMoment == "" {
			rec.favoriteCamperMoment = value
		}
	case "closest_friend":
		if rec.closestFriend == "" {
			rec.closestFriend = value
		}
	case "tawonga_makes_think":
		if rec.tawongaMakesThink == "" {
			rec.tawongaMakesThink = value
		}
	case "advice_would_give":
		if rec.adviceWouldGive == "" {
			rec.adviceWouldGive = value
		}
	case "how_look_at_camp":
		if rec.howLookAtCamp == "" {
			rec.howLookAtCamp = value
		}
	}

	return column
}

// retiredAppFieldReasons documents the 48 App-*/Position Preference custom
// field definitions that MapStaffAppFieldToColumn deliberately has no case
// for, out of the 88 isStaffApplicationField admits (kindred#2271). A name
// landing in this map is a closed question, not an oversight; do not add a
// routing case for one without first checking whether CampMinder actually
// resumed collecting it.
//
// The 48 fall into seven groups, verified against the production snapshot:
//   - 22 retired-2023 long-form essay prompts. The routing switch already
//     carries a replacement set of 13 essay prompts, which is the strongest
//     evidence the drop is deliberate.
//   - 9 prior-camp-employment-history fields ("Previous Camp 1/2/3" x
//     name/type/years). Camp 1 and Camp 2 carried data through 2023; all
//     three Camp 3 fields are is_active = 0 and never populated.
//   - 5 Reference #2 fields, never populated -- the five Reference #1
//     equivalents ARE mapped, so the form only ever collected one reference.
//   - 2 other retired-2023 gates (a COVID-policy yes/no, an "additional
//     responsibilities" free text truncated upstream by CampMinder to 30
//     chars with no trailing "...").
//   - 2 retired-2025 fields (a "weaknesses" free text, misspelled upstream as
//     "Weakensses"; a WILD-dates explanation whose companion gate IS mapped).
//   - 4 never-populated leftovers.
//   - 4 fields still receiving 2026 answers ("over 18", "JEDIreturner",
//     "JEDInewstaff", "Work Camp Dates Kitchen Supervisor"). kindred#2271
//     decided against adding columns for these: nothing downstream reads
//     staff_applications (`grep -rn "staff_applications" bunking/ api/`
//     exits 1), and a column empty on every historical row (2017-2025) would
//     look like data that was lost rather than a question never asked.
var retiredAppFieldReasons = map[string]string{
	// Retired 2023 essay prompts (22)
	"App-85th Birthday...":       "retired 2023 essay prompt, no values since 2023",
	"App-Admire...":              "retired 2023 essay prompt, no values since 2023",
	"App-Angry When...":          "retired 2023 essay prompt, no values since 2023",
	"App-Camp Goals":             "retired 2023 essay prompt, no values since 2023",
	"App-Center By...":           "retired 2023 essay prompt, no values since 2023",
	"App-Friends Say...":         "retired 2023 essay prompt, no values since 2023",
	"App-Future Profession...":   "retired 2023 essay prompt, no values since 2023",
	"App-Great At...":            "retired 2023 essay prompt, no values since 2023",
	"App-Hours Alone...":         "retired 2023 essay prompt, no values since 2023",
	"App-Kids Are...":            "retired 2023 essay prompt, no values since 2023",
	"App-Life Lesson":            "retired 2023 essay prompt, no values since 2023",
	"App-Memorable Travel...":    "retired 2023 essay prompt, no values since 2023",
	"App-Nature Moment...":       "retired 2023 essay prompt, no values since 2023",
	"App-Original Because...":    "retired 2023 essay prompt, no values since 2023",
	"App-Respond to Anger...":    "retired 2023 essay prompt, no values since 2023",
	"App-Rustic Living...":       "retired 2023 essay prompt, no values since 2023",
	"App-Spiritual Highlight...": "retired 2023 essay prompt, no values since 2023",
	"App-Still Learning...":      "retired 2023 essay prompt, no values since 2023",
	"App-Strengths":              "retired 2023 essay prompt, no values since 2023",
	"App-When Alone...":          "retired 2023 essay prompt, no values since 2023",
	"App-Work Ethic":             "retired 2023 essay prompt, no values since 2023",
	"App-Worked Hardest At...":   "retired 2023 essay prompt, no values since 2023",

	// Prior-camp employment history (9)
	"App-Previous Camp 1":       "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 1 Type":  "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 1 Years": "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 2":       "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 2 Type":  "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 2 Years": "retired 2023 prior-camp-employment field, no values since 2023",
	"App-Previous Camp 3":       "never populated -- Camp 3 slot of the retired prior-camp-employment block",
	"App-Previous Camp 3 Type":  "never populated -- Camp 3 slot of the retired prior-camp-employment block",
	"App-Previous Camp 3 Years": "never populated -- Camp 3 slot of the retired prior-camp-employment block",

	// Reference #2 block, never populated (5)
	"App-Ref 2 Email":               "never populated -- the form only ever collected one reference",
	"App-Ref 2 Name":                "never populated -- the form only ever collected one reference",
	"App-Ref 2 Phone Number":        "never populated -- the form only ever collected one reference",
	"App-Ref 2 Relationship":        "never populated -- the form only ever collected one reference",
	"App-Ref 2 Yrs of Acquaintance": "never populated -- the form only ever collected one reference",

	// Other retired-2023 gates (2)
	"App-COVID policies":             "retired 2023 field, no values since 2023",
	"App-What additional responsibi": "retired 2023 field, name truncated to 30 chars upstream by CampMinder",

	// Retired 2025 fields (2)
	"App-Weakensses":         "retired 2025 field, no values since 2025 (misspelled upstream)",
	"App-Wild Dates EXPLAIN": "retired 2025 field, no values since 2025",

	// Never-populated leftovers (4)
	"App-Assess specific strengths": "never populated in any year",
	"App-Help Meet Goals":           "never populated in any year",
	"App-Hobbies/Interests/Skills":  "never populated in any year",
	"App-Relevant Courses":          "never populated in any year",

	// Live 2026 fields, deliberately not given columns (4). See kindred#2271
	// in the doc comment above for why: no downstream consumer.
	"App-over 18":                            "live field, no downstream consumer",
	"App-JEDIreturner":                       "live field, no downstream consumer",
	"App-JEDInewstaff":                       "live field, no downstream consumer",
	"App-Work Camp Dates Kitchen Supervisor": "live field, no downstream consumer",
}

// classifyUnmappedAppFields splits per-field discard counts (fields
// MapStaffAppFieldToColumn returned "" for) into the 48 names
// retiredAppFieldReasons already explains, and everything else. The second
// bucket is the one an operator needs to act on: it is either a brand-new
// CampMinder App-* field with no routing case yet, or a retired field this
// map has not been told about.
func classifyUnmappedAppFields(counts map[string]int) (known, unexpected map[string]int) {
	known = make(map[string]int, len(counts))
	unexpected = make(map[string]int, len(counts))
	for name, n := range counts {
		if _, ok := retiredAppFieldReasons[name]; ok {
			known[name] = n
		} else {
			unexpected[name] = n
		}
	}
	return known, unexpected
}

// MapStaffAppFieldToColumn maps CampMinder field names to database column
// names. 48 App-*/Position Preference definitions are deliberately absent
// from this switch -- see retiredAppFieldReasons immediately above for which
// ones and why.
func MapStaffAppFieldToColumn(fieldName string) string {
	switch fieldName {
	// Work availability
	case "App-Work Camp Dates?":
		return "can_work_dates"
	case "App-Can't Work Camp Dates Expl":
		return "cant_work_explain"
	case "App- Work Camp Dates Supervisor?":
		return "work_dates_supervisor"
	case "App-Work Camp Dates WILD?":
		return "work_dates_wild"
	case "App- Work Camp Dates Driver?":
		return "work_dates_driver"

	// Qualifications
	case "App-Work Expectations":
		return "work_expectations"
	case "App-Qualifications":
		return "qualifications"
	case "App-Qualification changes":
		return "qualification_changes"

	// Position preferences (no App- prefix in CampMinder)
	case "Position Preference 1":
		return "position_pref_1"
	case "Position Preference 2":
		return "position_pref_2"
	case "Position Preference 3":
		return "position_pref_3"

	// Essays
	case "App-Why Tawonga?":
		return "why_tawonga"
	case "App-Why work at camp again?":
		return "why_work_again"
	case "App-Jewish Community":
		return "jewish_community"
	case "App-Three Rules...":
		return "three_rules"
	case "App-Autobiography...":
		return "autobiography"
	case "App-Community Means...":
		return "community_means"
	case "App- Working Across Differences":
		return "working_across_differences"

	// Personal info
	case "App-languages":
		return "languages"
	case "App-Dietary Needs":
		return "dietary_needs"
	case "App-Dietary Needs (Other)":
		return "dietary_needs_other"
	case "App-Over 21":
		return "over_21"

	// Reference
	case "App-Ref 1 Name":
		return "ref_1_name"
	case "App-Ref 1 Phone Number":
		return "ref_1_phone"
	case "App-Ref 1 Email":
		return "ref_1_email"
	case "App-Ref 1 Relationship":
		return "ref_1_relationship"
	case "App-Ref 1 Yrs of Acquaintance":
		return "ref_1_years"

	// Reflection prompts
	case "App-I got stressed when":
		return "stress_situation"
	case "App-I responded to my stress":
		return "stress_response"
	case "App-I had a spiritual moment":
		return "spiritual_moment"
	case "App-An activity or program":
		return "activity_program"
	case "App-Someone whose work I":
		return "someone_admire"
	case "App-Since camp I've been":
		return "since_camp"
	case "App-I wish I had gotten toknow":
		return "wish_knew"
	case "App-Last summer I learned":
		return "last_summer_learned"
	case "App-My favorite camper moment":
		return "favorite_camper_moment"
	case "App-My closest friend at camp":
		return "closest_friend"
	case "App-Tawonga makes me think of":
		return "tawonga_makes_think"
	case "App-what advice would you":
		return "advice_would_give"
	case "App-How do you look at camp":
		return "how_look_at_camp"
	}
	return ""
}

// parseStaffAppBool parses Yes/No values to boolean
// Note: Only "Yes" variants return true (per TDD spec)
func parseStaffAppBool(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == boolYes
}

// makeStaffAppKey creates the composite key for upsert logic
func makeStaffAppKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// loadExistingRecords loads existing staff_applications records for a year
func (s *StaffApplicationsSync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
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

		records, err := s.App.FindRecordsByFilter("staff_applications", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying staff_applications page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			key := makeStaffAppKey(personID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates staff application records
func (s *StaffApplicationsSync) upsertRecords(
	ctx context.Context,
	records map[string]*staffApplicationRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, errCount int) {
	col, err := s.App.FindCollectionByNameOrId("staff_applications")
	if err != nil {
		slog.Error("Error finding staff_applications collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errCount
		default:
		}

		key := makeStaffAppKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("staff_applications", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errCount++
				continue
			}
		} else {
			record = core.NewRecord(col)
		}

		// Set all fields
		record.Set("staff", rec.staffID)
		record.Set("person_id", rec.personID)
		record.Set("year", rec.year)

		// Work availability
		record.Set("can_work_dates", rec.canWorkDates)
		record.Set("cant_work_explain", rec.cantWorkExplain)
		record.Set("work_dates_supervisor", rec.workDatesSupervisor)
		record.Set("work_dates_wild", rec.workDatesWild)
		record.Set("work_dates_driver", rec.workDatesDriver)

		// Qualifications
		record.Set("work_expectations", rec.workExpectations)
		record.Set("qualifications", rec.qualifications)
		record.Set("qualification_changes", rec.qualificationChanges)

		// Position preferences
		record.Set("position_pref_1", rec.positionPref1)
		record.Set("position_pref_2", rec.positionPref2)
		record.Set("position_pref_3", rec.positionPref3)

		// Essays
		record.Set("why_tawonga", rec.whyTawonga)
		record.Set("why_work_again", rec.whyWorkAgain)
		record.Set("jewish_community", rec.jewishCommunity)
		record.Set("three_rules", rec.threeRules)
		record.Set("autobiography", rec.autobiography)
		record.Set("community_means", rec.communityMeans)
		record.Set("working_across_differences", rec.workingAcrossDifferences)

		// Personal info
		record.Set("languages", rec.languages)
		record.Set("dietary_needs", rec.dietaryNeeds)
		record.Set("dietary_needs_other", rec.dietaryOther)
		record.Set("over_21", rec.over21)

		// Reference
		record.Set("ref_1_name", rec.ref1Name)
		record.Set("ref_1_phone", rec.ref1Phone)
		record.Set("ref_1_email", rec.ref1Email)
		record.Set("ref_1_relationship", rec.ref1Relationship)
		record.Set("ref_1_years", rec.ref1Years)

		// Reflection prompts
		record.Set("stress_situation", rec.stressSituation)
		record.Set("stress_response", rec.stressResponse)
		record.Set("spiritual_moment", rec.spiritualMoment)
		record.Set("activity_program", rec.activityProgram)
		record.Set("someone_admire", rec.someoneAdmire)
		record.Set("since_camp", rec.sinceCamp)
		record.Set("wish_knew", rec.wishKnew)
		record.Set("last_summer_learned", rec.lastSummerLearned)
		record.Set("favorite_camper_moment", rec.favoriteCamperMoment)
		record.Set("closest_friend", rec.closestFriend)
		record.Set("tawonga_makes_think", rec.tawongaMakesThink)
		record.Set("advice_would_give", rec.adviceWouldGive)
		record.Set("how_look_at_camp", rec.howLookAtCamp)

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving staff_applications record",
				"person_id", rec.personID,
				"year", rec.year,
				"error", err,
			)
			errCount++
			continue
		}

		if exists {
			updated++
		} else {
			created++
		}
	}

	return created, updated, errCount
}

// deleteOrphans removes records that exist in DB but not in computed set.
//
// Refuses when the computed set is too small to be believed against the rows on
// disk: that combination is always a broken input, and sweeping on it deletes
// the year and reports success (kindred#2279 Gap 2). The rule itself lives in
// OrphanSweepGuard -- this was one of two hand-written copies, and it now shares
// the one implementation, which also widened it from "empty" to "suspiciously
// small" (kindred#2279 Gap 1).
//
// This service shares staff_vehicle_info's loadPersonStaffMapping(ctx, year)
// gate exactly, so it has the identical year-wipe path and the same two
// upstream causes: a collapsed personToStaff mapping (values fail the staff
// gate), or a collapsed fieldNameMap after an upstream rename of the App-*
// definitions (values route nowhere).
func (s *StaffApplicationsSync) deleteOrphans(
	ctx context.Context,
	records map[string]*staffApplicationRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	guard := OrphanSweepGuard{
		Entity:   "staff_applications",
		Year:     year,
		Computed: len(records),
		Hint:     "check the staff table for that year, and that the App-* field definitions still exist upstream",
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
			record, err := s.App.FindRecordById("staff_applications", recordID)
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
func (s *StaffApplicationsSync) forceWALCheckpoint() error {
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
