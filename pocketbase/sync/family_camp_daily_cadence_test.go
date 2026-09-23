package sync

import (
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// cadenceTestApp builds a throwaway app carrying only the collections the
// bounded daily family-camp cadence pass touches (kindred#2482). It is
// deliberately separate from newSyncTestApp: that shared fixture's attendees
// collection has no "status" text field (only status_id), and the resolver's
// existing enrolled-only path filters on the text column
// (`status = 'enrolled'`), so a test exercising both the enrolled-only and
// any-status paths needs both columns present.
func cadenceTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	sessions.Fields.Add(&core.TextField{Name: "session_type"})
	sessions.Fields.Add(&core.NumberField{Name: "parent_id"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("save camp_sessions: %v", err)
	}

	households := core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(households); err != nil {
		t.Fatalf("save households: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "household_id"})
	persons.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("save persons: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.TextField{Name: "status"})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(attendees); err != nil {
		t.Fatalf("save attendees: %v", err)
	}

	return app
}

func cadenceAddSession(t *testing.T, app core.App, cmID int, sessionType string, year int) string {
	t.Helper()
	return saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": cmID, "name": sessionType, "session_type": sessionType, "year": year,
	})
}

func cadenceAddHousehold(t *testing.T, app core.App, cmID, year int) string {
	t.Helper()
	return saveRecord(t, app, "households", map[string]any{"cm_id": cmID, "year": year})
}

func cadenceAddPerson(t *testing.T, app core.App, cmID, householdCMID, year int, householdPBID string) string {
	t.Helper()
	return saveRecord(t, app, "persons", map[string]any{
		"cm_id": cmID, "household_id": householdCMID, "household": householdPBID, "year": year,
	})
}

func cadenceAddAttendee(
	t *testing.T, app core.App, personPBID, sessionPBID, status string, personCMID, statusID, year int,
) {
	t.Helper()
	saveRecord(t, app, "attendees", map[string]any{
		"person": personPBID, "person_id": personCMID, "session": sessionPBID,
		"status": status, "status_id": statusID, "year": year,
	})
}

func intsSorted(ids []int) []int {
	out := append([]int(nil), ids...)
	sort.Ints(out)
	return out
}

func intsEqual(a, b []int) bool {
	a, b = intsSorted(a), intsSorted(b)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestSessionResolver_AnyStatus_IncludesNonEnrolled pins the sibling-function
// shape ruled in kindred#2482: GetPersonIDsForSession's enrolled-only
// behavior is UNCHANGED (manual `?session=` runs must stay enrolled-only),
// while the new AnyStatus sibling observes a household moving in or out of
// enrolled -- a cancellation or waitlist entry -- which is the entire point
// of the bounded daily pass.
func TestSessionResolver_AnyStatus_IncludesNonEnrolled(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	sessionPB := cadenceAddSession(t, app, 1309514, sessionTypeFamily, year)

	hh1 := cadenceAddHousehold(t, app, 501, year)
	hh2 := cadenceAddHousehold(t, app, 502, year)
	hh3 := cadenceAddHousehold(t, app, 503, year)

	p1 := cadenceAddPerson(t, app, 601, 501, year, hh1)
	p2 := cadenceAddPerson(t, app, 602, 502, year, hh2)
	p3 := cadenceAddPerson(t, app, 603, 503, year, hh3)

	cadenceAddAttendee(t, app, p1, sessionPB, "enrolled", 601, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, p2, sessionPB, "cancelled", 602, 32, year)
	cadenceAddAttendee(t, app, p3, sessionPB, "waitlisted", 603, 8, year)

	resolver := NewSessionResolver(app)

	enrolledOnly, err := resolver.GetPersonIDsForSession("1309514", year)
	if err != nil {
		t.Fatalf("GetPersonIDsForSession: %v", err)
	}
	if !intsEqual(enrolledOnly, []int{601}) {
		t.Errorf("GetPersonIDsForSession (enrolled-only) = %v, want [601] -- manual ?session= runs "+
			"must stay enrolled-only", enrolledOnly)
	}

	anyStatus, err := resolver.GetPersonIDsForSessionAnyStatus("1309514", year)
	if err != nil {
		t.Fatalf("GetPersonIDsForSessionAnyStatus: %v", err)
	}
	if !intsEqual(anyStatus, []int{601, 602, 603}) {
		t.Errorf("GetPersonIDsForSessionAnyStatus = %v, want [601 602 603]", anyStatus)
	}

	enrolledHH, err := resolver.GetHouseholdIDsForSession("1309514", year)
	if err != nil {
		t.Fatalf("GetHouseholdIDsForSession: %v", err)
	}
	if !intsEqual(enrolledHH, []int{501}) {
		t.Errorf("GetHouseholdIDsForSession (enrolled-only) = %v, want [501]", enrolledHH)
	}

	anyStatusHH, err := resolver.GetHouseholdIDsForSessionAnyStatus("1309514", year)
	if err != nil {
		t.Fatalf("GetHouseholdIDsForSessionAnyStatus: %v", err)
	}
	if !intsEqual(anyStatusHH, []int{501, 502, 503}) {
		t.Errorf("GetHouseholdIDsForSessionAnyStatus = %v, want [501 502 503]", anyStatusHH)
	}
}

// TestGetFamilyCampIDsAnyStatus_SpansWeekendsExcludesOtherSessions pins the
// cohort-selection shape ruled in kindred#2482: the bounded daily pass's
// cohort must come from attendees across EVERY family-camp weekend (any
// status), unioned and deduplicated, and must NOT pick up a non-family
// session's attendees even if a person also attends one.
func TestGetFamilyCampIDsAnyStatus_SpansWeekendsExcludesOtherSessions(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	fc2 := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	fc3 := cadenceAddSession(t, app, 1002, sessionTypeFamily, year)
	summerSession := cadenceAddSession(t, app, 2001, sessionTypeMain, year)

	hhFC2 := cadenceAddHousehold(t, app, 701, year)
	hhFC3 := cadenceAddHousehold(t, app, 702, year)
	hhSummerOnly := cadenceAddHousehold(t, app, 703, year)
	hhBothWeekends := cadenceAddHousehold(t, app, 704, year)

	pFC2 := cadenceAddPerson(t, app, 801, 701, year, hhFC2)
	pFC3 := cadenceAddPerson(t, app, 802, 702, year, hhFC3)
	pSummerOnly := cadenceAddPerson(t, app, 803, 703, year, hhSummerOnly)
	pBoth := cadenceAddPerson(t, app, 804, 704, year, hhBothWeekends)

	cadenceAddAttendee(t, app, pFC2, fc2, "enrolled", 801, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, pFC3, fc3, "cancelled", 802, 32, year)
	cadenceAddAttendee(t, app, pSummerOnly, summerSession, "enrolled", 803, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, pBoth, fc2, "waitlisted", 804, 8, year)
	cadenceAddAttendee(t, app, pBoth, fc3, "enrolled", 804, statusIDActiveEnrolled, year)

	resolver := NewSessionResolver(app)

	personIDs, err := resolver.GetWeekendPersonIDsAnyStatus(year)
	if err != nil {
		t.Fatalf("GetWeekendPersonIDsAnyStatus: %v", err)
	}
	if !intsEqual(personIDs, []int{801, 802, 804}) {
		t.Errorf("GetWeekendPersonIDsAnyStatus = %v, want [801 802 804] "+
			"(803 is summer-only and must be excluded)", personIDs)
	}

	householdIDs, err := resolver.GetFamilyCampHouseholdIDsAnyStatus(year)
	if err != nil {
		t.Fatalf("GetFamilyCampHouseholdIDsAnyStatus: %v", err)
	}
	if !intsEqual(householdIDs, []int{701, 702, 704}) {
		t.Errorf("GetFamilyCampHouseholdIDsAnyStatus = %v, want [701 702 704]", householdIDs)
	}
}

// TestWeekendPersonIDsAnyStatus_IncludesAdultPrograms pins the owner ruling of
// 2026-09-23: the bounded daily PERSON pass also covers adult-program attendees
// (Women's/Men's Weekend, ...), any status, because an adult weekend's cabin is a
// PERSON custom field (212997/223823) and staff may type it into CampMinder while
// placing guests in October -- a weekly refresh would leave the board up to a week
// behind. The HOUSEHOLD pass deliberately stays family-camp only: adult weekends
// carry no household-grain lodging data, and adult-cohort household answers are
// written by other household members about other weekends.
func TestWeekendPersonIDsAnyStatus_IncludesAdultPrograms(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	fc := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	ww := cadenceAddSession(t, app, 1101, sessionTypeAdult, year)
	summerSession := cadenceAddSession(t, app, 2001, sessionTypeMain, year)

	hhFC := cadenceAddHousehold(t, app, 701, year)
	hhGuest := cadenceAddHousehold(t, app, 705, year)
	hhCancelledGuest := cadenceAddHousehold(t, app, 706, year)
	hhSummerOnly := cadenceAddHousehold(t, app, 703, year)

	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	pGuest := cadenceAddPerson(t, app, 805, 705, year, hhGuest)
	pCancelledGuest := cadenceAddPerson(t, app, 806, 706, year, hhCancelledGuest)
	pSummerOnly := cadenceAddPerson(t, app, 803, 703, year, hhSummerOnly)

	cadenceAddAttendee(t, app, pFC, fc, "enrolled", 801, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, pGuest, ww, "enrolled", 805, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, pCancelledGuest, ww, "cancelled", 806, 32, year)
	cadenceAddAttendee(t, app, pSummerOnly, summerSession, "enrolled", 803, statusIDActiveEnrolled, year)

	resolver := NewSessionResolver(app)

	personIDs, err := resolver.GetWeekendPersonIDsAnyStatus(year)
	if err != nil {
		t.Fatalf("GetWeekendPersonIDsAnyStatus: %v", err)
	}
	if !intsEqual(personIDs, []int{801, 805, 806}) {
		t.Errorf("GetWeekendPersonIDsAnyStatus = %v, want [801 805 806] "+
			"(adult guests of any status included; 803 is summer-only)", personIDs)
	}

	householdIDs, err := resolver.GetFamilyCampHouseholdIDsAnyStatus(year)
	if err != nil {
		t.Fatalf("GetFamilyCampHouseholdIDsAnyStatus: %v", err)
	}
	if !intsEqual(householdIDs, []int{701}) {
		t.Errorf("GetFamilyCampHouseholdIDsAnyStatus = %v, want [701] "+
			"(the household pass stays family-camp only)", householdIDs)
	}

	// The Refresh Housing guard still accepts family-camp weekends only.
	familyCMIDs, err := resolver.GetFamilyCampSessionCMIDs(year)
	if err != nil {
		t.Fatalf("GetFamilyCampSessionCMIDs: %v", err)
	}
	if !intsEqual(familyCMIDs, []int{1001}) {
		t.Errorf("GetFamilyCampSessionCMIDs = %v, want [1001]", familyCMIDs)
	}
}

// TestPersonCustomFieldValuesSync_ScopeFamilyCamp pins the bounded-mode
// wiring on the sync service itself: when ScopeFamilyCamp is set,
// getPersonIDsToSync must use the any-status family-camp cohort instead of
// the Session filter or the year-wide fallback, and the plain Session=""
// (unbounded) behavior must be untouched.
func TestPersonCustomFieldValuesSync_ScopeFamilyCamp(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	fc2 := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	summerSession := cadenceAddSession(t, app, 2001, sessionTypeMain, year)

	hhFC := cadenceAddHousehold(t, app, 701, year)
	hhSummer := cadenceAddHousehold(t, app, 702, year)

	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	pSummer := cadenceAddPerson(t, app, 802, 702, year, hhSummer)

	cadenceAddAttendee(t, app, pFC, fc2, "cancelled", 801, 32, year)
	cadenceAddAttendee(t, app, pSummer, summerSession, "enrolled", 802, statusIDActiveEnrolled, year)

	sync := NewPersonCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp

	ids, err := sync.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{801}) {
		t.Errorf("getPersonIDsToSync (bounded) = %v, want [801] "+
			"(cancelled family-camp attendee, any status)", ids)
	}
}

// TestPersonCustomFieldValuesSync_ScopeFamilyCampCoversAdultGuests is the wiring
// half of TestWeekendPersonIDsAnyStatus_IncludesAdultPrograms: the registered
// daily instance (ScopeFamilyCamp, no Session) must actually fetch an adult
// guest's person custom values, where the adult-weekend cabin lives.
func TestPersonCustomFieldValuesSync_ScopeFamilyCampCoversAdultGuests(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	fc := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	ww := cadenceAddSession(t, app, 1101, sessionTypeAdult, year)

	hhFC := cadenceAddHousehold(t, app, 701, year)
	hhGuest := cadenceAddHousehold(t, app, 705, year)

	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	pGuest := cadenceAddPerson(t, app, 805, 705, year, hhGuest)

	cadenceAddAttendee(t, app, pFC, fc, "enrolled", 801, statusIDActiveEnrolled, year)
	cadenceAddAttendee(t, app, pGuest, ww, "enrolled", 805, statusIDActiveEnrolled, year)

	sync := NewPersonCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp

	ids, err := sync.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{801, 805}) {
		t.Errorf("getPersonIDsToSync (bounded) = %v, want [801 805] "+
			"(the adult-weekend guest's cabin is a person custom field)", ids)
	}
}

func TestHouseholdCustomFieldValuesSync_ScopeFamilyCamp(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026

	fc2 := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	summerSession := cadenceAddSession(t, app, 2001, sessionTypeMain, year)

	hhFC := cadenceAddHousehold(t, app, 701, year)
	hhSummer := cadenceAddHousehold(t, app, 702, year)

	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	pSummer := cadenceAddPerson(t, app, 802, 702, year, hhSummer)

	cadenceAddAttendee(t, app, pFC, fc2, "waitlisted", 801, 8, year)
	cadenceAddAttendee(t, app, pSummer, summerSession, "enrolled", 802, statusIDActiveEnrolled, year)

	sync := NewHouseholdCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp

	ids, err := sync.getHouseholdIDsToSync(year)
	if err != nil {
		t.Fatalf("getHouseholdIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{701}) {
		t.Errorf("getHouseholdIDsToSync (bounded) = %v, want [701]", ids)
	}
}

// TestGetDailySyncJobs_ScopeFamilyCampPassBetweenSourceAndTransform pins
// the ordering ruled in kindred#2482: the bounded daily custom-values pass
// must sit strictly after financial_transactions (the last source job) and
// strictly before family_camp_derived (the first transform job that reads
// custom values). A future edit to the hardcoded job list must not silently
// undo this -- that is the entire point of the ruling, since the daily job
// not honoring its own phase order is the bug this fixes.
func TestGetDailySyncJobs_ScopeFamilyCampPassBetweenSourceAndTransform(t *testing.T) {
	t.Parallel()
	jobs := getDailySyncJobs()

	pos := make(map[string]int, len(jobs))
	for i, j := range jobs {
		pos[j] = i
	}

	for _, want := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		if _, ok := pos[want]; !ok {
			t.Fatalf("getDailySyncJobs missing %q: %v", want, jobs)
		}
	}

	sourceEnd, ok := pos["financial_transactions"]
	if !ok {
		t.Fatalf("financial_transactions missing from daily sync jobs: %v", jobs)
	}
	transformStart, ok := pos["family_camp_derived"]
	if !ok {
		t.Fatalf("family_camp_derived missing from daily sync jobs: %v", jobs)
	}

	for _, boundedJob := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		p := pos[boundedJob]
		if p <= sourceEnd {
			t.Errorf("%s (pos %d) must run after financial_transactions (pos %d)", boundedJob, p, sourceEnd)
		}
		if p >= transformStart {
			t.Errorf("%s (pos %d) must run before family_camp_derived (pos %d)", boundedJob, p, transformStart)
		}
	}

	// The weekly unrestricted sweep's job names must NOT appear in the daily
	// list -- the ruling retains them as weekly-only, on the "0 4 * * 0" cron,
	// not as part of the daily run.
	for _, unrestricted := range []string{"person_custom_values", "household_custom_values"} {
		if _, ok := pos[unrestricted]; ok {
			t.Errorf("getDailySyncJobs must not include the unrestricted %q -- "+
				"the weekly sweep stays weekly-only", unrestricted)
		}
	}
}

// TestSyncJobMeta_ScopeFamilyCampJobsAreExpensivePhase asserts the new
// bounded jobs are registered in syncJobMeta as PhaseExpensive, consistent
// with the unrestricted person_custom_values/household_custom_values jobs
// they sit alongside -- both make 1 CampMinder API call per entity.
func TestSyncJobMeta_ScopeFamilyCampJobsAreExpensivePhase(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		if got := GetPhaseForJob(id); got != PhaseExpensive {
			t.Errorf("GetPhaseForJob(%q) = %q, want %q", id, got, PhaseExpensive)
		}
	}

	expensive := GetJobsForPhase(PhaseExpensive)
	for _, id := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		found := false
		for _, j := range expensive {
			if j == id {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("GetJobsForPhase(PhaseExpensive) missing %q: %v", id, expensive)
		}
	}
}

// TestWeeklyCustomValuesCronRetained pins the RETAIN half of the kindred#2482
// ruling: the weekly unrestricted sweep's cron schedule ("0 4 * * 0") and its
// handler must survive untouched. Reads scheduler.go's source the same way
// TestCamperHistoryServiceFullyRemoved reads orchestrator.go -- a live
// scheduler needs a real cron.Cron and cannot be introspected for its
// schedule strings, so the source text is the only place to pin this.
func TestWeeklyCustomValuesCronRetained(t *testing.T) {
	t.Parallel()
	bodyBytes, err := os.ReadFile("scheduler.go")
	if err != nil {
		t.Fatalf("read scheduler.go: %v", err)
	}
	body := string(bodyBytes)
	if !strings.Contains(body, `"0 4 * * 0"`) {
		t.Error("scheduler.go no longer schedules the weekly custom-values sweep at 0 4 * * 0")
	}
	if !strings.Contains(body, "runCustomValuesSync") {
		t.Error("scheduler.go no longer wires the weekly cron to runCustomValuesSync")
	}
}
