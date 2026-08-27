package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameFamilyCampDerived is the canonical name for this sync service
const serviceNameFamilyCampDerived = "family_camp_derived"

// familyCampSweepHint points an operator at the upstream behind all three
// computed sets. Unlike the CampMinder-backed services, nothing here is fetched
// from the vendor: every one of these tables is derived from custom values
// already in PocketBase, so a collapse means the custom-value sync or the
// field-definition map is what came back short, not the API.
const familyCampSweepHint = "check that person_custom_values, household_custom_values and " +
	"custom_field_defs hold this season's family-camp rows -- these tables are derived " +
	"from PocketBase, not fetched from CampMinder"

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

	// DryRunDiff holds the last DryRun pass's verdict, keyed by collection name.
	// It is populated only by a dry run and reset at the top of every Sync, so a
	// writing run never leaves a stale diff behind for a caller to misread.
	DryRunDiff map[string]DryRunDiff
}

// DryRunDiff is one table's answer to "what would a real run do here", produced
// without doing any of it.
//
// Why WouldDelete and GuardWouldRefuse are separate fields: a replay's danger is
// concentrated in its deletions, and counting them is only half the answer. The
// orphan sweep may REFUSE the whole thing (see OrphanSweepGuard), in which case
// those rows survive and the run fails instead -- an operationally different
// outcome from the same number of deletions actually happening.
type DryRunDiff struct {
	// WouldCreate counts computed rows with nothing stored under their key.
	WouldCreate int
	// WouldUpdate counts computed rows whose stored row differs, judged by the
	// SAME needsUpdate comparison the writing path uses -- not a second opinion
	// that could drift from it.
	WouldUpdate int
	// Unchanged counts rows a real run would leave exactly as they are. It is
	// the denominator that makes the other three readable: "40 updates" means
	// something different against 45 rows than against 4,500.
	Unchanged int
	// WouldDelete counts stored rows this run's computed set does not account
	// for -- what the orphan sweep would TARGET. A row protected by kindred#2335
	// (see Protected) is excluded from this count: the real sweep never targets
	// it either, and a forecast that counted it anyway would tell an operator a
	// replay destroys data it will not actually touch.
	WouldDelete int
	// Protected counts stored rows this run's computed set does not account for
	// but that the sweep will not delete anyway, because they are wholly
	// nameless (name, first_name, last_name all empty) yet carry another
	// attribute -- date_of_birth, email, gender, pronouns or
	// relationship_to_camper (kindred#2335). Only family_camp_adults has these
	// columns, so this is always 0 for family_camp_registrations and
	// family_camp_medical.
	Protected int
	// GuardWouldRefuse reports that the sweep would be refused rather than
	// performed, so WouldDelete describes an intention, not an outcome.
	GuardWouldRefuse bool
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

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *FamilyCampDerivedSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
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

	// enrollmentStatus is the household's family-camp enrollment verdict for
	// the year (kindred#2305). A household-year attribute, so every adult slot
	// in one household carries the same value -- see loadHouseholdEnrollmentStatus.
	enrollmentStatus string

	// conflicts holds the answers this merge DISCARDED, keyed by the
	// family_camp_adults column they were destined for. It is written to the
	// additive `attribute_conflicts` JSON column and nothing else: the merge
	// policy is unchanged (kindred#2275, owner ruling 2026-08-17 -- Option B,
	// a conflict flag, NOT the camper re-grain).
	//
	// WHY A SLOT CAN HOLD TWO ANSWERS AT ALL, because getting this wrong sends
	// the next reader back toward the declined re-grain: it is NOT two children
	// reporting on their parents. CampMinder asks the family-camp questions on
	// a per-CAMPER form covering all of a household's summer and family
	// sessions, so one parent fills the same family-camp section once per
	// child, on a form where that section should have been skipped after the
	// first. A divergence is therefore one person being less careful the second
	// time -- a data-entry artifact of form design, not evidence that the row
	// is keyed at the wrong grain.
	conflicts map[string][]string
}

// noteConflict records other as an answer this adult slot received and the
// merge discarded, for the given family_camp_adults column. Duplicates are
// dropped: three campers on one form who typed the same losing answer twice
// are one conflicting answer, not two.
func (a *adultData) noteConflict(column, other string) {
	if other == "" {
		return
	}
	if a.conflicts == nil {
		a.conflicts = make(map[string][]string, 1)
	}
	if slices.Contains(a.conflicts[column], other) {
		return
	}
	a.conflicts[column] = append(a.conflicts[column], other)
}

// mergeFirstNonEmpty applies the UNCHANGED first-non-empty-wins rule for one
// attribute and records the residual conflict when a later answer disagrees
// with the one already held. It returns the value to store, which is always
// what the pre-kindred#2275 code would have stored.
//
// candidate must already be normalised (kindred#2405) where the column has a
// normaliser, so that two spellings of one answer never reach this comparison.
func (a *adultData) mergeFirstNonEmpty(column, current, candidate string) string {
	if candidate == "" || candidate == current {
		return current
	}
	if current == "" {
		return candidate
	}
	if !sameAnswer(current, candidate) {
		a.noteConflict(column, candidate)
	}
	return current
}

// sameAnswer reports whether two answers to one question differ only in
// SPELLING -- letter case, or how much whitespace the typist left.
//
// It gates what is RECORDED, never what is stored: every return value in
// mergeFirstNonEmpty and every assignment in the email arm is byte-identical
// with or without this check, so the first-non-empty and preferEmail merges
// are untouched. It exists because the free-text columns have no
// kindred#2405 normaliser and a badge that fires on `Amy Johnson` vs
// `amy johnson` is a badge staff learn to ignore. Measured by replaying
// processAdults over data-prod.db, all years: 232 recorded losers and 189 of
// 1,429 lit slots -- 32 of 2026's 124 -- differed from the winner in nothing
// but case.
//
// Deliberately narrow. It folds case and collapses whitespace runs; it does
// NOT strip punctuation, reorder tokens, or fold nicknames. `Amy Johnson` vs
// `Amy R Johnson` is still two answers, because it is.
func sameAnswer(a, b string) bool {
	return strings.EqualFold(
		strings.Join(strings.Fields(a), " "),
		strings.Join(strings.Fields(b), " "),
	)
}

// conflictsJSON renders the discarded answers in the canonical form stored in
// the attribute_conflicts column -- `{"column":["other value",...]}` -- or ""
// when the slot's answers all agreed.
//
// Both the keys (encoding/json sorts map keys) and the values are sorted, so
// the rendering does not depend on map iteration order or on the record id
// order the values happened to load in. The sync compares before it writes;
// an unstable rendering would rewrite every conflicted row on every run.
func (a *adultData) conflictsJSON() string {
	if len(a.conflicts) == 0 {
		return ""
	}
	sorted := make(map[string][]string, len(a.conflicts))
	for column, others := range a.conflicts {
		values := slices.Clone(others)
		slices.Sort(values)
		sorted[column] = values
	}
	encoded, err := json.Marshal(sorted)
	if err != nil {
		// Unreachable: the map holds only strings and string slices.
		slog.Error("Error encoding adult attribute conflicts", "household", a.householdPBID, "error", err)
		return ""
	}
	return string(encoded)
}

// storedAttributeConflicts reads a family_camp_adults row's attribute_conflicts
// column back in the same canonical form conflictsJSON produces, so the two
// are directly comparable.
//
// A PocketBase json column is a types.JSONRaw ([]byte), not a map, and an
// unset one renders as the literal string "null" rather than "". Every empty
// shape PocketBase can hand back collapses to "" here; anything else is
// returned verbatim, because conflictsJSON wrote it verbatim.
func storedAttributeConflicts(record *core.Record) string {
	if record == nil {
		return ""
	}
	raw := strings.TrimSpace(record.GetString(attributeConflictsColumn))
	switch raw {
	case "", "null", "{}", `""`:
		return ""
	}
	return raw
}

// setAttributeConflicts writes the canonical rendering onto a record, storing
// SQL NULL rather than an empty object when there is nothing to report.
func setAttributeConflicts(record *core.Record, adult *adultData) {
	if encoded := adult.conflictsJSON(); encoded != "" {
		record.Set(attributeConflictsColumn, encoded)
		return
	}
	record.Set(attributeConflictsColumn, nil)
}

// attributeConflictsColumn is the additive JSON column kindred#2275 Option B
// adds to family_camp_adults (migration 1500000160).
const attributeConflictsColumn = "attribute_conflicts"

// registrationData holds extracted registration information
type registrationData struct {
	householdPBID        string
	cabinAssignment      string
	shareCabinPreference string
	// Renamed from sharedCabinWith by Task 16's migration. It never held "who
	// they want to share with" -- it holds the pipe-delimited NEAR/WITH
	// multi-select verbatim. wantsNear / wantsWithNamed below are the parsed
	// form.
	sharedCabinModesRaw string
	arrivalETA          string
	specialOccasions    string
	goals               string
	notes               string
	needsAccommodation  bool

	// Household-grain request layer (spec 4). shareCabinPreference and
	// sharedCabinModesRaw above stay as the RAW profile values; these are the
	// normalised, deduplicated versions the board reads.
	shareCabinGate string
	wantsNear      bool
	// wantsWithNamed is the named-family tick ALONE (owner ruling 2026-08-22:
	// the checkbox ticks are stored as truly separate answers). It does NOT
	// imply wantsSimilarAges, nor the reverse -- see ParseSharedCabinModes.
	wantsWithNamed     bool
	wantsSimilarAges   bool
	requestText        string
	requestSourceField string
	requestLastUpdated time.Time

	// The RESOLVED share verdict the board places on, and its provenance.
	// shareCabinGate above is the registration answer only; the Family Camp
	// information form outranks it wherever both were answered, which is why
	// these are separate columns rather than a reinterpretation of the gate.
	// See DeriveShareEligibility.
	shareEligibility       string
	shareEligibilitySource string

	// Derived accessibility flags. Spec 5.3: the board shows a flag, never the
	// narrative -- that lives in family_camp_medical.
	needsPrivateBathroom     bool
	needsPower               bool
	accommodationIsMandatory bool
	// kindred#2224. Resolved from the accommodation NARRATIVE, not from a
	// question CampMinder asks: the gate is a bare Yes/No and the substance
	// lands in the explain twins. Only this boolean leaves the sync layer --
	// the sentence it came from stays in family_camp_medical, which is
	// admin-gated and absent from every export (lodging_medical_narrative_test.go).
	needsFridge bool

	// kindred#2438. The step-free twin of needsFridge, kept a SEPARATE
	// derivation rather than a wider keyword list on the same one because the
	// two answer different questions off the same sentence. See stepFreeKeywords.
	//
	// It routes the ACCOMMODATION narrative alone, exactly as needsFridge does.
	// It also read the bathroom narrative until the 2026-08-23 owner ruling
	// reversed that -- a household narrating only a bathroom need drew this
	// glyph AND needs_private_bathroom, two tooltips quoting one paragraph.
	needsStepFree bool

	// Housing-suitability signal rather than an accessibility need (kindred#1876).
	hasInfant bool

	// The household's family-camp enrollment verdict for the year
	// (kindred#2305). Registering is not attending.
	enrollmentStatus string
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
	// Medical narrative. Detailed medical disclosures about named individuals.
	// Never logged, never exported (see lodging_medical_narrative_test.go).
	//
	// The two below are the ones this plan added, but the never-log/never-export
	// contract covers EVERY text field on this struct -- cpapInfo, physicianInfo,
	// specialNeedsInfo, allergyInfo, dietaryInfo and additionalInfo carry the
	// same kind of sentence. lodging_medical_narrative_test.go's narrativeColumns is the full list
	// and the authority; this comment sits here only because it is where a
	// future editor adding a field will be looking.
	bathroomExplain      string
	accommodationExplain string

	// The household's family-camp enrollment verdict for the year
	// (kindred#2305). Not a narrative and not medical -- it is here because
	// this table is one of the three keyed on (household, year) and a reader
	// of any one of them needs the same answer.
	enrollmentStatus string

	// The household's answer to each gate question, split out of the narrative
	// columns above (kindred#2542). Three states: "yes", "no", and "" for a
	// question the household never reached -- see gateVerdict for why the third
	// is not optional. These are answers to medical questions and live on this
	// admin-gated table with the narrative, but they are STRUCTURED, not
	// narrative: lodging_medical_narrative_test.go keeps them in their own
	// gateColumns list rather than in narrativeColumns.
	allergyGate      string
	dietaryGate      string
	specialNeedsGate string
	physicianGate    string
	cpapGate         string
}

// Sync executes the family camp derived computation
func (s *FamilyCampDerivedSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.ProcessedAdultKeys = make(map[string]bool)
	s.ProcessedRegKeys = make(map[string]bool)
	s.ProcessedMedicalKeys = make(map[string]bool)
	s.DryRunDiff = nil

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

	// Step 4b: Resolve each household's family-camp enrollment for the year
	// (kindred#2305). Reads attendees and camp_sessions, and reuses the
	// person -> household mapping loaded in step 2 rather than building a
	// second one.
	enrollmentByHousehold, err := s.loadHouseholdEnrollmentStatus(ctx, year, personToHousehold)
	if err != nil {
		return fmt.Errorf("loading household enrollment status: %w", err)
	}
	slog.Info("Loaded household enrollment statuses", "count", len(enrollmentByHousehold))

	// Step 5: Process adults data
	adults := s.processAdults(householdValues, personValues)
	slog.Info("Processed adults", "count", len(adults))

	// Step 6: Process registrations data
	registrations := s.processRegistrations(householdValues, personValues)
	slog.Info("Processed registrations", "count", len(registrations))

	// Step 7: Process medical data
	medical := s.processMedical(personValues)
	slog.Info("Processed medical", "count", len(medical))

	// Step 7b: Stamp the enrollment verdict onto EVERY computed row, on all
	// three tables. Applied here rather than inside the three process* helpers
	// so there is one rule and one place it is read from -- and so a row that
	// already exists is rewritten rather than left at the column default. An
	// untouched row keeping "" is exactly the "could not determine" case a
	// non-nullable derived column exists to prevent.
	for _, adult := range adults {
		adult.enrollmentStatus = enrollmentStatusForHousehold(enrollmentByHousehold, adult.householdPBID)
	}
	for _, reg := range registrations {
		reg.enrollmentStatus = enrollmentStatusForHousehold(enrollmentByHousehold, reg.householdPBID)
	}
	for _, med := range medical {
		med.enrollmentStatus = enrollmentStatusForHousehold(enrollmentByHousehold, med.householdPBID)
	}

	// Step 8: Preload existing records for upsert.
	//
	// A dry run reaches this too, and that is the whole point of where it
	// returns. It used to return above, having seen only the computed set, and
	// so reported len(adults)+len(registrations)+len(medical) as "created" --
	// counts, not a diff. That made a replay unmeasurable before it was done,
	// which is what turned "should we replay 2017-2025" into an unanswerable
	// question rather than merely an open one. The preloads are reads.
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

	if s.DryRun {
		s.reportDryRun(year, adults, registrations, medical,
			existingAdults, existingRegs, existingMedical)
		s.SyncSuccessful = true
		return nil
	}

	// Step 9: Upsert adults. The error COUNT is deliberately not named `errors`
	// -- the orphan sweeps below join real error values, and a local of that
	// name would shadow the stdlib package.
	created, updated, skipped, errCount := s.upsertAdults(ctx, adults, year, existingAdults)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errCount

	// Step 10: Upsert registrations
	created, updated, skipped, errCount = s.upsertRegistrations(ctx, registrations, year, existingRegs)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errCount

	// Step 11: Upsert medical
	created, updated, skipped, errCount = s.upsertMedical(ctx, medical, year, existingMedical)
	s.Stats.Created += created
	s.Stats.Updated += updated
	s.Stats.Skipped += skipped
	s.Stats.Errors += errCount

	// Mark sync as successful before orphan deletion
	s.SyncSuccessful = true

	// Step 12: Delete orphaned records (no longer in source data).
	//
	// A RUN CANCELLED BEFORE STEP 12 SWEEPS NOTHING, and this check is what
	// makes that true. The claim is deliberately no stronger than that: none of
	// the three sweeps below takes a context, so a cancellation landing partway
	// THROUGH Step 12 is a separate case, handled by the re-checks between the
	// sweep calls rather than here.
	//
	// The three upsert loops above break on ctx.Done() and return their partial
	// counts with no error -- unlike staff_skills.go, whose loop returns
	// ctx.Err() up so its sweep is never reached. So an interruption arrives
	// here looking exactly like a collapsed upstream, and the guard alone
	// handles neither half of that well:
	//
	//   - Below OrphanSweepMinRows the ratio arm is silent, so the guard does
	//     not refuse and the sweep deletes every row the run never got to. A
	//     year holding three family_camp_adults rows loses all three to a
	//     cancellation that fired after the first write.
	//   - Above it the guard does refuse, but reports "refused ... check that
	//     person_custom_values ... hold this season's rows" -- sending an
	//     operator after a feed that was never the problem. Keeping those two
	//     facts apart is the whole job of wrapOrphanSweepError.
	//
	// Reported through the same wrapper rather than returned bare, so an
	// interrupted run still says which phase it stopped in.
	var sweepErr error
	if ctxErr := ctx.Err(); ctxErr != nil {
		sweepErr = ctxErr
	} else {
		// All three sweeps run even when an earlier one refuses: they guard
		// three independent tables, and a collapsed adults computation says
		// nothing about whether the medical computation is trustworthy. The
		// refusals are joined and returned together so an operator sees every
		// table that stopped, not just the first.
		//
		// Cancellation is the one thing that DOES stop the sequence early, and
		// it is re-checked between tables because the sweeps take no context of
		// their own. Without these checks a cancellation landing on the adults
		// sweep still ran registrations and medical to completion and then
		// reported a clean run.
		//
		// What is already swept stands, and that is correct rather than merely
		// convenient: the check above passed, so no upsert loop broke early, so
		// the computed set is complete and every row deleted was a genuine
		// orphan an uninterrupted run would also have deleted. The defect being
		// fixed is that the run kept working after it was told to stop and then
		// did not say so -- which is why this re-checks here instead of
		// propagating ctx.Err() out of the three upserts.
		var adultsErr, regsErr, medicalErr, ctxErr error
		var deleted int

		deleted, adultsErr = s.deleteOrphanedAdults(existingAdults, year)
		s.Stats.Deleted += deleted

		if ctxErr = ctx.Err(); ctxErr == nil {
			deleted, regsErr = s.deleteOrphanedRegistrations(existingRegs, year)
			s.Stats.Deleted += deleted
			ctxErr = ctx.Err()
		}

		if ctxErr == nil {
			deleted, medicalErr = s.deleteOrphanedMedical(existingMedical, year)
			s.Stats.Deleted += deleted
			ctxErr = ctx.Err()
		}

		// Joined alongside the refusals, so an interrupted run that also hit a
		// refusal reports both -- and so the cancellation reaches
		// wrapOrphanSweepError, which is what keeps "interrupted" from being
		// reported as "refused".
		sweepErr = errors.Join(adultsErr, regsErr, medicalErr, ctxErr)
	}

	// WAL checkpoint BEFORE the refusal return below: the upsert steps above
	// have already written by this point, and a guard refusal can fire on a
	// non-empty computed set (a PARTIAL collapse), which is precisely the case
	// where writes already happened. Same ordering as staff_skills.go.
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	if sweepErr != nil {
		return wrapOrphanSweepError(sweepErr)
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

	// Registered request fields resolve to the registry's canonical name rather
	// than the one CampMinder currently reports, so a rename cannot disconnect
	// an answer from the switch arm that routes it. Built from the same slice
	// LodgingRequestFieldNames exposes; done inline here to avoid a second pass
	// over custom_field_defs we have already loaded.
	canonical := make(map[int]string, len(lodgingRequestFields))
	for _, f := range lodgingRequestFields {
		canonical[f.CMID] = f.Name
	}

	for _, record := range records {
		cmID := record.GetInt("cm_id")
		if registered, ok := canonical[cmID]; ok {
			result[record.Id] = registered
			continue
		}
		name := normalizeFieldName(record.GetString("name"))
		if isFamilyCampField(name) || extraFieldCMIDs[cmID] {
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
// map. Routing is handled separately, and for the fields that carry a request or
// a housing flag it now goes through lodgingRequestFields, which resolves the
// canonical display name from the cm_id — so a rename survives admission AND
// routing. What is left here is the residue: fields admitted by id whose routing
// is either by name heuristic or, for the two medical narratives, by a name-keyed
// lookup in processMedical.
//
// The entries duplicated in lodgingRequestFields are kept rather than deleted:
// admission runs first, and leaving a field's admission dependent on the routing
// registry would couple two things that fail differently.
var extraFieldCMIDs = map[int]bool{
	274057: true, // Housing Accommodation        (Camper) — successor to FAM Camp-Accommodation
	274055: true, // Housing Accomodation  (sic)  (Adult)
	274058: true, // Housing Accommodation-Yes    (Camper) — medical narrative, spec 5
	274059: true, // Housing-Bathroom             (Camper) — medical narrative, spec 5
	224987: true, // Accommodation-Explain        (Adult)  — medical narrative, spec 5; twin of 274058, kindred#2224
	274053: true, // Adult-Bathroom               (Adult)
	274054: true, // Bathroom-Yes                 (Adult)  — medical narrative, spec 5
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

		records, err := s.App.FindRecordsByFilter("persons", filter, sortByID, perPage, (page-1)*perPage)
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

// loadPersonCampMinderIDs builds a map of person PB ID -> CampMinder person
// id, for the durable merge tiebreak kindred#2275 needs -- see
// customValueEntry.personCMID's doc comment for why a PocketBase record id is
// not safe to sort by.
//
// A second paged query over the same "persons" collection
// loadPersonHouseholdMapping already reads. Kept separate rather than folded
// into that function's return value because loadPersonHouseholdMapping is
// called directly, with its current two-value signature, from test files
// outside this one's scope (kindred#2275 touches only family_camp_derived.go
// and its test file) -- widening it would be a breaking change this issue is
// not chartered to make.
func (s *FamilyCampDerivedSync) loadPersonCampMinderIDs(ctx context.Context, year int) (map[string]int, error) {
	result := make(map[string]int)

	filter := fmt.Sprintf("year = %d && household != ''", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("persons", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			result[record.Id] = record.GetInt("cm_id")
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
	// personPBID is WHO answered: the PocketBase id of the person the value
	// hangs off, or "" for a household-partition value that has no answering
	// person (kindred#2257 step 0).
	//
	// The load used to discard it, and that is the root architectural cause of
	// every first-wins collapse in this file: a transform that cannot see who
	// answered cannot keep a gate bound to the explanation the SAME person
	// wrote, which is the design rule in
	// docs/reference/family-camp-field-provenance.md section 4. processRegistrations
	// is the first consumer -- it groups the special-occasion pair by person --
	// and the remaining sites (kindred#2255, kindred#2275) need it next.
	//
	// Nothing may treat "" as an identity: several household values sharing the
	// empty string are not one person, they are no person.
	personPBID string
	// personCMID is the answering person's CampMinder id -- kindred#2275's
	// stable tiebreak for the first-non-empty-wins merges in processAdults.
	//
	// The PocketBase record id loadPersonCustomValues used to order by (and
	// still orders its own paged query by, for the unrelated reason
	// documented there) is arbitrary but NOT durable: the vendor sync's
	// orphan sweep deletes and later re-admits a person_custom_values row
	// with a brand-new random id, so the same two siblings' answers could
	// pick a different merge winner on a later resync with no data change at
	// all. A person's own CampMinder id survives every resync, so
	// processAdults sorts by this field before merging instead. Owner ruling
	// 2026-08-19: "whatever sort we choose, must be repeatable, not random."
	//
	// Zero (unpopulated) for a household-partition entry, which has no
	// answering person to begin with -- see personPBID's comment.
	personCMID int
	// lastUpdated is CampMinder's own edit timestamp for this value. Spec 4.1
	// resolves a form-vs-registration conflict by comparing these, not by field
	// name precedence, so it has to survive the load.
	lastUpdated time.Time
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

		// Sorted by id: offset paging without an ORDER BY lets SQLite return
		// rows in an unspecified order, so a row can be skipped or seen twice
		// across pages. Spec 4.1 now resolves gate precedence by comparing the
		// registration answer against the form answer, and a skipped page means
		// one of the two never arrives -- so the gate silently takes whichever
		// value did. Same fix as lodging_session_attribution.go's paged read.
		records, err := s.App.FindRecordsByFilter("household_custom_values", filter, "id", perPage, (page-1)*perPage)
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
				parsed, _ := ParseCampMinderTimestamp(record.GetString("last_updated"))
				result = append(result, customValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
					lastUpdated:   parsed,
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
	personCMID, err := s.loadPersonCampMinderIDs(ctx, year)
	if err != nil {
		return nil, fmt.Errorf("loading person CampMinder ids: %w", err)
	}

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

		// Sorted by id so paging is safe (no ORDER BY would let SQLite skip or
		// repeat a row across pages -- same reasoning as
		// loadHouseholdCustomValues). This is NOT the order processAdults'
		// merge uses any more: see customValueEntry.personCMID and its sort in
		// processAdults (kindred#2275).
		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, "id", perPage, (page-1)*perPage)
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
				parsed, _ := ParseCampMinderTimestamp(record.GetString("last_updated"))
				result = append(result, customValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
					personPBID:    personID,
					personCMID:    personCMID[personID],
					lastUpdated:   parsed,
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

// processAdults extracts adult data from custom values.
//
// `name`, from the household-partition `Family Camp Adult 1-5`, is the COLUMN
// OF RECORD for who is attending. Staff transpose the person-level FC-P1/P2
// fields into Adults 1-2 and `Family Camp-Additional Adults` into Adults 3-5,
// splitting the names themselves, so it is a curated list rather than a
// household contact roster. The split columns below are a best-effort extra
// that only ever populates for adults 1-2: first_name/last_name are empty for
// 100% of adult_number 3-5 rows in every measured year, and CampMinder itself
// stopped filling `Family Camp-P1/P2 Last Name` (cm_id 216785/216786) after
// 2022, so `last_name` holds 0 of 834 rows in 2026.
//
// TWO CONSEQUENCES, both of which have already caught someone (kindred#1945):
//
//   - `first_name` is a MISLABELED FULL NAME. 773 of 788 2026 values contain a
//     space -- parents type their whole name into a field CampMinder labels
//     "First Name". Nothing may treat it as a given name.
//   - NEVER conclude a row is empty from the split columns. 196 real adults
//     across 2022-2026 are blank in first_name/last_name and populated in
//     `name`; a "delete the blank rows" cleanup written from that misreading
//     would have erased every one of them.
//
// The person-partition loop below merges with "first non-empty wins" over a
// slice sorted by the answering person's CampMinder id (kindred#2275, owner
// ruling 2026-08-19 -- see customValueEntry.personCMID), NOT the
// person_custom_values record-id order loadPersonCustomValues' own paged
// query happens to return. Measured over the 382 rostered 2026 households:
// 254 (household, field, adult) groups have siblings that disagree, spread
// across 113 households.
//
// RESOLVED for email (owner ruling 2026-08-09, kindred#1945): when the
// siblings' emails differ and are both non-empty, preferEmail breaks the tie
// by well-formedness instead of the sibling ordering below -- see its doc
// comment. Email got a rule because the harm is concrete and the rule is
// crisp: 5 stored adult emails carry a domain typo in production, 4 of which
// have a correct version on a sibling form. When validity does not
// discriminate between the two (both well-formed, or both malformed),
// preferEmail falls back to whichever answer this sort put first -- the same
// CampMinder-id tiebreak as every other attribute, not a coin flip.
//
// RESOLVED for every other merged field (first/last name, pronouns, gender,
// date_of_birth, relationship_to_camper) -- owner ruling 2026-08-19,
// kindred#2275: first-non-empty-wins STANDS, UNCHANGED as a policy; only the
// order it runs over moved. The owner rejected both a recency rule ("none of
// these are stable if an older child is edited later?") and a completeness
// rule for the identical reason: either lets editing the LOSING sibling's
// answer flip the winner. Sorting by the answering person's CampMinder id is
// stable under exactly that edit, because the id identifying an existing
// person never changes -- unlike a PocketBase record id, which the vendor
// sync's orphan sweep can and does regenerate on a resync with no data
// change. This is NOT a validity notion like preferEmail's, and does not
// need to be one: the goal is REPEATABILITY, not picking the "better"
// answer. It is NOT coupled to whether the columns exist: kindred#1945
// closed 2026-08-09 refusing deletion ("No deletion of the gender /
// date_of_birth / email / pronouns columns -- the 2026-08-07 hold stands"),
// so column existence blocked nothing here either.
//
// NORMALISED, separately from the merge (kindred#2275 phase D, owner ruling
// 2026-08-16): date_of_birth and relationship_to_camper are rewritten into a
// canonical form BEFORE they are stored -- see normalizeDateOfBirth and
// normalizeRelationshipToCamper. This is not a merge policy and does not
// change which sibling wins; it removes the disagreements that were only ever
// two spellings of one answer. Measured against the production snapshot, all
// years: date_of_birth divergence falls from 1,124 (household, year, adult
// slot) groups to 541, and relationship_to_camper from 315 to 169. The 710
// that survive are real -- 360 different birth YEARS and 92 Mother-vs-Father
// slot collisions.
//
// RECORDED, also separately from the merge (kindred#2275 Option B, owner
// ruling 2026-08-17): what survives normalisation is written to the additive
// attribute_conflicts column instead of vanishing -- see adultData.conflicts
// and mergeFirstNonEmpty. Which answer wins is still first-non-empty -- now
// over the CampMinder-id order above, not load order -- for every attribute,
// and still preferEmail for email; the only change from #2421 is that the
// discarded answers are kept, keyed by column, so staff can see that a slot
// was answered twice. What is NOT kept is a discarded
// answer that differs from the winner only in case or whitespace -- see
// sameAnswer, which gates the recording and nothing else.
//
// THE GRAIN QUESTION IS CLOSED. A 2026-08-15 ruling to re-key this table to
// camper grain was REVERSED on 2026-08-17; the column above is what replaced
// it, on the reading recorded on adultData.conflicts -- two answers in one
// slot are one parent filling a per-camper form once per child, not two
// children disagreeing. Nothing here should be re-keyed on the strength of the
// residual; the grain triple (this write key, TrackProcessedCompositeKey,
// idx_fc_adults_unique) stays as it is.
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

	// Process person values for adult details. Sorted by the answering
	// person's CampMinder id (ascending) before merging, NOT the load order
	// loadPersonCustomValues returns them in -- kindred#2275. A local clone,
	// not an in-place sort: personValues is also read by processRegistrations
	// and processMedical in the same Sync() run, and neither of those needs
	// (or should silently inherit) this ordering.
	personValuesByCMID := slices.Clone(personValues)
	slices.SortStableFunc(personValuesByCMID, func(a, b customValueEntry) int {
		return a.personCMID - b.personCMID
	})
	for _, v := range personValuesByCMID {
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

		// First non-empty wins, unchanged, EXCEPT email: see preferEmail for
		// the kindred#1945 validity-preferring rule. What mergeFirstNonEmpty
		// adds (kindred#2275 Option B) is that the answers it discards are
		// RECORDED on adult.conflicts instead of vanishing -- see that field's
		// comment for why one adult slot receives two answers at all.
		switch {
		case strings.Contains(v.fieldName, "First Name"):
			adult.firstName = adult.mergeFirstNonEmpty("first_name", adult.firstName, v.value)
		case strings.Contains(v.fieldName, "Last Name"):
			adult.lastName = adult.mergeFirstNonEmpty("last_name", adult.lastName, v.value)
		case strings.Contains(v.fieldName, "Email"):
			if preferEmail(adult.email, v.value) {
				// The DISPLACED value is the conflict, not the candidate:
				// preferEmail has just ruled the candidate the better answer.
				// This branch needs the sameAnswer guard as much as the other
				// one does: a leading space fails emailFormatPattern, so
				// " amy@example.com" is displaced by "amy@example.com" and
				// would otherwise be recorded as conflicting with itself.
				if !sameAnswer(adult.email, v.value) {
					adult.noteConflict("email", adult.email)
				}
				adult.email = v.value
			} else if !sameAnswer(adult.email, v.value) {
				adult.noteConflict("email", v.value)
			}
		case strings.Contains(v.fieldName, "Pronouns"):
			adult.pronouns = adult.mergeFirstNonEmpty("pronouns", adult.pronouns, v.value)
		case strings.Contains(v.fieldName, "Gender"):
			adult.gender = adult.mergeFirstNonEmpty("gender", adult.gender, v.value)
		case strings.Contains(v.fieldName, "DOB"):
			// Normalised BEFORE the merge and before the comparison: see
			// normalizeDateOfBirth. Which sibling wins is the CampMinder-id
			// sort above (kindred#2275), not load order; what normalisation
			// buys is that two spellings of one birthday neither swap the
			// stored value nor raise a conflict. 583 of the 1,124 diverging
			// production groups are exactly that, and they must stay silent.
			adult.dateOfBirth = adult.mergeFirstNonEmpty(
				"date_of_birth", adult.dateOfBirth, normalizeDateOfBirth(v.value))
		case strings.Contains(v.fieldName, "Relationship"):
			adult.relationship = adult.mergeFirstNonEmpty(
				"relationship_to_camper", adult.relationship, normalizeRelationshipToCamper(v.value))
		}
	}

	// Dedupe rows that coalesce to the same adult (kindred#2483) BEFORE the
	// admission filter below, so a merged slot's survivor is judged for
	// admission exactly like any other adult.
	for _, adults := range adultMap {
		dedupeAdultSlots(adults)
	}

	// Convert map to slice, only include adults with a real name somewhere.
	// kindred#1946: the email/gender arms this filter used to carry let 194
	// wholly nameless rows into production -- an adult with only a gender
	// value (including a placeholder like "NA") or only an email is not a
	// person on its own. A `name` with blank first_name/last_name is the
	// opposite case and must still be admitted; see the doc comment above.
	var result []*adultData
	for _, adults := range adultMap {
		for _, adult := range adults {
			if adult.name != "" || adult.firstName != "" || adult.lastName != "" {
				result = append(result, adult)
			}
		}
	}

	return result
}

// coalescedAdultName reproduces the API's `_adult_display_name` coalesce
// (`api/services/lodging_roster_service.py`) so the dedupe key groups the
// same way the read path does: `name` (the household column of record) if
// set, otherwise the split first/last columns joined and trimmed.
func coalescedAdultName(a *adultData) string {
	if a.name != "" {
		return a.name
	}
	return strings.TrimSpace(strings.TrimSpace(a.firstName) + " " + strings.TrimSpace(a.lastName))
}

// dedupeAdultSlots collapses adult slots within one household that coalesce
// to the same casefolded display name with a non-conflicting date of birth
// (kindred#2483 -- see the correction on the issue for why name alone is
// unsafe: it merges 27 groups of genuinely different people who share a
// name, sample DOB pairs include a child and an adult).
//
// "Non-conflicting" means the group's non-empty date_of_birth values are all
// equal, or at most one slot in the group carries a DOB at all. A plain
// equality key is not enough -- one of the two reported 2026 pairs has a
// blank DOB on one side, so it looks like a single non-empty DOB, not an
// equal pair. Any group with two or more DISTINCT non-empty DOBs is refused
// entirely, matching the issue's measurement (MERGE 15 / REFUSE 27 over all
// years; 2026 merges = exactly 2).
//
// Deleting a losing slot's map entry removes it from processAdults' result,
// which is also what marks its stored row (if any) unprocessed for this run
// -- the existing orphan sweep in deleteOrphanedAdults then deletes it, the
// same path kindred#2335 already uses for rows the computed set no longer
// accounts for. That is the intended outcome here: the duplicate slot is
// destroyed, not archived (owner ruling 2026-08-19 -- this trades away the
// raw-slot evidence deliberately).
//
// The survivor is the LOWEST adult_number in the group. adult_number is the
// one deterministic ordering available here (Go map iteration is not), and
// it mirrors "first-wins" -- Adult 1 is filled first on the form.
func dedupeAdultSlots(adults map[int]*adultData) {
	groups := make(map[string][]*adultData, len(adults))
	for _, adult := range adults {
		key := strings.ToLower(coalescedAdultName(adult))
		if key == "" {
			continue // nameless slots are not a duplicate of anything; left to the admission filter
		}
		groups[key] = append(groups[key], adult)
	}

	for _, group := range groups {
		if len(group) < 2 {
			continue
		}
		if adultGroupDOBConflicts(group) {
			continue // 27-groups-of-different-people case: leave every slot as its own adult
		}

		slices.SortFunc(group, func(a, b *adultData) int {
			return a.adultNumber - b.adultNumber
		})
		survivor := group[0]
		for _, loser := range group[1:] {
			mergeAdultSlot(survivor, loser)
			delete(adults, loser.adultNumber)
		}
	}
}

// adultGroupDOBConflicts reports whether a same-name group holds two or more
// DISTINCT non-empty date_of_birth values -- the signal that the group is
// actually different people who share a name, not one person duplicated
// across slots. date_of_birth is normalised (normalizeDateOfBirth) before it
// ever reaches processAdults' map, so a straight string comparison is a
// straight date comparison.
func adultGroupDOBConflicts(group []*adultData) bool {
	seen := ""
	for _, adult := range group {
		if adult.dateOfBirth == "" {
			continue
		}
		if seen == "" {
			seen = adult.dateOfBirth
			continue
		}
		if adult.dateOfBirth != seen {
			return true
		}
	}
	return false
}

// mergeAdultSlot folds loser's non-blank attributes onto survivor using the
// SAME per-field merge policy processAdults already applies when two
// siblings answer for one slot (kindred#2483 ruling: reuse mergeFirstNonEmpty
// rather than invent a second merge implementation). email keeps its
// existing preferEmail validity tie-break rather than plain first-wins, for
// the same reason the sibling-merge loop above does.
func mergeAdultSlot(survivor, loser *adultData) {
	survivor.name = survivor.mergeFirstNonEmpty("name", survivor.name, loser.name)
	survivor.firstName = survivor.mergeFirstNonEmpty("first_name", survivor.firstName, loser.firstName)
	survivor.lastName = survivor.mergeFirstNonEmpty("last_name", survivor.lastName, loser.lastName)
	survivor.pronouns = survivor.mergeFirstNonEmpty("pronouns", survivor.pronouns, loser.pronouns)
	survivor.gender = survivor.mergeFirstNonEmpty("gender", survivor.gender, loser.gender)
	survivor.dateOfBirth = survivor.mergeFirstNonEmpty("date_of_birth", survivor.dateOfBirth, loser.dateOfBirth)
	survivor.relationship = survivor.mergeFirstNonEmpty(
		"relationship_to_camper", survivor.relationship, loser.relationship)

	if loser.email != "" {
		if preferEmail(survivor.email, loser.email) {
			if !sameAnswer(survivor.email, loser.email) {
				survivor.noteConflict("email", survivor.email)
			}
			survivor.email = loser.email
		} else if !sameAnswer(survivor.email, loser.email) {
			survivor.noteConflict("email", loser.email)
		}
	}

	for column, others := range loser.conflicts {
		for _, other := range others {
			survivor.noteConflict(column, other)
		}
	}
}

// ---------------------------------------------------------------------------
// date_of_birth and relationship_to_camper normalisation (kindred#2275)
//
// These are FORMAT normalisers, not merge policy and not validators. The
// merge below is still first-non-empty-wins and the record grain is still
// (household, year, adult_number); both remain kindred#2275's open subject.
// What normalisation buys is that the column becomes COMPARABLE, so the
// residual disagreement between two siblings answering for the same adult is
// a real disagreement rather than two spellings of one answer.
// ---------------------------------------------------------------------------

// dobTwoDigitYearPivot is the century rule for a two-digit year, stated
// explicitly because the value is genuinely ambiguous: YY >= 30 means 19YY,
// YY < 30 means 20YY.
//
// The pivot is placed at 30 because it lands in a gap that is empty in the
// production snapshot. The two-digit years actually stored in the family camp
// DOB fields are 01-24 (52 answers -- children's birthdays typed into an adult
// field) and 43-99 (2,188 answers -- the adults). Nothing occupies 25-42, so
// no value present today can be misclassified by this choice.
const dobTwoDigitYearPivot = 30

// The accepted input shapes for normalizeDateOfBirth. Every one of them
// occurs in the production snapshot; the whole point of the list is that a
// parser accepting only the most common shape (M/D/YYYY, 10,418 of 13,823
// answers) reports the other 3,243 readable ones as junk, which is exactly how
// kindred#2275
// was mis-measured twice before.
var (
	// M/D/YY(YY) with any of / - . or space as the separator, and tolerant of
	// the two separators differing (`05-02/1972` occurs).
	dobNumericPattern = regexp.MustCompile(`^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$`)
	// YYYY-M-D, already canonical or nearly so.
	dobISOPattern = regexp.MustCompile(`^(\d{4})-(\d{1,2})-(\d{1,2})$`)
	// MMDDYYYY and MMDDYY, typed with the separators left out.
	dobDigits8Pattern = regexp.MustCompile(`^(\d{2})(\d{2})(\d{4})$`)
	dobDigits6Pattern = regexp.MustCompile(`^(\d{2})(\d{2})(\d{2})$`)
	// `October 28, 1981`, `Oct 6, 1981`, `Nov. 1 1966`.
	dobMonthNamePattern = regexp.MustCompile(`^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$`)
	// `28 Nov 1967`, `9-Oct-1974`.
	dobDayMonthNamePattern = regexp.MustCompile(`^(\d{1,2})(?:st|nd|rd|th)?[ \-]([A-Za-z]{3,9})\.?[ \-,]+(\d{4})$`)
)

// dobMonthNames maps the long and abbreviated English month names, lowercased,
// to their number. `sept` is included because parents type it.
var dobMonthNames = map[string]int{
	"january": 1, "jan": 1,
	"february": 2, "feb": 2,
	"march": 3, "mar": 3,
	"april": 4, "apr": 4,
	"may":  5,
	"june": 6, "jun": 6,
	"july": 7, "jul": 7,
	"august": 8, "aug": 8,
	"september": 9, "sept": 9, "sep": 9,
	"october": 10, "oct": 10,
	"november": 11, "nov": 11,
	"december": 12, "dec": 12,
}

// normalizeDateOfBirth rewrites a free-text CampMinder date answer into the
// single canonical form YYYY-MM-DD.
//
// It NORMALISES, it does not discard: a value it cannot read comes back
// unchanged, never blanked. 162 of the 13,823 stored family camp DOB answers
// (1.2%) land there -- `11/13`, `6274`, `1974`, `None`, `na` -- and each is a
// real answer a staff member typed, so a "cleanup" that emptied them would be
// data loss. Nor does it judge plausibility: a mistyped year (2986, 9171) is a
// well-formed date and is rewritten like any other, because rejecting it would
// put it straight back in the junk bucket the earlier measurements inflated.
//
// It is idempotent, which the sync's compare-before-write depends on: a
// normaliser whose output re-normalised differently would rewrite every
// family_camp_adults row on every run.
func normalizeDateOfBirth(raw string) string {
	trimmed := strings.Join(strings.Fields(raw), " ")
	if trimmed == "" {
		return ""
	}

	if m := dobISOPattern.FindStringSubmatch(trimmed); m != nil {
		if out, ok := canonicalDate(atoiOrZero(m[1]), atoiOrZero(m[2]), atoiOrZero(m[3])); ok {
			return out
		}
	}
	if m := dobNumericPattern.FindStringSubmatch(trimmed); m != nil {
		if out, ok := canonicalDate(expandTwoDigitYear(m[3]), atoiOrZero(m[1]), atoiOrZero(m[2])); ok {
			return out
		}
	}
	if m := dobDigits8Pattern.FindStringSubmatch(trimmed); m != nil {
		if out, ok := canonicalDate(atoiOrZero(m[3]), atoiOrZero(m[1]), atoiOrZero(m[2])); ok {
			return out
		}
	}
	if m := dobDigits6Pattern.FindStringSubmatch(trimmed); m != nil {
		if out, ok := canonicalDate(expandTwoDigitYear(m[3]), atoiOrZero(m[1]), atoiOrZero(m[2])); ok {
			return out
		}
	}
	if m := dobMonthNamePattern.FindStringSubmatch(trimmed); m != nil {
		if month, ok := dobMonthNames[strings.ToLower(m[1])]; ok {
			if out, ok := canonicalDate(atoiOrZero(m[3]), month, atoiOrZero(m[2])); ok {
				return out
			}
		}
	}
	if m := dobDayMonthNamePattern.FindStringSubmatch(trimmed); m != nil {
		if month, ok := dobMonthNames[strings.ToLower(m[2])]; ok {
			if out, ok := canonicalDate(atoiOrZero(m[3]), month, atoiOrZero(m[1])); ok {
				return out
			}
		}
	}

	return raw
}

// expandTwoDigitYear applies dobTwoDigitYearPivot. A year already written with
// three or more digits is returned as-is.
func expandTwoDigitYear(year string) int {
	y := atoiOrZero(year)
	if len(year) > 2 {
		return y
	}
	if y >= dobTwoDigitYearPivot {
		return 1900 + y
	}
	return 2000 + y
}

// canonicalDate renders YYYY-MM-DD, reporting false when the parts are not a
// real calendar date (February 30, month 13). time.Date silently rolls those
// over, so the round-trip check is what actually rejects them.
func canonicalDate(year, month, day int) (string, bool) {
	if year <= 0 || month <= 0 || day <= 0 {
		return "", false
	}
	t := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if t.Year() != year || int(t.Month()) != month || t.Day() != day {
		return "", false
	}
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day), true
}

// atoiOrZero converts a regex-captured digit run. The patterns guarantee the
// input is digits, so the error case is unreachable and is folded to 0, which
// canonicalDate then rejects.
func atoiOrZero(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

// relationshipSynonyms folds the only two synonym pairs the vocabulary
// supports. Mother and Father are deliberately NOT folded into each other:
// 92 of the groups that still disagree after normalisation are exactly that
// pair, and they are two children naming two DIFFERENT PEOPLE into one adult
// slot -- the signal kindred#2275 exists to measure.
//
// The lookup is exact-match on the whole value, never a substring, which is
// what keeps the small step-parent population (~21 answers: `Step Father`,
// `step mother`, `Stepmom`, `Dad/Stepdad`) out of it.
var relationshipSynonyms = map[string]string{
	"mom":    "Mother",
	"mother": "Mother",
	"dad":    "Father",
	"father": "Father",
}

// normalizeRelationshipToCamper folds case and the two synonym pairs on a
// relationship answer, and leaves everything else exactly as the parent typed
// it.
//
// Case folding applies only to a SINGLE all-letters token, so `mother` becomes
// `Mother` and `spouse` becomes `Spouse`, while free text (`mother of Emma and
// Liam`) and punctuated answers (`N/A`, `Dad/Stepdad`) keep their own
// capitalisation. Re-casing free text would buy 2 more collapsed groups out of
// 315 and rewrite 100 more stored values, which is not a trade worth making.
func normalizeRelationshipToCamper(raw string) string {
	trimmed := strings.Join(strings.Fields(raw), " ")
	if trimmed == "" {
		return ""
	}

	if canonical, ok := relationshipSynonyms[strings.ToLower(trimmed)]; ok {
		return canonical
	}

	if !isSingleAlphabeticToken(trimmed) {
		return trimmed
	}

	runes := []rune(trimmed)
	return string(unicode.ToUpper(runes[0])) + strings.ToLower(string(runes[1:]))
}

// isSingleAlphabeticToken reports whether s is one word made only of letters.
func isSingleAlphabeticToken(s string) bool {
	for _, r := range s {
		if !unicode.IsLetter(r) {
			return false
		}
	}
	return s != ""
}

// emailFormatPattern is a narrow, defensible notion of "well-formed enough
// to prefer in a merge tie" -- local@domain.tld, no embedded whitespace or
// commas (the two junk shapes measured in the 2026 snapshot), and at least
// one dot in the domain. It is NOT full RFC 5322 validation and it is not
// used to reject input anywhere; it exists solely to break a tie between two
// sibling forms' answers for the same adult (kindred#1945).
var emailFormatPattern = regexp.MustCompile(`^[^\s@,]+@[^\s@,]+\.[^\s@,]+$`)

// isWellFormedEmail reports whether value looks like a syntactically valid
// email address per emailFormatPattern.
func isWellFormedEmail(value string) bool {
	return emailFormatPattern.MatchString(value)
}

// preferEmail decides whether candidate should replace current in the
// per-adult email merge (kindred#1945). Gap-fill is unchanged: an empty
// current always loses to any non-empty candidate. When both are non-empty
// and differ, well-formed beats malformed; when validity does not
// discriminate between them (both well-formed, or both malformed), the
// pre-existing first-loaded-sibling tie-break stands -- candidate does not
// replace current.
func preferEmail(current, candidate string) bool {
	if current == "" {
		return true
	}
	if candidate == "" || candidate == current {
		return false
	}
	return isWellFormedEmail(candidate) && !isWellFormedEmail(current)
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

	// Free-text answers are COLLECTED rather than assigned (kindred#2274). Six
	// columns used to keep whichever member answered first and drop the rest;
	// they now dedup and join, in family_camp_registration_text.go. The
	// accumulators live beside regMap rather than on registrationData because
	// that struct is the row to be written, not the working state.
	textByHousehold := make(map[string]*registrationText)
	textFor := func(householdPBID string) *registrationText {
		if txt, ok := textByHousehold[householdPBID]; ok {
			return txt
		}
		txt := &registrationText{}
		textByHousehold[householdPBID] = txt
		return txt
	}

	// Process person values for registration details
	for _, v := range personValues {
		if regMap[v.householdPBID] == nil {
			regMap[v.householdPBID] = &registrationData{
				householdPBID: v.householdPBID,
			}
		}

		reg := regMap[v.householdPBID]

		// Free-text fields dedup and join; see registrationText. The RAW share
		// columns are collected the same way as the rest and are NOT the
		// board's resolved verdict -- share_cabin_gate / share_eligibility are,
		// and CollapseToHouseholdGrain still resolves those by recency in
		// applyHouseholdRequests below. Joining the raw profile values cannot
		// disturb that: nothing reads these two columns except as provenance
		// (api/services/lodging_repository.py:584 says so explicitly).
		switch v.fieldName {
		case fieldShareCabinsRegistration:
			textFor(v.householdPBID).shareCabinPreference.add(v.value)
		case fieldSharedCabinForm:
			textFor(v.householdPBID).sharedCabinModesRaw.add(v.value)
		case "Family Camp-Trans ETA":
			textFor(v.householdPBID).arrivalETA.add(v.value)
		// The special-occasion gate and the sentence explaining it are ONE
		// question in two fields, so they are accumulated per answering person
		// and collapsed as a pair (kindred#2276, and the design rule in
		// docs/reference/family-camp-field-provenance.md section 4). The gate is a
		// bare Yes/No -- 3,665 No against 344 Yes lifetime -- so before this the
		// column stored "Yes" and discarded what the occasion actually was.
		case "Family Camp-Special occasions":
			textFor(v.householdPBID).occasionFor(v.personPBID).gate.add(v.value)
		case "Family Camp-describe special occasion":
			textFor(v.householdPBID).occasionFor(v.personPBID).describe.add(v.value)
		// Retired after 2024 (645 values that year, 0 since) and no successor
		// exists. Kept because spec 4.4 forbids auto-inferring retirement and
		// because this plan backfills 2024. The passive "0 values this year"
		// warning lives in lodging_field_mappings (migration 1500000122), which
		// UpsertFieldMappingStatus in lodging_fields.go populates.
		//
		// Its sibling Family Camp-Goals Other is NOT routed and must not be:
		// it died after 2018 (58 lifetime values), as did
		// Family Camp-Share Cabin With after 2024 (867). kindred#2276 lists all
		// three and only the occasion detail above is live.
		case "Family Camp-Goals Attending":
			textFor(v.householdPBID).goals.add(v.value)
		case "Family Camp-Anything else":
			textFor(v.householdPBID).notes.add(v.value)
		// Three generations of the same question. FAM Camp-Accommodation retired
		// after 2024 (5 values in 2025, 0 in 2026); Housing Accommodation is the
		// Camper successor and Housing Accomodation (one m) the Adult twin. Any
		// "yes" among them means the household needs an accommodation, so this
		// arm ORs rather than first-wins.
		case "FAM Camp-Accommodation", "Housing Accommodation", "Housing Accomodation":
			reg.needsAccommodation = reg.needsAccommodation || parseBoolFieldValue(v.value)
		case fieldFamCampOptOutVIP, fieldAdultOptOut:
			// ONE stored boolean for the VIP answer (owner ruling 2026-08-22):
			// accommodation_is_mandatory, its No pole -- "must have the
			// accommodation or they cancel". "Yes, please register regardless
			// of cabin type" carries no signal we store, and an UNANSWERED
			// question must stay soft, which is why this keys off a non-empty
			// value rather than off the parse alone (kindred#1874's polarity
			// trap). A blocker anywhere in the household wins structurally: a
			// plain OR over the No pole is order-independent, unlike the
			// retired two-column encoding, which needed a finalization pass to
			// stop one member's yes-flexible clobbering another's blocker.
			if strings.TrimSpace(v.value) != "" && !parseBoolFieldValue(v.value) {
				reg.accommodationIsMandatory = true
			}
		// Derived accessibility flags. The narrative behind each of these lives
		// in family_camp_medical and never reaches this table (spec 5.3).
		case fieldFamCampBathroom, fieldAdultBathroom:
			reg.needsPrivateBathroom = reg.needsPrivateBathroom || parseBoolFieldValue(v.value)
		case fieldFamCampCPAP, fieldFamilyCampCPAP, fieldAdultCPAP:
			// Deliberately NOT parseBoolFieldValue -- these three fields are
			// multi-option selects, and every option starts "Yes" (kindred#1875).
			ans := classifyCPAPAnswer(v.value)
			reg.needsPower = reg.needsPower || ans.power
			reg.needsPrivateBathroom = reg.needsPrivateBathroom || ans.bathroom
		case fieldAdultInfant:
			// Housing-suitability signal, not an accessibility need (kindred#1876).
			// Women's and Men's Weekend share one form: for women this asks
			// whether they are bringing an infant, which matters because of
			// nursing; "I'm attending Men's Weekend" (21 values) is how a male
			// registrant says the question does not apply. It correctly parses
			// false and must NOT be special-cased -- the data is not dirty.
			reg.hasInfant = reg.hasInfant || parseBoolFieldValue(v.value)
		// The accommodation NARRATIVE, resolved into a boolean the registry can
		// answer (kindred#2224). A default arm rather than a case list, because
		// the names live in accommodationExplainFieldNames -- the same list
		// processMedical routes on, so a generation added for one is added for
		// both. A case list here would be the second copy that drifts.
		//
		// Derived from the RAW per-person values with an OR, exactly as the
		// gate above is, and never from the collapsed
		// family_camp_medical.accommodation_explain: that column's
		// first-non-empty flatten has already discarded 13 of 43 sibling
		// narratives before anything can read them.
		//
		// Nothing about the sentence is stored here. The switch reads it and
		// keeps one bit.
		default:
			if isAccommodationExplainField(v.fieldName) {
				reg.needsFridge = reg.needsFridge || mentionsFridge(v.value)
			}
			// The step-free need reads the accommodation narrative ALONE, the
			// same route as fridge above. It used to read the bathroom
			// narrative too (kindred#2438) on the reasoning that a family
			// explaining why it needs a private bathroom is often explaining
			// that someone cannot walk to the shared one.
			//
			// REVERSED by owner ruling 2026-08-23, because of what it did to
			// the board: a household whose only narrative is a bathroom
			// explanation raised this flag AND needs_private_bathroom, drawing
			// two glyphs whose tooltips showed the same paragraph -- one family
			// answer rendered as two independent needs.
			//
			// Re-measured before reversing, and the signal loss is zero. Of the
			// 14 step-free households on the 2026 snapshot, 9 trip the keyword
			// surface on the accommodation narrative and are unaffected; the
			// other 5 trip only on the bathroom narrative and are ALL already
			// needs_private_bathroom, so they keep a glyph carrying the very
			// same words. 2025: 4 step-free, none bathroom-only.
			//
			// This split read 11/3 until it was re-derived read-only against
			// the 2026 snapshot for kindred#2572. 11 is how many of the 14 HAVE
			// an accommodation narrative at all; 2 of those 11 carry the
			// mobility words only in their bathroom answer, so they lose the
			// flag too. The conclusion is unchanged -- all 5 that lose it are
			// already needs_private_bathroom.
			if isAccommodationExplainField(v.fieldName) {
				reg.needsStepFree = reg.needsStepFree || mentionsStepFree(v.value)
			}
		}
	}

	s.applyHouseholdRequests(regMap, personValues)

	// Convert to slice
	var result []*registrationData
	for _, reg := range regMap {
		// Collapse the collected free text last, so every household member has
		// been seen. Doing it inside the loop above is what made it first-wins.
		s.applyRegistrationText(reg, textByHousehold[reg.householdPBID])

		// Only include if has some data
		if reg.cabinAssignment != "" || reg.shareCabinPreference != "" ||
			reg.sharedCabinModesRaw != "" || reg.arrivalETA != "" ||
			reg.specialOccasions != "" || reg.goals != "" ||
			reg.notes != "" || reg.needsAccommodation ||
			reg.shareCabinGate != "" || reg.requestText != "" ||
			reg.wantsNear || reg.wantsWithNamed || reg.wantsSimilarAges ||
			reg.needsPrivateBathroom || reg.needsPower || reg.hasInfant ||
			// Same reason as accommodationIsMandatory below: a household whose
			// only parseable answer is the narrative-derived need would be the
			// row dropped before it is written.
			reg.needsFridge ||
			// And needs_step_free, which is now PURELY DEFENSIVE and worth
			// saying so rather than leaving a measured justification that no
			// longer measures anything. The entry shipped because 3 of the 14
			// mobility households on the 2026 snapshot were NOT
			// accommodation-gated, against 0 of the 6 fridge households -- but
			// all 3 narrated only through the BATHROOM field, and the
			// 2026-08-23 ruling above removed that route, so none of them
			// raises this flag any more. Re-measured over the accommodation
			// narrative alone: all 9 step-free households are
			// accommodation-gated, exactly as all 6 fridge households are, so
			// no row reaches this line today. It stays because the flag is
			// deliberately not gated in code and a household could narrate a
			// step-free need without answering the gate (kindred#2438).
			reg.needsStepFree ||
			// accommodationIsMandatory belongs here for the same reason as the
			// rest, and more so: it is the blocker signal, and a household whose
			// only answer is the blocker was the one row that got dropped before
			// it was written.
			reg.accommodationIsMandatory {
			result = append(result, reg)
		}
	}

	return result
}

// accommodationExplainFieldNames routes the accommodation NARRATIVE, by literal
// display name, in both places that read it: processMedical (which stores the
// sentence) and processRegistrations (which derives booleans from it and stores
// nothing). ONE list, because two copies of a name-keyed route drift the moment
// a generation is added -- which is exactly how the Adult twin came to be read
// in one of the two and not the other.
//
// "Housing Accommodation-Yes" (cm_id 274058) is the Camper partition and
// "Accommodation-Explain" (224987) the Adult twin. The remaining two are
// DEFENSIVE successors, not fields that exist today: admission is by cm_id
// (extraFieldCMIDs) and survives a CampMinder rename, but routing is by display
// name and does not, so a rename silently stops population with no error. The
// gate's own arm already carries three generations for the same reason, and
// CampMinder's one-m misspelling of "Accomodation" is real -- it is how the
// live Adult gate is spelled -- so it is the likeliest shape a successor takes.
// A name here that never appears costs nothing: nothing is admitted under it.
var accommodationExplainFieldNames = []string{
	"Housing Accommodation-Yes",
	"Accommodation-Explain",
	"Housing Accomodation-Yes",
	"Accomodation-Explain",
}

// isAccommodationExplainField reports whether name routes the accommodation
// narrative. A linear scan of four strings, called once per person value.
func isAccommodationExplainField(name string) bool {
	return slices.Contains(accommodationExplainFieldNames, name)
}

// fridgeKeywords is the recall surface for needs_fridge (kindred#2224).
//
// RECALL OVER PRECISION, on purpose. The flag is ADVISORY -- it hatches a unit
// card, it never refuses a drop -- so a false positive costs a mark staff can
// overrule at a glance, while a false negative costs the ask entirely and
// returns the household to the prose nobody parses.
//
// Measured over the two narrative fields on the production snapshot, 2026:
// "fridge" and "refrigerat" together find 6 households, "cooler" adds 0 but is
// kept because a family asking for a cooler is asking the registry the same
// question. "fridge" as a substring also catches the doubled-d misspelling of
// "refrigerator" that families commonly type, which a word list would miss.
// 2026 is only 16% placed, so 6 is the SHAPE of the demand, not a rate.
var fridgeKeywords = []string{"fridge", "refrigerat", "cooler"}

// mentionsFridge reports whether a free-text accommodation answer asks for cold
// storage. Case-insensitive substring matching -- the input is unvalidated
// family-authored prose, so anything stricter (word boundaries, a token list)
// loses answers to punctuation and compounding.
func mentionsFridge(text string) bool {
	lower := strings.ToLower(text)
	for _, kw := range fridgeKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// bathroomExplainFieldNames routes the bathroom NARRATIVE, by literal display
// name, into the ONE place that reads it: processMedical, which stores the
// sentence in family_camp_medical.bathroom_explain.
//
// It had a SECOND reader until the 2026-08-23 owner ruling -- processRegistrations
// derived needs_step_free from this narrative as well (kindred#2438) -- and the
// note below records where the predicate went. The list is still ONE list for
// the reason accommodationExplainFieldNames states above, and because a second
// reader may well come back; but it has none today, so a generation added here
// reaches bathroom_explain and nothing else. processMedical's bathroom block
// says the same thing from the reader's side.
//
// "Housing-Bathroom" (cm_id 274059) is the Camper partition and "Bathroom-Yes"
// (274054) the Adult twin. Unlike the accommodation list this carries NO
// defensive successors: that list has them because CampMinder demonstrably
// misspells "Accommodation" with one m -- it is how the live adult gate is
// spelled -- and no comparable misspelling of these two has ever been observed.
// The name-routing fragility is identical, so a rename here would silently stop
// population too; inventing spellings nobody has seen is a guess, and this
// comment is the warning instead.
var bathroomExplainFieldNames = []string{
	"Housing-Bathroom",
	"Bathroom-Yes",
}

// (isBathroomExplainField was here. Its only caller was the step-free
// derivation, removed by the 2026-08-23 owner ruling; bathroomExplainFieldNames
// itself is still the routing list processMedical reads for the narrative
// column, so the LIST stays and only the predicate went.)

// stepFreeKeywords is the recall surface for needs_step_free (kindred#2438).
//
// RECALL OVER PRECISION, for the reason fridgeKeywords states: the flag is
// ADVISORY -- it hatches a unit card, it never refuses a drop -- so a false
// positive costs a mark staff overrule at a glance while a false negative costs
// the ask entirely and returns the household to prose nobody parses.
//
// Measured over the ACCOMMODATION narrative alone -- the one field the live
// derivation reads since the 2026-08-23 ruling -- on the production snapshot,
// 2026, household grain, re-derived read-only for kindred#2572: this surface
// finds 9 of the 43 households carrying an accommodation narrative, against 6
// for fridge. Contributions, so the surface can be argued rather than
// inherited (they overlap, so they sum above 9):
//
//	"walk"          -- 6, and as a SUBSTRING, so it also catches
//	                   walking/walkway. Every one reads as a genuine step-free
//	                   ask on inspection.
//	"knee" / "hip"  -- 3 and 2. Every knee/hip mention in the corpus, in every
//	                   year, is a mobility limitation: a joint replacement, a
//	                   post-surgical recovery, or a stated limit on how far
//	                   someone can walk. Zero false positives, which is why a
//	                   diagnosis word earns its place in an otherwise ask-shaped
//	                   list. (Aggregate only -- the narratives themselves are
//	                   PHI and are not quoted here.)
//	"crutch"        -- 1.
//
// HISTORICAL, and kept so the surface is not re-argued from a number that no
// longer describes it: this comment read "14 of the 86" with a "walk" of 10 and
// a "mobilit" of 2 until kindred#2572. Those figures were measured over BOTH
// narrative fields -- 86 is the union corpus, and 5 of the 14 trip only on the
// bathroom narrative, which nothing derives from any more.
//
// "mobilit" and "stair" match 0 households in the 2026 accommodation corpus and
// 1 each in 2025. Every other entry matches 0 today and is kept because each is
// the plain word for an ask `has_ramp` answers. 2026 is only 16% placed, so 9
// is the SHAPE of the demand, not a rate.
//
// DELIBERATELY EXCLUDED: bare "close to". It matches 4 households in the
// accommodation corpus, and it is PROXIMITY rather than step-free access -- a
// different ask, which the registry answers with `map_x`/`map_y` and
// `near_bathhouse` rather than with `has_ramp`, so a household flagged on it
// would be hatched against a column that cannot speak to what they asked for.
// Two of the four are already caught on a genuine mobility word ("walk" and
// "knee"); the two that remain uncaught were inspected under the earlier
// both-field measurement and neither is a step-free ask. (This is the one
// exclusion, and it is a PRECISION judgement made against a specific supply
// column -- not a retreat from the recall rule above.)
//
// SUBSTRING matching, as fridgeKeywords uses, because the input is unvalidated
// prose and anything stricter loses answers to punctuation and compounding:
// "walk" has to catch walking and walkway, "mobilit" has to catch mobility and
// mobilities, "stair" has to catch stairs and stairway.
var stepFreeKeywords = []string{
	"walk", "mobilit", "wheelchair", "scooter", "crutch",
	"knee", "stair", "steps",
	"ground floor", "single level", "one level",
}

// stepFreeWordPattern holds the three keywords that must match as WHOLE WORDS.
//
// Substring matching is the rule above and it is right for the rest, but these
// three are short enough to sit inside common, unrelated words: "hip" is in
// RELATIONSHIP and SHIPPING, "cane" is in HURRICANE, "ramp" is in CRAMP. None
// of those says anything about mobility, so firing on them is not the
// near-miss that recall-over-precision buys -- it is an unrelated word, and it
// would mark a household that asked for nothing of the kind.
//
// Deliberately still generous WITHIN the word: the plural and the hyphenated
// compound both match ("hips", "post-op hip", "ramps", "canes"), because \b
// treats the hyphen as a boundary.
var stepFreeWordPattern = regexp.MustCompile(`\b(hips?|canes?|ramps?)\b`)

// mentionsStepFree reports whether a free-text answer describes a mobility or
// step-free access need. Case-insensitive substring matching, exactly as
// mentionsFridge does and for the same reason: the input is unvalidated
// family-authored prose, so anything stricter loses answers to punctuation and
// compounding.
func mentionsStepFree(text string) bool {
	lower := strings.ToLower(text)
	for _, kw := range stepFreeKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return stepFreeWordPattern.MatchString(lower)
}

// cpapAnswer is the result of classifying one answer to a CPAP field.
type cpapAnswer struct {
	power    bool
	bathroom bool
}

// classifyCPAPAnswer splits a CPAP-field answer into the need it actually
// describes. The three CPAP fields LOOK boolean and are not: they are
// multi-option selects where the qualifier after "Yes" says which need the
// family has, and parseBoolFieldValue -- which anchors on the leading token --
// reads all of them as true.
//
// The four observed answer shapes, counted across FAM CAMP-CPAP and Adult-CPAP:
//
//	Yes                                             ->  power             (63)
//	Yes, outlet needed for CPAP machine             ->  power             (73)
//	Yes, bathroom or other housing accommodation
//	for a medical (not CPAP related) or
//	accessibility-related reason needed             ->  bathroom          (75)
//	Yes, {we,I} need an outlet for a CPAP machine
//	AND need a bathroom or other housing
//	accommodation ...                               ->  power + bathroom  (20)
//
// The 75 bathroom answers say "not CPAP related" in so many words; treating
// them as power reserves an outlet cabin for a family that asked for a private
// bathroom, and loses the bathroom signal at the same time.
//
// The two needs are tested INDEPENDENTLY rather than as ordered branches. The
// fourth option asks for both, and a switch returning on the first bathroom
// match drops the outlet for all 20 of them -- leaving a CPAP machine without
// power, which is the harmful direction to get wrong. Matching on "outlet"
// keeps the bathroom-only option out of the power bucket without needing an
// ordering rule: that option mentions CPAP, inside "not CPAP related", but
// never an outlet.
//
// A bare "Yes" names neither need, and is power: the field is named CPAP, and
// the qualified options were added later when the camp widened the question to
// cover non-CPAP accessibility needs. It does not also set bathroom -- bathroom
// units are scarce and that would be an inference, not a statement.
func classifyCPAPAnswer(value string) cpapAnswer {
	if !parseBoolFieldValue(value) {
		return cpapAnswer{}
	}
	lower := strings.ToLower(value)
	out := cpapAnswer{
		bathroom: strings.Contains(lower, "bathroom"),
		power:    strings.Contains(lower, "outlet") || strings.Contains(lower, "cpap machine"),
	}
	if !out.bathroom && !out.power {
		out.power = true
	}
	return out
}

// applyHouseholdRequests folds the person-partition request fields onto the
// household rows.
//
// Spec 4.2 is mandatory here: those fields are person-partition, so a household
// with two enrolled children stores the same text twice (observed at n=2 and
// n=3). Collapsing before anything reads the text is the difference between one
// request and two.
//
// The gate, the NEAR/WITH modes and the free text all come out of
// CollapseToHouseholdGrain, which resolves the form-vs-registration conflict by
// last_updated per spec 4.1. Keying on the households PB record id is correct
// here because that is what family_camp_registrations.household stores.
func (s *FamilyCampDerivedSync) applyHouseholdRequests(
	regMap map[string]*registrationData, personValues []customValueEntry,
) {
	values := make([]PersonRequestValue, 0, len(personValues))
	for _, v := range personValues {
		values = append(values, PersonRequestValue{
			HouseholdKey: v.householdPBID,
			FieldName:    v.fieldName,
			Value:        v.value,
			LastUpdated:  v.lastUpdated,
		})
	}

	for householdPBID, req := range CollapseToHouseholdGrain(values) {
		reg, ok := regMap[householdPBID]
		if !ok {
			reg = &registrationData{householdPBID: householdPBID}
			regMap[householdPBID] = reg
		}
		reg.shareCabinGate = req.Gate
		reg.wantsNear = req.WantsNear
		reg.wantsWithNamed = req.WantsWithNamed
		reg.wantsSimilarAges = req.WantsSimilarAges
		reg.requestText = req.RequestText
		reg.requestSourceField = req.SourceField
		reg.requestLastUpdated = req.LastUpdated
		reg.shareEligibility = req.ShareEligibility
		reg.shareEligibilitySource = req.ShareEligibilitySource
	}
}

// medicalColumnLimits are the declared max lengths of the family_camp_medical
// text columns, which are NOT uniform: allergy_info, dietary_info,
// special_needs_info and additional_info are 10,000, cpap_info and
// physician_info 5,000 (migration 1500000035), and bathroom_explain and
// accommodation_explain 4,000 (migration 1500000126).
//
// They matter for the first time now that a column concatenates every
// answerer's disclosure instead of one: record.Set() past a PocketBase field's
// max fails the whole row's save, which would lose a household rather than a
// sentence. Worst case in the production snapshot is 2,128 of 10,000, so this
// is a guard, not a working limit -- joinAnswers drops whole answers and the
// caller logs the count.
var medicalColumnLimits = map[string]int{
	"allergy_info":          10000,
	"dietary_info":          10000,
	"special_needs_info":    10000,
	"additional_info":       10000,
	"cpap_info":             5000,
	"physician_info":        5000,
	"bathroom_explain":      4000,
	"accommodation_explain": 4000,
}

// The three states a family-camp medical gate can be in. The third is the whole
// reason the column is a select and not a bool: families reach different
// question blocks, so "answered No" and "never asked" are different facts. In
// 2026, 430 of 900 households answered the allergy gate No and 224 never
// answered it at all; for the physician gate it is 284 and 589. A bool would
// collapse those into one false.
const (
	gateVerdictUnanswered = ""
	gateVerdictNo         = "no"
	gateVerdictYes        = "yes"
)

// gateDenials is the negative pole of the gate vocabulary -- the mirror of the
// affirmative set parseBoolFieldValue accepts.
var gateDenials = map[string]struct{}{
	"no": {}, "false": {}, "0": {}, "n": {},
}

// gateVerdict collapses every household member's answer to one gate question
// into the household's answer, by OR.
//
// This is the same total aggregation processRegistrations applies to the
// housing flags, and it is the only collapse rule on this path that never picks
// a winner: `personValues` carries one entry per person per field and
// CampMinder asks these questions on a per-CAMPER form, so a household with two
// enrolled children answers each question twice. It is therefore
// order-independent, which is what docs/reference/family-camp-field-provenance.md
// section 4's binding rule requires -- a gate and its explain must collapse as a
// pair, and after this neither half selects a winner.
//
// The vocabulary is closed. Across all 35,895 stored answers to the seven gate
// fields, every one is either a leading-token "Yes" or a member of gateDenials;
// the four pure Yes/No gates hold 2 distinct values each, 3 characters at the
// longest, across 30,283 answers. That measurement is what licenses collapsing
// them to a single verdict rather than keeping every distinct answer the way the
// narrative columns do.
//
// An answer outside that vocabulary is NOT stored anywhere -- it contributes no
// verdict and does not reach the narrative column. `medicalAnswers.parts` used
// to let one fall through into the narrative join; that valve was retired by
// owner ruling (2026-08-22) once the gate stopped sharing the column. The
// warning below is what replaced it, and is the only way a CampMinder
// vocabulary change would now surface. It carries the field name and a COUNT
// and never the answer: these are answers on a medical form, and the same
// never-log contract joinMedicalColumn states covers them.
func gateVerdict(fieldName string, parts []string) string {
	verdict := gateVerdictUnanswered
	unrecognized := 0

	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if parseBoolFieldValue(trimmed) {
			verdict = gateVerdictYes
			continue
		}
		if _, denied := gateDenials[strings.ToLower(trimmed)]; denied {
			// Never downgrades a Yes already seen: the OR is the point.
			if verdict == gateVerdictUnanswered {
				verdict = gateVerdictNo
			}
			continue
		}
		unrecognized++
	}

	if unrecognized > 0 {
		slog.Warn("Family camp medical gate answer outside the Yes/No vocabulary",
			"field", fieldName, "count", unrecognized,
			"hint", "the answer is not stored; check the CampMinder field's options")
	}

	return verdict
}

// orGateVerdicts unions per-field gate verdicts by the same rule gateVerdict
// itself uses to union per-person answers within one field: yes beats no
// beats unanswered, order-independent.
//
// It exists for CPAP, the one gate spread across three CampMinder fields
// (fieldFamilyCampCPAP, fieldFamCampCPAP, fieldAdultCPAP -- one question asked
// in three generations). Calling gateVerdict once per field, then ORing the
// results, keeps its "field" warning naming the actual field whose vocabulary
// moved -- the promise gateVerdict's doc comment makes -- instead of the
// single literal "CPAP" label a combined call would have to invent. The union
// itself changes nothing observable: yes/no/unanswered is order-independent
// whether it is computed over one combined answer list or three separate
// ones, so processMedical's cpap_gate is identical either way.
func orGateVerdicts(verdicts ...string) string {
	verdict := gateVerdictUnanswered
	for _, v := range verdicts {
		if v == gateVerdictYes {
			return gateVerdictYes
		}
		if v == gateVerdictNo {
			verdict = gateVerdictNo
		}
	}
	return verdict
}

// medicalAnswers holds one household's family-camp medical answers: every
// distinct answer given to each field, in canonical order, across everyone who
// answered it.
//
// It replaces a first-non-empty-wins map. That map discarded every answer after
// the first because `personValues` carries one entry per person per field and
// CampMinder asks these questions on a per-CAMPER form, so a household with two
// enrolled children answers each question twice. 105 of 464 family-camp
// households in 2026 (22.6%) lost a real second disclosure to it, and because
// the gate and its explanation were chosen independently, 836 of 8,864 stored
// rows read "No; <description of the condition it denies>" -- one person's
// denial glued to another person's disclosure.
type medicalAnswers map[string][]string

// parts returns the answers to one field, ready to be concatenated into a
// column: every distinct answer, in canonical order, across everyone who
// answered it. A second person's sentence is a second disclosure.
//
// It used to collapse a Yes/No gate to a single token, because the gate and its
// explanation shared a column and joining two answerers' gates verbatim rendered
// "No; Yes; <A>; <B>". kindred#2542 gave the gate its own column, so no gate
// token reaches a narrative join any more and the collapse moved to gateVerdict.
func (m medicalAnswers) parts(fieldName string) []string {
	values := m[fieldName]
	if len(values) == 0 {
		return nil
	}
	// Cloned because callers append the next field's parts onto this slice:
	// handing back the map's own backing array would let one column's join
	// overwrite another's answers.
	return slices.Clone(values)
}

// joinMedicalColumn concatenates one column's parts within its declared cap,
// dropping whole answers rather than cutting one in half and counting what it
// dropped.
//
// The log carries counts only. Every column on this struct is a medical
// disclosure about a named individual and none of them may be logged; see the
// contract on medicalData.
func (s *FamilyCampDerivedSync) joinMedicalColumn(householdPBID, column string, parts []string) string {
	limit, ok := medicalColumnLimits[column]
	if !ok {
		// Fail SAFE, not quiet. joinAnswers with a zero limit would return an
		// empty string, so a column added here and forgotten in the limits map
		// would silently blank itself -- the exact class of loss this function
		// exists to end. Keep every answer and shout instead.
		slog.Error("Family camp medical column has no declared length limit",
			"column", column, "hint", "add it to medicalColumnLimits")
		return strings.Join(parts, answerJoinSeparator)
	}

	joined, dropped, truncated := joinAnswers(parts, limit)
	if dropped > 0 || truncated {
		slog.Warn("Family camp medical column exceeded its cap",
			"household", householdPBID, "column", column,
			"dropped_answers", dropped, "truncated", truncated)
	}
	return joined
}

// processMedical extracts medical data from person custom values
func (s *FamilyCampDerivedSync) processMedical(personValues []customValueEntry) []*medicalData {
	// Map: household -> field_name -> the distinct answers given to it
	setsByHousehold := make(map[string]map[string]*answerSet)

	for _, v := range personValues {
		if setsByHousehold[v.householdPBID] == nil {
			setsByHousehold[v.householdPBID] = make(map[string]*answerSet)
		}
		set := setsByHousehold[v.householdPBID][v.fieldName]
		if set == nil {
			set = &answerSet{}
			setsByHousehold[v.householdPBID][v.fieldName] = set
		}
		set.add(v.value)
	}

	// Process each household
	var result []*medicalData
	for householdID, sets := range setsByHousehold {
		fields := make(medicalAnswers, len(sets))
		for name, set := range sets {
			if values := set.values(); len(values) > 0 {
				fields[name] = values
			}
		}

		med := &medicalData{
			householdPBID: householdID,
		}

		// CPAP. The three fields are one question asked in three generations, so
		// the gate is the union of all three -- which is what makes it match the
		// flag logic in processRegistrations, which ORs across the same three.
		//
		// The affirmative options are multi-option sentences whose text names
		// WHICH accommodation is needed ("Yes, outlet needed for CPAP machine"
		// vs "Yes, bathroom or other housing accommodation ... (not CPAP
		// related)"). That distinction is real and is NOT lost here: it is
		// exactly what classifyCPAPAnswer resolves into needs_power and
		// needs_private_bathroom, and AccessibilityFlagList renders both as
		// Housing-needs rows directly above this text in the same panel section.
		// What leaves is the wording, never the decision -- which is why this
		// column no longer needs the pass that stood here before kindred#2542,
		// dropping a household's pure CPAP denials whenever anyone in it
		// disclosed a need so that "No; Yes, outlet needed for CPAP machine"
		// could not be rendered. No gate answer reaches this column at all now,
		// so there is nothing left for it to contradict.
		//
		// One gateVerdict call per field, ORed by orGateVerdicts, rather than one
		// combined call over all three fields' answers -- so a vocabulary warning
		// names the actual CampMinder field that drifted (Family Camp-CPAP, FAM
		// CAMP-CPAP or Adult-CPAP) instead of the aggregate label "CPAP". The
		// verdict itself is unchanged either way: see orGateVerdicts' doc comment.
		med.cpapGate = orGateVerdicts(
			gateVerdict(fieldFamilyCampCPAP, fields.parts(fieldFamilyCampCPAP)),
			gateVerdict(fieldFamCampCPAP, fields.parts(fieldFamCampCPAP)),
			gateVerdict(fieldAdultCPAP, fields.parts(fieldAdultCPAP)),
		)
		med.cpapInfo = s.joinMedicalColumn(householdID, "cpap_info",
			fields.parts("Family Medical-CPAP Explain"))

		// Physician
		med.physicianGate = gateVerdict("Family Camp-Physician",
			fields.parts("Family Camp-Physician"))
		med.physicianInfo = s.joinMedicalColumn(householdID, "physician_info",
			fields.parts("Family Camp-Physician If Yes"))

		// Special needs
		med.specialNeedsGate = gateVerdict("Family Camp-Special Needs",
			fields.parts("Family Camp-Special Needs"))
		med.specialNeedsInfo = s.joinMedicalColumn(householdID, "special_needs_info",
			fields.parts("Family Camp-Special Needs Yes"))

		// Allergies
		med.allergyGate = gateVerdict("Family Medical-Allergies",
			fields.parts("Family Medical-Allergies"))
		med.allergyInfo = s.joinMedicalColumn(householdID, "allergy_info",
			fields.parts("Family Medical-Allergy Info"))

		// Dietary
		med.dietaryGate = gateVerdict("Family Medical-Dietary Needs",
			fields.parts("Family Medical-Dietary Needs"))
		med.dietaryInfo = s.joinMedicalColumn(householdID, "dietary_info",
			fields.parts("Family Medical-Dietary Explain"))

		// Additional info
		med.additionalInfo = s.joinMedicalColumn(
			householdID, "additional_info", fields.parts("Family Medical-Additional"))

		// Medical narrative for the two accessibility questions. These sentences
		// describe named individuals' medical circumstances, so they live only
		// here -- family_camp_medical is admin-gated on all five rules and is
		// absent from every export config (lodging_medical_narrative_test.go asserts that).
		// bathroomExplainFieldNames has ONE reader, this column. It was shared
		// with processRegistrations' needs_step_free derivation until the
		// 2026-08-23 owner ruling removed that route (kindred#2438); the list
		// stayed because the narrative column still needs it. Unlike
		// accommodationExplainFieldNames below it is no longer a two-reader
		// list, so a generation added here reaches this column and nothing else.
		bathroomParts := make([]string, 0, len(bathroomExplainFieldNames))
		for _, key := range bathroomExplainFieldNames {
			bathroomParts = append(bathroomParts, fields.parts(key)...)
		}
		med.bathroomExplain = s.joinMedicalColumn(householdID, "bathroom_explain", bathroomParts)

		// Same two-partition shape as bathroomExplain above: "Housing
		// Accommodation-Yes" is the Camper-partition narrative and
		// "Accommodation-Explain" (cm_id 224987) is its Adult-partition twin.
		// Reading the Camper key alone dropped every household narrated only
		// through the adult gate -- 12 of 42 accommodation-gated households in
		// 2026 production. kindred#2224.
		// accommodationExplainFieldNames is the ONE routing list, shared with
		// processRegistrations' needs_fridge derivation (kindred#2224) so a
		// generation added for one is added for both.
		accommodationParts := make([]string, 0, len(accommodationExplainFieldNames))
		for _, key := range accommodationExplainFieldNames {
			accommodationParts = append(accommodationParts, fields.parts(key)...)
		}
		med.accommodationExplain = s.joinMedicalColumn(
			householdID, "accommodation_explain", accommodationParts)

		// A gate answer is content. 375 of 900 2026 households have nothing else
		// once the narratives hold the family's words alone, and without this
		// they would be absent from the result slice and swept as orphans.
		if med.cpapInfo != "" || med.physicianInfo != "" ||
			med.specialNeedsInfo != "" || med.allergyInfo != "" ||
			med.dietaryInfo != "" || med.additionalInfo != "" ||
			med.bathroomExplain != "" || med.accommodationExplain != "" ||
			med.allergyGate != "" || med.dietaryGate != "" ||
			med.specialNeedsGate != "" || med.physicianGate != "" ||
			med.cpapGate != "" {
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
// Row keys
//
// The upsert path, the preload and the dry-run diff must agree on these
// EXACTLY: a preload keyed differently from the upsert reads every stored row
// as an orphan, and a dry run keyed differently from either reports a diff that
// describes nothing real. They were SIX separate fmt.Sprintf calls across two
// format strings -- one per table in the preloads and one per table in the
// upserts -- until the dry-run diff needed three more.
// ============================================================================

// familyCampAdultKey keys one family_camp_adults row.
func familyCampAdultKey(householdPBID string, year, adultNumber int) string {
	return fmt.Sprintf("%s:%d:%d", householdPBID, year, adultNumber)
}

// familyCampHouseholdYearKey keys one family_camp_registrations or
// family_camp_medical row -- both are one row per household per year.
func familyCampHouseholdYearKey(householdPBID string, year int) string {
	return fmt.Sprintf("%s:%d", householdPBID, year)
}

// ============================================================================
// Dry run
// ============================================================================

// reportDryRun computes what a real run would do to each of the three tables
// and records it on s.DryRunDiff, without writing anything.
//
// Stats carries the same verdict rather than the old row counts. A dry run's
// Stats are a FORECAST -- "would create", not "created" -- and the numbers are
// only useful if they are the honest ones: reporting every computed row as a
// creation, as this did before, told an operator that a replay of an already
// derived year would create 4,000 rows when it would in fact change none.
func (s *FamilyCampDerivedSync) reportDryRun(
	year int,
	adults []*adultData, registrations []*registrationData, medical []*medicalData,
	existingAdults, existingRegs, existingMedical map[string]*core.Record,
) {
	// A fixed slice rather than a map range, so the log reads the same way on
	// every run.
	tables := []struct {
		name     string
		existing map[string]*core.Record
		diff     DryRunDiff
	}{
		{
			name:     "family_camp_adults",
			existing: existingAdults,
			diff: computeDryRunDiff("family_camp_adults", year, adults, existingAdults,
				func(a *adultData) string {
					return familyCampAdultKey(a.householdPBID, year, a.adultNumber)
				},
				s.adultNeedsUpdate, isNamelessButAttributedAdult),
		},
		{
			name:     "family_camp_registrations",
			existing: existingRegs,
			diff: computeDryRunDiff("family_camp_registrations", year, registrations, existingRegs,
				func(r *registrationData) string {
					return familyCampHouseholdYearKey(r.householdPBID, year)
				},
				s.registrationNeedsUpdate, nil),
		},
		{
			name:     "family_camp_medical",
			existing: existingMedical,
			diff: computeDryRunDiff("family_camp_medical", year, medical, existingMedical,
				func(m *medicalData) string {
					return familyCampHouseholdYearKey(m.householdPBID, year)
				},
				s.medicalNeedsUpdate, nil),
		},
	}

	s.DryRunDiff = make(map[string]DryRunDiff, len(tables))
	for _, t := range tables {
		s.DryRunDiff[t.name] = t.diff

		slog.Info("Dry run diff",
			"table", t.name,
			"year", year,
			"would_create", t.diff.WouldCreate,
			"would_update", t.diff.WouldUpdate,
			"unchanged", t.diff.Unchanged,
			"would_delete", t.diff.WouldDelete,
			"protected", t.diff.Protected,
			"existing", len(t.existing),
		)
		if t.diff.GuardWouldRefuse {
			slog.Warn("Dry run: this table's orphan sweep would be REFUSED, not performed",
				"table", t.name,
				"year", year,
				"computed", t.diff.WouldCreate+t.diff.WouldUpdate+t.diff.Unchanged,
				"existing", len(t.existing),
				"hint", familyCampSweepHint,
			)
		}

		s.Stats.Created += t.diff.WouldCreate
		s.Stats.Updated += t.diff.WouldUpdate
		s.Stats.Skipped += t.diff.Unchanged

		// Stats.Deleted is deliberately NOT mirrored from WouldDelete.
		//
		// recordSyncRun writes Stats.Deleted straight into
		// sync_runs.deleted_count with status=completed, and sync_runs carries
		// no dry-run marker of any kind. Mirroring here would leave a completed
		// run row asserting deletions that never happened -- nine of them once
		// the planned 2017-2025 replay dry runs are done, and afterwards
		// indistinguishable from nine real sweeps.
		//
		// Deleted is singled out because it is the only one of the four that
		// describes a DESTRUCTIVE act; an overstated created/updated/skipped is
		// a harmless overcount and predates this. The would-be count is not
		// lost -- it stays on DryRunDiff.WouldDelete and in the log line above,
		// which is where a dry run's answer belongs. Recording it in sync_runs
		// honestly would need a dry-run column or status there, which is a
		// schema change and a separate decision.
	}
}

// computeDryRunDiff classifies every computed row against what is stored, then
// asks the same OrphanSweepGuard the real sweep would ask.
//
// needsUpdate is the production comparison function, passed in rather than
// reimplemented: a dry run that judged "changed" by its own rule would drift
// from the writing path silently, and a forecast nobody can trust is worse than
// no forecast.
//
// protected classifies a stored row this run's computed set does not account
// for: true means the real sweep would leave it alone (kindred#2335), so it
// belongs on diff.Protected rather than diff.WouldDelete. Pass nil for tables
// with no such rule -- family_camp_registrations and family_camp_medical carry
// no name column, so nothing on them is ever "wholly nameless".
func computeDryRunDiff[T any](
	entity string,
	year int,
	items []T,
	existing map[string]*core.Record,
	key func(T) string,
	needsUpdate func(*core.Record, T) bool,
	protected func(*core.Record) bool,
) DryRunDiff {
	var diff DryRunDiff

	computed := make(map[string]bool, len(items))
	for _, item := range items {
		k := key(item)
		computed[k] = true

		record, ok := existing[k]
		switch {
		case !ok:
			diff.WouldCreate++
		case needsUpdate(record, item):
			diff.WouldUpdate++
		default:
			diff.Unchanged++
		}
	}

	for k, record := range existing {
		if computed[k] {
			continue
		}
		if protected != nil && protected(record) {
			diff.Protected++
			continue
		}
		diff.WouldDelete++
	}

	// Computed is the size of the key set, matching what the real sweep passes
	// (len(s.Processed*Keys) after the upsert loop has run).
	guard := OrphanSweepGuard{
		Entity:   entity,
		Year:     year,
		Computed: len(computed),
		Hint:     familyCampSweepHint,
	}
	diff.GuardWouldRefuse = guard.Check(len(existing)) != nil

	return diff
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
		records, err := s.App.FindRecordsByFilter("family_camp_adults", filter, sortByID, perPage, (page-1)*perPage)
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
				result[familyCampAdultKey(householdID, year, adultNum)] = record
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
		records, err := s.App.FindRecordsByFilter("family_camp_registrations", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying family_camp_registrations page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				result[familyCampHouseholdYearKey(householdID, year)] = record
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
		records, err := s.App.FindRecordsByFilter("family_camp_medical", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying family_camp_medical page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				result[familyCampHouseholdYearKey(householdID, year)] = record
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
		existing.GetString("relationship_to_camper") != adult.relationship ||
		existing.GetString(enrollmentStatusColumn) != adult.enrollmentStatus ||
		storedAttributeConflicts(existing) != adult.conflictsJSON()
}

// registrationNeedsUpdate checks if a registration record needs updating
func (s *FamilyCampDerivedSync) registrationNeedsUpdate(existing *core.Record, reg *registrationData) bool {
	// Compared in the same normalised form setRegistrationRequestFields WRITES, or
	// every household with no request values would look changed on every pass:
	// the struct holds "" while the row holds "unknown".
	normalizedEligibility, normalizedSource := NormalizeShareEligibility(
		reg.shareEligibility, reg.shareEligibilitySource)
	return existing.GetString("cabin_assignment") != reg.cabinAssignment ||
		existing.GetString("share_cabin_preference") != reg.shareCabinPreference ||
		existing.GetString("shared_cabin_modes_raw") != reg.sharedCabinModesRaw ||
		existing.GetString("arrival_eta") != reg.arrivalETA ||
		existing.GetString("special_occasions") != reg.specialOccasions ||
		existing.GetString("goals") != reg.goals ||
		existing.GetString("notes") != reg.notes ||
		existing.GetBool("needs_accommodation") != reg.needsAccommodation ||
		existing.GetString("share_cabin_gate") != reg.shareCabinGate ||
		existing.GetBool("wants_near") != reg.wantsNear ||
		existing.GetBool("wants_with_named") != reg.wantsWithNamed ||
		existing.GetBool("wants_similar_ages") != reg.wantsSimilarAges ||
		existing.GetString("request_text") != reg.requestText ||
		existing.GetString("request_source_field") != reg.requestSourceField ||
		existing.GetString("request_last_updated") != formatRequestStamp(reg.requestLastUpdated) ||
		existing.GetBool("needs_private_bathroom") != reg.needsPrivateBathroom ||
		existing.GetBool("needs_power") != reg.needsPower ||
		existing.GetBool("accommodation_is_mandatory") != reg.accommodationIsMandatory ||
		existing.GetBool("has_infant") != reg.hasInfant ||
		existing.GetBool("needs_fridge") != reg.needsFridge ||
		existing.GetBool("needs_step_free") != reg.needsStepFree ||
		existing.GetString("share_eligibility") != normalizedEligibility ||
		existing.GetString("share_eligibility_source") != normalizedSource ||
		existing.GetString(enrollmentStatusColumn) != reg.enrollmentStatus
}

// setRegistrationRequestFields writes the registration profile columns, the
// household-grain request layer, and the derived housing flags. Shared by the
// create and update branches so the two cannot drift -- PocketBase Set on a
// column the schema lacks is a silent no-op, so a field written in only one
// branch fails invisibly on the other path.
//
// The first block (cabin_assignment through needs_accommodation) used to be
// hand-copied into both branches of upsertRegistrations (kindred#2552 piece
// 1). Seven of those eight columns are plain strings with no normalisation,
// meeting the inclusion criterion medicalColumnValues' doc comment states.
// needs_accommodation is the bool of the eight, but unlike that comment's
// "shared list" (a single []struct{column, value string} walked by both the
// writer and the comparator), this function is write-only and already mixes
// bools with strings below -- wantsNear, needsPower, hasInfant, and the rest.
// Nothing about being a bool stops a column joining a write-only helper, so
// it is included here too. registrationNeedsUpdate's SEPARATE compare list
// is untouched: whether that list can fuse with this one is kindred#2552
// piece 2, not yet decided.
func setRegistrationRequestFields(record *core.Record, reg *registrationData) {
	record.Set("cabin_assignment", reg.cabinAssignment)
	record.Set("share_cabin_preference", reg.shareCabinPreference)
	record.Set("shared_cabin_modes_raw", reg.sharedCabinModesRaw)
	record.Set("arrival_eta", reg.arrivalETA)
	record.Set("special_occasions", reg.specialOccasions)
	record.Set("goals", reg.goals)
	record.Set("notes", reg.notes)
	record.Set("needs_accommodation", reg.needsAccommodation)
	record.Set(enrollmentStatusColumn, reg.enrollmentStatus)
	record.Set("share_cabin_gate", reg.shareCabinGate)
	record.Set("wants_near", reg.wantsNear)
	record.Set("wants_with_named", reg.wantsWithNamed)
	record.Set("wants_similar_ages", reg.wantsSimilarAges)
	record.Set("request_text", reg.requestText)
	record.Set("request_source_field", reg.requestSourceField)
	record.Set("request_last_updated", formatRequestStamp(reg.requestLastUpdated))
	record.Set("needs_private_bathroom", reg.needsPrivateBathroom)
	record.Set("needs_power", reg.needsPower)
	record.Set("accommodation_is_mandatory", reg.accommodationIsMandatory)
	record.Set("has_infant", reg.hasInfant)
	record.Set("needs_fridge", reg.needsFridge)
	record.Set("needs_step_free", reg.needsStepFree)
	// The board's placement verdict. share_cabin_gate above stays the raw
	// REGISTRATION answer; this is the resolved one, and the Family Camp
	// information form outranks the gate wherever both were answered.
	//
	// Normalised so the column has exactly ONE spelling per state: a household
	// with no request values at all never reaches the collapse, and writing its
	// zero value would store "" beside "unknown" for the same meaning.
	eligibility, eligibilitySource := NormalizeShareEligibility(
		reg.shareEligibility, reg.shareEligibilitySource)
	record.Set("share_eligibility", eligibility)
	record.Set("share_eligibility_source", eligibilitySource)
}

// formatRequestStamp renders requestLastUpdated for the PocketBase date column.
// A zero time becomes the empty string rather than a year-1 date, so an
// unanswered request reads as absent instead of as an implausibly old answer.
func formatRequestStamp(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02 15:04:05.000Z")
}

// medicalColumnValue pairs one family_camp_medical column with the value
// medicalData currently holds for it.
type medicalColumnValue struct {
	column string
	value  string
}

// medicalColumnValues lists every family_camp_medical column setMedicalFields
// writes, next to med's current value for it. Both setMedicalFields and
// medicalNeedsUpdate walk this ONE list rather than each naming the same 14
// columns by hand -- so, unlike setRegistrationRequestFields' comparison
// sibling registrationNeedsUpdate (which stays a hand-written list because it
// mixes bools with a normalisation step, NormalizeShareEligibility, that has
// no single scalar to compare), a column added here reaches the write path
// and the change-detection path in one edit. What makes a shared list
// workable here and not there: every field on medicalData is a plain string,
// with no normalisation applied between the struct and the column.
//
// The registration WRITE path is now fully solved (kindred#2552 piece 1):
// setRegistrationRequestFields covers all of the columns upsertRegistrations
// writes, including the eight (seven plain strings plus the bool
// needs_accommodation) that used to be hand-copied into both its branches.
// registrationNeedsUpdate's SEPARATE compare list is still hand-written and
// deliberately untouched -- whether it can fuse with the write list the way
// this one does is kindred#2552 piece 2, and it carries a real decision: a
// column whose write and compare sets should DIVERGE cannot simply join a
// fused list, for the same reason given in the paragraph below.
//
// ONE LIST FUSES TWO QUESTIONS -- "is this column written?" and "does a
// change to it make the row dirty?" -- and today those sets are identical for
// every medical column. A future column where they should DIVERGE (a
// write-only stamp, or a value deliberately outside change detection) must
// not simply be appended: it would make every row compare dirty on every run,
// which is the kindred#2384 shape. Split the list before adding one.
func medicalColumnValues(med *medicalData) []medicalColumnValue {
	return []medicalColumnValue{
		{"cpap_info", med.cpapInfo},
		{"physician_info", med.physicianInfo},
		{"special_needs_info", med.specialNeedsInfo},
		{"allergy_info", med.allergyInfo},
		{"dietary_info", med.dietaryInfo},
		{"additional_info", med.additionalInfo},
		{"bathroom_explain", med.bathroomExplain},
		{"accommodation_explain", med.accommodationExplain},
		{"allergy_gate", med.allergyGate},
		{"dietary_gate", med.dietaryGate},
		{"special_needs_gate", med.specialNeedsGate},
		{"physician_gate", med.physicianGate},
		{"cpap_gate", med.cpapGate},
		{enrollmentStatusColumn, med.enrollmentStatus},
	}
}

// medicalNeedsUpdate checks if a medical record needs updating
func (s *FamilyCampDerivedSync) medicalNeedsUpdate(existing *core.Record, med *medicalData) bool {
	for _, c := range medicalColumnValues(med) {
		if existing.GetString(c.column) != c.value {
			return true
		}
	}
	return false
}

// setMedicalFields writes the household's medical disclosures and derived
// gate answers. Shared by the create and update branches so the two cannot
// drift -- PocketBase Set on a column the schema lacks is a silent no-op, so
// a field written in only one branch fails invisibly on the other path.
func setMedicalFields(record *core.Record, med *medicalData) {
	for _, c := range medicalColumnValues(med) {
		record.Set(c.column, c.value)
	}
}

// ============================================================================
// Upsert functions
// ============================================================================

// upsertAdults performs upsert for adult records
func (s *FamilyCampDerivedSync) upsertAdults(
	ctx context.Context, adults []*adultData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errCount int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_adults")
	if err != nil {
		slog.Error("Error finding family_camp_adults collection", "error", err)
		return 0, 0, 0, len(adults)
	}

	for _, adult := range adults {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errCount
		default:
		}

		key := familyCampAdultKey(adult.householdPBID, year, adult.adultNumber)
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
				existingRecord.Set(enrollmentStatusColumn, adult.enrollmentStatus)
				setAttributeConflicts(existingRecord, adult)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating adult record", "household", adult.householdPBID, "error", err)
					errCount++
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
			record.Set(enrollmentStatusColumn, adult.enrollmentStatus)
			setAttributeConflicts(record, adult)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating adult record", "household", adult.householdPBID, "error", err)
				errCount++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errCount
}

// upsertRegistrations performs upsert for registration records
func (s *FamilyCampDerivedSync) upsertRegistrations(
	ctx context.Context, registrations []*registrationData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errCount int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_registrations")
	if err != nil {
		slog.Error("Error finding family_camp_registrations collection", "error", err)
		return 0, 0, 0, len(registrations)
	}

	for _, reg := range registrations {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errCount
		default:
		}

		key := familyCampHouseholdYearKey(reg.householdPBID, year)
		s.ProcessedRegKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			// Record exists - check if update needed
			if s.registrationNeedsUpdate(existingRecord, reg) {
				setRegistrationRequestFields(existingRecord, reg)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating registration record", "household", reg.householdPBID, "error", err)
					errCount++
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
			setRegistrationRequestFields(record, reg)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating registration record", "household", reg.householdPBID, "error", err)
				errCount++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errCount
}

// upsertMedical performs upsert for medical records
func (s *FamilyCampDerivedSync) upsertMedical(
	ctx context.Context, medical []*medicalData, year int, existing map[string]*core.Record,
) (created, updated, skipped, errCount int) {
	col, err := s.App.FindCollectionByNameOrId("family_camp_medical")
	if err != nil {
		slog.Error("Error finding family_camp_medical collection", "error", err)
		return 0, 0, 0, len(medical)
	}

	for _, med := range medical {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errCount
		default:
		}

		key := familyCampHouseholdYearKey(med.householdPBID, year)
		s.ProcessedMedicalKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			// Record exists - check if update needed
			if s.medicalNeedsUpdate(existingRecord, med) {
				setMedicalFields(existingRecord, med)

				if err := s.App.Save(existingRecord); err != nil {
					slog.Error("Error updating medical record", "household", med.householdPBID, "error", err)
					errCount++
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
			setMedicalFields(record, med)

			if err := s.App.Save(record); err != nil {
				slog.Error("Error creating medical record", "household", med.householdPBID, "error", err)
				errCount++
				continue
			}
			created++
		}
	}

	return created, updated, skipped, errCount
}

// ============================================================================
// Orphan deletion functions
//
// All three refuse to sweep when this run's computed set is too small to be
// believed against the rows already on disk (kindred#2257, kindred#2279). These
// were the last unguarded sweeps in the package, and they guard exactly the
// three tables a replay of an older season rewrites -- none of which has a
// history table behind it, so a wrong delete here has no way back.
//
// Computed is the size of the key set THIS RUN built, not the number of stored
// rows it happens to match; see OrphanSweepGuard's doc comment. Rejected is
// deliberately left unset, matching the nine other services that construct
// their own guard: this service counts no rejections, so the REJECTION arm
// cannot fire and there is nothing for it to fire on.
// ============================================================================

// isNamelessButAttributedAdult reports whether a family_camp_adults row has no
// name at all (name, first_name and last_name all empty) but carries at least
// one of the other adult attributes: date_of_birth, email, gender, pronouns or
// relationship_to_camper.
//
// kindred#2335 measured 188 such rows across 2017-2025 (plus 6 more in 2026),
// 137 of them holding a date_of_birth and 36 an email. They are households
// that answered the gender or date-of-birth question for an adult but never
// the name question -- a real adult with real attributes and no label, not the
// wholly-empty junk row kindred#2198 stopped ADMITTING. The owner's ruling
// (2026-08-14) is to protect the ones that already exist until their names can
// be rescued, which is separate, out-of-scope work: this function decides only
// whether a row survives a sweep, and recovers nothing.
//
// This deliberately does NOT change what gets CREATED -- #2198's admission
// rule is untouched, so a new wholly-nameless row still cannot come into
// existence. This only stops an existing one from being deleted.
func isNamelessButAttributedAdult(record *core.Record) bool {
	if record.GetString("name") != "" ||
		record.GetString("first_name") != "" ||
		record.GetString("last_name") != "" {
		return false
	}
	return record.GetString("date_of_birth") != "" ||
		record.GetString("email") != "" ||
		record.GetString("gender") != "" ||
		record.GetString("pronouns") != "" ||
		record.GetString("relationship_to_camper") != ""
}

// deleteOrphanedAdults removes adult records that weren't processed.
//
// A row that is wholly nameless but carries another attribute is protected
// rather than deleted (kindred#2335, isNamelessButAttributedAdult) -- the
// OrphanSweepGuard above does not catch this: the shortfall it measures is
// comfortably inside the guard's budget, so the guard is not a backstop for
// this class of row at all.
func (s *FamilyCampDerivedSync) deleteOrphanedAdults(
	existing map[string]*core.Record, year int,
) (int, error) {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for adults due to sync failure")
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "family_camp_adults",
		Year:     year,
		Computed: len(s.ProcessedAdultKeys),
		Hint:     familyCampSweepHint,
	}
	if err := guard.Check(len(existing)); err != nil {
		return 0, err
	}

	orphanCount := 0
	protectedCount := 0
	for key, record := range existing {
		if s.ProcessedAdultKeys[key] {
			continue
		}

		if isNamelessButAttributedAdult(record) {
			protectedCount++
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

	if protectedCount > 0 {
		slog.Info("Protected nameless-but-attributed family_camp_adults from sweep",
			"count", protectedCount, "year", year)
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned family_camp_adults records", "count", orphanCount)
	}

	return orphanCount, nil
}

// deleteOrphanedRegistrations removes registration records that weren't processed.
func (s *FamilyCampDerivedSync) deleteOrphanedRegistrations(
	existing map[string]*core.Record, year int,
) (int, error) {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for registrations due to sync failure")
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "family_camp_registrations",
		Year:     year,
		Computed: len(s.ProcessedRegKeys),
		Hint:     familyCampSweepHint,
	}
	if err := guard.Check(len(existing)); err != nil {
		return 0, err
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

	return orphanCount, nil
}

// deleteOrphanedMedical removes medical records that weren't processed.
func (s *FamilyCampDerivedSync) deleteOrphanedMedical(
	existing map[string]*core.Record, year int,
) (int, error) {
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion for medical due to sync failure")
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "family_camp_medical",
		Year:     year,
		Computed: len(s.ProcessedMedicalKeys),
		Hint:     familyCampSweepHint,
	}
	if err := guard.Check(len(existing)); err != nil {
		return 0, err
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

	return orphanCount, nil
}
