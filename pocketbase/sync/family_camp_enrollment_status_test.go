package sync

import (
	"context"
	"os"
	"regexp"
	"strconv"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ============================================================================
// kindred#2305 -- the three family_camp_* tables carry an enrollment status.
//
// The defect these pin is NOT "a registered household has no status column".
// It is the read that column replaces: `build_household_journey` badges a year
// "No enrollment" whenever the household has no ENROLLED CHILD, and its child
// source filters `session.session_type = "family"`. An adult weekend enrolls the
// PARENT, person-grain, on a session typed `adult` -- so a household that
// genuinely attended gets the chip anyway.
//
// Measured on the production snapshot for 2026: 480 journey (household, year)
// rows, 89 carrying the chip, 33 of them households with an enrolled
// family-or-adult attendee. Copying the family-only predicate into this
// derivation would reproduce all 33.
// ============================================================================

// seedWeekendSession writes one camp_sessions row and returns its PB id.
func seedWeekendSession(t *testing.T, app core.App, cmID int, name, sessionType string, year int) string {
	t.Helper()
	return seedRow(t, app, "camp_sessions", map[string]any{
		"cm_id": cmID, "name": name, "session_type": sessionType, "year": year,
		"start_date": "2026-06-05 07:00:00.000Z", "end_date": "2026-06-07 07:00:00.000Z",
	}).Id
}

// seedHouseholdMember writes one persons row bound to a household PB id and
// returns the person's PB id. The replay scaffolding stores `household` as
// text, exactly as loadPersonHouseholdMapping reads it.
func seedHouseholdMember(t *testing.T, app core.App, householdPBID string, year int) string {
	t.Helper()
	return seedRow(t, app, "persons", map[string]any{"household": householdPBID, "year": year}).Id
}

// seedAttendee writes one attendees row.
func seedAttendee(t *testing.T, app core.App, personPBID, sessionPBID, status string, statusID, year int) {
	t.Helper()
	seedRow(t, app, "attendees", map[string]any{
		"person": personPBID, "session": sessionPBID,
		"status": status, "status_id": statusID, "year": year,
	})
}

// enrollmentStatusesForYear runs the two loaders Sync runs, in the same order.
func enrollmentStatusesForYear(t *testing.T, app core.App, year int) map[string]string {
	t.Helper()
	s := NewFamilyCampDerivedSync(app)
	personToHousehold, err := s.loadPersonHouseholdMapping(context.Background(), year)
	if err != nil {
		t.Fatalf("loadPersonHouseholdMapping: %v", err)
	}
	statuses, err := s.loadHouseholdEnrollmentStatus(context.Background(), year, personToHousehold)
	if err != nil {
		t.Fatalf("loadHouseholdEnrollmentStatus: %v", err)
	}
	return statuses
}

// TestFamilyCampEnrollmentStatusCountsAdultWeekends is the whole issue in one
// assertion: an ADULT weekend is a family-camp weekend. A derivation that
// filtered `session_type = "family"` -- the predicate
// fetch_household_family_attendees uses, and the reason the journey's chip is
// wrong on 33 of 89 rows -- would report this household as never enrolled.
func TestFamilyCampEnrollmentStatusCountsAdultWeekends(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	familyWeekend := seedWeekendSession(t, app, 101, "Family Camp 1", "family", year)
	adultWeekend := seedWeekendSession(t, app, 102, "Adult Weekend 1", "adult", year)

	onFamily := seedHouseholdMember(t, app, "hh_family", year)
	seedAttendee(t, app, onFamily, familyWeekend, "enrolled", 2, year)

	onAdult := seedHouseholdMember(t, app, "hh_adult", year)
	seedAttendee(t, app, onAdult, adultWeekend, "enrolled", 2, year)

	statuses := enrollmentStatusesForYear(t, app, year)

	for _, household := range []string{"hh_family", "hh_adult"} {
		if got := statuses[household]; got != enrollmentStatusEnrolled {
			t.Errorf("%s enrollment_status = %q, want %q", household, got, enrollmentStatusEnrolled)
		}
	}
}

// TestFamilyCampEnrollmentStatusIgnoresSummerSessions is the other side of the
// same predicate. A household whose only enrollment that year is a SUMMER
// session has no family-camp enrollment, and folding summer in would both
// mis-badge the journey and break the standing rule that Family Camp and
// summer never count toward each other.
func TestFamilyCampEnrollmentStatusIgnoresSummerSessions(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	summer := seedWeekendSession(t, app, 201, "Session 1", "main", year)
	member := seedHouseholdMember(t, app, "hh_summer_only", year)
	seedAttendee(t, app, member, summer, "enrolled", 2, year)

	statuses := enrollmentStatusesForYear(t, app, year)

	if _, ok := statuses["hh_summer_only"]; ok {
		t.Errorf("summer-only household got a family-camp enrollment status %q, want none",
			statuses["hh_summer_only"])
	}
	if got := enrollmentStatusForHousehold(statuses, "hh_summer_only"); got != enrollmentStatusNoneOnFile {
		t.Errorf("enrollmentStatusForHousehold = %q, want %q", got, enrollmentStatusNoneOnFile)
	}
}

// TestFamilyCampEnrollmentStatusPrefersEnrolledThenBestStatus pins the
// two-stage rule: ANY enrolled member makes the household enrolled, and a
// household with none falls back to its single best non-enrolled status by the
// ordering enrollmentFilter.ts already uses.
func TestFamilyCampEnrollmentStatusPrefersEnrolledThenBestStatus(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	weekend := seedWeekendSession(t, app, 301, "Family Camp 1", "family", year)

	// One cancelled child and one enrolled sibling: the household attended.
	mixedA := seedHouseholdMember(t, app, "hh_mixed", year)
	mixedB := seedHouseholdMember(t, app, "hh_mixed", year)
	seedAttendee(t, app, mixedA, weekend, "cancelled", 32, year)
	seedAttendee(t, app, mixedB, weekend, "enrolled", 2, year)

	// Nobody enrolled: waitlisted outranks cancelled.
	waitA := seedHouseholdMember(t, app, "hh_waitlisted", year)
	waitB := seedHouseholdMember(t, app, "hh_waitlisted", year)
	seedAttendee(t, app, waitA, weekend, "cancelled", 32, year)
	seedAttendee(t, app, waitB, weekend, "waitlisted", 8, year)

	// CampMinder's own `none` status is a REAL answer and must survive as
	// itself -- it is not the sentinel for "no attendee row at all".
	noneMember := seedHouseholdMember(t, app, "hh_status_none", year)
	seedAttendee(t, app, noneMember, weekend, "none", 1, year)

	statuses := enrollmentStatusesForYear(t, app, year)

	for household, want := range map[string]string{
		"hh_mixed":       enrollmentStatusEnrolled,
		"hh_waitlisted":  "waitlisted",
		"hh_status_none": "none",
	} {
		if got := statuses[household]; got != want {
			t.Errorf("%s enrollment_status = %q, want %q", household, got, want)
		}
	}
}

// TestFamilyCampEnrollmentStatusReachesAllThreeTables checks the column is
// actually written on a CREATE, on every one of the three tables. PocketBase's
// Set on a column the schema lacks is a silent no-op, so a table left out of
// the migration fails invisibly rather than loudly.
func TestFamilyCampEnrollmentStatusReachesAllThreeTables(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	s := NewFamilyCampDerivedSync(app)
	ctx := context.Background()

	s.upsertAdults(ctx, []*adultData{{
		householdPBID: "hh_1", adultNumber: 1, name: "Emma Johnson",
		enrollmentStatus: enrollmentStatusEnrolled,
	}}, year, map[string]*core.Record{})
	s.upsertRegistrations(ctx, []*registrationData{{
		householdPBID: "hh_1", enrollmentStatus: enrollmentStatusEnrolled,
	}}, year, map[string]*core.Record{})
	s.upsertMedical(ctx, []*medicalData{{
		householdPBID: "hh_1", enrollmentStatus: enrollmentStatusEnrolled,
	}}, year, map[string]*core.Record{})

	for _, collection := range []string{"family_camp_adults", "family_camp_registrations", "family_camp_medical"} {
		records, err := app.FindRecordsByFilter(collection, "year = 2026", "", 0, 0)
		if err != nil {
			t.Fatalf("read %s: %v", collection, err)
		}
		if len(records) != 1 {
			t.Fatalf("%s holds %d rows, want 1", collection, len(records))
		}
		if got := records[0].GetString("enrollment_status"); got != enrollmentStatusEnrolled {
			t.Errorf("%s.enrollment_status = %q, want %q", collection, got, enrollmentStatusEnrolled)
		}
	}
}

// TestFamilyCampEnrollmentStatusRewritesAPreExistingRow is the additive-column
// trap. A row written before this column existed holds "" -- the "could not
// determine" value the derivation must never leave behind. The upsert's own
// change detection has to SEE that difference, or every pre-existing row is
// skipped as unchanged and keeps the empty string forever.
func TestFamilyCampEnrollmentStatusRewritesAPreExistingRow(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedRow(t, app, "family_camp_registrations", map[string]any{"household": "hh_1", "year": year})

	s := NewFamilyCampDerivedSync(app)
	existing, err := s.preloadExistingRegistrations(year)
	if err != nil {
		t.Fatalf("preload: %v", err)
	}

	reg := &registrationData{householdPBID: "hh_1", enrollmentStatus: "waitlisted"}
	if !s.registrationNeedsUpdate(existing[familyCampHouseholdYearKey("hh_1", year)], reg) {
		t.Fatal("registrationNeedsUpdate = false for a row still holding the empty status")
	}

	_, updated, skipped, errCount := s.upsertRegistrations(
		context.Background(), []*registrationData{reg}, year, existing)
	if updated != 1 || skipped != 0 || errCount != 0 {
		t.Fatalf("upsert updated=%d skipped=%d errors=%d, want 1/0/0", updated, skipped, errCount)
	}

	records, err := app.FindRecordsByFilter("family_camp_registrations", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got := records[0].GetString("enrollment_status"); got != "waitlisted" {
		t.Errorf("enrollment_status = %q, want %q", got, "waitlisted")
	}
}

// TestFamilyCampStatusPriorityMatchesTheFrontend pins the Go ordering against
// the TypeScript one it duplicates. There is no shared source for it: the
// derivation runs in Go and getStatusPriority is TypeScript, so the ONLY thing
// stopping the two drifting is this test. It reads the real file rather than a
// copied literal, so editing the map without editing this package fails here.
func TestFamilyCampStatusPriorityMatchesTheFrontend(t *testing.T) {
	t.Parallel()

	const path = "../../frontend/src/utils/enrollmentFilter.ts"
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	block := regexp.MustCompile(`(?s)const STATUS_PRIORITY: Record<string, number> = \{(.*?)\n\}`).
		FindSubmatch(source)
	if block == nil {
		t.Fatalf("STATUS_PRIORITY not found in %s -- if it was renamed, rename it here too", path)
	}

	want := map[string]int{}
	for _, entry := range regexp.MustCompile(`(\w+):\s*(\d+)`).FindAllSubmatch(block[1], -1) {
		rank, convErr := strconv.Atoi(string(entry[2]))
		if convErr != nil {
			t.Fatalf("unparseable rank %q: %v", entry[2], convErr)
		}
		want[string(entry[1])] = rank
	}
	if len(want) == 0 {
		t.Fatalf("parsed no entries out of STATUS_PRIORITY in %s", path)
	}

	if len(familyCampStatusPriority) != len(want) {
		t.Errorf("Go map holds %d statuses, %s holds %d", len(familyCampStatusPriority), path, len(want))
	}
	for status, rank := range want {
		if got, ok := familyCampStatusPriority[status]; !ok || got != rank {
			t.Errorf("familyCampStatusPriority[%q] = %d (present=%t), want %d", status, got, ok, rank)
		}
	}
}
