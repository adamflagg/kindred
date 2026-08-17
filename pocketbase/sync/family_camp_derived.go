package sync

import (
	"context"
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
}

// registrationData holds extracted registration information
type registrationData struct {
	householdPBID        string
	cabinAssignment      string
	shareCabinPreference string
	// Renamed from sharedCabinWith by Task 16's migration. It never held "who
	// they want to share with" -- it holds the pipe-delimited NEAR/WITH
	// multi-select verbatim. wantsNear / wantsWith below are the parsed form.
	sharedCabinModesRaw string
	arrivalETA          string
	specialOccasions    string
	goals               string
	notes               string
	needsAccommodation  bool
	optOutVIP           bool

	// Household-grain request layer (spec 4). shareCabinPreference and
	// sharedCabinModesRaw above stay as the RAW profile values; these are the
	// normalised, deduplicated versions the board reads.
	shareCabinGate string
	wantsNear      bool
	wantsWith      bool
	// wantsSimilarAges implies wantsWith: the option it comes from is itself a
	// "Share a cabin WITH" answer whose partner is unnamed, which is what makes
	// these households the staff-matchable pool.
	wantsSimilarAges   bool
	requestText        string
	requestSourceField string
	requestLastUpdated time.Time

	// The RESOLVED share verdict the board places on, and its provenance.
	// shareCabinGate above is the registration answer only; the Family Camp
	// information form outranks it wherever both were answered, which is why
	// these are separate columns rather than a reinterpretation of the gate.
	// shareAnswersConflict marks the two forms pointing opposite ways -- a
	// staff-review signal, not a placement rule. See DeriveShareEligibility.
	shareEligibility       string
	shareEligibilitySource string
	shareAnswersConflict   bool

	// Derived accessibility flags. Spec 5.3: the board shows a flag, never the
	// narrative -- that lives in family_camp_medical.
	needsPrivateBathroom     bool
	needsPower               bool
	accommodationIsMandatory bool

	// Housing-suitability signal rather than an accessibility need (kindred#1876).
	hasInfant bool
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
	// PHI narrative. Detailed medical disclosures about named individuals.
	// Never logged, never exported (see lodging_phi_test.go).
	//
	// The two below are the ones this plan added, but the never-log/never-export
	// contract covers EVERY text field on this struct -- cpapInfo, physicianInfo,
	// specialNeedsInfo, allergyInfo, dietaryInfo and additionalInfo carry the
	// same kind of sentence. lodging_phi_test.go's phiColumns is the full list
	// and the authority; this comment sits here only because it is where a
	// future editor adding a field will be looking.
	bathroomExplain      string
	accommodationExplain string
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

	// Step 5: Process adults data
	adults := s.processAdults(householdValues, personValues)
	slog.Info("Processed adults", "count", len(adults))

	// Step 6: Process registrations data
	registrations := s.processRegistrations(householdValues, personValues)
	slog.Info("Processed registrations", "count", len(registrations))

	// Step 7: Process medical data
	medical := s.processMedical(personValues)
	slog.Info("Processed medical", "count", len(medical))

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
// is either by name heuristic or, for the two PHI narratives, by a name-keyed
// lookup in processMedical.
//
// The entries duplicated in lodgingRequestFields are kept rather than deleted:
// admission runs first, and leaving a field's admission dependent on the routing
// registry would couple two things that fail differently.
var extraFieldCMIDs = map[int]bool{
	274057: true, // Housing Accommodation        (Camper) — successor to FAM Camp-Accommodation
	274055: true, // Housing Accomodation  (sic)  (Adult)
	274058: true, // Housing Accommodation-Yes    (Camper) — PHI narrative, spec 5
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

		// Sorted by id, for the reason spelled out in loadHouseholdCustomValues:
		// this is the read the request-layer precedence depends on.
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
// slice loadPersonCustomValues returns in record-id order, so when two
// enrolled siblings carry different answers the winner is whichever row has
// the lower id -- which correlates with nothing. Measured over the 382
// rostered 2026 households: 254 (household, field, adult) groups disagree
// across 113 households.
//
// RESOLVED for email only (owner ruling 2026-08-09, kindred#1945): when the
// siblings' emails differ and are both non-empty, preferEmail breaks the tie
// by well-formedness instead of load order -- see its doc comment. Email got
// a rule because the harm is concrete and the rule is crisp: 5 stored adult
// emails carry a domain typo in production, 4 of which have a correct
// version on a sibling form that iteration order was discarding.
//
// STILL PENDING for every other merged field (first/last name, pronouns,
// gender, date_of_birth, relationship): first-non-empty-wins over load order
// stands, unchanged, because none of them has a validity notion as crisp as
// "syntactically valid email" -- inventing one to feel consistent would be
// guessing, not fixing. Which sibling should win there remains a product
// decision. It is NOT coupled to whether the columns exist: kindred#1945
// closed 2026-08-09 refusing deletion ("No deletion of the gender /
// date_of_birth / email / pronouns columns -- the 2026-08-07 hold stands"),
// so column existence blocks nothing here. What #1945 left open is exactly
// this per-attribute merge policy, and that is kindred#2275's subject.
// Today's behavior for those fields is pinned by test instead of changed on
// a guess.
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
// slot collisions -- and that residual is what the grain decision on
// kindred#2275 now rests on.
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

		// Only set if empty (first non-empty wins for deduplication), EXCEPT
		// email: see preferEmail for the kindred#1945 validity-preferring rule.
		switch {
		case strings.Contains(v.fieldName, "First Name") && adult.firstName == "":
			adult.firstName = v.value
		case strings.Contains(v.fieldName, "Last Name") && adult.lastName == "":
			adult.lastName = v.value
		case strings.Contains(v.fieldName, "Email"):
			if preferEmail(adult.email, v.value) {
				adult.email = v.value
			}
		case strings.Contains(v.fieldName, "Pronouns") && adult.pronouns == "":
			adult.pronouns = v.value
		case strings.Contains(v.fieldName, "Gender") && adult.gender == "":
			adult.gender = v.value
		case strings.Contains(v.fieldName, "DOB") && adult.dateOfBirth == "":
			// Normalised, not merged: see normalizeDateOfBirth. Which sibling
			// wins is still load order (kindred#2275); what changes is that
			// the winner is stored in one canonical form, so two siblings who
			// typed the SAME birthday two ways no longer read as a conflict.
			adult.dateOfBirth = normalizeDateOfBirth(v.value)
		case strings.Contains(v.fieldName, "Relationship") && adult.relationship == "":
			adult.relationship = normalizeRelationshipToCamper(v.value)
		}
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
			optedOut := parseBoolFieldValue(v.value)
			// Accumulated with OR here and then RESOLVED against the blocker in
			// the finalization pass below (kindred#1874). Both steps are needed:
			// this one cannot see the rest of the household, so on its own it
			// let one member's "Yes, please register regardless of cabin type"
			// override another's "No, I am only able to attend with this
			// accommodation in place" -- 3 households a year.
			reg.optOutVIP = reg.optOutVIP || optedOut
			// "Yes, please register regardless of cabin type" (90 values) means
			// the family will come anyway, so the need is a warning. "No, I am
			// only able to attend with this accommodation in place" (39) makes it
			// a blocker. An UNANSWERED question must stay soft, which is why this
			// keys off a non-empty value rather than off !optedOut alone.
			if strings.TrimSpace(v.value) != "" && !optedOut {
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
		}
	}

	s.applyHouseholdRequests(regMap, personValues)

	// Convert to slice
	var result []*registrationData
	for _, reg := range regMap {
		// Collapse the collected free text last, so every household member has
		// been seen. Doing it inside the loop above is what made it first-wins.
		s.applyRegistrationText(reg, textByHousehold[reg.householdPBID])

		// A blocker anywhere in the household outranks another member's opt-out
		// (kindred#1874). Resolving it here rather than in the switch is what
		// makes it order-independent: the switch sees one member at a time and
		// cannot know a later one will answer blocker, so a running OR gave a
		// different answer depending on which member CampMinder returned first.
		//
		// The two columns are a three-state answer wearing two booleans, and
		// this is what keeps them mutually exclusive:
		//
		//	accommodationIsMandatory  -> some member cannot attend without it
		//	optOutVIP                 -> answered, and the family will come anyway
		//	both false                -> nobody answered
		//
		// Collapsing toward the blocker is the fail-SAFE direction. The reverse
		// reads as "this family will cope" when someone said they cannot attend.
		if reg.accommodationIsMandatory {
			reg.optOutVIP = false
		}

		// Only include if has some data
		if reg.cabinAssignment != "" || reg.shareCabinPreference != "" ||
			reg.sharedCabinModesRaw != "" || reg.arrivalETA != "" ||
			reg.specialOccasions != "" || reg.goals != "" ||
			reg.notes != "" || reg.needsAccommodation || reg.optOutVIP ||
			reg.shareCabinGate != "" || reg.requestText != "" ||
			reg.wantsNear || reg.wantsWith || reg.wantsSimilarAges ||
			reg.needsPrivateBathroom || reg.needsPower || reg.hasInfant ||
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
		reg.wantsWith = req.WantsWith
		reg.wantsSimilarAges = req.WantsSimilarAges
		reg.requestText = req.RequestText
		reg.requestSourceField = req.SourceField
		reg.requestLastUpdated = req.LastUpdated
		reg.shareEligibility = req.ShareEligibility
		reg.shareEligibilitySource = req.ShareEligibilitySource
		reg.shareAnswersConflict = req.ShareAnswersConflict
	}
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

		// CPAP info. The two Camper-partition names are generations of the SAME
		// question, so they collapse to one answer; Adult-CPAP is a DIFFERENT
		// PERSON and is therefore additive.
		//
		// That split has to match the flag logic in processRegistrations, which
		// ORs across all three. A single first-wins loop over all three -- what
		// this was -- meant a household with a camper "outlet needed" answer and
		// an adult "bathroom ... needed" answer raised BOTH flags while the
		// medical record kept only the camper's sentence, leaving
		// needs_private_bathroom with nothing behind it in the one place staff
		// can look for the reason.
		cpapParts := []string{}
		for _, key := range []string{fieldFamilyCampCPAP, fieldFamCampCPAP} {
			if v, ok := fields[key]; ok && v != "" {
				cpapParts = append(cpapParts, v)
				break
			}
		}
		if v, ok := fields[fieldAdultCPAP]; ok && v != "" && !slices.Contains(cpapParts, v) {
			cpapParts = append(cpapParts, v)
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

		// PHI narrative for the two accessibility questions. These sentences
		// describe named individuals' medical circumstances, so they live only
		// here -- family_camp_medical is admin-gated on all five rules and is
		// absent from every export config (lodging_phi_test.go asserts that).
		bathroomParts := []string{}
		for _, key := range []string{"Housing-Bathroom", "Bathroom-Yes"} {
			if v, ok := fields[key]; ok && v != "" {
				bathroomParts = append(bathroomParts, v)
			}
		}
		med.bathroomExplain = strings.Join(bathroomParts, "; ")

		if v, ok := fields["Housing Accommodation-Yes"]; ok && v != "" {
			med.accommodationExplain = v
		}

		// Only include if has some data
		if med.cpapInfo != "" || med.physicianInfo != "" ||
			med.specialNeedsInfo != "" || med.allergyInfo != "" ||
			med.dietaryInfo != "" || med.additionalInfo != "" ||
			med.bathroomExplain != "" || med.accommodationExplain != "" {
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
		existing.GetString("relationship_to_camper") != adult.relationship
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
		existing.GetBool("opt_out_vip") != reg.optOutVIP ||
		existing.GetString("share_cabin_gate") != reg.shareCabinGate ||
		existing.GetBool("wants_near") != reg.wantsNear ||
		existing.GetBool("wants_with") != reg.wantsWith ||
		existing.GetBool("wants_similar_ages") != reg.wantsSimilarAges ||
		existing.GetString("request_text") != reg.requestText ||
		existing.GetString("request_source_field") != reg.requestSourceField ||
		existing.GetString("request_last_updated") != formatRequestStamp(reg.requestLastUpdated) ||
		existing.GetBool("needs_private_bathroom") != reg.needsPrivateBathroom ||
		existing.GetBool("needs_power") != reg.needsPower ||
		existing.GetBool("accommodation_is_mandatory") != reg.accommodationIsMandatory ||
		existing.GetBool("has_infant") != reg.hasInfant ||
		existing.GetString("share_eligibility") != normalizedEligibility ||
		existing.GetString("share_eligibility_source") != normalizedSource ||
		existing.GetBool("share_answers_conflict") != reg.shareAnswersConflict
}

// setRegistrationRequestFields writes the household-grain request layer and the
// derived housing flags. Shared by the create and update branches so the two
// cannot drift -- PocketBase Set on a column the schema lacks is a silent no-op,
// so a field written in only one branch fails invisibly on the other path.
func setRegistrationRequestFields(record *core.Record, reg *registrationData) {
	record.Set("share_cabin_gate", reg.shareCabinGate)
	record.Set("wants_near", reg.wantsNear)
	record.Set("wants_with", reg.wantsWith)
	record.Set("wants_similar_ages", reg.wantsSimilarAges)
	record.Set("request_text", reg.requestText)
	record.Set("request_source_field", reg.requestSourceField)
	record.Set("request_last_updated", formatRequestStamp(reg.requestLastUpdated))
	record.Set("needs_private_bathroom", reg.needsPrivateBathroom)
	record.Set("needs_power", reg.needsPower)
	record.Set("accommodation_is_mandatory", reg.accommodationIsMandatory)
	record.Set("has_infant", reg.hasInfant)
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
	record.Set("share_answers_conflict", reg.shareAnswersConflict)
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

// medicalNeedsUpdate checks if a medical record needs updating
func (s *FamilyCampDerivedSync) medicalNeedsUpdate(existing *core.Record, med *medicalData) bool {
	return existing.GetString("cpap_info") != med.cpapInfo ||
		existing.GetString("physician_info") != med.physicianInfo ||
		existing.GetString("special_needs_info") != med.specialNeedsInfo ||
		existing.GetString("allergy_info") != med.allergyInfo ||
		existing.GetString("dietary_info") != med.dietaryInfo ||
		existing.GetString("additional_info") != med.additionalInfo ||
		existing.GetString("bathroom_explain") != med.bathroomExplain ||
		existing.GetString("accommodation_explain") != med.accommodationExplain
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
				existingRecord.Set("cabin_assignment", reg.cabinAssignment)
				existingRecord.Set("share_cabin_preference", reg.shareCabinPreference)
				existingRecord.Set("shared_cabin_modes_raw", reg.sharedCabinModesRaw)
				existingRecord.Set("arrival_eta", reg.arrivalETA)
				existingRecord.Set("special_occasions", reg.specialOccasions)
				existingRecord.Set("goals", reg.goals)
				existingRecord.Set("notes", reg.notes)
				existingRecord.Set("needs_accommodation", reg.needsAccommodation)
				existingRecord.Set("opt_out_vip", reg.optOutVIP)
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
			record.Set("cabin_assignment", reg.cabinAssignment)
			record.Set("share_cabin_preference", reg.shareCabinPreference)
			record.Set("shared_cabin_modes_raw", reg.sharedCabinModesRaw)
			record.Set("arrival_eta", reg.arrivalETA)
			record.Set("special_occasions", reg.specialOccasions)
			record.Set("goals", reg.goals)
			record.Set("notes", reg.notes)
			record.Set("needs_accommodation", reg.needsAccommodation)
			record.Set("opt_out_vip", reg.optOutVIP)
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
				existingRecord.Set("cpap_info", med.cpapInfo)
				existingRecord.Set("physician_info", med.physicianInfo)
				existingRecord.Set("special_needs_info", med.specialNeedsInfo)
				existingRecord.Set("allergy_info", med.allergyInfo)
				existingRecord.Set("dietary_info", med.dietaryInfo)
				existingRecord.Set("additional_info", med.additionalInfo)
				existingRecord.Set("bathroom_explain", med.bathroomExplain)
				existingRecord.Set("accommodation_explain", med.accommodationExplain)

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
			record.Set("cpap_info", med.cpapInfo)
			record.Set("physician_info", med.physicianInfo)
			record.Set("special_needs_info", med.specialNeedsInfo)
			record.Set("allergy_info", med.allergyInfo)
			record.Set("dietary_info", med.dietaryInfo)
			record.Set("additional_info", med.additionalInfo)
			record.Set("bathroom_explain", med.bathroomExplain)
			record.Set("accommodation_explain", med.accommodationExplain)

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
