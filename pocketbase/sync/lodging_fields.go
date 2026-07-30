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

// Display names of the source fields. These are documentation, not the matching
// key -- resolution goes through the cm_ids above. They exist as constants only
// because the same literals appear in family_camp_derived.go's name-routed
// switch, and goconst counts a third occurrence as drift waiting to happen.
const fieldNameFamilyCampCabin = "Family Camp Cabin"

// lodgingSourceField is one CampMinder custom field the lodging ingest reads.
type lodgingSourceField struct {
	CMID   int
	Name   string // display name at time of writing; documentation only
	Target string
	Grain  string
}

// lodgingSourceFields is the assignment-source registry. Phase C appends the
// request-layer fields to it.
var lodgingSourceFields = []lodgingSourceField{
	{CMID: cmIDFamilyCampCabin, Name: fieldNameFamilyCampCabin,
		Target: targetCabinAssignmentHousehold, Grain: grainHousehold},
	{CMID: cmIDReportableFamilyCampCabin, Name: "Reportable Family Camp Cabin",
		Target: targetCabinAssignmentPerson, Grain: grainPerson},
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
		rec.Set("last_seen_year", year)
		rec.Set("last_seen_count", counts[f.CMID])
		rec.Set("prior_year_count", priorCounts[f.CMID])

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
