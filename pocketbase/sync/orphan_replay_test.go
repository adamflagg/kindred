package sync

import (
	"fmt"
	"strconv"
	"strings"
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
	// SeedOrphan writes ONE row the fixture never writes: the POSITIVE
	// CONTROL, and the difference between this helper proving something and
	// proving nothing.
	//
	// Every other assertion here is survival-only -- "the rows are still
	// there" -- and a sweep that never RAN passes all of them trivially.
	// deleteOrphans (base_sync.go) returns nil without reading a row whenever
	// SyncSuccessful is false, and there are several other early returns
	// beside it (skipSweepForRejections, the unkeyable-records warning, a
	// service's own pre-sweep guard). Drop the `SyncSuccessful = true` line
	// from any WriteFixture below and, without this control, the test stays
	// GREEN: nothing is swept, so nothing this run wrote is deleted, so the
	// count matches. Measured on TestPersonsOrphanSweep_SurvivesReplay.
	//
	// The row is seeded ONCE, before run 1, and must be keyable by the
	// sweep's own getIDFunc while absent from ProcessedKeys -- i.e. a genuine
	// orphan. Run 1's existing row-count assertion then does double duty: a
	// live sweep deletes it and leaves WantRows, while a sweep that never ran
	// leaves WantRows+1 and fails. No third run and no second assertion
	// needed.
	//
	// Optional only so attendees_orphan_replay_test.go (kindred#2641, outside
	// this change) keeps compiling unchanged; every kindred#2643 wiring sets it.
	SeedOrphan func(t replayT) error
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
		// The two directions are opposite defects and must not share one
		// message: too FEW rows is the sweep deleting what the run just wrote,
		// too MANY is the sweep not having run at all.
		switch got := cfg.CountRows(t); {
		case got < cfg.WantRows:
			t.Fatalf("%s: %d rows survived the orphan sweep, want %d -- the sweep's own "+
				"getIDFunc built a key TrackProcessedCompositeKey never recorded, so it read "+
				"this run's own rows as orphans and deleted them while the sweep itself "+
				"reported no error (kindred#2626)", label, got, cfg.WantRows)
			return
		case got > cfg.WantRows:
			t.Fatalf("%s: %d rows survived the orphan sweep, want %d -- the SeedOrphan control "+
				"row is still here, so the sweep deleted nothing. Something returned before the "+
				"delete loop: SyncSuccessful left false, a rejection tripping "+
				"skipSweepForRejections, or a guard refusing. A sweep that never runs passes "+
				"every survival assertion in this helper, which is why the control exists",
				label, got, cfg.WantRows)
			return
		}
	}

	// The positive control goes in BEFORE run 1, so run 1's own row-count
	// assertion is what catches a sweep that never ran. See SeedOrphan.
	if cfg.SeedOrphan != nil {
		before := cfg.CountRows(t)
		if err := cfg.SeedOrphan(t); err != nil {
			t.Fatalf("SeedOrphan: %v", err)
			return
		}
		// Counted as a DELTA, not against WantRows: nothing has written the
		// fixture yet at this point, and each service's setup leaves a
		// different number of unrelated rows behind.
		if got := cfg.CountRows(t); got != before+1 {
			t.Fatalf("SeedOrphan took the row count from %d to %d, want exactly one more -- the "+
				"control row must be stored and visible to the sweep's own filter before run 1, "+
				"or the counts below cannot tell a live sweep from one that returned early and "+
				"swept nothing", before, got)
			return
		}
	}

	runOnce(t, "run 1")
	runOnce(t, "run 2 (replay, unchanged fixture)")
}

// declaredFullGrain returns the CollectionGrain that `service` declares for
// `collection` in grain.go (kindred#2627), and fails unless that declaration is
// a FULL one -- WriteKey, OrphanKey, UniqueIndex and Reduce all set -- whose two
// key texts AGREE.
//
// Every kindred#2643 wiring starts here instead of restating the service's key
// as a literal, and that is the whole reason #2627 was scheduled ahead of #2643:
// with the declaration READ rather than copied, each write key has one copy in
// the tree instead of two, and the two cannot drift. A service whose declaration
// goes wrong fails HERE, naming itself, rather than being papered over by a test
// carrying its own private copy of the old key.
func declaredFullGrain(t *testing.T, service, collection string) CollectionGrain {
	t.Helper()

	decl, ok := GrainForService(service)
	if !ok {
		t.Fatalf("grain.go declares no service %q -- the replay guard reads the declared key "+
			"rather than repeating it, so an undeclared service cannot be wired", service)
		return CollectionGrain{}
	}

	for i := range decl.Writes {
		g := decl.Writes[i]
		if g.Collection != collection {
			continue
		}
		if !g.HasFullGrain() {
			t.Fatalf("grain.go declares %s/%s without a full grain (NoGrain=%q) -- every "+
				"DeleteOrphansGuarded caller carries WriteKey, OrphanKey, UniqueIndex and Reduce",
				service, collection, g.NoGrain)
			return CollectionGrain{}
		}
		if g.WriteKey != g.OrphanKey {
			t.Fatalf("grain.go declares %s/%s with WriteKey %q and OrphanKey %q -- the two code "+
				"paths those texts describe disagree, which is exactly the sweep-deletes-what-it-"+
				"just-wrote defect kindred#2626 exists to catch, declared rather than latent",
				service, collection, g.WriteKey, g.OrphanKey)
			return CollectionGrain{}
		}
		return g
	}

	t.Fatalf("grain.go's %q declaration lists no collection %q", service, collection)
	return CollectionGrain{}
}

// assertTrackedKeysMatchGrain checks the keys a service's REAL write path just
// put in ProcessedKeys against the SHAPE its declaration describes: the same
// number of ":"-joined identity components, and the "|<year>" suffix
// TrackProcessedCompositeKey appends.
//
// This is the half that keeps the declaration honest in the other direction.
// declaredFullGrain reads grain.go and believes it; this reads what the code
// actually built. Widen a write key in the service without widening its declared
// text (or the reverse) and the component counts stop matching -- a real drift
// between grain.go and the write path, as distinct from the disagreement between
// two key BUILDERS that assertOrphanSweepSurvivesReplay catches.
//
// The limit, stated so the next reader does not over-trust it: this compares the
// NUMBER of components, never their ORDER or meaning. grain.go declaring
// "session_cm_id:person_cm_id:bunk_cm_id|year" while bunk_assignments.go builds
// person:session:bunk passes here, and passes the replay too -- the two real
// builders still agree with each other, so no row is deleted; only the declared
// TEXT is wrong. That matters because #2627's whole value is a reader trusting
// the declaration instead of the code. It is not mechanically checkable: the
// declaration is field NAMES and the tracked key is VALUES, with nothing generic
// to match them by. Reading the declaration against the write path stays a human
// step for order; the arity is what a test can hold.
func assertTrackedKeysMatchGrain(
	t *testing.T, grain *CollectionGrain, processedKeys map[string]bool, year int,
) {
	t.Helper()

	declIdentity, declYear, found := strings.Cut(grain.WriteKey, "|")
	if !found || declYear != "year" {
		t.Fatalf("grain.go's WriteKey %q for %s does not end in \"|year\" -- every "+
			"DeleteOrphansGuarded caller's tracked key is year-scoped", grain.WriteKey, grain.Collection)
		return
	}
	wantParts := len(strings.Split(declIdentity, ":"))

	if len(processedKeys) == 0 {
		t.Fatalf("%s: the write path tracked no key at all -- a run that tracks nothing makes "+
			"every stored row an orphan", grain.Collection)
		return
	}

	for key := range processedKeys {
		identity, gotYear, found := strings.Cut(key, "|")
		if !found {
			t.Fatalf("%s: tracked key %q carries no \"|year\" suffix, but grain.go declares %q",
				grain.Collection, key, grain.WriteKey)
			return
		}
		if gotYear != strconv.Itoa(year) {
			t.Fatalf("%s: tracked key %q is year-scoped to %q, want %d",
				grain.Collection, key, gotYear, year)
			return
		}
		if got := len(strings.Split(identity, ":")); got != wantParts {
			t.Fatalf("%s: the write path tracked %q -- %d \":\"-joined component(s) -- while "+
				"grain.go declares %q, which is %d. The declaration and the real write path have "+
				"drifted (kindred#2627/#2643)",
				grain.Collection, key, got, grain.WriteKey, wantParts)
			return
		}
	}
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
