package sync

import (
	"fmt"
	"slices"
	"strconv"

	"github.com/pocketbase/pocketbase/core"
)

// Grain of a source field: whether its values key on a household or a person.
const (
	grainHousehold = "household"
	grainPerson    = "person"
)

// Target columns produced by the lodging ingest.
//
// These two are ROUTING KEYS rather than column names -- defIDsForTarget
// matches on them to pick which custom-field definitions each grain pass reads,
// and the pass writes lodging_assignments rows. They are the primary target of
// their registry rows for that reason. targetFamilyCampCabin below is a real
// column, and is the second thing the household field writes.
const (
	targetCabinAssignmentHousehold = "cabin_assignment_household"
	targetCabinAssignmentPerson    = "cabin_assignment_person"

	// family_camp_registrations.cabin_assignment -- the same staff-typed
	// string, kept at (household, year) grain as the raw record. The
	// assignment lane pins it to a weekend and queues an ingest issue when it
	// cannot; this column never tries and no caller may read it as
	// per-weekend placement (kindred#2336).
	targetFamilyCampCabin = "cabin_assignment"
)

// Target columns produced by the request layer (spec 4), on
// family_camp_registrations.
const (
	targetShareCabinGate           = "share_cabin_gate"
	targetSharedCabinModesRaw      = "shared_cabin_modes_raw"
	targetRequestText              = "request_text"
	targetNeedsPrivateBathroom     = "needs_private_bathroom"
	targetNeedsPower               = "needs_power"
	targetHasInfant                = "has_infant"
	targetAccommodationIsMandatory = "accommodation_is_mandatory"

	// The rest of the request layer. These are not the primary target of any
	// row -- they are the columns a field ALSO writes, which is the whole
	// reason Targets is a slice.
	targetShareCabinPreference   = "share_cabin_preference"
	targetWantsNear              = "wants_near"
	targetWantsWithNamed         = "wants_with_named"
	targetWantsSimilarAges       = "wants_similar_ages"
	targetShareEligibility       = "share_eligibility"
	targetShareEligibilitySource = "share_eligibility_source"
	targetRequestSourceField     = "request_source_field"
	targetRequestLastUpdated     = "request_last_updated"

	// TABLE-QUALIFIED because it is on a different table: the CPAP fields
	// reach family_camp_medical as well as family_camp_registrations, and an
	// unqualified "cpap_gate" beside "needs_power" would read as one row's two
	// columns rather than two tables'.
	//
	// medicalTablePrefix is the qualifier itself, lifted to a package-level
	// const because the fan-out guard builds and strips the same prefix when
	// it merges the two tables' columns into one comparison. Two copies of a
	// literal that must stay byte-identical is the drift this registry exists
	// to stop; one const cannot drift.
	medicalTablePrefix    = "family_camp_medical."
	targetMedicalCPAPGate = medicalTablePrefix + "cpap_gate"
)

// CampMinder custom-field ids for the lodging sources.
//
// Spec 4.4: "Source fields are matched on custom_field_defs.cm_id, NOT the
// user-editable display name." Staff can and do rename these in CampMinder; the
// names below are documentation, the ids are the contract. Verified against
// custom_field_defs on 2026-07-30.
const (
	// Household grain: partition ["Family"], lives in household_custom_values.
	// One value per household per YEAR -- which is exactly why session
	// attribution has to be derived rather than read.
	cmIDFamilyCampCabin = 218072 // "Family Camp Cabin"

	// Person grain: partition ["Camper","Adult"], lives in person_custom_values.
	// Verified: in 2024 and 2025 every one of these values that maps to an active
	// enrollment maps to an `adult` session, never a `family` one.
	cmIDReportableFamilyCampCabin = 223823 // "Reportable Family Camp Cabin"
)

// CampMinder custom-field ids for the request layer (spec 4). Verified against
// custom_field_defs on 2026-07-30, same basis as the two above: staff rename
// these, so the id is the contract and the name is the payload.
const (
	// The 3-state gate and the NEAR/WITH modes.
	cmIDShareCabinsRegistration = 240877 // "FAM CAMP-Share Cabins"
	cmIDSharedCabinForm         = 263379 // "FAM CAMP-Shared Cabin"

	// Free text, all three generations. COVID-19 Bunking Requests is a
	// misleading legacy name for a live second request detail, not a dead field.
	cmIDSharedRequest        = 274133 // "Shared-request"
	cmIDShareComments        = 240598 // "FAM CAMP-Share Comments"
	cmIDCovidBunkingRequests = 206286 // "COVID-19 Bunking Requests"

	// Housing and accessibility. The CPAP fields are multi-option selects
	// despite the boolean-looking name (kindred#1875).
	cmIDFamCampBathroom  = 274056 // "FAM CAMP-bathroom"        (Camper)
	cmIDAdultBathroom    = 274053 // "Adult-Bathroom"           (Adult)
	cmIDFamCampCPAP      = 256582 // "FAM CAMP-CPAP"            (Camper)
	cmIDFamilyCampCPAP   = 171577 // "Family Camp-CPAP"         (Camper, earlier generation)
	cmIDAdultCPAP        = 256933 // "Adult-CPAP"               (Adult)
	cmIDAdultInfant      = 257248 // "Adult-Infant"             (Adult)
	cmIDFamCampOptOutVIP = 256927 // "FAM CAMP-Opt Out VIP"     (Camper)
	cmIDAdultOptOut      = 256935 // "Adult-Opt Out"            (Adult)
)

// Display names of the source fields. These are documentation, not the matching
// key -- resolution goes through the cm_ids above. They exist as constants only
// because the same literals appear in family_camp_derived.go's name-routed
// switch, and goconst counts a third occurrence as drift waiting to happen.
const (
	fieldNameFamilyCampCabin           = "Family Camp Cabin"
	fieldNameReportableFamilyCampCabin = "Reportable Family Camp Cabin"
)

// lodgingSourceField is one CampMinder custom field the lodging ingest reads.
type lodgingSourceField struct {
	CMID int
	Name string // also the lookup key -- see lodgingSourceFieldByName
	// Targets is EVERY stored column this one CampMinder answer reaches, not
	// just the headline one. It is a slice because the interesting direction
	// of this map is the one a single value could not express.
	//
	// Many sources -> one target is the safe direction and was always
	// representable: three fields name request_text, two name
	// needs_private_bathroom. ONE source -> two columns is the direction that
	// has produced a defect twice -- `opt_out_vip` stored the Yes pole of an
	// answer whose No pole was already in `accommodation_is_mandatory`
	// (migration 1500000169), and `share_answers_conflict` was computed and
	// stored beside a verdict nothing read it with (1500000174) -- and while
	// this was `Target string` a fan-out was structurally unsayable. A reader
	// auditing the registry counted one column per row and concluded there
	// were none, which is exactly how both survived. kindred#2569.
	//
	// Targets[0] is the PRIMARY, and it is load-bearing rather than a
	// convention: it is the routing key defIDsForTarget matches on and the
	// value UpsertFieldMappingStatus snapshots into lodging_field_mappings.
	// The rest are declarations, pinned by
	// TestLodgingRequestFieldsDeclareEveryColumnTheTransformWrites.
	Targets []string
	Grain   string
}

// primaryTarget is the routing key: the column this field's answer is
// principally about. See Targets.
func (f lodgingSourceField) primaryTarget() string {
	if len(f.Targets) == 0 {
		return ""
	}
	return f.Targets[0]
}

// lodgingSourceFields is the assignment-source registry: the fields whose values
// become lodging_assignments rows.
//
// The request-layer fields live in lodgingRequestFields below rather than here,
// which is a deliberate split and not an oversight. The assignment ingest walks
// THIS slice to raise spec 4.4's zero-values warning, comparing against counts
// only that ingest collects; a request field listed here would file a work-queue
// issue on every run for a field another job is reading correctly.
var lodgingSourceFields = []lodgingSourceField{
	// TWO DESTINATIONS, TWO INGESTS. This field is admitted by the assignment
	// lane through its cm_id AND by family_camp_derived's "family camp" name
	// heuristic, so the one staff-typed string becomes a lodging_assignments
	// row (session-attributed, queueing an issue when it cannot be) and lands
	// verbatim in family_camp_registrations.cabin_assignment (household-year
	// grain, the raw record the journey card reads). Deliberate and both
	// halves are read -- but it was invisible here until kindred#2569, because
	// neither registry names the other lane's column.
	{CMID: cmIDFamilyCampCabin, Name: fieldNameFamilyCampCabin,
		Targets: []string{targetCabinAssignmentHousehold, targetFamilyCampCabin},
		Grain:   grainHousehold},
	// The person twin writes one destination: it is person-partition, and
	// processRegistrations' household loop is the only thing that routes a
	// cabin string into family_camp_registrations.
	{CMID: cmIDReportableFamilyCampCabin, Name: fieldNameReportableFamilyCampCabin,
		Targets: []string{targetCabinAssignmentPerson}, Grain: grainPerson},
}

// lodgingSourceFieldByName looks an assignment source field up by the display
// name a work-queue row carries in source_field.
//
// Matching on the name is safe HERE and nowhere else. Spec 4.4's rule -- match
// on cm_id, never the user-editable name -- governs reading CampMinder's
// definitions, and this reads none: the two grain passes stamp source_field
// with these very constants, so the stored value is the constant rather than
// whatever CampMinder currently calls the field. A rename therefore cannot
// break this lookup; it can only leave rows queued under the old constant,
// which is what they were queued under.
// Targets is CLONED on the way out. The struct is returned by value and
// primaryTarget has a value receiver, so the type reads as copy-safe -- but a
// slice field is not copied by either, and `f.Targets[0] = x` in a caller
// would rewrite the package-level registry for the life of the process.
// Nothing does that today; the clone is one two-element slice per work-queue
// row and it means nothing has to.
func lodgingSourceFieldByName(name string) (lodgingSourceField, bool) {
	for _, f := range lodgingSourceFields {
		if f.Name == name {
			f.Targets = slices.Clone(f.Targets)
			return f, true
		}
	}
	return lodgingSourceField{}, false
}

// lodgingRequestFields is the request-layer registry (spec 4): the CampMinder
// fields whose routing into a stored column is DECLARED -- mostly
// family_camp_registrations, and for the CPAP generations family_camp_medical
// as well.
//
// ⚠️ IT IS NOT THE WHOLE SWITCH, and reading it as one is how a fan-out hides.
// processRegistrations' person switch carries eight more case labels, across
// six arms, that no row below names -- "Family Camp-Trans ETA", the
// special-occasion gate and its describe half, "Family Camp-Goals Attending",
// "Family Camp-Anything else", and the three-generation accommodation gate --
// plus the `default:` arm. Between them they cover arrival_eta,
// special_occasions, goals, notes, needs_accommodation, needs_fridge and
// needs_step_free. processMedical routes its own narrative and gate fields by
// name as well, and of those only the CPAP trio is declared here.
//
// WHAT THAT COSTS THE GUARD, which is the part worth being plain about.
// TestLodgingRequestFieldsDeclareEveryColumnTheTransformWrites iterates THESE
// ROWS, so an undeclared arm is not an under-declaration it reports -- it is a
// field the guard never probes at all. The `default:` arm is the sharpest
// case: one accommodation-narrative value sets needs_fridge AND needs_step_free
// (mentionsFridge and mentionsStepFree, in the arm's two ifs), a
// one-source-to-two-column fan-out of exactly the shape Targets was widened to
// make sayable -- and it is structurally invisible, because there is no
// registry row for the guard to walk.
//
// Adding those arms is a DESIGN change rather than a doc fix, and is not made
// here: the free-text arms are name-routed generations with no cm_id contract
// of their own, and the `default:` arm is keyed by a name LIST rather than by a
// case label, so neither has a row shape today.
//
// Its job is the half extraFieldCMIDs could not do. That allowlist decides
// whether a definition is ADMITTED into the field map, so admission already
// survived a CampMinder rename — but routing downstream compares display names
// by exact equality, so a renamed field was admitted and then matched no case at
// all. Its answer reached no column, and nothing went red. Resolving the
// canonical Name from the CMID (see LodgingRequestFieldNames) closes that.
//
// Name is therefore NOT documentation here, unlike in lodgingSourceFields: it is
// the value the switch compares against, so it has to stay exactly in step with
// the case labels. The field-name constants are shared with that switch for
// precisely that reason.
var lodgingRequestFields = []lodgingSourceField{
	// The share pair. Both fields feed CollapseToHouseholdGrain, so both reach
	// the resolved verdict AND its provenance stamps, and each also keeps its
	// own answer verbatim in a raw column beside the verdict. That raw/verdict
	// pairing is deliberate and load-bearing -- ShareRequestSummary
	// (api/schemas/lodging.py) forbids recomputing the verdict from the raw --
	// but note the registry used to declare the pair at DIFFERENT layers: the
	// verdict for one field and the raw for the other. Both are declared now.
	{CMID: cmIDShareCabinsRegistration, Name: fieldShareCabinsRegistration,
		Targets: []string{
			targetShareCabinGate, targetShareCabinPreference,
			targetShareEligibility, targetShareEligibilitySource,
			targetRequestSourceField, targetRequestLastUpdated,
		}, Grain: grainPerson},
	// share_cabin_gate is declared here too, and it is not a courtesy: this
	// field is in the SAME switch arm as the registration gate above and wins
	// an exact timestamp tie for that column (winsGate). No live option
	// sentence of this field normalises to a gate today -- "No requests" is
	// held out by NormalizeShareGate's "shar" guard, which is the bug that
	// guard exists to stop -- so the route is reachable rather than exercised,
	// and that is exactly the kind of thing a declaration should carry.
	{CMID: cmIDSharedCabinForm, Name: fieldSharedCabinForm,
		Targets: []string{
			targetSharedCabinModesRaw, targetShareCabinGate,
			targetWantsNear, targetWantsWithNamed, targetWantsSimilarAges,
			targetShareEligibility, targetShareEligibilitySource,
			targetRequestSourceField, targetRequestLastUpdated,
		}, Grain: grainPerson},

	// Free text. Three sources, one text column -- the safe many-to-one
	// direction -- plus the recency stamp spec 4.1 resolves precedence with.
	// They do NOT set request_source_field: that stamp names the field the
	// GATE came from, and only the two arms above write it.
	{CMID: cmIDSharedRequest, Name: fieldSharedRequest,
		Targets: []string{targetRequestText, targetRequestLastUpdated}, Grain: grainPerson},
	{CMID: cmIDShareComments, Name: fieldShareComments,
		Targets: []string{targetRequestText, targetRequestLastUpdated}, Grain: grainPerson},
	{CMID: cmIDCovidBunkingRequests, Name: fieldCovidBunkingRequests,
		Targets: []string{targetRequestText, targetRequestLastUpdated}, Grain: grainPerson},

	// One column each, and the narrative that explains them is a DIFFERENT
	// pair of CampMinder fields (Housing-Bathroom / Bathroom-Yes) that reaches
	// family_camp_medical.bathroom_explain. These two carry only the boolean.
	{CMID: cmIDFamCampBathroom, Name: fieldFamCampBathroom,
		Targets: []string{targetNeedsPrivateBathroom}, Grain: grainPerson},
	{CMID: cmIDAdultBathroom, Name: fieldAdultBathroom,
		Targets: []string{targetNeedsPrivateBathroom}, Grain: grainPerson},

	// THREE COLUMNS ACROSS TWO TABLES, and only the first split was ever
	// written down. classifyCPAPAnswer resolves the multi-option sentence into
	// needs_power and needs_private_bathroom (kindred#1875), and processMedical
	// ALSO reads these same three fields into family_camp_medical.cpap_gate
	// (kindred#2542).
	//
	// Not a pole pair, and worth stating so nobody "tidies" one away: the gate
	// is three-state and separates a recorded No from a question never asked,
	// which the two booleans cannot. The one-way implication is
	// cpap_gate == "yes"  =>  needs_power || needs_private_bathroom, since
	// classifyCPAPAnswer always sets at least one need for an answer
	// parseBoolFieldValue accepts. The converse does NOT hold --
	// needs_private_bathroom is also set by the two bathroom fields above.
	{CMID: cmIDFamCampCPAP, Name: fieldFamCampCPAP,
		Targets: []string{targetNeedsPower, targetNeedsPrivateBathroom, targetMedicalCPAPGate},
		Grain:   grainPerson},
	{CMID: cmIDFamilyCampCPAP, Name: fieldFamilyCampCPAP,
		Targets: []string{targetNeedsPower, targetNeedsPrivateBathroom, targetMedicalCPAPGate},
		Grain:   grainPerson},
	{CMID: cmIDAdultCPAP, Name: fieldAdultCPAP,
		Targets: []string{targetNeedsPower, targetNeedsPrivateBathroom, targetMedicalCPAPGate},
		Grain:   grainPerson},

	{CMID: cmIDAdultInfant, Name: fieldAdultInfant,
		Targets: []string{targetHasInfant}, Grain: grainPerson},

	// ONE column, and it is one on purpose. This answer was stored as two --
	// opt_out_vip held the Yes pole and accommodation_is_mandatory the No --
	// until migration 1500000169 dropped the Yes pole on the owner ruling of
	// 2026-08-22. It is the precedent this whole registry shape exists to make
	// visible, and it is clean now.
	{CMID: cmIDFamCampOptOutVIP, Name: fieldFamCampOptOutVIP,
		Targets: []string{targetAccommodationIsMandatory}, Grain: grainPerson},
	{CMID: cmIDAdultOptOut, Name: fieldAdultOptOut,
		Targets: []string{targetAccommodationIsMandatory}, Grain: grainPerson},
}

// LodgingRequestFieldNames maps custom_field_defs PB record id -> the canonical
// display name family_camp_derived.go's switch routes on, for every registered
// request field present in this database.
//
// Callers should overlay this on top of the name CampMinder currently reports,
// so a field staff renamed still reaches its column.
//
// Unlike LodgingFieldDefIDs this does not consult disabledFieldCMIDs. There is
// nothing coherent for an off switch to mean here: skipping the overlay would
// not stop the field being read, it would only stop the rename being corrected,
// so a "disabled" field would keep working right up until somebody renamed it.
// When the request layer gains a real per-field off switch it belongs at the
// admission boundary, not here.
func LodgingRequestFieldNames(app core.App) (map[string]string, error) {
	byCMID := make(map[int]string, len(lodgingRequestFields))
	for _, f := range lodgingRequestFields {
		byCMID[f.CMID] = f.Name
	}

	defs, err := app.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading custom_field_defs: %w", err)
	}

	result := make(map[string]string, len(byCMID))
	for _, d := range defs {
		if name, ok := byCMID[d.GetInt("cm_id")]; ok {
			result[d.Id] = name
		}
	}
	return result, nil
}

// LodgingFieldDefIDs maps custom_field_defs PB record id -> target column, for
// every registered source field that exists in this database and has not been
// disabled by a human in lodging_field_mappings.
//
// Returning PB ids rather than names is deliberate: household_custom_values and
// person_custom_values store field_definition as a PB relation, so this is the
// key the value rows actually carry.
func LodgingFieldDefIDs(app core.App) (map[string]string, error) {
	disabled, err := disabledFieldCMIDs(app)
	if err != nil {
		return nil, err
	}

	byCMID := make(map[int]string, len(lodgingSourceFields))
	for _, f := range lodgingSourceFields {
		if disabled[f.CMID] {
			continue
		}
		byCMID[f.CMID] = f.primaryTarget()
	}

	defs, err := app.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading custom_field_defs: %w", err)
	}

	result := make(map[string]string, len(byCMID))
	for _, d := range defs {
		if target, ok := byCMID[d.GetInt("cm_id")]; ok {
			result[d.Id] = target
		}
	}
	return result, nil
}

// disabledFieldCMIDs reads the human-set off switches. A missing row means
// enabled: spec 4.4 keeps a mapping active until somebody turns it off.
func disabledFieldCMIDs(app core.App) (map[int]bool, error) {
	rows, err := app.FindRecordsByFilter("lodging_field_mappings", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading lodging_field_mappings: %w", err)
	}
	disabled := make(map[int]bool)
	for _, r := range rows {
		if !r.GetBool("is_enabled") {
			disabled[r.GetInt("field_cm_id")] = true
		}
	}
	return disabled, nil
}

// UpsertFieldMappingStatus records this year's observed value count per source
// field, and the previous year's, so the admin UI can show spec 4.4's passive
// warning ("0 values in 2026, 171 in 2025").
//
// It NEVER writes is_enabled on an existing row. Auto-inferring retirement would
// have silently dropped "FAM CAMP-Share Comments", which had 0 values in 2023,
// 112 in 2024, 171 in 2025 and 0 in 2026 and is still live. New rows are created
// with is_enabled explicitly true, because PocketBase has no per-field default
// for a bool and an unset one stores as false.
func UpsertFieldMappingStatus(app core.App, year int, counts, priorCounts map[int]int) error {
	col, err := app.FindCollectionByNameOrId("lodging_field_mappings")
	if err != nil {
		return fmt.Errorf("finding lodging_field_mappings: %w", err)
	}

	names, err := fieldNamesByCMID(app)
	if err != nil {
		return err
	}

	for _, f := range lodgingSourceFields {
		existing, findErr := app.FindRecordsByFilter(
			"lodging_field_mappings", "field_cm_id = "+strconv.Itoa(f.CMID), "", 1, 0)
		if findErr != nil {
			return fmt.Errorf("finding mapping %d: %w", f.CMID, findErr)
		}

		var rec *core.Record
		if len(existing) > 0 {
			rec = existing[0]
		} else {
			rec = core.NewRecord(col)
			rec.Set("field_cm_id", f.CMID)
			rec.Set("is_enabled", true)
		}

		name := names[f.CMID]
		if name == "" {
			name = f.Name
		}
		rec.Set("field_name", name)
		rec.Set("target", f.primaryTarget())

		// last_seen_* means MOST RECENT, and the sync is year-parameterised, so
		// Task 14's 2024/2025 backfill runs AFTER the current season has synced.
		// Writing the backfill year's counts over the current ones would make
		// spec 4.4's passive warning describe the wrong season. An older run
		// still refreshes the name and target snapshot, but not the counters.
		if year >= rec.GetInt("last_seen_year") {
			rec.Set("last_seen_year", year)
			rec.Set("last_seen_count", counts[f.CMID])
			rec.Set("prior_year_count", priorCounts[f.CMID])
		}

		if err := app.Save(rec); err != nil {
			return fmt.Errorf("saving mapping %d: %w", f.CMID, err)
		}
	}
	return nil
}

// fieldNamesByCMID snapshots the current display names for the admin UI.
func fieldNamesByCMID(app core.App) (map[int]string, error) {
	defs, err := app.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading custom_field_defs: %w", err)
	}
	names := make(map[int]string, len(defs))
	for _, d := range defs {
		names[d.GetInt("cm_id")] = normalizeFieldName(d.GetString("name"))
	}
	return names, nil
}
