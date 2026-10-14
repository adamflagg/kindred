package sync

import (
	"context"
	"errors"
	"slices"
	"strings"
	gosync "sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin the scheduled runs over two seasons (spec §5): the primary season
// N first, then the prior season N-1, each job of the N-1 pass running its own year-scoped
// instance so the shared registry is never swapped.
//
// They drive the real queues (RunDailySync, RunHourlySync, ...) against recorders that log the
// season each run actually used. A client-backed recorder reports its CampMinder client's
// season, the way the real services fetch; a field-backed recorder reports the year it was
// given through SetYear. Most run inside a synctest bubble, because runSyncAndWait polls every
// 500ms and a two-season daily queue is ~60 jobs.

// seasonRun is one recorded run: which job, and the season it ran with.
type seasonRun struct {
	ID   string
	Year int
}

// seasonRecorder logs every run and can fail or pause chosen (job, season) pairs.
type seasonRecorder struct {
	mu      gosync.Mutex
	runs    []seasonRun
	fail    map[seasonRun]bool
	block   map[seasonRun]chan struct{}
	blocked chan seasonRun
	// filters holds the changed-collections filter each run of a ChangedCollectionsAware
	// recorder was handed (nil means "export everything").
	filters map[seasonRun]map[string]bool
}

func newSeasonRecorder() *seasonRecorder {
	return &seasonRecorder{
		fail:    map[seasonRun]bool{},
		block:   map[seasonRun]chan struct{}{},
		blocked: make(chan seasonRun, 8),
		filters: map[seasonRun]map[string]bool{},
	}
}

func (r *seasonRecorder) run(ctx context.Context, id string, year int) error {
	key := seasonRun{ID: id, Year: year}
	r.mu.Lock()
	r.runs = append(r.runs, key)
	release, fail := r.block[key], r.fail[key]
	r.mu.Unlock()
	if release != nil {
		r.blocked <- key
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if fail {
		return errors.New("recorded failure")
	}
	return nil
}

// Runs returns every run so far, in the order they started.
func (r *seasonRecorder) Runs() []seasonRun {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.runs)
}

// Ran reports whether id ran with season year.
func (r *seasonRecorder) Ran(id string, year int) bool {
	return slices.Contains(r.Runs(), seasonRun{ID: id, Year: year})
}

// count is how many times id ran with season year.
func (r *seasonRecorder) count(id string, year int) int {
	n := 0
	for _, run := range r.Runs() {
		if run == (seasonRun{ID: id, Year: year}) {
			n++
		}
	}
	return n
}

// FailFor makes id fail whenever it runs with season year.
func (r *seasonRecorder) FailFor(id string, year int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fail[seasonRun{ID: id, Year: year}] = true
}

// blockDuring pauses id's run for season year until release is closed.
func (r *seasonRecorder) blockDuring(id string, year int, release chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.block[seasonRun{ID: id, Year: year}] = release
}

// waitUntilBlocked returns once a run has reached its blockDuring pause.
func (r *seasonRecorder) waitUntilBlocked(t *testing.T) seasonRun {
	t.Helper()
	select {
	case run := <-r.blocked:
		return run
	case <-time.After(time.Hour):
		t.Fatal("no run reached its block")
		return seasonRun{}
	}
}

// clientRecorder stands in for a CampMinder-backed job: its season is its client's.
type clientRecorder struct {
	id     string
	client *campminder.Client
	rec    *seasonRecorder
}

func (s *clientRecorder) Sync(ctx context.Context) error {
	return s.rec.run(ctx, s.id, s.client.GetSeasonID())
}
func (s *clientRecorder) GetStats() Stats { return Stats{Updated: 1} }

// yearRecorder stands in for a job that reads its season from a field (a YearSetter). It is
// ChangedCollectionsAware too, so a test can see which filter the export was handed.
type yearRecorder struct {
	id      string
	year    int
	changed map[string]bool
	rec     *seasonRecorder
}

func (s *yearRecorder) Sync(ctx context.Context) error {
	s.rec.mu.Lock()
	s.rec.filters[seasonRun{ID: s.id, Year: s.year}] = s.changed
	s.rec.mu.Unlock()
	return s.rec.run(ctx, s.id, s.year)
}
func (s *yearRecorder) GetStats() Stats                               { return Stats{Updated: 1} }
func (s *yearRecorder) SetYear(year int)                              { s.year = year }
func (s *yearRecorder) SetChangedCollections(changed map[string]bool) { s.changed = changed }

// filterFor is the changed-collections filter id's run for year was handed, and whether it ran.
func (r *seasonRecorder) filterFor(id string, year int) (map[string]bool, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f, ok := r.filters[seasonRun{ID: id, Year: year}]
	return f, ok
}

// newRecordingOrchestrator builds an orchestrator whose every job (or only the given ones) is a
// recorder, booted the way InitializeSyncServices boots: a base client for the current primary
// season, client-backed jobs bound to it. Both factories the season logic uses are swapped for
// recorder factories that cover exactly the job ids the real ones build, so a gap in the real
// factory still shows up as a missing run.
//
// app may be nil (no sync_runs rows, no global-table bootstrap).
func newRecordingOrchestrator(
	t *testing.T, app core.App, client *campminder.Client, only ...string,
) (*Orchestrator, *seasonRecorder) {
	t.Helper()
	rec := newSeasonRecorder()
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)
	o.baseClient = client

	clientBacked := map[string]bool{}
	for id := range o.clientServices(client) {
		clientBacked[id] = true
	}
	wanted := func(id string) bool { return len(only) == 0 || slices.Contains(only, id) }
	recorderFor := func(id string, c *campminder.Client, year int) Service {
		if clientBacked[id] {
			return &clientRecorder{id: id, client: c, rec: rec}
		}
		return &yearRecorder{id: id, year: year, rec: rec}
	}

	for _, m := range syncJobMeta {
		if wanted(m.ID) {
			o.RegisterService(m.ID, recorderFor(m.ID, client, 0))
		}
	}
	o.clientServicesFn = func(c *campminder.Client) map[string]Service {
		out := map[string]Service{}
		for id := range clientBacked {
			if wanted(id) {
				out[id] = recorderFor(id, c, 0)
			}
		}
		return out
	}
	o.yearServicesFn = func(year int, _ bool) map[string]Service {
		yearClient := o.BaseClient().CloneWithYear(year)
		out := map[string]Service{}
		// Built with no app: only the key set matters, so the real factory decides coverage.
		// The real factory builds the export only beside a registered exporter.
		keys := NewOrchestrator(nil)
		if wanted("multi_workbook_export") {
			exp, err := NewMultiWorkbookExport(nil, nil, nil, year)
			if err != nil {
				t.Errorf("NewMultiWorkbookExport: %v", err)
			}
			keys.RegisterService("multi_workbook_export", exp)
		}
		for id := range keys.servicesForYear(year, false) {
			if wanted(id) {
				out[id] = recorderFor(id, yearClient, year)
			}
		}
		return out
	}
	return o, rec
}

// runInBubble runs f inside a synctest bubble, so runSyncAndWait's 500ms polls cost nothing.
func runInBubble(t *testing.T, f func(t *testing.T)) {
	t.Helper()
	synctest.Test(t, f)
}

// TestDailySyncRunsPrimaryThenPriorSeason is spec §5's daily row: every primary job first,
// then the prior season's, with the PrimaryOnly windowed jobs only in the primary pass.
func TestDailySyncRunsPrimaryThenPriorSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	t.Setenv("JOTFORM_API_KEY", "test-key")
	t.Setenv("IS_DOCKER", "true")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		if err := o.RunDailySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		runs := rec.Runs()
		firstPrior := slices.IndexFunc(runs, func(r seasonRun) bool { return r.Year == 2026 })
		if firstPrior < 0 {
			t.Fatal("no N-1 (2026) runs")
		}
		for _, r := range runs[:firstPrior] {
			if r.Year != 2027 {
				t.Fatalf("primary must finish before N-1 starts; got %+v before the first 2026 run", r)
			}
		}
		for _, r := range runs[firstPrior:] {
			if r.Year != 2026 {
				t.Errorf("unexpected year in the N-1 pass: %+v", r)
			}
			if r.ID == "financial_transactions" || r.ID == "aid_postings" {
				t.Errorf("%s ran in the N-1 pass", r.ID)
			}
		}
		// Every job the N-1 queue names ran for 2026, in queue order, cleanup last.
		prior := make([]string, 0, len(runs)-firstPrior)
		for _, r := range runs[firstPrior:] {
			prior = append(prior, r.ID)
		}
		if want := orderQueue(secondarySeasonQueue(CadenceDaily)); !slices.Equal(prior, want) {
			t.Errorf("N-1 pass ran %v, want %v", prior, want)
		}
	})
}

// TestPriorSeasonPassNeverSwapsTheRegistry is the plan's Review Focus 2: the hourly cron can
// fire while the nightly N-1 pass is running, and must find the primary's services, not 2026's.
func TestPriorSeasonPassNeverSwapsTheRegistry(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		before := map[string]Service{}
		o.mu.RLock()
		for id, svc := range o.services {
			before[id] = svc
		}
		o.mu.RUnlock()

		release := make(chan struct{})
		rec.blockDuring("attendees", 2026, release) // pause mid N-1 pass
		done := make(chan error, 1)
		go func() { done <- o.RunDailySync(context.Background()) }()
		rec.waitUntilBlocked(t)

		o.mu.RLock()
		for id, svc := range before {
			if o.services[id] != svc {
				t.Errorf("the registry's %s changed during the N-1 pass; an hourly run would pick up the wrong season", id)
			}
		}
		o.mu.RUnlock()
		if !o.IsDailySyncRunning() {
			t.Error("Manage > Sync must show the nightly run in progress during the N-1 pass")
		}
		close(release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if o.IsDailySyncRunning() {
			t.Error("the daily flag must clear once the N-1 pass ends")
		}
	})
}

// TestPriorSeasonFailureLeavesPrimaryRecorded pins spec §5's failure rule: primary runs first,
// so an N-1 failure never costs the primary, and one N-1 job failing does not stop the rest.
func TestPriorSeasonFailureLeavesPrimaryRecorded(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		rec.FailFor("attendees", 2026)
		_ = o.RunDailySync(context.Background())
		if !rec.Ran("attendees", 2027) || !rec.Ran("persons", 2026) {
			t.Fatal("a 2026 failure must not stop the primary or the rest of the N-1 pass")
		}
		if got := o.GetStatus("attendees"); got == nil || got.Status != statusFailed || got.Year != 2026 {
			t.Errorf("the failed N-1 attendees run must be recorded as a 2026 failure, got %+v", got)
		}
	})
}

// TestSyncRunsRowsCarryTheirSeason is spec §5's process-global-year test: a two-season daily
// run records a set of sync_runs rows per season, each under its own year, and the N-1 pass
// does not inherit the primary's year (or the reverse).
func TestSyncRunsRowsCarryTheirSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	app := newSyncRunsApp(t)
	jobs := []string{"attendees", "persons", "financial_transactions"}
	o, _ := newRecordingOrchestrator(t, app, client, jobs...)
	if err := o.RunDailySync(context.Background()); err != nil {
		t.Fatal(err)
	}
	// attendees and persons twice (2027, 2026); financial_transactions once (2027).
	recs := waitForSyncRuns(t, app, 5)

	years := map[string][]int{}
	batchYear := map[string]int{}
	for _, r := range recs {
		service, year, batch := r.GetString("service"), r.GetInt("year"), r.GetString("batch_id")
		if !slices.Contains(jobs, service) {
			continue
		}
		years[service] = append(years[service], year)
		if r.GetString("trigger") != triggerDaily {
			t.Errorf("%s/%d trigger = %q, want %q", service, year, r.GetString("trigger"), triggerDaily)
		}
		if prev, seen := batchYear[batch]; seen && prev != year {
			t.Errorf("batch %s holds rows for %d and %d; a season pass inherited another's year", batch, prev, year)
		}
		batchYear[batch] = year
	}
	for _, id := range []string{"attendees", "persons"} {
		slices.Sort(years[id])
		if !slices.Equal(years[id], []int{2026, 2027}) {
			t.Errorf("%s rows filed under %v, want [2026 2027]", id, years[id])
		}
	}
	if !slices.Equal(years["financial_transactions"], []int{2027}) {
		t.Errorf("financial_transactions rows filed under %v, want only [2027]", years["financial_transactions"])
	}
}

// TestHourlyRunCollidingWithThePriorSeasonPassIsRefusedNotMisfiled pins what happens when the
// hourly cron's bunk_assignments (primary, registry instance) starts while the nightly N-1 pass
// is running bunk_assignments (2026, its own instance). Both use the job id's one status slot.
// The second must be refused and logged, not adopt the running slot: adopting it used to
// restamp the 2026 run as an hourly 2027 run, run both at once, and leave the N-1 pass waiting
// forever for a completion token that had been overwritten.
func TestHourlyRunCollidingWithThePriorSeasonPassIsRefusedNotMisfiled(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		release := make(chan struct{})
		rec.blockDuring("bunk_assignments", 2026, release)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()
		done := make(chan error, 1)
		go func() { done <- o.RunDailySync(ctx) }()
		rec.waitUntilBlocked(t)

		primaryRuns := rec.count("bunk_assignments", 2027)
		err := o.RunHourlySync(ctx)
		if err == nil || !strings.Contains(err.Error(), "already in progress") {
			t.Errorf("the colliding hourly run must be refused, got %v", err)
		}
		if got := rec.count("bunk_assignments", 2027); got != primaryRuns {
			t.Errorf("the refused hourly run still ran bunk_assignments for 2027 (%d runs, was %d)", got, primaryRuns)
		}
		if st := o.GetStatus("bunk_assignments"); st == nil || st.Year != 2026 || st.Trigger != triggerDaily {
			t.Errorf("the running N-1 slot was restamped: %+v", st)
		}

		close(release)
		select {
		case <-done:
		case <-time.After(time.Hour):
			t.Fatal("the N-1 pass never saw its bunk_assignments run complete")
		}
		o.mu.RLock()
		last := o.lastCompletedStatus["bunk_assignments"]
		o.mu.RUnlock()
		if last == nil || last.Year != 2026 || last.Trigger != triggerDaily {
			t.Errorf("the N-1 bunk_assignments run was filed as %+v, want year 2026, trigger daily", last)
		}
	})
}

// TestPrimaryPassFollowsTheRolloverWithoutARestart is audit Fix A: the boot client is built for
// the season at process start. At Oct 15 00:00 Pacific the primary moves on, and the next
// scheduled run must sync the new primary without a container restart.
func TestPrimaryPassFollowsTheRolloverWithoutARestart(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	pacific := func(day, hour int) time.Time {
		return time.Date(2026, time.October, day, hour, 0, 0, 0, seasonLocation)
	}
	withNow(t, pacific(14, 23)) // booted the evening before: primary 2026
	client := newTestCampMinderClient(t, 2026)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		nowFn = func() time.Time { return pacific(15, 1) } // primary 2027 now
		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		if !rec.Ran("bunk_assignments", 2027) {
			t.Errorf("the primary pass must sync 2027 after the rollover: %+v", rec.Runs())
		}
		if !rec.Ran("bunk_assignments", 2026) {
			t.Errorf("the hourly N-1 pass must sync 2026, the new prior season: %+v", rec.Runs())
		}
		if got := rec.count("bunk_assignments", 2026); got != 1 {
			t.Errorf("2026 ran %d times, want once (the N-1 pass; the primary pass must not sync it)", got)
		}
		if got := o.BaseClient().GetSeasonID(); got != 2027 {
			t.Errorf("BaseClient season = %d, want 2027 (on-demand handlers build from it)", got)
		}
	})
}

// TestEveryScheduledRunMovesThePrimaryClient pins Fix A at all four scheduled entry points.
func TestEveryScheduledRunMovesThePrimaryClient(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2026)                           // booted before Oct 15

	entries := map[string]func(*Orchestrator) error{
		"daily":         func(o *Orchestrator) error { return o.RunDailySync(context.Background()) },
		"hourly":        func(o *Orchestrator) error { return o.RunHourlySync(context.Background()) },
		"weekly":        func(o *Orchestrator) error { return o.RunWeeklySync(context.Background()) },
		"custom_values": func(o *Orchestrator) error { return o.RunCustomValuesSync(context.Background()) },
	}
	for name, run := range entries {
		t.Run(name, func(t *testing.T) {
			runInBubble(t, func(t *testing.T) {
				o, _ := newRecordingOrchestrator(t, nil, client)
				_ = run(o)
				if got := o.BaseClient().GetSeasonID(); got != 2027 {
					t.Errorf("%s run left the primary client on %d, want 2027", name, got)
				}
				if c, ok := o.GetService("attendees").(*clientRecorder); !ok || c.client.GetSeasonID() != 2027 {
					t.Errorf("%s run left the registered attendees on the old season", name)
				}
			})
		})
	}
}

// The jobs below run in the N-1 pass because they scope themselves by data (spec §5): a season
// with no work for them must be a no-op, not an error and not a write. One test per job, where
// the job's own harness makes it cheap. process_requests is not here: its Go side is one HTTP
// call, and whether a season has unprocessed requests is decided in FastAPI.

func TestJotformIsANoOpForASeasonWithNoForms(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app) // a form for jfYear only
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}

	s := NewJotformSubmissionsSync(app)
	s.Year = jfYear - 1
	s.Fetcher = fake
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("a season with no forms must not fail: %v", err)
	}
	if !s.Stats.IsNoOp() {
		t.Errorf("Stats = %+v, want a no-op", s.Stats)
	}
	if subs, _ := app.FindAllRecords("jotform_submissions"); len(subs) != 0 {
		t.Errorf("stored %d submissions for a season with no forms", len(subs))
	}
}

func TestReconcileIsANoOpForASeasonWithNoRequests(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	setupReconcileCollections(t, app)

	// A 2025 requester who moved sessions: a 2025 pass would mark this request unprocessed.
	_ = saveSession(t, app, 100)
	session2 := saveSession(t, app, 200)
	liam := savePerson(t, app, 1001)
	saveAttendee(t, app, 1001, 2, 2025, session2)
	obr := saveOBR(t, app, liam, 2025, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1001, 1002, 100, 2025, "resolved")

	s := NewReconcileLifecycleSync(app)
	s.Year = 2024
	if err = s.Sync(context.Background()); err != nil {
		t.Fatalf("a season with no requests must not fail: %v", err)
	}
	if !s.Stats.IsNoOp() {
		t.Errorf("Stats = %+v, want a no-op", s.Stats)
	}
	reloaded, err := app.FindRecordById("original_bunk_requests", obr.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.GetString("processed"); got != fixtureProcessed2025 {
		t.Errorf("a 2024 pass touched a 2025 request: processed = %q", got)
	}
}

func TestBunkRequestsIsANoOpForASeasonWithNoUpload(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	s := NewBunkRequestsSync(app, newTestCampMinderClient(t, 2026)) // no 2026_latest.csv
	if err = s.Sync(context.Background()); err != nil {
		t.Fatalf("a season with no upload must not fail: %v", err)
	}
	if !s.WasSuccessful() || !s.Stats.IsNoOp() {
		t.Errorf("successful = %v, Stats = %+v; want a successful no-op", s.WasSuccessful(), s.Stats)
	}
}

func TestScopedCustomValuesAreANoOpForASeasonWithNoWeekends(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	col := core.NewBaseCollection("camp_sessions")
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.TextField{Name: "session_type"})
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	saveCollection(t, app, col)
	addAidCohortCollections(t, app)
	saveRecord(t, app, "camp_sessions", map[string]any{"year": 2027, "session_type": "adult", "cm_id": 1300001})

	client := newTestCampMinderClient(t, 2026) // the weekend above is 2027's
	person := NewPersonCustomFieldValuesSync(app, client)
	person.SetScope(ScopeFamilyCamp)
	household := NewHouseholdCustomFieldValuesSync(app, client)
	household.SetScope(ScopeFamilyCamp)
	for name, svc := range map[string]Service{
		"person_custom_values_family_camp":    person,
		"household_custom_values_family_camp": household,
	} {
		if err := svc.Sync(context.Background()); err != nil {
			t.Errorf("%s: a season with no weekends or aid must not fail: %v", name, err)
		}
		if st := svc.GetStats(); !st.IsNoOp() {
			t.Errorf("%s: Stats = %+v, want a no-op", name, st)
		}
	}
}

// TestHourlySyncCoversBothSeasons is spec §5's hourly row: bunk_assignments for both seasons.
func TestHourlySyncCoversBothSeasons(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		if !rec.Ran("bunk_assignments", 2027) || !rec.Ran("bunk_assignments", 2026) {
			t.Fatalf("hourly bunk_assignments must run for 2027 and 2026: %+v", rec.Runs())
		}
		if runs := rec.Runs(); runs[0] != (seasonRun{ID: "bunk_assignments", Year: 2027}) {
			t.Errorf("the primary must run first, got %+v", runs)
		}
		if st := o.GetStatus("bunk_assignments"); st == nil || st.Year != 2026 || st.Trigger != triggerHourly {
			t.Errorf("the N-1 hourly run must be filed as an hourly 2026 run, got %+v", st)
		}
	})
}

// TestWeeklyExportCoversBothSeasonsButCustomValuesStayPrimary is spec §5's weekly row: the
// export writes the prior season's workbook too, while the full custom-values passes are primary
// only (ruling 4).
func TestWeeklyExportCoversBothSeasonsButCustomValuesStayPrimary(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC))
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		_ = o.RunWeeklySync(context.Background())
		_ = o.RunCustomValuesSync(context.Background())
		if !rec.Ran("multi_workbook_export", 2027) || !rec.Ran("multi_workbook_export", 2026) {
			t.Errorf("the 2027 and 2026 workbooks must both stay current: %+v", rec.Runs())
		}
		if rec.Ran("person_custom_values", 2026) || rec.Ran("household_custom_values", 2026) {
			t.Error("the weekly full custom-values pass is primary only")
		}
		if !rec.Ran("person_custom_values", 2027) || !rec.Ran("household_custom_values", 2027) {
			t.Error("the weekly full custom-values pass must still run for the primary")
		}
		for _, id := range GetJobsForPhase(PhaseGlobal) {
			if rec.Ran(id, 2026) {
				t.Errorf("global job %s ran in the N-1 pass; globals run once", id)
			}
		}
		// The N-1 export is a batch of one: nothing ran before it in its batch, so it must
		// export everything (nil), never the empty filter that exports nothing.
		filter, ran := rec.filterFor("multi_workbook_export", 2026)
		if !ran || filter != nil {
			t.Errorf("the 2026 export must get the nil filter (export everything), got %v (ran %v)", filter, ran)
		}
	})
}

// registrySnapshot copies the registry's id -> instance map, for comparing before and after.
func registrySnapshot(o *Orchestrator) map[string]Service {
	o.mu.RLock()
	defer o.mu.RUnlock()
	snap := make(map[string]Service, len(o.services))
	for id, svc := range o.services {
		snap[id] = svc
	}
	return snap
}

// TestHourlyRunDuringAManualPriorSeasonRunSyncsThePrimary is the plan's Review Focus 2 for a
// staff-started run: after the rollover, Manage > Sync "run all" for N-1 (RunSyncWithOptions
// with Year 2026, primary 2027) is a normal action. The hourly cron firing while it runs must
// sync the season it means to. A replay that registered its own instances for the run made the
// hourly primary pass pick up 2026's bunk_assignments and file it as the hourly primary run.
func TestHourlyRunDuringAManualPriorSeasonRunSyncsThePrimary(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	t.Run("a different job is running", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			primaryBunks := o.GetService("bunk_assignments")

			release := make(chan struct{})
			rec.blockDuring("attendees", 2026, release) // pause the manual N-1 run mid-way
			done := make(chan error, 1)
			go func() { done <- o.RunSyncWithOptions(context.Background(), Options{Year: 2026}) }()
			rec.waitUntilBlocked(t)

			if got := o.GetService("bunk_assignments"); got != primaryBunks {
				t.Errorf("the registry's bunk_assignments changed during the manual 2026 run: an hourly " +
					"run would sync the replay's season and file it under the primary")
			}

			before2026 := rec.count("bunk_assignments", 2026)
			if err := o.RunHourlySync(context.Background()); err != nil {
				t.Fatalf("RunHourlySync: %v", err)
			}
			if got := rec.count("bunk_assignments", 2027); got != 1 {
				t.Errorf("the hourly primary pass must sync bunk_assignments for 2027 once, ran %d times: %+v",
					got, rec.Runs())
			}
			if got := rec.count("bunk_assignments", 2026) - before2026; got != 1 {
				t.Errorf("the hourly run must sync 2026 once (its N-1 pass), ran %d times: the primary pass "+
					"must not sync the replay's season", got)
			}

			close(release)
			if err := <-done; err != nil {
				t.Fatalf("RunSyncWithOptions: %v", err)
			}
		})
	})

	t.Run("the same job is running", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)

			release := make(chan struct{})
			rec.blockDuring("bunk_assignments", 2026, release)
			done := make(chan error, 1)
			go func() { done <- o.RunSyncWithOptions(context.Background(), Options{Year: 2026}) }()
			rec.waitUntilBlocked(t)

			err := o.RunHourlySync(context.Background())
			if err == nil || !strings.Contains(err.Error(), "already in progress") {
				t.Errorf("the colliding hourly run must be refused, got %v", err)
			}
			if got := rec.count("bunk_assignments", 2027); got != 0 {
				t.Errorf("the refused hourly run still ran bunk_assignments for 2027 (%d runs)", got)
			}
			if st := o.GetStatus("bunk_assignments"); st == nil || st.Year != 2026 || st.Trigger != triggerHistorical {
				t.Errorf("the manual 2026 run's slot was restamped: %+v", st)
			}

			close(release)
			if err := <-done; err != nil {
				t.Fatalf("RunSyncWithOptions: %v", err)
			}
			o.mu.RLock()
			last := o.lastCompletedStatus["bunk_assignments"]
			o.mu.RUnlock()
			if last == nil || last.Year != 2026 || last.Trigger != triggerHistorical {
				t.Errorf("the manual 2026 bunk_assignments run was filed as %+v, want year 2026, trigger historical", last)
			}
		})
	})
}

// TestManualPriorSeasonRunLeavesTheRegistryAsItFoundIt pins that a manual season run never
// touches the registry, so there is nothing to restore when it ends: the same ids, the same
// instances, and the run itself still went to the replay's season.
func TestManualPriorSeasonRunLeavesTheRegistryAsItFoundIt(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		before := registrySnapshot(o)

		if err := o.RunSyncWithOptions(context.Background(), Options{Year: 2026}); err != nil {
			t.Fatalf("RunSyncWithOptions: %v", err)
		}

		after := registrySnapshot(o)
		if len(after) != len(before) {
			t.Errorf("the registry holds %d services after the run, %d before", len(after), len(before))
		}
		for id, svc := range before {
			if after[id] != svc {
				t.Errorf("the registry's %s is a different instance after the manual 2026 run", id)
			}
		}
		if !rec.Ran("attendees", 2026) || rec.Ran("attendees", 2027) {
			t.Errorf("the manual run must sync 2026 and only 2026: %+v", rec.Runs())
		}
	})
}
