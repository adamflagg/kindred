// kindred#2484: socialize_with's source of truth moves from the manually uploaded
// bunk-requests CSV column ("RetParent-Socializewithbest") to the CampMinder custom
// field it mirrors (cm_id 85803), read via person_custom_values. The CSV column is
// still parsed during the transition so a disagreement can be logged in production
// (the issue's own build note: "compare the two ... confirm they agree, row for row,
// before cutting over"), but the value actually written to original_bunk_requests now
// comes from the custom field whenever one is present.
package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// Dropdown values reused across the fixtures below (goconst).
const (
	dropdownOlder   = "OLDER"
	dropdownYounger = "YOUNGER"
)

// newBunkRequestsSocializeWithTestApp returns a throwaway app carrying just the
// original_bunk_requests collection processRow writes to.
func newBunkRequestsSocializeWithTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	obr := core.NewBaseCollection("original_bunk_requests")
	obr.Fields.Add(&core.TextField{Name: "requester"})
	obr.Fields.Add(&core.NumberField{Name: "year"})
	obr.Fields.Add(&core.TextField{Name: "field"})
	obr.Fields.Add(&core.TextField{Name: "content"})
	obr.Fields.Add(&core.TextField{Name: "content_hash"})
	obr.Fields.Add(&core.TextField{Name: "processed"})
	if saveErr := app.Save(obr); saveErr != nil {
		t.Fatalf("save original_bunk_requests: %v", saveErr)
	}

	return app
}

// socializeWithCSVRow builds a CSV row (matching csvFieldMap's five columns) carrying
// csvContent in the RetParent-Socializewithbest column and blanks elsewhere.
func socializeWithCSVRow(personIDStr, csvContent string) (row []string, columnIndex map[string]int) {
	columnIndex = map[string]int{
		"PersonID": 0, "Last Name": 1, "First Name": 2,
		"Share Bunk With": 3, "Do Not Share Bunk With": 4,
		"Internal Bunk Notes": 5, "BunkingNotes Notes": 6,
		"RetParent-Socializewithbest": 7,
	}
	row = []string{personIDStr, "Johnson", "Emma", "", "", "", "", csvContent}
	return row, columnIndex
}

// findSocializeWithOBR returns the content of the one original_bunk_requests row for
// field=socialize_with, failing the test if it is missing or duplicated.
func findSocializeWithOBR(t *testing.T, app core.App, personPBID string, year int) string {
	t.Helper()
	recs, err := app.FindRecordsByFilter(
		"original_bunk_requests",
		fmt.Sprintf("requester = '%s' && year = %d && field = 'socialize_with'", personPBID, year),
		"", 0, 0)
	if err != nil {
		t.Fatalf("find socialize_with OBR: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("found %d socialize_with OBR rows for %s/%d, want 1", len(recs), personPBID, year)
	}
	return recs[0].GetString("content")
}

// Log-line coverage for the CSV/custom-field mismatch warning (processRow's slog.Warn
// call, kindred#2484's production diffing safety net) is intentionally not asserted here.
// Verifying it would need captureSweepLogs, which swaps the process-global slog default
// and so cannot run under t.Parallel() (sync/lodging are held to a package-wide
// all-tests-parallel guard) -- and the exemption list that would allow an opt-out lives
// in main_test_parallelism_test.go, outside this issue's file scope. The behavioral pin
// below (custom field wins) covers the invariant that matters; the warning itself is
// exercised by hand against production logs during rollout, per the issue's build note.
func TestProcessRow_SocializeWith_PrefersCustomFieldValueOverCSV(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1001
	const personPBID = "pb_person_1001"
	const year = 2026

	row, columnIndex := socializeWithCSVRow("1001", dropdownOlder+" (stale csv answer)")

	s := &BunkRequestsSync{
		BaseSyncService: BaseSyncService{App: app, Stats: Stats{}},
		validPersonIDs:  map[int]string{personID: personPBID},
		csvPersonIDs:    make(map[int]bool),
		socializeWithByPerson: map[string]string{
			personPBID: dropdownYounger,
		},
	}

	if err := s.processRow(row, columnIndex, year); err != nil {
		t.Fatalf("processRow: %v", err)
	}

	got := findSocializeWithOBR(t, app, personPBID, year)
	if got != dropdownYounger {
		t.Errorf("socialize_with content = %q, want %q (custom field must win over CSV)", got, dropdownYounger)
	}
}

func TestProcessRow_SocializeWith_FallsBackToCSVWhenNoCustomFieldValue(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1002
	const personPBID = "pb_person_1002"
	const year = 2026

	row, columnIndex := socializeWithCSVRow("1002", dropdownOlder)

	s := &BunkRequestsSync{
		BaseSyncService:       BaseSyncService{App: app, Stats: Stats{}},
		validPersonIDs:        map[int]string{personID: personPBID},
		csvPersonIDs:          make(map[int]bool),
		socializeWithByPerson: map[string]string{}, // no custom field data for this person yet
	}

	if err := s.processRow(row, columnIndex, year); err != nil {
		t.Fatalf("processRow: %v", err)
	}

	got := findSocializeWithOBR(t, app, personPBID, year)
	if got != dropdownOlder {
		t.Errorf("socialize_with content = %q, want %q (must fall back to CSV)", got, dropdownOlder)
	}
}

func TestProcessRow_SocializeWith_EmptyCustomFieldValueFallsBackToCSV(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1003
	const personPBID = "pb_person_1003"
	const year = 2026

	row, columnIndex := socializeWithCSVRow("1003", dropdownYounger)

	s := &BunkRequestsSync{
		BaseSyncService: BaseSyncService{App: app, Stats: Stats{}},
		validPersonIDs:  map[int]string{personID: personPBID},
		csvPersonIDs:    make(map[int]bool),
		socializeWithByPerson: map[string]string{
			personPBID: "", // custom field synced but blank -- must not be treated as authoritative
		},
	}

	if err := s.processRow(row, columnIndex, year); err != nil {
		t.Fatalf("processRow: %v", err)
	}

	got := findSocializeWithOBR(t, app, personPBID, year)
	if got != dropdownYounger {
		t.Errorf("socialize_with content = %q, want %q (blank custom value must fall back to CSV)", got, dropdownYounger)
	}
}

// TestProcessRow_OtherFields_UnaffectedBySocializeWithSwap verifies the swap is scoped
// to the socialize_with field only -- a person with a socializeWithByPerson entry must
// still get their other four CSV columns (e.g. bunk_request_form) written verbatim from
// the CSV, not from anything custom-field-sourced.
func TestProcessRow_OtherFields_UnaffectedBySocializeWithSwap(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1004
	const personPBID = "pb_person_1004"
	const year = 2026

	columnIndex := map[string]int{
		"PersonID": 0, "Last Name": 1, "First Name": 2,
		"Share Bunk With": 3, "Do Not Share Bunk With": 4,
		"Internal Bunk Notes": 5, "BunkingNotes Notes": 6,
		"RetParent-Socializewithbest": 7,
	}
	row := []string{"1004", "Johnson", "Emma", "wants to bunk with Ada", "", "", "", dropdownOlder}

	s := &BunkRequestsSync{
		BaseSyncService: BaseSyncService{App: app, Stats: Stats{}},
		validPersonIDs:  map[int]string{personID: personPBID},
		csvPersonIDs:    make(map[int]bool),
		socializeWithByPerson: map[string]string{
			personPBID: dropdownYounger,
		},
	}

	if err := s.processRow(row, columnIndex, year); err != nil {
		t.Fatalf("processRow: %v", err)
	}

	recs, err := app.FindRecordsByFilter(
		"original_bunk_requests",
		fmt.Sprintf("requester = '%s' && year = %d && field = 'bunk_request_form'", personPBID, year),
		"", 0, 0)
	if err != nil {
		t.Fatalf("find bunk_request_form OBR: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("found %d bunk_request_form OBR rows, want 1", len(recs))
	}
	if got, want := recs[0].GetString("content"), "wants to bunk with Ada"; got != want {
		t.Errorf("bunk_request_form content = %q, want %q (unaffected by the socialize_with swap)", got, want)
	}
}
