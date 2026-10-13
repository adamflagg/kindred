package sync

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	gosync "sync"
	"sync/atomic"
	"testing"
	"time"
)

// kindred#2803 item B. FastAPI's server caches (metrics 2 h, lodging 15 min,
// social graph 15 min) were cleared on a sync only when a browser tab watched
// that sync finish and called the invalidate endpoint -- so the hourly and
// nightly scheduled syncs, which nobody watches, left them stale. The
// orchestrator now tells FastAPI itself, naming the job, after EVERY run it
// finishes: success or failure (a failed run may still have written), through
// every completion path.

type recordedNotifications struct {
	mu  gosync.Mutex
	got []string
}

func (r *recordedNotifications) notify(syncType string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, syncType)
}

func (r *recordedNotifications) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.got...)
}

func assertNotified(t *testing.T, rec *recordedNotifications, want ...string) {
	t.Helper()
	got := rec.snapshot()
	if len(got) != len(want) {
		t.Fatalf("notified %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("notified %v, want %v", got, want)
		}
	}
}

func TestACompletedRunTellsTheAPIWhichJobFinished(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	rec := &recordedNotifications{}
	o.runCompletedNotifier = rec.notify
	o.RegisterService("attendees", &MockService{name: "attendees"})

	if err := o.runSyncAndWait(context.Background(), "attendees", newBatch(triggerManual)); err != nil {
		t.Fatalf("runSyncAndWait: %v", err)
	}
	assertNotified(t, rec, "attendees")
}

func TestAFailedRunStillTellsTheAPI(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	rec := &recordedNotifications{}
	o.runCompletedNotifier = rec.notify
	o.RegisterService("persons", &MockService{name: "persons", shouldFail: true, failWith: errors.New("boom")})

	_ = o.runSyncAndWait(context.Background(), "persons", newBatch(triggerManual))
	assertNotified(t, rec, "persons")
}

// process_requests and its siblings run their own Service and report through
// FinalizeSyncStatus rather than RunSingleSync. That path notifies once, and a
// second Finalize for the same run -- the handlers' deferred panic recovery
// calls it again -- notifies nothing.
func TestFinalizeSyncStatusTellsTheAPIOnce(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	rec := &recordedNotifications{}
	o.runCompletedNotifier = rec.notify
	o.RegisterService("process_requests", &MockService{name: "process_requests"})

	if err := o.MarkSyncRunning("process_requests"); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}
	o.FinalizeSyncStatus("process_requests", Stats{Created: 1}, nil)
	o.FinalizeSyncStatus("process_requests", Stats{Created: 1}, nil)
	assertNotified(t, rec, "process_requests")
}

type panickingService struct{}

func (panickingService) Sync(context.Context) error { panic("sync exploded") }
func (panickingService) GetStats() Stats            { return Stats{} }

func TestAPanickedRunStillTellsTheAPI(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	rec := &recordedNotifications{}
	o.runCompletedNotifier = rec.notify
	o.RegisterService("bunks", panickingService{})

	_ = o.runSyncAndWait(context.Background(), "bunks", newBatch(triggerManual))
	assertNotified(t, rec, "bunks")
}

// With no notifier wired (every orchestrator a test builds), a completion
// makes no HTTP call and does not trip over the nil.
func TestAnOrchestratorWithNoNotifierStillCompletes(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	o.RegisterService("staff", &MockService{name: "staff"})

	done := make(chan error, 1)
	go func() { done <- o.runSyncAndWait(context.Background(), "staff", newBatch(triggerManual)) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runSyncAndWait: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run never completed")
	}
}

// The browser refetches the moment a run's end_time appears in the status it polls. Before
// this, a run was published FIRST and FastAPI told afterwards, on a fire-and-forget goroutine
// -- so that refetch could land before the invalidate did, be served the pre-sync cache, and
// spend the client's one refresh on stale data (useAidSyncInvalidation; the lodging year cache
// has had the same race since kindred#2803). The order is now: sync_runs row, then the
// invalidate has returned (or timed out), then end_time becomes visible.

// blockingNotifier stands in for an API that has not answered yet: notify reports the call on
// `called` and then waits for `release`.
type blockingNotifier struct {
	called  chan string
	release chan struct{}
}

func newBlockingNotifier() *blockingNotifier {
	return &blockingNotifier{called: make(chan string, 4), release: make(chan struct{})}
}

func (b *blockingNotifier) notify(syncType string) {
	b.called <- syncType
	<-b.release
}

func (b *blockingNotifier) awaitCall(t *testing.T) {
	t.Helper()
	select {
	case <-b.called:
	case <-time.After(5 * time.Second):
		t.Fatal("the finished run never told the API")
	}
}

// assertNotYetPublished checks what the status endpoint would serve for syncType: still the
// running run, with no end_time for the browser to react to.
func assertNotYetPublished(t *testing.T, o *Orchestrator, syncType string) {
	t.Helper()
	st := o.GetStatus(syncType)
	if st == nil {
		t.Fatalf("%s vanished from the status payload while the API was still clearing", syncType)
	}
	if st.EndTime != nil || st.Status != statusRunning {
		t.Fatalf("%s was published (status %q, end_time %v) before the API had cleared its "+
			"caches; a browser refetching now is served pre-sync data", syncType, st.Status, st.EndTime)
	}
}

func awaitPublished(t *testing.T, o *Orchestrator, syncType string) *Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if st := o.GetStatus(syncType); st != nil && st.EndTime != nil {
			return st
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("%s was never published after the API answered", syncType)
	return nil
}

func TestARunIsNotPublishedUntilTheAPIHasClearedItsCaches(t *testing.T) {
	t.Parallel()
	const syncType = "financial_transactions"
	o := NewOrchestrator(nil)
	api := newBlockingNotifier()
	o.runCompletedNotifier = api.notify
	o.RegisterService(syncType, &MockService{name: syncType})

	if _, err := o.runSingleSyncInternal(context.Background(), syncType, newBatch(triggerManual), nil); err != nil {
		t.Fatalf("runSingleSyncInternal: %v", err)
	}
	api.awaitCall(t)
	assertNotYetPublished(t, o, syncType)

	// The slot stays taken while the run finishes: a new run of the same job can neither be
	// marked nor started in it, so the publish below can never erase someone else's run.
	if err := o.MarkSyncRunning(syncType); err == nil {
		t.Fatal("MarkSyncRunning succeeded while the previous run was still finishing")
	}
	if _, err := o.runSingleSyncInternal(context.Background(), syncType, newBatch(triggerManual), nil); err == nil {
		t.Fatal("runSingleSyncInternal started a run in the slot of one still finishing")
	}
	assertNotYetPublished(t, o, syncType)

	close(api.release)
	if st := awaitPublished(t, o, syncType); st.Status != statusSuccess {
		t.Fatalf("published status = %q, want %q", st.Status, statusSuccess)
	}
}

func TestAFailedFinalizeIsNotPublishedUntilTheAPIHasClearedItsCaches(t *testing.T) {
	t.Parallel()
	const syncType = "process_requests"
	o := NewOrchestrator(nil)
	api := newBlockingNotifier()
	o.runCompletedNotifier = api.notify
	o.RegisterService(syncType, &MockService{name: syncType})
	if err := o.MarkSyncRunning(syncType); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}

	finalized := make(chan struct{})
	go func() {
		o.FinalizeSyncStatus(syncType, Stats{}, errors.New("boom"))
		close(finalized)
	}()
	api.awaitCall(t)
	assertNotYetPublished(t, o, syncType)

	close(api.release)
	select {
	case <-finalized:
	case <-time.After(5 * time.Second):
		t.Fatal("FinalizeSyncStatus never returned after the API answered")
	}
	st := o.GetStatus(syncType)
	if st == nil || st.EndTime == nil || st.Status != statusFailed {
		t.Fatalf("after the API answered, status = %+v; want a published failed run", st)
	}
}

// A wedged API must cost a bounded wait, never a hung sync: the run publishes once the notify
// timeout expires, and says why in a warning. Serial: captureSweepLogs swaps slog's default.
func TestAWedgedAPIDelaysPublishingOnlyUntilTheTimeout(t *testing.T) {
	logs := captureSweepLogs(t)
	const syncType = "process_requests"
	o := NewOrchestrator(nil)
	api := newBlockingNotifier() // never released by the test body
	t.Cleanup(func() { close(api.release) })
	o.runCompletedNotifier = api.notify
	o.runCompletedNotifyTimeout = 20 * time.Millisecond
	o.RegisterService(syncType, &MockService{name: syncType})
	if err := o.MarkSyncRunning(syncType); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}

	finalized := make(chan struct{})
	go func() {
		o.FinalizeSyncStatus(syncType, Stats{}, nil)
		close(finalized)
	}()
	select {
	case <-finalized:
	case <-time.After(5 * time.Second):
		t.Fatal("a wedged API hung the sync: FinalizeSyncStatus never returned")
	}
	if st := o.GetStatus(syncType); st == nil || st.EndTime == nil {
		t.Fatalf("the run was not published after the notify timeout: %+v", st)
	}
	if out := logs.String(); !strings.Contains(out, "level=WARN") || !strings.Contains(out, "syncType="+syncType) {
		t.Fatalf("no warning names the job whose invalidate timed out; logs:\n%s", out)
	}
}

// FastAPI's season reads ledger freshness from sync_runs, so the row must exist before the
// invalidate makes FastAPI rebuild from it.
func TestTheSyncRunsRowIsWrittenBeforeTheAPIIsTold(t *testing.T) {
	t.Parallel()
	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	rowsWhenTold := make(chan int, 1)
	o.runCompletedNotifier = func(string) {
		recs, err := app.FindAllRecords(syncRunsCollection)
		if err != nil {
			t.Errorf("FindAllRecords: %v", err)
		}
		rowsWhenTold <- len(recs)
	}
	o.RegisterService("process_requests", &MockService{name: "process_requests"})
	if err := o.MarkSyncRunning("process_requests"); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}
	o.FinalizeSyncStatus("process_requests", Stats{Created: 1}, nil)

	if got := <-rowsWhenTold; got != 1 {
		t.Fatalf("the API was told with %d sync_runs rows written, want 1", got)
	}
}

// The production notifier itself waits for FastAPI's answer: a fire-and-forget call would let
// the orchestrator publish before the caches were cleared. Serial: t.Setenv(API_URL).
func TestNotifyAPIRunCompletedWaitsForTheAPIToAnswer(t *testing.T) {
	var answered atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(20 * time.Millisecond)
		answered.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("API_URL", srv.URL)

	notifyAPIRunCompleted("attendees")
	if answered.Load() != 1 {
		t.Fatal("notifyAPIRunCompleted returned before FastAPI had answered")
	}
}
