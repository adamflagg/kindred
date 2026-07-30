package sync

import (
	"testing"
	"time"
)

// TestParseCampMinderTimestamp pins the exact shape custom-value last_updated
// arrives in. It is a TEXT column carrying CampMinder's raw .NET DateTimeOffset
// -- seven fractional digits and a +00:00 offset.
//
// ParseDate (date_utils.go) also parses this format; what it cannot do is hand
// back a time.Time. It returns a whole-second string, and AttributeSession
// compares against session start dates, so the typed parse is the point.
func TestParseCampMinderTimestamp(t *testing.T) {
	got, ok := ParseCampMinderTimestamp("2025-04-21T17:51:11.5964281+00:00")
	if !ok {
		t.Fatal("failed to parse the CampMinder last_updated format")
	}
	if got.UTC().Format("2006-01-02 15:04") != "2025-04-21 17:51" {
		t.Errorf("parsed to %s", got.UTC())
	}

	if _, ok := ParseCampMinderTimestamp(""); ok {
		t.Error("empty string reported as parsed")
	}
	if _, ok := ParseCampMinderTimestamp("not a date"); ok {
		t.Error("garbage reported as parsed")
	}
}

// TestLoadSessionWindowsReadsDateFields: camp_sessions.start_date is a
// PocketBase DATE field, stored as "2025-05-23 07:00:00.000Z". That layout
// matches none of date_utils.go's DateFormats -- verified by running all eight
// against it -- so it must be read via GetDateTime, not ParseDate.
func TestLoadSessionWindowsReadsDateFields(t *testing.T) {
	app := newLodgingTestApp(t)
	addSession(t, app, 1309514, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	addSession(t, app, 1335115, "Women's Weekend", "adult",
		"2025-10-16 07:00:00.000Z", "2025-10-19 07:00:00.000Z", 2025)
	addSession(t, app, 1235404, "Session 2", "summer",
		"2025-06-25 07:00:00.000Z", "2025-07-10 07:00:00.000Z", 2025)

	got, err := LoadSessionWindows(app, 2025, []string{"family"})
	if err != nil {
		t.Fatalf("LoadSessionWindows: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 family session, got %d", len(got))
	}
	for _, w := range got {
		if w.CMID != 1309514 {
			t.Errorf("CMID = %d, want 1309514", w.CMID)
		}
		if w.Start.UTC().Format("2006-01-02") != "2025-05-23" {
			t.Errorf("Start = %s; the date field did not parse", w.Start.UTC())
		}
		if w.End.UTC().Format("2006-01-02") != "2025-05-26" {
			t.Errorf("End = %s", w.End.UTC())
		}
	}
}

// TestBuildHouseholdSessionIndexUsesActiveEnrolmentOnly: status_id = 2 is
// "active enrolled". Any other status is not attending, and counting them would
// manufacture ambiguity where there is none.
func TestBuildHouseholdSessionIndexUsesActiveEnrolmentOnly(t *testing.T) {
	app := newLodgingTestApp(t)
	fc1 := addSession(t, app, 1309514, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	fc6 := addSession(t, app, 1309519, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, fc1, 5001, 2, 2025) // active
	addAttendee(t, app, emma, fc6, 5001, 5, 2025) // cancelled

	idx, err := BuildHouseholdSessionIndex(app, 2025, []string{"family"})
	if err != nil {
		t.Fatalf("BuildHouseholdSessionIndex: %v", err)
	}
	if len(idx[9001]) != 1 {
		t.Fatalf("household 9001 has %d sessions, want 1 (the cancelled one must not count)", len(idx[9001]))
	}
	if idx[9001][0].CMID != 1309514 {
		t.Errorf("got session %d, want 1309514", idx[9001][0].CMID)
	}
}

// TestBuildHouseholdSessionIndexDedupesSiblings: two enrolled children in one
// household attending the same weekend is ONE household-weekend, not two.
func TestBuildHouseholdSessionIndexDedupesSiblings(t *testing.T) {
	app := newLodgingTestApp(t)
	fc1 := addSession(t, app, 1309514, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	liam := addPerson(t, app, 5002, 9001, 2025, hh)
	addAttendee(t, app, emma, fc1, 5001, 2, 2025)
	addAttendee(t, app, liam, fc1, 5002, 2, 2025)

	idx, err := BuildHouseholdSessionIndex(app, 2025, []string{"family"})
	if err != nil {
		t.Fatalf("BuildHouseholdSessionIndex: %v", err)
	}
	if len(idx[9001]) != 1 {
		t.Errorf("two siblings at one weekend produced %d session entries, want 1", len(idx[9001]))
	}
}

// TestAttributeSessionSingle: the 98% case.
func TestAttributeSessionSingle(t *testing.T) {
	only := SessionWindow{ID: "s1", CMID: 1309514, Name: "Family Camp 1",
		Start: time.Date(2025, 5, 23, 7, 0, 0, 0, time.UTC),
		End:   time.Date(2025, 5, 26, 7, 0, 0, 0, time.UTC)}

	got := AttributeSession([]SessionWindow{only}, time.Time{})
	if got.Reason != attrSingleSession {
		t.Errorf("Reason = %q, want %q", got.Reason, attrSingleSession)
	}
	if got.SessionID != "s1" {
		t.Errorf("SessionID = %q, want s1", got.SessionID)
	}
}

// TestAttributeSessionNone: 53 cabin values in 2025 belong to households with no
// active family enrolment. They are queue items, not drops and not errors.
func TestAttributeSessionNone(t *testing.T) {
	got := AttributeSession(nil, time.Time{})
	if got.Reason != attrNoSession {
		t.Errorf("Reason = %q, want %q", got.Reason, attrNoSession)
	}
	if got.SessionID != "" {
		t.Errorf("SessionID = %q; nothing may be attributed with no candidate", got.SessionID)
	}
}

// TestAttributeSessionAmbiguousSuggestsButDoesNotAssign reproduces a real 2025
// household: enrolled in Family Camp 1 (May 23), Family Camp 5 (Sep 11), Family
// Camp 6 (Sep 18) and Winter Family Camp (Dec 21), with one cabin value last
// edited 10 September -- the day before Family Camp 5.
//
// Spec 3.6 says flag these for manual entry rather than guess, so SessionID
// stays empty and only BestGuess carries the heuristic.
func TestAttributeSessionAmbiguousSuggestsButDoesNotAssign(t *testing.T) {
	mk := func(id string, cmID int, month, day int) SessionWindow {
		return SessionWindow{ID: id, CMID: cmID,
			Start: time.Date(2025, time.Month(month), day, 7, 0, 0, 0, time.UTC),
			End:   time.Date(2025, time.Month(month), day+3, 7, 0, 0, 0, time.UTC)}
	}
	candidates := []SessionWindow{
		mk("s1", 1309514, 5, 23),
		mk("s5", 1334831, 9, 11),
		mk("s6", 1309519, 9, 18),
		mk("sw", 1354939, 12, 21),
	}
	lastUpdated := time.Date(2025, 9, 10, 18, 0, 0, 0, time.UTC)

	got := AttributeSession(candidates, lastUpdated)
	if got.Reason != attrAmbiguousSession {
		t.Errorf("Reason = %q, want %q", got.Reason, attrAmbiguousSession)
	}
	if got.SessionID != "" {
		t.Errorf("SessionID = %q; an ambiguous party must not be assigned", got.SessionID)
	}
	if got.BestGuess != "s5" {
		t.Errorf("BestGuess = %q, want s5 (earliest session starting on or after 10 Sep)", got.BestGuess)
	}
	if len(got.Candidates) != 4 {
		t.Errorf("Candidates = %d, want all 4 for the queue item", len(got.Candidates))
	}
}

// TestAttributeSessionAmbiguousAfterAllSessions: a value edited after every
// weekend has ended -- staff tidying records at season close -- suggests the
// LAST weekend, since that is the one the value most plausibly describes.
func TestAttributeSessionAmbiguousAfterAllSessions(t *testing.T) {
	candidates := []SessionWindow{
		{ID: "s1", CMID: 1309514, Start: time.Date(2025, 5, 23, 7, 0, 0, 0, time.UTC)},
		{ID: "s3", CMID: 1356527, Start: time.Date(2025, 8, 28, 7, 0, 0, 0, time.UTC)},
	}
	got := AttributeSession(candidates, time.Date(2025, 12, 15, 0, 0, 0, 0, time.UTC))
	if got.BestGuess != "s3" {
		t.Errorf("BestGuess = %q, want s3 (the last weekend)", got.BestGuess)
	}
	if got.SessionID != "" {
		t.Error("still must not assign")
	}
}

// TestAttributeSessionAmbiguousWithoutTimestamp: no timestamp, no suggestion --
// but still a queue item rather than a drop.
func TestAttributeSessionAmbiguousWithoutTimestamp(t *testing.T) {
	candidates := []SessionWindow{
		{ID: "s1", CMID: 1309514, Start: time.Date(2025, 5, 23, 7, 0, 0, 0, time.UTC)},
		{ID: "s3", CMID: 1356527, Start: time.Date(2025, 8, 28, 7, 0, 0, 0, time.UTC)},
	}
	got := AttributeSession(candidates, time.Time{})
	if got.Reason != attrAmbiguousSession {
		t.Errorf("Reason = %q", got.Reason)
	}
	if got.BestGuess != "" {
		t.Errorf("BestGuess = %q; there is nothing to base a guess on", got.BestGuess)
	}
}
