package sync

import (
	"fmt"
	"strconv"

	"github.com/pocketbase/pocketbase/core"
)

// Grain of a source field: whether its values key on a household or a person.
const (
	grainHousehold = "household"
	grainPerson    = "person"
)

// Target columns produced by the lodging ingest.
const (
	targetCabinAssignmentHousehold = "cabin_assignment_household"
	targetCabinAssignmentPerson    = "cabin_assignment_person"
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
	CMID   int
	Name   string // display name at time of writing; documentation only
	Target string
	Grain  string
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
	{CMID: cmIDFamilyCampCabin, Name: fieldNameFamilyCampCabin,
		Target: targetCabinAssignmentHousehold, Grain: grainHousehold},
	{CMID: cmIDReportableFamilyCampCabin, Name: fieldNameReportableFamilyCampCabin,
		Target: targetCabinAssignmentPerson, Grain: grainPerson},
}

// lodgingRequestFields is the request-layer registry (spec 4): every CampMinder
// field family_camp_derived.go's switch routes into a family_camp_registrations
// column.
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
	{CMID: cmIDShareCabinsRegistration, Name: fieldShareCabinsRegistration,
		Target: targetShareCabinGate, Grain: grainPerson},
	{CMID: cmIDSharedCabinForm, Name: fieldSharedCabinForm,
		Target: targetSharedCabinModesRaw, Grain: grainPerson},

	{CMID: cmIDSharedRequest, Name: fieldSharedRequest,
		Target: targetRequestText, Grain: grainPerson},
	{CMID: cmIDShareComments, Name: fieldShareComments,
		Target: targetRequestText, Grain: grainPerson},
	{CMID: cmIDCovidBunkingRequests, Name: fieldCovidBunkingRequests,
		Target: targetRequestText, Grain: grainPerson},

	{CMID: cmIDFamCampBathroom, Name: fieldFamCampBathroom,
		Target: targetNeedsPrivateBathroom, Grain: grainPerson},
	{CMID: cmIDAdultBathroom, Name: fieldAdultBathroom,
		Target: targetNeedsPrivateBathroom, Grain: grainPerson},

	// These three target needs_power, but a bathroom-qualified option also sets
	// needs_private_bathroom -- classifyCPAPAnswer owns that split. Target names
	// the primary column; it is not a claim that the field writes only one.
	{CMID: cmIDFamCampCPAP, Name: fieldFamCampCPAP,
		Target: targetNeedsPower, Grain: grainPerson},
	{CMID: cmIDFamilyCampCPAP, Name: fieldFamilyCampCPAP,
		Target: targetNeedsPower, Grain: grainPerson},
	{CMID: cmIDAdultCPAP, Name: fieldAdultCPAP,
		Target: targetNeedsPower, Grain: grainPerson},

	{CMID: cmIDAdultInfant, Name: fieldAdultInfant,
		Target: targetHasInfant, Grain: grainPerson},

	{CMID: cmIDFamCampOptOutVIP, Name: fieldFamCampOptOutVIP,
		Target: targetAccommodationIsMandatory, Grain: grainPerson},
	{CMID: cmIDAdultOptOut, Name: fieldAdultOptOut,
		Target: targetAccommodationIsMandatory, Grain: grainPerson},
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
		byCMID[f.CMID] = f.Target
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
		rec.Set("target", f.Target)

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
