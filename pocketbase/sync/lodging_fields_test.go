package sync

import (
	"strconv"
	"testing"
)

// TestLodgingSourceFieldsAreUnique guards the registry itself: two entries with
// the same cm_id would make LodgingFieldDefIDs non-deterministic, and
// lodging_field_mappings has a UNIQUE index on field_cm_id that would reject the
// second row at sync time rather than at review time.
func TestLodgingSourceFieldsAreUnique(t *testing.T) {
	t.Parallel()
	seenCMID := map[int]string{}
	for _, f := range lodgingSourceFields {
		if prev, dup := seenCMID[f.CMID]; dup {
			t.Errorf("cm_id %d is registered twice: %q and %q", f.CMID, prev, f.Name)
		}
		seenCMID[f.CMID] = f.Name
		if f.Target == "" {
			t.Errorf("%q (cm_id %d) has no target", f.Name, f.CMID)
		}
		if f.Grain != grainHousehold && f.Grain != grainPerson {
			t.Errorf("%q (cm_id %d) has grain %q; want %q or %q",
				f.Name, f.CMID, f.Grain, grainHousehold, grainPerson)
		}
	}
}

// TestLodgingRequestFieldsAreWellFormed guards the request-layer registry the
// same way, and additionally that it stays DISJOINT from lodgingSourceFields.
//
// Disjointness is not tidiness. lodging_field_mappings has a UNIQUE index on
// field_cm_id, and the assignment ingest raises spec 4.4's zero-values warning
// by walking lodgingSourceFields and comparing against counts only IT collects
// -- so a request field appearing in that slice would file a work-queue issue
// every single run, for a field that is being read correctly by somebody else.
func TestLodgingRequestFieldsAreWellFormed(t *testing.T) {
	t.Parallel()
	assignment := map[int]string{}
	for _, f := range lodgingSourceFields {
		assignment[f.CMID] = f.Name
	}

	seen := map[int]string{}
	for _, f := range lodgingRequestFields {
		if prev, dup := seen[f.CMID]; dup {
			t.Errorf("cm_id %d is registered twice: %q and %q", f.CMID, prev, f.Name)
		}
		seen[f.CMID] = f.Name

		if prev, clash := assignment[f.CMID]; clash {
			t.Errorf("cm_id %d (%q) is in both registries, also as %q", f.CMID, f.Name, prev)
		}
		if f.Name == "" || f.Target == "" {
			t.Errorf("cm_id %d has an empty name (%q) or target (%q)", f.CMID, f.Name, f.Target)
		}
		if f.Name != normalizeFieldName(f.Name) {
			t.Errorf("%q is not in canonical (trimmed) form; the switch compares by exact equality", f.Name)
		}
		if f.Grain != grainHousehold && f.Grain != grainPerson {
			t.Errorf("%q (cm_id %d) has grain %q", f.Name, f.CMID, f.Grain)
		}
	}
}

// TestLodgingRequestFieldNamesResolveThroughCMID is the point of the registry:
// staff rename these in CampMinder, and family_camp_derived.go routes on the
// display name. Resolving the name back from the cm_id is what stops a rename
// from silently disconnecting an answer from its column.
func TestLodgingRequestFieldNamesResolveThroughCMID(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)

	renamed := addFieldDef(t, app, cmIDShareCabinsRegistration, "FC Cabin Sharing 2027")
	untouched := addFieldDef(t, app, cmIDSharedRequest, "Shared-request")
	addFieldDef(t, app, 999999, "SVI-Vehicle Make") // unrelated

	got, err := LodgingRequestFieldNames(app)
	if err != nil {
		t.Fatalf("LodgingRequestFieldNames: %v", err)
	}

	if got[renamed] != fieldShareCabinsRegistration {
		t.Errorf("renamed field resolved to %q, want %q", got[renamed], fieldShareCabinsRegistration)
	}
	if got[untouched] != fieldSharedRequest {
		t.Errorf("field resolved to %q, want %q", got[untouched], fieldSharedRequest)
	}
	if len(got) != 2 {
		t.Errorf("expected exactly 2 resolved defs, got %d: %v", len(got), got)
	}
}

// TestLodgingFieldDefIDsMapsByCMID proves resolution goes through cm_id, not the
// display name (spec 4.4). The fixture renames a field to something the name
// would never match; the mapping must still be found.
func TestLodgingFieldDefIDsMapsByCMID(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)

	cabinDefID := addFieldDef(t, app, cmIDFamilyCampCabin, "Renamed By Staff In 2027")
	reportableDefID := addFieldDef(t, app, cmIDReportableFamilyCampCabin, "Reportable Family Camp Cabin")
	addFieldDef(t, app, 999999, "SVI-Vehicle Make") // unrelated

	got, err := LodgingFieldDefIDs(app)
	if err != nil {
		t.Fatalf("LodgingFieldDefIDs: %v", err)
	}

	if got[cabinDefID] != targetCabinAssignmentHousehold {
		t.Errorf("cabin field mapped to %q, want %q", got[cabinDefID], targetCabinAssignmentHousehold)
	}
	if got[reportableDefID] != targetCabinAssignmentPerson {
		t.Errorf("reportable field mapped to %q, want %q", got[reportableDefID], targetCabinAssignmentPerson)
	}
	if len(got) != 2 {
		t.Errorf("expected exactly 2 mapped defs, got %d: %v", len(got), got)
	}
}

// TestLodgingFieldDefIDsHonoursDisabledMapping covers spec 4.4's human override:
// a mapping stays active until a person turns it off, and once off the sync must
// stop reading that field.
func TestLodgingFieldDefIDsHonoursDisabledMapping(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	cabinDefID := addFieldDef(t, app, cmIDFamilyCampCabin, "Family Camp Cabin")

	saveRecord(t, app, "lodging_field_mappings", map[string]any{
		"field_cm_id": cmIDFamilyCampCabin,
		"is_enabled":  false,
		"note":        "turned off by staff while the 2027 form is rebuilt",
	})

	got, err := LodgingFieldDefIDs(app)
	if err != nil {
		t.Fatalf("LodgingFieldDefIDs: %v", err)
	}
	if _, present := got[cabinDefID]; present {
		t.Error("a disabled mapping was still returned; spec 4.4 says a human disable must take effect")
	}
}

// TestUpsertFieldMappingStatusIsIdempotentAndNeverAutoDisables covers the other
// half of spec 4.4: "Retirement is never auto-inferred. A field with zero values
// this year may simply have a form that hasn't been sent yet."
func TestUpsertFieldMappingStatusIsIdempotentAndNeverAutoDisables(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	addFieldDef(t, app, cmIDFamilyCampCabin, "Family Camp Cabin")

	// Year with zero values for the cabin field, 464 the year before.
	counts := map[int]int{cmIDFamilyCampCabin: 0}
	prior := map[int]int{cmIDFamilyCampCabin: 464}

	for i := 0; i < 2; i++ {
		if err := UpsertFieldMappingStatus(app, 2026, counts, prior); err != nil {
			t.Fatalf("UpsertFieldMappingStatus pass %d: %v", i, err)
		}
	}

	rows, err := app.FindRecordsByFilter("lodging_field_mappings",
		"field_cm_id = "+strconv.Itoa(cmIDFamilyCampCabin), "", 0, 0)
	if err != nil {
		t.Fatalf("find mappings: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected exactly 1 mapping row after two passes, got %d", len(rows))
	}
	r := rows[0]
	if !r.GetBool("is_enabled") {
		t.Error("zero values this year auto-disabled the mapping; spec 4.4 forbids that")
	}
	if r.GetInt("last_seen_count") != 0 || r.GetInt("prior_year_count") != 464 {
		t.Errorf("counts wrong: last_seen=%d prior=%d, want 0 and 464",
			r.GetInt("last_seen_count"), r.GetInt("prior_year_count"))
	}
	if r.GetString("field_name") != "Family Camp Cabin" {
		t.Errorf("field_name = %q, want %q", r.GetString("field_name"), "Family Camp Cabin")
	}
}

// TestUpsertFieldMappingStatusDoesNotRegressOnOlderYearBackfill: Task 14
// backfills 2024 and 2025 AFTER the current season has already synced, and the
// sync is year-parameterised (`sync/run?year=2024`). Writing the backfill year's
// counts over the current ones makes spec 4.4's passive warning describe the
// wrong season -- "0 values in 2024" where staff expect "0 values in 2026, 171
// in 2025". last_seen_* means MOST RECENT, so an older run must leave it alone.
func TestUpsertFieldMappingStatusDoesNotRegressOnOlderYearBackfill(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	addFieldDef(t, app, cmIDFamilyCampCabin, "Family Camp Cabin")

	// The current season's daily sync: no values yet this year, 171 last year.
	if err := UpsertFieldMappingStatus(app, 2026,
		map[int]int{cmIDFamilyCampCabin: 0}, map[int]int{cmIDFamilyCampCabin: 171}); err != nil {
		t.Fatalf("current-year pass: %v", err)
	}

	// Task 14's backfill, run afterwards. Its counts belong to 2024.
	if err := UpsertFieldMappingStatus(app, 2024,
		map[int]int{cmIDFamilyCampCabin: 464}, map[int]int{cmIDFamilyCampCabin: 645}); err != nil {
		t.Fatalf("backfill pass: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_field_mappings",
		"field_cm_id = "+strconv.Itoa(cmIDFamilyCampCabin), "", 0, 0)
	if err != nil {
		t.Fatalf("find mappings: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 mapping row, got %d", len(rows))
	}
	r := rows[0]
	if r.GetInt("last_seen_year") != 2026 {
		t.Errorf("last_seen_year = %d, want 2026 (a 2024 backfill must not rewind it)",
			r.GetInt("last_seen_year"))
	}
	if r.GetInt("last_seen_count") != 0 {
		t.Errorf("last_seen_count = %d, want 0 (2026's count, not the backfill's)",
			r.GetInt("last_seen_count"))
	}
	if r.GetInt("prior_year_count") != 171 {
		t.Errorf("prior_year_count = %d, want 171 (2025's count, not 2023's)",
			r.GetInt("prior_year_count"))
	}
}

// TestUpsertFieldMappingStatusAdvancesOnNewerYear is the other half: a LATER
// year must still move the counters, or the warning freezes at whatever season
// happened to run first.
func TestUpsertFieldMappingStatusAdvancesOnNewerYear(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	addFieldDef(t, app, cmIDFamilyCampCabin, "Family Camp Cabin")

	if err := UpsertFieldMappingStatus(app, 2025,
		map[int]int{cmIDFamilyCampCabin: 171}, map[int]int{cmIDFamilyCampCabin: 112}); err != nil {
		t.Fatalf("2025 pass: %v", err)
	}
	if err := UpsertFieldMappingStatus(app, 2026,
		map[int]int{cmIDFamilyCampCabin: 0}, map[int]int{cmIDFamilyCampCabin: 171}); err != nil {
		t.Fatalf("2026 pass: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_field_mappings",
		"field_cm_id = "+strconv.Itoa(cmIDFamilyCampCabin), "", 0, 0)
	if err != nil {
		t.Fatalf("find mappings: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 mapping row, got %d", len(rows))
	}
	if got := rows[0].GetInt("last_seen_year"); got != 2026 {
		t.Errorf("last_seen_year = %d, want 2026", got)
	}
	if got := rows[0].GetInt("prior_year_count"); got != 171 {
		t.Errorf("prior_year_count = %d, want 171", got)
	}
}
