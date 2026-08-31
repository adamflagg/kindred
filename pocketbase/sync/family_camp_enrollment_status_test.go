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
// kindred#2619 -- that status counts FAMILY weekends only.
//
// What the column is for: the three derived tables are built from custom values,
// a form a family filled in, and filling the form is not attending. Between 46
// and 89 households a year hold family-camp rows with nobody enrolled, and the
// column is what tells them apart from a household that came.
//
// ⛔ ADULT WEEKENDS ARE NOT FAMILY CAMP. An earlier version of this derivation
// counted them, on the reasoning that a family-only filter would badge genuine
// attendees as never enrolled. That reasoning was measured against this column
// and was CIRCULAR -- the households it counted were `enrolled` BECAUSE of the
// adult weekend. kindred#2619 ruled it out, and the tests below pin the ruling.
//
// Measured on the production snapshot (2026-08-23) for 2026: 162 households
// hold a family_camp_* row whose stored status changes, every one of them with
// no family-session attendee row in any state.
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

// TestFamilyCampEnrollmentStatusExcludesAdultWeekends is the whole ruling in one
// assertion: an adult weekend is NOT family camp.
//
// Men's and Women's Weekend and the Divorce & Discovery retreat are a SEPARATE
// PROGRAM that enrols adults directly. They are not family camp at a different
// grain, and their attendee rows say nothing about whether a household attended
// a family weekend. kindred#2619 ruled it, and api/services/lodging_repository.py
// and lodging_roster_service.py already read it this way.
//
// A household whose only weekend enrolment is an adult one is therefore ABSENT
// from the map -- it holds no family-camp attendee row at all, which is exactly
// what none_on_file names.
func TestFamilyCampEnrollmentStatusExcludesAdultWeekends(t *testing.T) {
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

	if got := statuses["hh_family"]; got != enrollmentStatusEnrolled {
		t.Errorf("hh_family enrollment_status = %q, want %q", got, enrollmentStatusEnrolled)
	}
	if got, present := statuses["hh_adult"]; present {
		t.Errorf("hh_adult is present with %q; an adult-weekend-only household holds no "+
			"family-camp attendee row and must be absent", got)
	}
	if got := enrollmentStatusForHousehold(statuses, "hh_adult"); got != enrollmentStatusNoneOnFile {
		t.Errorf("hh_adult resolves to %q, want %q", got, enrollmentStatusNoneOnFile)
	}
}

// TestFamilyCampEnrollmentStatusIgnoresAnAdultWeekendFallbackStatus covers the
// OTHER branch, which the enrolled case above does not reach.
//
// A household whose only weekend row is a CANCELLED adult-weekend one took the
// bestStatus path, not the enrolled one, and stored `cancelled` -- asserting a
// family-camp cancellation on the strength of a different program's row. 19 such
// households on the 2026 production snapshot, 292 across all years.
func TestFamilyCampEnrollmentStatusIgnoresAnAdultWeekendFallbackStatus(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedWeekendSession(t, app, 101, "Family Camp 1", "family", year)
	adultWeekend := seedWeekendSession(t, app, 102, "Adult Weekend 1", "adult", year)

	onAdult := seedHouseholdMember(t, app, "hh_adult_cancelled", year)
	seedAttendee(t, app, onAdult, adultWeekend, "cancelled", 32, year)

	statuses := enrollmentStatusesForYear(t, app, year)

	if got, present := statuses["hh_adult_cancelled"]; present {
		t.Errorf("hh_adult_cancelled is present with %q; a cancelled adult-weekend row is "+
			"not a family-camp cancellation", got)
	}
	if got := enrollmentStatusForHousehold(statuses, "hh_adult_cancelled"); got != enrollmentStatusNoneOnFile {
		t.Errorf("hh_adult_cancelled resolves to %q, want %q", got, enrollmentStatusNoneOnFile)
	}
}

// TestFamilyCampEnrollmentStatusLetsTheFamilyStatusSurfaceOverAnAdultEnrolment
// is the sharpest case, and the one the column got actively backwards.
//
// A household enrolled on an adult weekend AND waitlisted for a family weekend
// stored `enrolled`, because the adult row won the two-stage resolution -- so the
// column asserted the family attended a family camp it was only waitlisted for.
// With adult weekends excluded, the family-side status is the only one left and
// it surfaces. 8 such households in 2022, 10 in 2023, 5 in 2025 on the
// production snapshot.
func TestFamilyCampEnrollmentStatusLetsTheFamilyStatusSurfaceOverAnAdultEnrolment(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	familyWeekend := seedWeekendSession(t, app, 101, "Family Camp 1", "family", year)
	adultWeekend := seedWeekendSession(t, app, 102, "Adult Weekend 1", "adult", year)

	member := seedHouseholdMember(t, app, "hh_mixed", year)
	seedAttendee(t, app, member, adultWeekend, "enrolled", 2, year)
	seedAttendee(t, app, member, familyWeekend, "waitlisted", 8, year)

	statuses := enrollmentStatusesForYear(t, app, year)

	if got := statuses["hh_mixed"]; got != "waitlisted" {
		t.Errorf("hh_mixed enrollment_status = %q, want %q -- an adult-weekend enrolment "+
			"must not outrank the household's real family-camp status", got, "waitlisted")
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

// TestFamilyCampEnrollmentStatusRefusesAYearWithNoSessionsAtAll closes the one
// way this column can assert something it does not know.
//
// `none_on_file` is a POSITIVE claim -- "we hold no attendee row for this
// household" -- and absence from the status map is what produces it. If the
// sessions sync has not run for the year, every household is absent for a
// reason that has nothing to do with the household, and because the column is
// part of all three change comparisons the wrong answer WRITES. That is the
// exact "could not determine" case the column exists to prevent, so the run
// refuses instead.
//
// The discriminator is the year's camp_sessions rows, not its weekends: a
// season that ran sessions but no family weekend is a real answer
// (`none_on_file` for everyone), while a season with no sessions row at all has
// not been synced yet. Every year 2017-2026 on the production snapshot carries
// between 6 and 10 family weekends, so the second case is never a real season.
func TestFamilyCampEnrollmentStatusRefusesAYearWithNoSessionsAtAll(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedHouseholdMember(t, app, "hh_1", year)

	s := NewFamilyCampDerivedSync(app)
	personToHousehold, err := s.loadPersonHouseholdMapping(context.Background(), year)
	if err != nil {
		t.Fatalf("loadPersonHouseholdMapping: %v", err)
	}

	if _, err := s.loadHouseholdEnrollmentStatus(context.Background(), year, personToHousehold); err == nil {
		t.Fatal("accepted a year with no camp_sessions rows -- every household would be " +
			"written none_on_file on the strength of a table that was never synced")
	}

	// And the refusal reaches the caller rather than being swallowed.
	s.Year = year
	if err := s.Sync(context.Background()); err == nil {
		t.Fatal("Sync reported success for a year whose sessions were never synced")
	}
}

// TestFamilyCampEnrollmentStatusAcceptsASeasonWithNoWeekends is the other half:
// the guard above must not fire on a season that genuinely ran no family
// weekend. Sessions exist, none of them is a family weekend, so every household
// is honestly none_on_file.
func TestFamilyCampEnrollmentStatusAcceptsASeasonWithNoWeekends(t *testing.T) {
	t.Parallel()
	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedWeekendSession(t, app, 401, "Session 1", "main", year)
	seedHouseholdMember(t, app, "hh_1", year)

	statuses := enrollmentStatusesForYear(t, app, year)
	if len(statuses) != 0 {
		t.Errorf("statuses = %v, want empty", statuses)
	}
	if got := enrollmentStatusForHousehold(statuses, "hh_1"); got != enrollmentStatusNoneOnFile {
		t.Errorf("enrollmentStatusForHousehold = %q, want %q", got, enrollmentStatusNoneOnFile)
	}
}
