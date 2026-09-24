package sync

import (
	"context"
	"errors"
	gosync "sync"
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
