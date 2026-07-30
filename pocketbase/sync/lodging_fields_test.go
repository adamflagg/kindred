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

// TestLodgingFieldDefIDsMapsByCMID proves resolution goes through cm_id, not the
// display name (spec 4.4). The fixture renames a field to something the name
// would never match; the mapping must still be found.
func TestLodgingFieldDefIDsMapsByCMID(t *testing.T) {
	app := newLodgingTestApp(t)

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
	app := newLodgingTestApp(t)
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
	app := newLodgingTestApp(t)
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
