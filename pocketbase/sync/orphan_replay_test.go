package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// replayT is the minimal surface assertOrphanSweepSurvivesReplay needs from a
// test handle: enough to report a failure, nothing else. *testing.T already
// satisfies it (Helper and Fatalf are both real *testing.T methods with this
// exact signature) without declaring so.
//
// It exists, instead of taking *testing.T directly, so
// TestAssertOrphanSweepSurvivesReplay_CatchesWidenedWriteKey below can hand
// the helper a fake that RECORDS a Fatalf instead of acting on one. A real
// sub-test would do the job for the halting behavior, but Go's testing
// package marks every ancestor of a failed sub-test failed too -- there is
// no way for a parent to observe "my sub-test failed, as it correctly should
// have" without the parent itself being reported failed. testing.TB would
// dodge that same way, but it carries an unexported method specifically to
// stop outside packages implementing it, so a small interface of our own is
// what is left.
type replayT interface {
	Helper()
	Fatalf(format string, args ...any)
}

// replayOrphanSweepConfig is what any DeleteOrphansGuarded caller supplies to
// assertOrphanSweepSurvivesReplay, kindred#2626's shared structural guard.
//
// It is built from closures rather than a shared interface because the six
// DeleteOrphansGuarded callers keep six different deleteOrphans signatures --
// attendees.go, bunk_assignments.go and bunk_plans.go take no arguments;
// household_custom_field_values.go and person_custom_field_values.go take a
// year and a swept-owners set; persons.go takes only a year. A closure lets
// each caller adapt its own shape rather than the helper dictating one.
type replayOrphanSweepConfig struct {
	// WriteFixture drives the service's REAL write path over a fixed fixture
	// -- e.g. AttendeesSync.processEnrollment -- so it both persists rows AND
	// tracks each row's write key via TrackProcessedCompositeKey exactly as
	// production does. Called once per run; the fixture it writes must not
	// change between calls, and it is responsible for resetting whatever
	// per-run tracking state the service keeps (ClearProcessedKeys), the way
	// Sync() does at the top of every run.
	WriteFixture func(t replayT) error
	// Sweep drives the service's REAL orphan sweep -- its deleteOrphans,
	// whatever its signature -- called once per run, immediately after
	// WriteFixture, against the SAME service state WriteFixture just built.
	Sweep func(t replayT) error
	// CountRows returns how many rows of the entity survive right now.
	CountRows func(t replayT) int
	// WantRows is how many rows the fixture is expected to leave behind,
	// checked after every run.
	WantRows int
}

// assertOrphanSweepSurvivesReplay is kindred#2626's shared structural guard:
// run a service's real write path and its real orphan sweep, twice, over an
// unchanged fixture, and fail loudly the moment either run's sweep deletes a
// row the fixture just wrote.
//
// The trap it pins: DeleteOrphansGuarded's sweep recognizes a row as "still
// wanted" only by looking up, in b.ProcessedKeys, the key its OWN getIDFunc
// rebuilds from that record. TrackProcessedCompositeKey fills ProcessedKeys
// from an entirely separate builder, the write path's own. Nothing before
// this helper checked that the two builders agree. Widen one without the
// other -- add a field to the write key and the unique index that lets two
// rows share what used to be the whole key, without widening getIDFunc to
// match -- and every row the widening exists to keep reads as an orphan and
// is deleted, in the same run that wrote it, with DeleteOrphansGuarded
// returning nil: the sweep did exactly what it always does, delete whatever
// ProcessedKeys does not recognize, and the run reports success.
//
// Two runs, not one: a single run's ProcessedKeys is built by the SAME
// WriteFixture call the sweep runs against, so a disagreement inside one run
// already deletes everything and one run alone would catch it (see
// TestAssertOrphanSweepSurvivesReplay_CatchesWidenedWriteKey below, which
// fails on run 1 already). What a single run cannot catch is a service whose
// write path re-derives its existing-records map -- and skips writes it
// judges unchanged -- from what the PREVIOUS run left behind (attendees.go
// does; see TestAttendeesOrphanSweep_SurvivesReplay): an agreement that
// holds during a fresh create can still break on the read-back-and-compare
// path only a second run exercises.
func assertOrphanSweepSurvivesReplay(t replayT, cfg replayOrphanSweepConfig) {
	t.Helper()

	runOnce := func(t replayT, label string) {
		t.Helper()
		if err := cfg.WriteFixture(t); err != nil {
			t.Fatalf("%s: WriteFixture: %v", label, err)
			return
		}
		if err := cfg.Sweep(t); err != nil {
			t.Fatalf("%s: Sweep returned an error: %v", label, err)
			return
		}
		if got := cfg.CountRows(t); got != cfg.WantRows {
			t.Fatalf("%s: %d rows survived the orphan sweep, want %d -- the sweep's own "+
				"getIDFunc built a key TrackProcessedCompositeKey never recorded, so it read "+
				"this run's own rows as orphans and deleted them while the sweep itself "+
				"reported no error (kindred#2626)", label, got, cfg.WantRows)
			return
		}
	}

	runOnce(t, "run 1")
	runOnce(t, "run 2 (replay, unchanged fixture)")
}

// fakeReplayT is the only implementation of replayT that is not a real
// *testing.T. It records a Fatalf instead of halting, so
// TestAssertOrphanSweepSurvivesReplay_CatchesWidenedWriteKey can observe
// "the helper correctly failed" as a plain bool on a value nobody else's
// pass/fail status depends on.
type fakeReplayT struct {
	failed   bool
	messages []string
}

func (f *fakeReplayT) Helper() {}
func (f *fakeReplayT) Fatalf(format string, args ...any) {
	f.failed = true
	f.messages = append(f.messages, fmt.Sprintf(format, args...))
}

// newOrphanReplayMetaApp builds a throwaway PocketBase app carrying one
// synthetic collection -- cm_id, sub_id, year -- used only by the two meta
// tests below to exercise assertOrphanSweepSurvivesReplay itself, generically,
// against BaseSyncService's shared primitives (TrackProcessedCompositeKey,
// DeleteOrphansGuarded) rather than against any one service's schema.
func newOrphanReplayMetaApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("orphan_replay_widgets")
	col.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	col.Fields.Add(&core.NumberField{Name: "sub_id", Required: true})
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(col); err != nil {
		t.Fatalf("create orphan_replay_widgets: %v", err)
	}
	return app
}

// widgetReplayRow is one fixture row shared by both meta tests: cm_id alone
// does NOT distinguish the two rows -- sub_id does. That shape is deliberate:
// it is what a real widening looks like, a second row that only a wider key
// can tell apart from the first (kindred#2263's ProgramID is exactly this
// shape for attendees).
type widgetReplayRow struct{ cmID, subID int }

func widgetReplayFixture() []widgetReplayRow {
	return []widgetReplayRow{{cmID: 1, subID: 10}, {cmID: 1, subID: 20}}
}

// widgetReplayWrite saves (or finds) each fixture row and tracks it under
// keyOf(row) -- the write path's own key builder, passed in by the caller so
// the two meta tests can each supply a different one without duplicating the
// save logic.
func widgetReplayWrite(
	t replayT, app core.App, b *BaseSyncService, year int, keyOf func(widgetReplayRow) string,
) error {
	t.Helper()
	b.ClearProcessedKeys()
	for _, row := range widgetReplayFixture() {
		filter := fmt.Sprintf("cm_id = %d && sub_id = %d && year = %d", row.cmID, row.subID, year)
		existing, err := app.FindRecordsByFilter("orphan_replay_widgets", filter, "", 1, 0)
		if err != nil {
			return fmt.Errorf("find widget: %w", err)
		}
		if len(existing) == 0 {
			col, err := app.FindCollectionByNameOrId("orphan_replay_widgets")
			if err != nil {
				return fmt.Errorf("find collection: %w", err)
			}
			rec := core.NewRecord(col)
			rec.Set("cm_id", row.cmID)
			rec.Set("sub_id", row.subID)
			rec.Set("year", year)
			if err := app.Save(rec); err != nil {
				return fmt.Errorf("save widget: %w", err)
			}
		}
		b.TrackProcessedCompositeKey(keyOf(row), year)
	}
	return nil
}

func widgetReplayCountRows(t replayT, app core.App, year int) int {
	t.Helper()
	rows, err := app.FindRecordsByFilter("orphan_replay_widgets", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("query orphan_replay_widgets: %v", err)
	}
	return len(rows)
}

// TestAssertOrphanSweepSurvivesReplay_KeysAgree is the sanity half: when the
// write key and the orphan key build the identical string for a record, the
// helper must pass, not just refuse to fail. Without this, a helper that
// always fails (or always passes) would be indistinguishable from a correct
// one by the negative test alone.
func TestAssertOrphanSweepSurvivesReplay_KeysAgree(t *testing.T) {
	t.Parallel()
	app := newOrphanReplayMetaApp(t)
	const year = 2026
	b := &BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}

	// Write key and orphan key both carry (cm_id, sub_id): no disagreement.
	writeKeyOf := func(row widgetReplayRow) string {
		return fmt.Sprintf("%d:%d", row.cmID, row.subID)
	}
	getIDFunc := func(record *core.Record) (string, bool) {
		cmID, _ := record.Get("cm_id").(float64)
		subID, _ := record.Get("sub_id").(float64)
		return fmt.Sprintf("%d:%d|%d", int(cmID), int(subID), year), true
	}

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		WriteFixture: func(t replayT) error { return widgetReplayWrite(t, app, b, year, writeKeyOf) },
		Sweep: func(t replayT) error {
			b.SyncSuccessful = true
			return b.DeleteOrphansGuarded("orphan_replay_widgets", getIDFunc, "widget",
				fmt.Sprintf("year = %d", year),
				OrphanSweepGuard{Entity: "widget", Year: year, Computed: len(b.ProcessedKeys)})
		},
		CountRows: func(t replayT) int { return widgetReplayCountRows(t, app, year) },
		WantRows:  len(widgetReplayFixture()),
	})
}

// TestAssertOrphanSweepSurvivesReplay_CatchesWidenedWriteKey reproduces
// kindred#2626's trap directly: the write key is WIDENED to (cm_id, sub_id)
// -- carrying the disambiguator a real widening adds -- while the orphan
// key is left exactly as an un-widened one would read, cm_id alone. Both
// fixture rows share cm_id, so the sweep's getIDFunc builds the SAME key for
// both, ProcessedKeys never holds that key (only the two wide keys are
// there), and DeleteOrphansGuarded deletes both rows it was handed this very
// run -- returning nil, no error, the run reporting success throughout.
//
// The assertion under test must catch that and fail loudly. It is driven
// against fakeReplayT (not a real sub-test) precisely so THIS test's own
// pass/fail can report "the helper correctly failed" without inheriting that
// failure the way a real sub-test's parent always does.
func TestAssertOrphanSweepSurvivesReplay_CatchesWidenedWriteKey(t *testing.T) {
	t.Parallel()
	app := newOrphanReplayMetaApp(t)
	const year = 2026
	b := &BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}

	// The widened write key: cm_id AND sub_id.
	widenedWriteKeyOf := func(row widgetReplayRow) string {
		return fmt.Sprintf("%d:%d", row.cmID, row.subID)
	}
	// The orphan key, left un-widened: cm_id alone -- identical for both
	// fixture rows.
	narrowGetIDFunc := func(record *core.Record) (string, bool) {
		cmID, _ := record.Get("cm_id").(float64)
		return fmt.Sprintf("%d|%d", int(cmID), year), true
	}

	fake := &fakeReplayT{}
	assertOrphanSweepSurvivesReplay(fake, replayOrphanSweepConfig{
		WriteFixture: func(t replayT) error { return widgetReplayWrite(t, app, b, year, widenedWriteKeyOf) },
		Sweep: func(t replayT) error {
			b.SyncSuccessful = true
			return b.DeleteOrphansGuarded("orphan_replay_widgets", narrowGetIDFunc, "widget",
				fmt.Sprintf("year = %d", year),
				OrphanSweepGuard{Entity: "widget", Year: year, Computed: len(b.ProcessedKeys)})
		},
		CountRows: func(t replayT) int { return widgetReplayCountRows(t, app, year) },
		WantRows:  len(widgetReplayFixture()),
	})

	if !fake.failed {
		t.Fatal("assertOrphanSweepSurvivesReplay passed against a write key that is WIDER than " +
			"the orphan key it is swept against -- it must fail: an un-widened orphan key deletes " +
			"every row the widening exists to keep, in the very run that wrote them, with the sweep " +
			"reporting no error (kindred#2626)")
	}
	t.Logf("assertOrphanSweepSurvivesReplay correctly caught the disagreement: %v", fake.messages)
}
