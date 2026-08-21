// TestLoadPersonCustomFieldValuesByCMID pins kindred#2484's join helper: given a
// CampMinder custom-field cm_id, return person PB id -> value for that year, going
// through custom_field_defs (NOT person_tag_defs -- the wrong join returns zero rows
// with no error, which is exactly the trap this helper exists to isolate in one place).
package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newCustomFieldByCMIDTestApp returns a throwaway app carrying just the three
// collections loadPersonCustomFieldValuesByCMID reads: custom_field_defs (the cm_id ->
// PB id join target), persons (unused by the query itself, kept only so relation-shaped
// fixtures look like production), and person_custom_values (the source rows).
func newCustomFieldByCMIDTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.TextField{Name: "name"})
	if saveErr := app.Save(defs); saveErr != nil {
		t.Fatalf("save custom_field_defs: %v", saveErr)
	}

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.TextField{Name: "field_definition"})
	pcv.Fields.Add(&core.TextField{Name: "person"})
	pcv.Fields.Add(&core.TextField{Name: "value"})
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(pcv); saveErr != nil {
		t.Fatalf("save person_custom_values: %v", saveErr)
	}

	return app
}

// addCustomFieldDef writes one custom_field_defs row and returns its PB id.
func addCustomFieldDef(t *testing.T, app core.App, cmID int, name string) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("cm_id", cmID)
	rec.Set("name", name)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save custom_field_defs row: %v", saveErr)
	}
	return rec.Id
}

// addPersonCustomValueRow writes one person_custom_values row keyed by field_definition PB id.
func addPersonCustomValueRow(t *testing.T, app core.App, fieldDefPBID, personPBID, value string, year int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("person_custom_values")
	if err != nil {
		t.Fatalf("find person_custom_values: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("field_definition", fieldDefPBID)
	rec.Set("person", personPBID)
	rec.Set("value", value)
	rec.Set("year", year)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save person_custom_values row: %v", saveErr)
	}
}

func TestLoadPersonCustomFieldValuesByCMID_ReturnsPersonToValueMap(t *testing.T) {
	t.Parallel()
	app := newCustomFieldByCMIDTestApp(t)

	fieldDefID := addCustomFieldDef(t, app, 85803, "Ret Parent-Socialize with best")
	addPersonCustomValueRow(t, app, fieldDefID, "pb_person_a", "OLDER", 2026)
	addPersonCustomValueRow(t, app, fieldDefID, "pb_person_b", "YOUNGER", 2026)

	values, err := loadPersonCustomFieldValuesByCMID(app, 85803, 2026)
	if err != nil {
		t.Fatalf("loadPersonCustomFieldValuesByCMID: %v", err)
	}

	if got, want := len(values), 2; got != want {
		t.Fatalf("len(values) = %d, want %d: %v", got, want, values)
	}
	if got, want := values["pb_person_a"], "OLDER"; got != want {
		t.Errorf("values[pb_person_a] = %q, want %q", got, want)
	}
	if got, want := values["pb_person_b"], "YOUNGER"; got != want {
		t.Errorf("values[pb_person_b] = %q, want %q", got, want)
	}
}

// TestLoadPersonCustomFieldValuesByCMID_ScopedToYear verifies a row from a different
// year is not returned -- person_custom_values is year-scoped, and this helper must
// respect that like every other reader in the package.
func TestLoadPersonCustomFieldValuesByCMID_ScopedToYear(t *testing.T) {
	t.Parallel()
	app := newCustomFieldByCMIDTestApp(t)

	fieldDefID := addCustomFieldDef(t, app, 85803, "Ret Parent-Socialize with best")
	addPersonCustomValueRow(t, app, fieldDefID, "pb_person_a", "OLDER", 2025)

	values, err := loadPersonCustomFieldValuesByCMID(app, 85803, 2026)
	if err != nil {
		t.Fatalf("loadPersonCustomFieldValuesByCMID: %v", err)
	}
	if len(values) != 0 {
		t.Errorf("values = %v, want empty (2025 row must not leak into a 2026 query)", values)
	}
}

// TestLoadPersonCustomFieldValuesByCMID_UnsyncedFieldDefReturnsEmptyMapNotError verifies
// that a cm_id with no custom_field_defs row yet (field not synced) is reported as "no
// values available" rather than a hard error -- callers that fall back to another source
// (bunk_requests.go's CSV swap, kindred#2484) need to treat this as normal, not fatal.
func TestLoadPersonCustomFieldValuesByCMID_UnsyncedFieldDefReturnsEmptyMapNotError(t *testing.T) {
	t.Parallel()
	app := newCustomFieldByCMIDTestApp(t)

	values, err := loadPersonCustomFieldValuesByCMID(app, 999999, 2026)
	if err != nil {
		t.Fatalf("loadPersonCustomFieldValuesByCMID: %v", err)
	}
	if len(values) != 0 {
		t.Errorf("values = %v, want empty map for an unsynced field definition", values)
	}
}

// TestLoadPersonCustomFieldValuesByCMID_TrimsWhitespace pins a PR #2523 review fix:
// CampMinder's custom-field API is a different export path than the CSV, and the CSV
// side is already trimmed (bunk_requests.go's getColumn calls strings.TrimSpace). A
// leading/trailing-whitespace-only difference on the custom-field side must not be
// treated as a real disagreement by bunk_requests.go's socialize_with comparison --
// left untrimmed, it would log a spurious mismatch warning (and force a
// content_hash/processed churn) on every sync run for an answer that never changed.
func TestLoadPersonCustomFieldValuesByCMID_TrimsWhitespace(t *testing.T) {
	t.Parallel()
	app := newCustomFieldByCMIDTestApp(t)

	fieldDefID := addCustomFieldDef(t, app, 85803, "Ret Parent-Socialize with best")
	addPersonCustomValueRow(t, app, fieldDefID, "pb_person_a", "  "+dropdownOlder+"  \n", 2026)

	values, err := loadPersonCustomFieldValuesByCMID(app, 85803, 2026)
	if err != nil {
		t.Fatalf("loadPersonCustomFieldValuesByCMID: %v", err)
	}
	if got, want := values["pb_person_a"], dropdownOlder; got != want {
		t.Errorf("values[pb_person_a] = %q, want %q (surrounding whitespace must be trimmed)", got, want)
	}
}

// TestLoadPersonCustomFieldValuesByCMID_JoinsThroughFieldDefinitionNotPersonTagDefs
// pins the join column: a person_custom_values row whose field_definition points at
// some OTHER custom_field_defs record (a different field entirely) must not appear in
// the cm_id-85803 result, even though both defs live in the same table.
func TestLoadPersonCustomFieldValuesByCMID_JoinsThroughFieldDefinitionNotPersonTagDefs(t *testing.T) {
	t.Parallel()
	app := newCustomFieldByCMIDTestApp(t)

	socializeDefID := addCustomFieldDef(t, app, 85803, "Ret Parent-Socialize with best")
	otherDefID := addCustomFieldDef(t, app, 12345, "Unrelated field")

	addPersonCustomValueRow(t, app, socializeDefID, "pb_person_a", "OLDER", 2026)
	addPersonCustomValueRow(t, app, otherDefID, "pb_person_b", "should not appear", 2026)

	values, err := loadPersonCustomFieldValuesByCMID(app, 85803, 2026)
	if err != nil {
		t.Fatalf("loadPersonCustomFieldValuesByCMID: %v", err)
	}
	if _, found := values["pb_person_b"]; found {
		t.Errorf("values contains pb_person_b (belongs to a different field definition): %v", values)
	}
	if got, want := values["pb_person_a"], "OLDER"; got != want {
		t.Errorf("values[pb_person_a] = %q, want %q", got, want)
	}
}
