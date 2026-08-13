package sync

import (
	"context"
	"errors"
	"strings"
	"testing"
	"testing/synctest"
	"time"
)

// The tests in this file pin kindred#2284: a sync that counts infrastructure failures must
// not report success.
//
// `Stats.Errors` counts local SQLite operations that failed — App.Save, App.Delete,
// App.Create, FindRecordsByFilter. There is no healthy run in which that is non-zero, so the
// tolerance is zero. `Stats.Rejected` counts per-record transform failures, which are
// upstream data quality and warn-only for their first season.
//
// Three functions turn (stats, err) into a status, and the escalation has to hold in all
// three or a service reached through the other two keeps reporting green. That is the whole
// point of the table in each test — an earlier revision of the issue described this as a
// single site.

// completionPath runs one service to completion through one of the orchestrator's three
// status-finalizing paths and returns the resulting status.
type completionPath struct {
	name string
	run  func(t *testing.T, o *Orchestrator, syncType string, svc *MockService, syncErr error)
}

func completionPaths() []completionPath {
	return []completionPath{
		{
			// orchestrator.go:606 — the registry path. Scheduled runs and most manual ones.
			name: "runSingleSyncInternal",
			run: func(t *testing.T, o *Orchestrator, syncType string, svc *MockService, syncErr error) {
				t.Helper()
				// failWith, not just shouldFail: the caller's own error has to reach
				// applyCompletionStatus, or a test asserting on the message is really
				// asserting on MockService's default and passes against a broken precedence.
				svc.shouldFail = syncErr != nil
				svc.failWith = syncErr
				o.RegisterService(syncType, svc)
				if err := o.RunSingleSync(context.Background(), syncType); err != nil {
					t.Fatalf("RunSingleSync: %v", err)
				}
				time.Sleep(50 * time.Millisecond)
			},
		},
		{
			// orchestrator.go:704 — per-request service instances (dry-run, year overrides, #1881).
			name: "RunSingleSyncWithService",
			run: func(t *testing.T, o *Orchestrator, syncType string, svc *MockService, syncErr error) {
				t.Helper()
				svc.shouldFail = syncErr != nil
				svc.failWith = syncErr
				if err := o.RunSingleSyncWithService(context.Background(), syncType, svc, newBatch(triggerManual)); err != nil {
					t.Fatalf("RunSingleSyncWithService: %v", err)
				}
				time.Sleep(50 * time.Millisecond)
			},
		},
		{
			// orchestrator.go:780 — handlers that run a service themselves.
			name: "FinalizeSyncStatus",
			run: func(t *testing.T, o *Orchestrator, syncType string, svc *MockService, syncErr error) {
				t.Helper()
				o.RegisterService(syncType, svc)
				if err := o.MarkSyncRunning(syncType); err != nil {
					t.Fatalf("MarkSyncRunning: %v", err)
				}
				o.FinalizeSyncStatus(syncType, svc.stats, syncErr)
			},
		},
	}
}

func completedStatus(t *testing.T, o *Orchestrator, syncType string) *Status {
	t.Helper()
	o.mu.RLock()
	defer o.mu.RUnlock()
	status := o.lastCompletedStatus[syncType]
	if status == nil {
		t.Fatalf("no completed status recorded for %q", syncType)
	}
	return status
}

// TestInfrastructureErrorsFailTheRun is the core guard. A service that returns nil but
// counted database failures must not land on statusSuccess.
func TestInfrastructureErrorsFailTheRun(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{Created: 10, Errors: 3}}

				path.run(t, o, "svc", svc, nil)

				status := completedStatus(t, o, "svc")
				if status.Status != statusFailed {
					t.Errorf("3 infrastructure errors reported %q, want %q", status.Status, statusFailed)
				}
				if !strings.Contains(status.Error, "3") {
					t.Errorf("status error %q does not report the failure count", status.Error)
				}
			})
		})
	}
}

// TestRejectedRecordsDoNotFailTheRun pins the other half of the split. Rejected is
// upstream data quality and is warn-only for its first season — one bad record out of
// 156,669 must not abort the run.
func TestRejectedRecordsDoNotFailTheRun(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{Created: 10, Rejected: 500}}

				path.run(t, o, "svc", svc, nil)

				status := completedStatus(t, o, "svc")
				if status.Status != statusSuccess {
					t.Errorf("500 rejected records reported %q, want %q — Rejected is warn-only",
						status.Status, statusSuccess)
				}
				if status.Summary.Rejected != 500 {
					t.Errorf("Summary.Rejected = %d, want 500 — the count must still surface",
						status.Summary.Rejected)
				}
			})
		})
	}
}

// TestReturnedErrorTakesPrecedenceOverErrorCount ensures the new branch does not mask the
// real failure. A service that returns an error must surface that error's message, not a
// generic count, even when it also counted database failures on the way out.
func TestReturnedErrorTakesPrecedenceOverErrorCount(t *testing.T) {
	t.Parallel()

	sentinel := errors.New("upstream token expired")

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{Errors: 2}}

				path.run(t, o, "svc", svc, sentinel)

				status := completedStatus(t, o, "svc")
				if status.Status != statusFailed {
					t.Fatalf("status = %q, want %q", status.Status, statusFailed)
				}
				// Assert positively. A negative assertion alone passes against any
				// implementation that drops the diagnosis, including one that hardcodes a
				// generic string — the whole point of the precedence is that THIS message
				// survives.
				if !strings.Contains(status.Error, sentinel.Error()) {
					t.Errorf("status error %q does not surface the returned error %q",
						status.Error, sentinel)
				}
				if strings.Contains(status.Error, "database operations failed") {
					t.Errorf("status error %q masked the returned error with the generic count",
						status.Error)
				}
			})
		})
	}
}

// TestSubStatsErrorsFailTheRun closes a hole that the escalation would otherwise leave wide
// open. `persons` is a combined sync: it populates persons AND households, and reports the
// household half through Stats.SubStats["households"] (persons.go:65-67). Nothing folds that
// nested Errors count into the parent's.
//
// So without this, households could fail every database write it attempted and the persons
// sync would still report success — the exact bug kindred#2284 exists to fix, surviving
// inside the fix. The escalation has to see every counter, not just the top-level one.
func TestSubStatsErrorsFailTheRun(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{
					Created: 10,
					Errors:  0, // the parent is clean — only the sub-entity failed
					SubStats: map[string]Stats{
						"households": {Created: 4, Errors: 6},
					},
				}}

				path.run(t, o, "svc", svc, nil)

				status := completedStatus(t, o, "svc")
				if status.Status != statusFailed {
					t.Errorf("6 sub-entity infrastructure errors reported %q, want %q — "+
						"SubStats errors must not be invisible to the escalation",
						status.Status, statusFailed)
				}
				// The count, not just the verdict — matching the parent-level test above.
				// Asserting only "failed" leaves the sum untested: a loop that counted one
				// per failing sub-entity instead of summing Errors would still be red here,
				// while quietly reporting "1 database operations failed" to the operator.
				if !strings.Contains(status.Error, "6") {
					t.Errorf("status error %q does not report the summed failure count 6",
						status.Error)
				}
			})
		})
	}
}

// TestSubStatsRejectedDoesNotFailTheRun mirrors the parent-level rule one layer down: a
// sub-entity's rejected records are warn-only too.
func TestSubStatsRejectedDoesNotFailTheRun(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{
					Created:  10,
					SubStats: map[string]Stats{"households": {Rejected: 300}},
				}}

				path.run(t, o, "svc", svc, nil)

				if status := completedStatus(t, o, "svc"); status.Status != statusSuccess {
					t.Errorf("300 rejected sub-entity records reported %q, want %q",
						status.Status, statusSuccess)
				}
			})
		})
	}
}

// TestInfrastructureFailureAbortsTheSequence pins the escalation's blast radius, which until
// now was emergent behavior nobody had written down: runSyncAndWait turns statusFailed into
// a returned error, and RunSyncSequence returns on the first one. So a service that counts an
// infrastructure failure does not merely go red — it stops every service queued behind it.
// A bunking refresh (bunks -> bunk_plans -> bunk_assignments) dies before bunk_assignments.
//
// THIS IS INTENDED. Do not "fix" it by letting the sequence continue. A non-zero Stats.Errors
// means a local SQLite operation did not complete — the database is locked, out of disk, or
// schema-mismatched. That is the database being broken, not a data-quality blip, and running
// the remaining services against a broken database is not better than stopping.
//
// What makes the abort look disproportionate today is the trigger, not the response: every
// per-record transform failure still increments Stats.Errors, so one malformed upstream record
// can stop a nightly refresh. kindred#2295 moves those sites to warn-only Rejected, leaving
// only genuine infrastructure failures able to abort. kindred#2298 tracks revisiting the
// decision itself once kindred#2297's sync_runs table shows how often it actually fires — and
// records the alternatives already considered and rejected, so read it before re-proposing one.
func TestInfrastructureFailureAbortsTheSequence(t *testing.T) {
	t.Parallel()

	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		// The first service counts a database failure but returns nil — the exact shape
		// kindred#2284 exists to catch, and the only thing that makes this sequence abort.
		failing := &MockService{name: "bunks", stats: Stats{Created: 5, Errors: 1}}
		second := &MockService{name: "bunk_plans"}
		third := &MockService{name: "bunk_assignments"}

		o.RegisterService("bunks", failing)
		o.RegisterService("bunk_plans", second)
		o.RegisterService("bunk_assignments", third)

		err := o.RunSyncSequence(context.Background(),
			[]string{"bunks", "bunk_plans", "bunk_assignments"})

		if err == nil {
			t.Fatal("RunSyncSequence returned nil after a service counted an infrastructure " +
				"failure — the sequence must abort")
		}
		if !strings.Contains(err.Error(), "bunks") {
			t.Errorf("error %q does not name the service that failed", err)
		}

		// The control: the failing service really did run, so the assertions below are
		// about the sequence stopping and not about nothing having happened at all.
		if got := failing.GetCallCount(); got != 1 {
			t.Fatalf("failing service ran %d times, want 1", got)
		}

		// The actual guard. Asserting only that an error came back would still pass if the
		// sequence ran every service and merely reported the first failure at the end.
		if got := second.GetCallCount(); got != 0 {
			t.Errorf("bunk_plans.Sync ran %d times after bunks failed, want 0 — "+
				"the sequence did not abort", got)
		}
		if got := third.GetCallCount(); got != 0 {
			t.Errorf("bunk_assignments.Sync ran %d times after bunks failed, want 0 — "+
				"the sequence did not abort", got)
		}
	})
}

// TestCleanSequenceRunsEveryService is the negative control for the test above: without it,
// an implementation that aborted on EVERY service — not just failing ones — would satisfy the
// abort test perfectly while breaking every sequence in the product.
func TestCleanSequenceRunsEveryService(t *testing.T) {
	t.Parallel()

	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		services := map[string]*MockService{
			"bunks":            {name: "bunks", stats: Stats{Created: 5}},
			"bunk_plans":       {name: "bunk_plans", stats: Stats{Created: 2}},
			"bunk_assignments": {name: "bunk_assignments", stats: Stats{Updated: 7}},
		}
		order := []string{"bunks", "bunk_plans", "bunk_assignments"}
		for _, name := range order {
			o.RegisterService(name, services[name])
		}

		if err := o.RunSyncSequence(context.Background(), order); err != nil {
			t.Fatalf("clean sequence returned %v, want nil", err)
		}

		for _, name := range order {
			if got := services[name].GetCallCount(); got != 1 {
				t.Errorf("%s.Sync ran %d times, want 1 — a clean sequence must run every service",
					name, got)
			}
		}
	})
}

// TestCleanRunStillSucceeds is the negative control: with both counters at zero a run must
// still report success. Without it, "always fail" would pass every test above.
func TestCleanRunStillSucceeds(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				o := NewOrchestrator(nil)
				svc := &MockService{name: "svc", stats: Stats{Created: 10, Updated: 4}}

				path.run(t, o, "svc", svc, nil)

				status := completedStatus(t, o, "svc")
				if status.Status != statusSuccess {
					t.Errorf("clean run reported %q, want %q", status.Status, statusSuccess)
				}
			})
		})
	}
}
