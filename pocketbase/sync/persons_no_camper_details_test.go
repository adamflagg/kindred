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
// expected skip, so it neither warns nor counts.
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
}
