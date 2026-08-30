package sync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The bounded family-camp pass covers every family-camp weekend in the year (kindred#2482).
// kindred#2601 narrows ONE press of Refresh Housing to the weekend the operator is actually
// looking at, without disturbing the 3am cron's whole-cohort pass.
//
// The two behaviors are one branch apart and the tests below pin BOTH halves deliberately:
// the narrowing is the new feature, and the union is the cron's contract. Testing only the
// narrowing would let a later edit collapse the union case and go green -- which is exactly
// the regression that matters, because the cron is unattended and silent.
//
// Measured cost that motivates the narrowing (2026 production snapshot, any status): the
// union is 782 persons / 448 households across 9 attended weekends, while the largest single
// weekend is 175 persons. The two custom-values jobs are ~96% of the ~13.5 min chain, so one
// weekend is a ~4x saving at worst and ~5x typical.

// scopeSessionFixture builds two family-camp weekends, each with its own household and
// person, plus one summer session that must never appear in either cohort.
func scopeSessionFixture(t *testing.T, year int) (app core.App, weekendOneCMID int) {
	t.Helper()
	app = cadenceTestApp(t)

	fc1 := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	fc2 := cadenceAddSession(t, app, 1002, sessionTypeFamily, year)
	summer := cadenceAddSession(t, app, 2001, sessionTypeMain, year)

	hh1 := cadenceAddHousehold(t, app, 701, year)
	hh2 := cadenceAddHousehold(t, app, 702, year)
	hhSummer := cadenceAddHousehold(t, app, 703, year)

	p1 := cadenceAddPerson(t, app, 801, 701, year, hh1)
	p2 := cadenceAddPerson(t, app, 802, 702, year, hh2)
	pSummer := cadenceAddPerson(t, app, 803, 703, year, hhSummer)

	// Non-enrolled on purpose: the bounded pass is any-status, and narrowing must not
	// quietly reintroduce an enrolled-only filter.
	cadenceAddAttendee(t, app, p1, fc1, "cancelled", 801, 32, year)
	cadenceAddAttendee(t, app, p2, fc2, "waitlisted", 802, 8, year)
	cadenceAddAttendee(t, app, pSummer, summer, "enrolled", 803, statusIDActiveEnrolled, year)

	return app, 1001
}

func TestScopeFamilyCamp_SessionNarrowsPersonCohort(t *testing.T) {
	t.Parallel()
	const year = 2026
	app, weekendOne := scopeSessionFixture(t, year)

	sync := NewPersonCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp
	sync.SetSession(strconv.Itoa(weekendOne))

	ids, err := sync.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{801}) {
		t.Errorf("getPersonIDsToSync (family-camp scope, session %d) = %v, want [801] -- "+
			"a session-scoped press must cover ONLY that weekend", weekendOne, ids)
	}
}

// TestScopeFamilyCamp_NoSessionKeepsPersonUnion is the cron's contract, and it is the half
// most likely to rot: the 3am pass sets no session, and must keep covering every weekend.
func TestScopeFamilyCamp_NoSessionKeepsPersonUnion(t *testing.T) {
	t.Parallel()
	const year = 2026
	app, _ := scopeSessionFixture(t, year)

	sync := NewPersonCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp
	// Session deliberately left at the constructor's default -- this is the cron's shape.

	ids, err := sync.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{801, 802}) {
		t.Errorf("getPersonIDsToSync (family-camp scope, no session) = %v, want [801 802] -- "+
			"the unattended daily pass must still span every family-camp weekend", ids)
	}
}

func TestScopeFamilyCamp_SessionNarrowsHouseholdCohort(t *testing.T) {
	t.Parallel()
	const year = 2026
	app, weekendOne := scopeSessionFixture(t, year)

	sync := NewHouseholdCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp
	sync.SetSession(strconv.Itoa(weekendOne))

	ids, err := sync.getHouseholdIDsToSync(year)
	if err != nil {
		t.Fatalf("getHouseholdIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{701}) {
		t.Errorf("getHouseholdIDsToSync (family-camp scope, session %d) = %v, want [701]",
			weekendOne, ids)
	}
}

func TestScopeFamilyCamp_NoSessionKeepsHouseholdUnion(t *testing.T) {
	t.Parallel()
	const year = 2026
	app, _ := scopeSessionFixture(t, year)

	sync := NewHouseholdCustomFieldValuesSync(app, nil)
	sync.Scope = ScopeFamilyCamp

	ids, err := sync.getHouseholdIDsToSync(year)
	if err != nil {
		t.Fatalf("getHouseholdIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{701, 702}) {
		t.Errorf("getHouseholdIDsToSync (family-camp scope, no session) = %v, want [701 702]", ids)
	}
}

// TestScopeAll_SessionStillHonored guards the branch that was ALREADY there: narrowing the
// family-camp case must not disturb the unrestricted instance's own session filter, which
// backs manual `?session=` runs and is enrolled-only by design.
func TestScopeAll_SessionStillHonored(t *testing.T) {
	t.Parallel()
	const year = 2026
	app := cadenceTestApp(t)

	summer := cadenceAddSession(t, app, 2001, sessionTypeMain, year)
	hh := cadenceAddHousehold(t, app, 703, year)
	p := cadenceAddPerson(t, app, 803, 703, year, hh)
	cadenceAddAttendee(t, app, p, summer, "enrolled", 803, statusIDActiveEnrolled, year)

	sync := NewPersonCustomFieldValuesSync(app, nil)
	sync.SetSession("2001")

	ids, err := sync.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{803}) {
		t.Errorf("getPersonIDsToSync (unscoped, session 2001) = %v, want [803]", ids)
	}
}

// sessionSpy is a minimal Service carrying a Session field, mirroring yearSetterSpy's shape
// for the identical reason: it distinguishes "never touched" from "touched with the default".
type sessionSpy struct {
	name    string
	session string
	ran     bool
}

func (s *sessionSpy) Sync(context.Context) error { s.ran = true; return nil }
func (s *sessionSpy) Name() string               { return s.name }
func (s *sessionSpy) GetStats() Stats            { return Stats{} }
func (s *sessionSpy) SetSession(session string)  { s.session = session }

// TestRefreshHousingLeavesRegisteredSingletonUntouched is the kindred#2105 regression pin, and
// it is the most important test in this file.
//
// api.go's two on-demand custom-values handlers already carry the finding in a comment:
// mutating the SHARED registered singleton let a rejected (409) request's SetSession stick
// before MarkSyncRunning ever ran, "silently narrowing whichever request was actually in
// flight". A session-scoped Refresh Housing must therefore never write to the registered
// instance -- if it does, a second press (or the unattended 3am cron) inherits a weekend
// nobody asked for, and nothing crashes to say so.
//
// The assertion is deliberately on the SINGLETON rather than on the run's output: a test that
// only checked the scoped run's cohort would pass just as happily with the singleton
// corrupted underneath it.
func TestRefreshHousingLeavesRegisteredSingletonUntouched(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)

	const jobID = "person_custom_values_family_camp"
	registered := &sessionSpy{name: jobID, session: DefaultSession}
	o.RegisterService(jobID, registered)

	scoped := &sessionSpy{name: jobID, session: "1001"}

	if err := o.RunSyncSequenceWithServices(context.Background(),
		[]string{jobID}, map[string]Service{jobID: scoped}); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}

	if registered.session != DefaultSession {
		t.Errorf("registered singleton Session = %q after a session-scoped Refresh Housing, "+
			"want %q -- kindred#2105: a narrowed press must never reach the shared instance",
			registered.session, DefaultSession)
	}
	if registered.ran {
		t.Error("the registered singleton RAN -- the override was ignored and the press " +
			"silently covered every weekend")
	}
	if !scoped.ran {
		t.Error("the request-scoped instance never ran")
	}
}

// TestRunSyncSequenceNilOverridesUsesRegistry keeps the existing sequence behavior pinned:
// every caller that passes no overrides -- the crons, Refresh Bunking, Run Phase -- must be
// entirely unaffected by this change.
func TestRunSyncSequenceNilOverridesUsesRegistry(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)

	registered := &sessionSpy{name: "spy", session: DefaultSession}
	o.RegisterService("spy", registered)

	if err := o.RunSyncSequenceWithServices(context.Background(), []string{"spy"}, nil); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}
	if !registered.ran {
		t.Error("registered service did not run with nil overrides")
	}
}

// ── Refresh Housing's API surface (kindred#2601) ─────────────────────────────────────────

// TestRefreshFamilyCampOverridesEmptyForWholeCohort pins the compatibility half: with no
// weekend named, the handler must produce NO overrides, so the sequence is byte-identical to
// the one that shipped in kindred#2478/#2592. "all" and "" are the same answer.
func TestRefreshFamilyCampOverridesEmptyForWholeCohort(t *testing.T) {
	t.Parallel()

	for _, session := range []string{"", DefaultSession} {
		if got := refreshFamilyCampOverrides(nil, nil, session); len(got) != 0 {
			t.Errorf("refreshFamilyCampOverrides(%q) = %v, want empty -- an unscoped press "+
				"must run the registered services exactly as before", session, got)
		}
	}
}

// TestRefreshFamilyCampOverridesScopeBothCustomValuesJobs pins WHICH jobs get narrowed.
// Scoping only the person job would be a silent half-fix: the household pass is 4.0 of the
// chain's 13.5 minutes and covers the same ten weekends.
func TestRefreshFamilyCampOverridesScopeBothCustomValuesJobs(t *testing.T) {
	t.Parallel()

	overrides := refreshFamilyCampOverrides(nil, nil, "1001")

	wantJobs := []string{
		scopedID(serviceNamePersonCustomValues, ScopeFamilyCamp),
		scopedID(serviceNameHouseholdCustomValues, ScopeFamilyCamp),
	}
	if len(overrides) != len(wantJobs) {
		t.Fatalf("refreshFamilyCampOverrides(\"1001\") covers %d jobs, want %d (%v) -- the four "+
			"cheap jobs in the chain are year-wide and must NOT be overridden",
			len(overrides), len(wantJobs), wantJobs)
	}

	for _, job := range wantJobs {
		svc, ok := overrides[job]
		if !ok {
			t.Errorf("no request-scoped instance for %q", job)
			continue
		}
		sessioned, ok := svc.(interface{ SetSession(string) })
		if !ok {
			t.Errorf("%q override cannot carry a session", job)
			continue
		}
		_ = sessioned

		switch v := svc.(type) {
		case *PersonCustomFieldValuesSync:
			if v.Session != "1001" || v.Scope != ScopeFamilyCamp {
				t.Errorf("%q override = {Session:%q Scope:%q}, want {\"1001\" %q}",
					job, v.Session, v.Scope, ScopeFamilyCamp)
			}
		case *HouseholdCustomFieldValuesSync:
			if v.Session != "1001" || v.Scope != ScopeFamilyCamp {
				t.Errorf("%q override = {Session:%q Scope:%q}, want {\"1001\" %q}",
					job, v.Session, v.Scope, ScopeFamilyCamp)
			}
		default:
			t.Errorf("%q override has unexpected type %T", job, svc)
		}
	}
}

// TestHandleRefreshFamilyCampRejectsInvalidSession keeps the parameter honest at the edge,
// the same way handleIndividualSync does. A junk weekend must not reach ResolveSessionCMIDs
// and surface as a mid-sequence failure after the handler has already answered 200.
func TestHandleRefreshFamilyCampRejectsInvalidSession(t *testing.T) {
	t.Parallel()

	scheduler := NewScheduler(nil)
	for _, job := range GetRefreshFamilyCampJobs() {
		scheduler.GetOrchestrator().RegisterService(job, &MockService{name: job})
	}

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost, "/?session=not-a-weekend", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleRefreshFamilyCamp(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Errorf("session=not-a-weekend got %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
