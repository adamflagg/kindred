package sync

import (
	"strings"
	"testing"
)

// An attendee CampMinder returns with no CamperDetails gets no persons row. That used to
// be a Debug line and an unexposed map entry, so an enrolled adult could vanish with no
// trace at the default LOG_LEVEL=INFO. It must warn once per person and reach the run's
// Stats. Serial: captureSweepLogs swaps slog's process-global default.
func TestTransformPersonNoCamperDetailsWarnsAndCounts(t *testing.T) {
	logs := captureSweepLogs(t)
	s := &PersonsSync{missingDataStats: make(map[string]int)}

	person := map[string]any{
		"ID":   float64(900123),
		"Name": map[string]any{"First": "Pat", "Last": "Smith"},
	}

	pbData, err := s.transformPersonToPB(person, 2025, true)
	if err != nil || pbData != nil {
		t.Fatalf("want (nil, nil) for a person with no CamperDetails, got (%v, %v)", pbData, err)
	}

	if got := s.Stats.NoCamperDetails; got != 1 {
		t.Errorf("Stats.NoCamperDetails = %d, want 1", got)
	}
	out := logs.String()
	if got := strings.Count(out, "level=WARN"); got != 1 {
		t.Fatalf("want exactly one WARN line, got %d in:\n%s", got, out)
	}
	for _, want := range []string{"900123", "year=2025"} {
		if !strings.Contains(out, want) {
			t.Errorf("warning missing %q:\n%s", want, out)
		}
	}
}

// A staff-only person (not an attendee) has no CamperDetails by design; that is the
// expected skip, so it does not warn and stays out of the camper count. It is counted
// separately so the two populations never blur.
func TestTransformPersonNoCamperDetailsStaffOnlyIsQuiet(t *testing.T) {
	logs := captureSweepLogs(t)
	s := &PersonsSync{missingDataStats: make(map[string]int)}

	person := map[string]any{"ID": float64(900124), "Name": map[string]any{"First": "Lee", "Last": "Jones"}}
	if _, err := s.transformPersonToPB(person, 2025, false); err != nil {
		t.Fatal(err)
	}
	if s.Stats.NoCamperDetails != 0 || strings.Contains(logs.String(), "level=WARN") {
		t.Errorf("staff-only skip must be quiet; count=%d logs=%s", s.Stats.NoCamperDetails, logs.String())
	}
	if s.Stats.NoCamperDetailsStaff != 1 {
		t.Errorf("Stats.NoCamperDetailsStaff = %d, want 1", s.Stats.NoCamperDetailsStaff)
	}
}

// A person id we asked CampMinder for that comes back absent is the second way a person
// goes missing. Campers (from attendees) warn once each and count; staff-only ids count
// separately. Serial: captureSweepLogs swaps slog's process-global default.
func TestRecordNotReturnedSplitsCampersFromStaff(t *testing.T) {
	logs := captureSweepLogs(t)
	s := &PersonsSync{missingDataStats: make(map[string]int)}

	asked := []int{801, 802, 803, 804}
	returned := []map[string]any{{"ID": float64(801)}, {"ID": float64(803)}}
	camperIDs := map[int]bool{801: true, 802: true}

	s.recordNotReturned(asked, returned, camperIDs, 2025)

	if s.Stats.NotReturned != 1 || s.Stats.NotReturnedStaff != 1 {
		t.Errorf("NotReturned=%d NotReturnedStaff=%d, want 1 and 1", s.Stats.NotReturned, s.Stats.NotReturnedStaff)
	}
	out := logs.String()
	if got := strings.Count(out, "level=WARN"); got != 2 {
		t.Fatalf("want 2 WARN lines (one per missing id), got %d:\n%s", got, out)
	}
	for _, want := range []string{"802", "804", "year=2025"} {
		if !strings.Contains(out, want) {
			t.Errorf("logs missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "801") || strings.Contains(out, "803") {
		t.Errorf("returned ids must not be logged:\n%s", out)
	}
}
