// kindred#2484: socialize_with's source of truth moves from the manually uploaded
// bunk-requests CSV column ("RetParent-Socializewithbest") to the CampMinder custom
// field it mirrors (cm_id 85803), read via person_custom_values. The CSV column is
// still parsed during the transition so a disagreement can be logged in production
// (the issue's own build note: "compare the two ... confirm they agree, row for row,
// before cutting over").
//
// PR #2523 review (triage-attack): the first version of this file pinned "custom field
// always wins, even on disagreement." That is unsafe -- socialize_with's sole consumer,
// orchestrator.py's _parse_socialize_preference, exact-matches the value against exactly
// two literal strings with no AI fallback, so an unverified custom-field value that
// disagrees with the known-good CSV can silently drop out of the social graph on the
// very first sync after deploy. The invariant is deliberately retired: on disagreement,
// the already-live CSV value stays authoritative (still logged, so the two can be
// diffed in production per the issue's own request); the custom field is only trusted
// outright when there is no CSV value to compare it against -- the coverage-increase
// population the issue's own numbers document (1,145 custom-field persons vs 1,134 CSV,
// full overlap).
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
// in main_test_parallelism_test.go, outside this issue's file scope. The behavioral pins
// below cover the invariants that matter; the warning itself is exercised by hand against
// production logs during rollout, per the issue's build note.
//
// TestProcessRow_SocializeWith_DisagreementKeepsCSV pins the retired invariant's
// replacement (see the file-level comment): when the CSV and the custom field both carry
// a non-empty value and they disagree, the CSV value -- already live, already verified
// against production for the current sync year -- wins. The custom field does not get to
// silently overwrite a working answer with one nothing has cross-checked against
// orchestrator.py's exact-match parser.
func TestProcessRow_SocializeWith_DisagreementKeepsCSV(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1001
	const personPBID = "pb_person_1001"
	const year = 2026

	csvValue := dropdownOlder + " (stale csv answer)"
	row, columnIndex := socializeWithCSVRow("1001", csvValue)

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
	if got != csvValue {
		t.Errorf("socialize_with content = %q, want %q (CSV must win on disagreement)", got, csvValue)
	}
}

// TestProcessRow_SocializeWith_UsesCustomFieldWhenCSVAbsent covers the coverage-increase
// population the issue's own numbers document (1,145 custom-field persons vs 1,134 CSV,
// full overlap): a person with no CSV answer at all still gets one, sourced from the
// custom field, because there is nothing to disagree with.
func TestProcessRow_SocializeWith_UsesCustomFieldWhenCSVAbsent(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsSocializeWithTestApp(t)

	const personID = 1005
	const personPBID = "pb_person_1005"
	const year = 2026

	row, columnIndex := socializeWithCSVRow("1005", "")

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
		t.Errorf("socialize_with content = %q, want %q (custom field is the only signal when CSV absent)",
			got, dropdownYounger)
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
