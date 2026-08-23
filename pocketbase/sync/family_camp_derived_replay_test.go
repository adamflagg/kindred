package sync

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// ============================================================================
// Test scaffolding
//
// family_camp_derived reads four collections and writes three. Both features
// under test here -- the orphan-sweep guard and the dry-run diff -- are about
// what happens BETWEEN the computed set and the rows already on disk, so they
// cannot be exercised against a struct alone: they need real records.
//
// The collections below mirror production's SHAPE (names and types), not its
// constraints -- no select vocabularies, no length caps, no unique indexes.
// That is deliberate: these tests pin sweep and diff arithmetic, and a
// validation failure would fail them for an unrelated reason.
// ============================================================================

// newFamilyCampReplayTestApp returns a throwaway app carrying every collection
// FamilyCampDerivedSync.Sync touches.
func newFamilyCampReplayTestApp(t *testing.T) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	save := func(col *core.Collection) {
		if saveErr := app.Save(col); saveErr != nil {
			t.Fatalf("save %s: %v", col.Name, saveErr)
		}
	}

	text := func(col *core.Collection, names ...string) {
		for _, n := range names {
			col.Fields.Add(&core.TextField{Name: n})
		}
	}
	boolean := func(col *core.Collection, names ...string) {
		for _, n := range names {
			col.Fields.Add(&core.BoolField{Name: n})
		}
	}

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	text(defs, "name")
	save(defs)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "year"})
	text(persons, "household")
	save(persons)

	// The two collections the kindred#2305 enrollment derivation reads. Sync
	// now loads them on every run, so they are part of the minimum schema a
	// Sync test needs -- not optional extras for the enrollment tests alone.
	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	text(sessions, "name", "session_type")
	sessions.Fields.Add(&core.DateField{Name: "start_date"})
	sessions.Fields.Add(&core.DateField{Name: "end_date"})
	save(sessions)

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	text(attendees, "person", "session", "status")
	save(attendees)

	hcv := core.NewBaseCollection("household_custom_values")
	hcv.Fields.Add(&core.NumberField{Name: "year"})
	text(hcv, "household", "field_definition", "value", "last_updated")
	save(hcv)

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	text(pcv, "person", "field_definition", "value", "last_updated")
	save(pcv)

	adults := core.NewBaseCollection("family_camp_adults")
	adults.Fields.Add(&core.NumberField{Name: "year"})
	adults.Fields.Add(&core.NumberField{Name: "adult_number"})
	text(adults, "household", "name", "first_name", "last_name", "email",
		"pronouns", "gender", "date_of_birth", "relationship_to_camper")
	// JSON, not text: attribute_conflicts is a json column in production
	// (migration 1500000160), and PocketBase hands a json column back as a
	// types.JSONRaw whose empty form renders "null" -- a text stand-in would
	// hide exactly the round-trip this scaffolding is here to exercise.
	adults.Fields.Add(&core.JSONField{Name: "attribute_conflicts"})
	text(adults, enrollmentStatusColumn)
	save(adults)

	regs := core.NewBaseCollection("family_camp_registrations")
	regs.Fields.Add(&core.NumberField{Name: "year"})
	text(regs, "household", "cabin_assignment", "share_cabin_preference",
		"shared_cabin_modes_raw", "arrival_eta", "special_occasions", "goals", "notes",
		"share_cabin_gate", "request_text", "request_source_field", "request_last_updated",
		"share_eligibility", "share_eligibility_source")
	boolean(regs, "needs_accommodation", "wants_near", "wants_with_named",
		"wants_similar_ages", "needs_private_bathroom", "needs_power",
		"accommodation_is_mandatory", "has_infant", "share_answers_conflict",
		"needs_fridge", "needs_step_free")
	text(regs, enrollmentStatusColumn)
	save(regs)

	medical := core.NewBaseCollection("family_camp_medical")
	medical.Fields.Add(&core.NumberField{Name: "year"})
	text(medical, "household", "cpap_info", "physician_info", "special_needs_info",
		"allergy_info", "dietary_info", "additional_info", "bathroom_explain",
		"accommodation_explain", enrollmentStatusColumn)
	save(medical)

	return app
}

// seedRow writes one record into collection with the given field values.
func seedRow(t *testing.T, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()

	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	rec := core.NewRecord(col)
	for k, v := range values {
		rec.Set(k, v)
	}
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("seed %s: %v", collection, saveErr)
	}
	return rec
}

// countCollection returns how many rows a collection holds for a year.
func countCollection(t *testing.T, app core.App, collection string, year int) int {
	t.Helper()

	records, err := app.FindRecordsByFilter(collection, fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("count %s: %v", collection, err)
	}
	return len(records)
}

// seedDerivedRows writes n placeholder rows into one of the three derived
// tables, so a sweep has something to refuse to delete.
func seedDerivedRows(t *testing.T, app core.App, collection string, year, n int) {
	t.Helper()

	for i := 1; i <= n; i++ {
		values := map[string]any{
			"household": fmt.Sprintf("hh_%03d", i),
			"year":      year,
		}
		if collection == "family_camp_adults" {
			values["adult_number"] = 1
			values["name"] = fmt.Sprintf("Adult %03d", i)
		}
		seedRow(t, app, collection, values)
	}
}

// ============================================================================
// P1 -- the three sweeps are guarded (kindred#2257, kindred#2279)
// ============================================================================

// TestFamilyCampSweepsRefuseACollapsedComputedSet is the whole point of the
// guard. family_camp_derived owns the last three unguarded sweeps in the
// package, and they guard exactly the three tables a replay rewrites. A run
// whose computed set comes back short -- a partial custom-value read, a
// field-definition map that lost its entries -- must refuse to sweep rather
// than delete the year and report success. There is no history table behind
// these three; a wrong delete is unrecoverable.
func TestFamilyCampSweepsRefuseACollapsedComputedSet(t *testing.T) {
	t.Parallel()

	const (
		year   = 2026
		seeded = 60
	)

	cases := []struct {
		name       string
		collection string
		// computed is how many keys this run claims to have built. 5 against 60
		// rows on disk is 8% -- far under OrphanSweepRatioFloor.
		sweep func(s *FamilyCampDerivedSync, existing map[string]*core.Record) (int, error)
		mark  func(s *FamilyCampDerivedSync, key string)
		load  func(s *FamilyCampDerivedSync) (map[string]*core.Record, error)
	}{
		{
			name:       "adults",
			collection: "family_camp_adults",
			sweep: func(s *FamilyCampDerivedSync, existing map[string]*core.Record) (int, error) {
				return s.deleteOrphanedAdults(existing, year)
			},
			mark: func(s *FamilyCampDerivedSync, key string) { s.ProcessedAdultKeys[key] = true },
			load: func(s *FamilyCampDerivedSync) (map[string]*core.Record, error) {
				return s.preloadExistingAdults(year)
			},
		},
		{
			name:       "registrations",
			collection: "family_camp_registrations",
			sweep: func(s *FamilyCampDerivedSync, existing map[string]*core.Record) (int, error) {
				return s.deleteOrphanedRegistrations(existing, year)
			},
			mark: func(s *FamilyCampDerivedSync, key string) { s.ProcessedRegKeys[key] = true },
			load: func(s *FamilyCampDerivedSync) (map[string]*core.Record, error) {
				return s.preloadExistingRegistrations(year)
			},
		},
		{
			name:       "medical",
			collection: "family_camp_medical",
			sweep: func(s *FamilyCampDerivedSync, existing map[string]*core.Record) (int, error) {
				return s.deleteOrphanedMedical(existing, year)
			},
			mark: func(s *FamilyCampDerivedSync, key string) { s.ProcessedMedicalKeys[key] = true },
			load: func(s *FamilyCampDerivedSync) (map[string]*core.Record, error) {
				return s.preloadExistingMedical(year)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			app := newFamilyCampReplayTestApp(t)
			seedDerivedRows(t, app, tc.collection, year, seeded)

			s := NewFamilyCampDerivedSync(app)
			s.SyncSuccessful = true

			existing, err := tc.load(s)
			if err != nil {
				t.Fatalf("preload: %v", err)
			}
			if len(existing) != seeded {
				t.Fatalf("preloaded %d rows, want %d", len(existing), seeded)
			}

			// A short computed set: five of the sixty keys came back.
			marked := 0
			for key := range existing {
				if marked == 5 {
					break
				}
				tc.mark(s, key)
				marked++
			}

			deleted, sweepErr := tc.sweep(s, existing)
			if sweepErr == nil {
				t.Fatalf("sweep accepted a computed set of 5 against %d rows on disk", seeded)
			}
			if deleted != 0 {
				t.Errorf("deleted = %d, want 0 -- a refused sweep must delete nothing", deleted)
			}
			if remaining := countCollection(t, app, tc.collection, year); remaining != seeded {
				t.Errorf("%d rows survived, want %d", remaining, seeded)
			}
		})
	}
}

// TestFamilyCampSweepsStillDeleteRealOrphans is the other half, and it is the
// one that would catch a guard tuned so tight it stops working. Normal churn --
// one household cancelled out of sixty -- must still be swept.
func TestFamilyCampSweepsStillDeleteRealOrphans(t *testing.T) {
	t.Parallel()

	const (
		year   = 2026
		seeded = 60
	)

	app := newFamilyCampReplayTestApp(t)
	seedDerivedRows(t, app, "family_camp_registrations", year, seeded)

	s := NewFamilyCampDerivedSync(app)
	s.SyncSuccessful = true

	existing, err := s.preloadExistingRegistrations(year)
	if err != nil {
		t.Fatalf("preload: %v", err)
	}

	// Every key but one is accounted for: 59 of 60 is ordinary attrition.
	skipped := false
	for key := range existing {
		if !skipped {
			skipped = true
			continue
		}
		s.ProcessedRegKeys[key] = true
	}

	deleted, sweepErr := s.deleteOrphanedRegistrations(existing, year)
	if sweepErr != nil {
		t.Fatalf("guard refused an ordinary sweep: %v", sweepErr)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
	if remaining := countCollection(t, app, "family_camp_registrations", year); remaining != seeded-1 {
		t.Errorf("%d rows remain, want %d", remaining, seeded-1)
	}
}

// TestFamilyCampSyncSurfacesASweepRefusal pins the half a guard is useless
// without. deleteOrphaned* returning an error nobody reads leaves the run
// green, and "the sweep silently did nothing" is indistinguishable from "the
// sweep found no orphans" -- which is exactly the state this whole guard exists
// to end.
func TestFamilyCampSyncSurfacesASweepRefusal(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	// One weekend on file, for the reason seedDryRunFixture states: Sync
	// refuses a year whose camp_sessions were never synced, and the collapse
	// under test here is the SOURCE VALUES collapsing, not the sessions table.
	seedRow(t, app, "camp_sessions", map[string]any{
		"cm_id": 9001, "name": "Family Camp 1", "session_type": sessionTypeFamily,
		"year": year, "start_date": "2026-06-05 07:00:00.000Z",
		"end_date": "2026-06-07 07:00:00.000Z",
	})
	// Rows on disk with no source values behind them at all: the computed set
	// comes back empty, which is OrphanSweepGuard's total-collapse arm.
	seedDerivedRows(t, app, "family_camp_registrations", year, 40)

	s := NewFamilyCampDerivedSync(app)
	s.Year = year

	err := s.Sync(context.Background())
	if err == nil {
		t.Fatal("Sync reported success while its sweep refused to run")
	}
	if !strings.Contains(err.Error(), "orphan sweep") {
		t.Errorf("error does not name the sweep: %v", err)
	}
	if remaining := countCollection(t, app, "family_camp_registrations", year); remaining != 40 {
		t.Errorf("%d rows survived, want 40 -- a refused sweep deletes nothing", remaining)
	}
}

// ============================================================================
// P2 -- DryRun reports a real diff, and still writes nothing
// ============================================================================

// seedDryRunFixture writes the source values behind three adults, two
// registrations and one medical row for `year`, plus three family_camp_adults
// rows chosen so every arm of the diff is exercised:
//
//	hhA -- computed and stored identically   -> unchanged
//	hhB -- computed, stored with a stale name -> would update
//	hhD -- computed, nothing stored           -> would create
//	hhC -- stored, not computed               -> would delete
func seedDryRunFixture(t *testing.T, app core.App, year int) {
	t.Helper()

	const (
		hhA = "hha000000000001"
		hhB = "hhb000000000002"
		hhC = "hhc000000000003"
		hhD = "hhd000000000004"

		fdAdult1 = "fdaaaaaaaaaaaa1"
		fdETA    = "fdaaaaaaaaaaaa2"
		fdMedAdd = "fdaaaaaaaaaaaa3"

		personA = "paaaaaaaaaaaaa1"
		personB = "pbbbbbbbbbbbbb1"
	)

	// One weekend on file. Sync refuses a year with no camp_sessions rows at
	// all (kindred#2305) -- writing none_on_file off an unsynced sessions table
	// would assert a household never enrolled -- so every fixture that reaches
	// Sync has to look like a season that was actually synced. No attendees are
	// seeded, so every household here is honestly none_on_file.
	seedRow(t, app, "camp_sessions", map[string]any{
		"cm_id": 9001, "name": "Family Camp 1", "session_type": sessionTypeFamily,
		"year": year, "start_date": "2026-06-05 07:00:00.000Z",
		"end_date": "2026-06-07 07:00:00.000Z",
	})

	defCol, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	for _, def := range []struct {
		id   string
		cmID int
		name string
	}{
		{fdAdult1, 219270, "Family Camp Adult 1"},
		{fdETA, 36529, "Family Camp-Trans ETA"},
		{fdMedAdd, 60414, "Family Medical-Additional"},
	} {
		rec := core.NewRecord(defCol)
		rec.Id = def.id
		rec.Set("cm_id", def.cmID)
		rec.Set("name", def.name)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed field def %s: %v", def.name, saveErr)
		}
	}

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	for _, p := range []struct{ id, household string }{{personA, hhA}, {personB, hhB}} {
		rec := core.NewRecord(personsCol)
		rec.Id = p.id
		rec.Set("year", year)
		rec.Set("household", p.household)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed person %s: %v", p.id, saveErr)
		}
	}

	// Household partition: the adult NAME column of record.
	for _, hh := range []struct{ household, name string }{
		{hhA, "Emma Johnson"},
		{hhB, "Liam Garcia"},
		{hhD, "Ava Martinez"},
	} {
		seedRow(t, app, "household_custom_values", map[string]any{
			"year": year, "household": hh.household,
			"field_definition": fdAdult1, "value": hh.name,
		})
	}

	// Person partition: one registration answer each, one medical answer.
	seedRow(t, app, "person_custom_values", map[string]any{
		"year": year, "person": personA, "field_definition": fdETA, "value": "Friday around 4pm",
	})
	seedRow(t, app, "person_custom_values", map[string]any{
		"year": year, "person": personB, "field_definition": fdETA, "value": "Saturday morning",
	})
	seedRow(t, app, "person_custom_values", map[string]any{
		"year": year, "person": personA, "field_definition": fdMedAdd, "value": "Inhaler in the day bag",
	})

	// Rows already on disk. This fixture seeds no camp_sessions and no
	// attendees, so every household here resolves to `none_on_file`
	// (kindred#2305) -- which is what the UNCHANGED row must already hold to
	// stay unchanged. A row still carrying "" is one an older sync wrote, and
	// the derivation is meant to rewrite it.
	for _, row := range []struct {
		household, name, enrollment string
	}{
		{hhA, "Emma Johnson", enrollmentStatusNoneOnFile}, // identical to what this run computes
		{hhB, "Stale Name", enrollmentStatusNoneOnFile},   // differs -> update
		{hhC, "Noah Wilson", enrollmentStatusNoneOnFile},  // no source values at all -> orphan
	} {
		seedRow(t, app, "family_camp_adults", map[string]any{
			"year": year, "household": row.household,
			"adult_number": 1, "name": row.name,
			enrollmentStatusColumn: row.enrollment,
		})
	}
}

// TestFamilyCampDryRunWritesNothing is the invariant everything else here rests
// on. Moving the dry-run return past the preloads puts it one step from the
// upsert loops, and a dry run that writes is worse than no dry run at all.
func TestFamilyCampDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	s := NewFamilyCampDerivedSync(app)
	s.Year = year
	// Through the DryRunnable setter the orchestrator actually calls, not the field
	// directly: this is the only test that pins SetDryRun -> no writes end to end for
	// one of the two services in the kindred#2334 incident.
	s.SetDryRun(true)

	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("dry run failed: %v", err)
	}

	// Three adult rows went in; the run computes a create, an update and a
	// delete against them, so any write at all moves one of these counts.
	if got := countCollection(t, app, "family_camp_adults", year); got != 3 {
		t.Errorf("family_camp_adults holds %d rows, want the 3 seeded -- the dry run wrote", got)
	}
	if got := countCollection(t, app, "family_camp_registrations", year); got != 0 {
		t.Errorf("family_camp_registrations holds %d rows, want 0 -- the dry run wrote", got)
	}
	if got := countCollection(t, app, "family_camp_medical", year); got != 0 {
		t.Errorf("family_camp_medical holds %d rows, want 0 -- the dry run wrote", got)
	}

	// The orphan specifically: a dry run must not sweep.
	orphans, err := app.FindRecordsByFilter("family_camp_adults",
		"year = 2026 && household = 'hhc000000000003'", "", 0, 0)
	if err != nil {
		t.Fatalf("query orphan: %v", err)
	}
	if len(orphans) != 1 {
		t.Errorf("the orphan row is gone -- the dry run swept")
	}

	// And the stale row keeps its stale value.
	stale, err := app.FindRecordsByFilter("family_camp_adults",
		"year = 2026 && household = 'hhb000000000002'", "", 0, 0)
	if err != nil {
		t.Fatalf("query stale row: %v", err)
	}
	if len(stale) != 1 || stale[0].GetString("name") != "Stale Name" {
		t.Errorf("the stale row was updated by a dry run")
	}
}

// TestFamilyCampDryRunReportsAPerTableDiff is the feature itself. Before this,
// DryRun returned before any preload and reported len(computed) as "created" --
// counts, not a diff -- so a replay could not be measured before it was done,
// which is what made "should we replay 2017-2025" unanswerable rather than
// merely undecided.
func TestFamilyCampDryRunReportsAPerTableDiff(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	s := NewFamilyCampDerivedSync(app)
	s.Year = year
	s.DryRun = true

	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("dry run failed: %v", err)
	}

	want := map[string]DryRunDiff{
		// hhD creates, hhB updates, hhA is unchanged, hhC is an orphan.
		"family_camp_adults": {WouldCreate: 1, WouldUpdate: 1, Unchanged: 1, WouldDelete: 1},
		// hhA and hhB each answered the arrival question; nothing is stored.
		"family_camp_registrations": {WouldCreate: 2},
		// hhA alone carries a medical answer.
		"family_camp_medical": {WouldCreate: 1},
	}

	if len(s.DryRunDiff) != len(want) {
		t.Fatalf("DryRunDiff covers %d tables, want %d: %+v", len(s.DryRunDiff), len(want), s.DryRunDiff)
	}
	for table, expected := range want {
		got, ok := s.DryRunDiff[table]
		if !ok {
			t.Errorf("no diff reported for %s", table)
			continue
		}
		if got != expected {
			t.Errorf("%s diff = %+v, want %+v", table, got, expected)
		}
	}

	// Stats carries the same verdict, because that is what a run row records and
	// what an operator reads back afterwards -- with ONE deliberate exception.
	//
	// Deleted stays 0 on a dry run. recordSyncRun writes Stats.Deleted straight
	// into sync_runs.deleted_count with status=completed, and sync_runs has no
	// dry-run marker of any kind, so mirroring WouldDelete into Stats leaves a
	// row asserting deletions that never happened -- nine such rows once the
	// planned 2017-2025 replay dry runs are done, indistinguishable afterwards
	// from nine real sweeps. The count is not lost: it stays on
	// DryRunDiff.WouldDelete and in the "Dry run diff" log line, which is where
	// a dry run's output belongs. Deleted is singled out because it is the only
	// one of the four that describes a DESTRUCTIVE act; created/updated/skipped
	// overstate a harmless one and predate this behavior.
	if s.Stats.Created != 4 || s.Stats.Updated != 1 || s.Stats.Skipped != 1 || s.Stats.Deleted != 0 {
		t.Errorf("Stats = created:%d updated:%d skipped:%d deleted:%d; want 4/1/1/0",
			s.Stats.Created, s.Stats.Updated, s.Stats.Skipped, s.Stats.Deleted)
	}
	// ...and the would-be count is still reported, on the diff rather than in
	// Stats. Asserting both together is the point: dropping it from Stats must
	// not quietly drop it from the dry run's answer.
	if got := s.DryRunDiff["family_camp_adults"].WouldDelete; got != 1 {
		t.Errorf("adults WouldDelete = %d, want 1 -- Stats.Deleted is what a dry run "+
			"must not claim, not the diff", got)
	}
	if !s.SyncSuccessful {
		t.Error("a completed dry run is a successful run")
	}
}

// TestFamilyCampDryRunFlagsASweepTheGuardWouldRefuse ties P1 and P2 together.
// The reason to dry-run a replay year is to find out whether it is safe, and
// "the sweep would be refused" is the single most important thing such a run
// can tell an operator -- a diff promising 3,000 deletions that the guard would
// then block is a different fact from one that would actually happen.
func TestFamilyCampDryRunFlagsASweepTheGuardWouldRefuse(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)
	// Sixty registration rows on disk against the two this run computes: an
	// 3% computed set, far under OrphanSweepRatioFloor.
	seedDerivedRows(t, app, "family_camp_registrations", year, 60)

	s := NewFamilyCampDerivedSync(app)
	s.Year = year
	s.DryRun = true

	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("dry run failed: %v", err)
	}

	regs := s.DryRunDiff["family_camp_registrations"]
	if !regs.GuardWouldRefuse {
		t.Errorf("registrations diff = %+v; the guard would refuse this sweep and the dry run must say so", regs)
	}
	if regs.WouldDelete != 60 {
		t.Errorf("WouldDelete = %d, want 60 -- report what the sweep WOULD target, then flag the refusal",
			regs.WouldDelete)
	}
	if adults := s.DryRunDiff["family_camp_adults"]; adults.GuardWouldRefuse {
		t.Errorf("adults diff = %+v; that sweep is healthy and must not be flagged", adults)
	}
}

// TestFamilyCampSyncDoesNotSweepAfterACancelledRun is the case the guard alone
// does not cover, and the one where it does the wrong thing.
//
// The three upsert loops break on ctx.Done() and return their PARTIAL counts
// with no error -- unlike staff_skills.go, the file this service's sweep
// ordering is modeled on, which returns ctx.Err() up so its sweep is never
// reached at all. So an interrupted run arrives at Step 12 with a computed set
// that is short for a reason that has nothing to do with the upstream, and two
// things go wrong:
//
//   - Below OrphanSweepMinRows the ratio arm does not apply, so the guard does
//     NOT refuse: the sweep proceeds and deletes rows the run simply never got
//     to. family_camp_adults here holds three rows, one of which (hhA) is
//     current and correct, and it is deleted.
//   - Above it the guard DOES refuse, and the run reports "orphan sweep
//     refused ... check that person_custom_values ... hold this season's
//     family-camp rows" -- sending an operator to investigate a feed that is
//     fine. Keeping that apart from an interruption is the entire job of
//     wrapOrphanSweepError, whose doc comment says so in as many words.
func TestFamilyCampSyncDoesNotSweepAfterACancelledRun(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)
	// Two tables, deliberately on opposite sides of OrphanSweepMinRows:
	// family_camp_adults holds the fixture's 3 rows (the guard cannot help),
	// family_camp_registrations holds 40 (the guard refuses and misattributes).
	seedDerivedRows(t, app, "family_camp_registrations", year, 40)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Cancel on the first derived write. Whichever adult the transform reaches
	// first, one of these two fires: hhD is a create and hhB an update.
	cancelOnWrite := func(e *core.RecordEvent) error {
		cancel()
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("family_camp_adults").BindFunc(cancelOnWrite)
	app.OnRecordAfterUpdateSuccess("family_camp_adults").BindFunc(cancelOnWrite)

	s := NewFamilyCampDerivedSync(app)
	s.Year = year

	err := s.Sync(ctx)
	if err == nil {
		t.Fatal("Sync reported success for a cancelled run")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error does not carry the cancellation: %v", err)
	}
	if !strings.Contains(err.Error(), "interrupted") {
		t.Errorf("error does not report an interruption: %v", err)
	}
	if strings.Contains(err.Error(), "refused") {
		t.Errorf("a cancelled run must not be reported as a guard refusal -- that hint "+
			"points at person_custom_values, and the feed is not what stopped: %v", err)
	}

	// Nothing was swept. The adults table is the one that matters: at three
	// rows it is under OrphanSweepMinRows, so the guard's ratio arm is silent
	// and only skipping the sweep outright keeps these alive.
	//
	// Asserted per household rather than as a row COUNT, because the run
	// legitimately creates hhD's row before the cancellation lands -- a write
	// that already happened is not the defect. The defect is deletion: hhA is
	// current and correct, hhB is merely stale, and hhC is a genuine orphan
	// that a run which never reached it has no business sweeping.
	for _, household := range []string{
		"hha000000000001", "hhb000000000002", "hhc000000000003",
	} {
		rows, findErr := app.FindRecordsByFilter("family_camp_adults",
			fmt.Sprintf("year = %d && household = '%s'", year, household), "", 0, 0)
		if findErr != nil {
			t.Fatalf("query %s: %v", household, findErr)
		}
		if len(rows) != 1 {
			t.Errorf("family_camp_adults row for %s is gone -- a cancelled run swept a row "+
				"it never reached, and this table is too small for the guard to catch it", household)
		}
	}
	if got := countCollection(t, app, "family_camp_registrations", year); got != 40 {
		t.Errorf("family_camp_registrations holds %d rows, want 40", got)
	}
}

// TestFamilyCampSyncStopsSweepingWhenCancelledMidStep12 covers the half the
// single pre-sweep check cannot see. ctx.Err() is evaluated once, before the
// three sweeps, and none of deleteOrphanedAdults/...Registrations/...Medical
// takes a context of its own -- so a cancellation landing BETWEEN two tables
// ran the remaining ones to completion and then reported a clean sweep.
//
// This is an interruptibility and honesty defect, NOT data loss, and the
// distinction is worth stating because it decides the fix. The check above
// passed, so no upsert loop broke early, so the computed set is complete and
// every row these sweeps delete is a genuine orphan that an uninterrupted run
// would also have deleted. Nothing is lost. What is wrong is that a run told to
// stop keeps working, and then does not say it was interrupted -- so the fix is
// to re-check between tables, not to propagate ctx.Err() out of the upserts.
func TestFamilyCampSyncStopsSweepingWhenCancelledMidStep12(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	// One orphan in each of the two tables swept AFTER adults. The fixture
	// computes registrations for hhA/hhB and medical for hhA only, so neither
	// of these keys is accounted for: a sweep that reaches them deletes them.
	seedRow(t, app, "family_camp_registrations", map[string]any{
		"year": year, "household": "hhz000000000009",
	})
	seedRow(t, app, "family_camp_medical", map[string]any{
		"year": year, "household": "hhy000000000008", "additional_info": "orphan",
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Cancel on the adults sweep's OWN delete -- hhC, the fixture's orphan.
	// That places the cancellation strictly between the first sweep and the
	// second, which is the window a single check ahead of all three misses.
	app.OnRecordAfterDeleteSuccess("family_camp_adults").BindFunc(func(e *core.RecordEvent) error {
		cancel()
		return e.Next()
	})

	s := NewFamilyCampDerivedSync(app)
	s.Year = year

	err := s.Sync(ctx)
	if err == nil {
		t.Fatal("Sync reported success for a run cancelled during its orphan sweeps")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error does not carry the cancellation: %v", err)
	}
	if !strings.Contains(err.Error(), "interrupted") {
		t.Errorf("error does not report an interruption: %v", err)
	}
	if strings.Contains(err.Error(), "refused") {
		t.Errorf("an interrupted sweep must not be reported as a guard refusal: %v", err)
	}

	// The sweep that had already run stands. hhC was a genuine orphan and the
	// adults sweep completed before the cancellation landed; re-creating it
	// would be a different bug, and this pins that the fix does not undo work.
	adultRows, findErr := app.FindRecordsByFilter("family_camp_adults",
		fmt.Sprintf("year = %d && household = 'hhc000000000003'", year), "", 0, 0)
	if findErr != nil {
		t.Fatalf("query hhC: %v", findErr)
	}
	if len(adultRows) != 0 {
		t.Errorf("hhC survived -- the adults sweep should have completed before the cancel")
	}

	// The two sweeps that had NOT yet run must not have run. Three
	// registrations (hhA and hhB written by this run, plus the seeded orphan)
	// and two medical rows (hhA plus the seeded orphan).
	if got := countCollection(t, app, "family_camp_registrations", year); got != 3 {
		t.Errorf("family_camp_registrations holds %d rows, want 3 -- the registrations "+
			"sweep ran after the run was cancelled", got)
	}
	if got := countCollection(t, app, "family_camp_medical", year); got != 2 {
		t.Errorf("family_camp_medical holds %d rows, want 2 -- the medical sweep ran "+
			"after the run was cancelled", got)
	}
}

// ============================================================================
// P3 -- nameless-but-attributed family_camp_adults rows survive a sweep
// (kindred#2335)
//
// A replay measured 188 family_camp_adults rows across 2017-2025 (plus 6 in
// 2026) with name, first_name and last_name ALL empty -- the class kindred#2198
// stopped ADMITTING -- but 137 of them carry a date_of_birth and 36 carry an
// email. These are real adults whose name answer never made it in, not the
// wholly-empty rows #2198 targeted, and the owner ruled they must survive a
// sweep until their names are rescued (separate, out-of-scope work).
//
// Every test below proves survival against the REAL sweep function against a
// real PocketBase app, not a standalone helper: #2335 is explicit that a
// helper-level test is not sufficient evidence one line from a production
// data replay.
// ============================================================================

// TestFamilyCampSweepProtectsNamelessButAttributedAdults exercises all five
// protected attributes individually, plus the three cases that must NOT be
// protected: an ordinary named row (still tracked normally), a genuinely empty
// orphan (no name, no attribute at all -- still swept), and a NAMED orphan
// carrying every one of the five attributes (still swept -- the half of the
// predicate that keeps this from disabling the sweep outright).
func TestFamilyCampSweepProtectsNamelessButAttributedAdults(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)

	// 90 ordinary named rows this run recomputes (marked processed below) --
	// keeps the guard's ratio comfortably satisfied regardless of how the
	// other rows are classified.
	for i := 1; i <= 90; i++ {
		seedRow(t, app, "family_camp_adults", map[string]any{
			"household": fmt.Sprintf("hh_named_%04d", i), "year": year,
			"adult_number": 1, "name": fmt.Sprintf("Adult %04d", i),
		})
	}

	// One nameless row per protected attribute.
	protectedAttrs := []struct{ field, value string }{
		{"date_of_birth", "1980-01-01"},
		{"email", "adult@example.com"},
		{"gender", "female"},
		{"pronouns", "she/her"},
		{"relationship_to_camper", "parent"},
	}
	for i, pa := range protectedAttrs {
		seedRow(t, app, "family_camp_adults", map[string]any{
			"household": fmt.Sprintf("hh_protected_%04d", i), "year": year,
			"adult_number": 1, pa.field: pa.value,
		})
	}

	// One genuinely empty orphan: no name, no attribute at all.
	seedRow(t, app, "family_camp_adults", map[string]any{
		"household": "hh_empty_0001", "year": year, "adult_number": 1,
	})

	// One NAMED orphan that also carries every protected attribute. This is the
	// row that pins the "wholly nameless" half of the predicate: drop the name
	// check from isNamelessButAttributedAdult and this row becomes protected
	// too, which would neuter the family_camp_adults sweep entirely -- a real
	// adult who left the source data carries a name AND a gender, so nothing
	// would ever be swept again. #2335 protects rows with no label, not rows
	// with attributes.
	seedRow(t, app, "family_camp_adults", map[string]any{
		"household": "hh_orphan_named_0001", "year": year, "adult_number": 1,
		"name": "Olivia Chen", "first_name": "Olivia", "last_name": "Chen",
		"date_of_birth": "1982-07-04", "email": "test@example.com",
		"gender": "female", "pronouns": "she/her", "relationship_to_camper": "parent",
	})

	s := NewFamilyCampDerivedSync(app)
	s.SyncSuccessful = true

	existing, err := s.preloadExistingAdults(year)
	if err != nil {
		t.Fatalf("preload: %v", err)
	}
	if len(existing) != 97 {
		t.Fatalf("preloaded %d rows, want 97", len(existing))
	}

	// Mark only the 90 ordinary rows processed, keyed on the household prefix
	// rather than on the name column: the named orphan above must stay
	// UNprocessed, and marking by name would have quietly excluded it from the
	// sweep and pinned nothing. The 5 protected rows, the empty orphan and the
	// named orphan all look, to key-matching alone, identical to each other --
	// that is the whole point of the test.
	for key, record := range existing {
		if strings.HasPrefix(record.GetString("household"), "hh_named_") {
			s.ProcessedAdultKeys[key] = true
		}
	}

	deleted, sweepErr := s.deleteOrphanedAdults(existing, year)
	if sweepErr != nil {
		t.Fatalf("guard refused an ordinary sweep: %v", sweepErr)
	}
	if deleted != 2 {
		t.Errorf("deleted = %d, want 2 -- the genuinely empty orphan and the named orphan", deleted)
	}

	for i, pa := range protectedAttrs {
		rows, findErr := app.FindRecordsByFilter("family_camp_adults",
			fmt.Sprintf("year = %d && household = 'hh_protected_%04d'", year, i), "", 0, 0)
		if findErr != nil {
			t.Fatalf("query protected row %d: %v", i, findErr)
		}
		if len(rows) != 1 {
			t.Errorf("protected row %d (carrying %s) was swept -- it must survive", i, pa.field)
		}
	}

	empty, findErr := app.FindRecordsByFilter("family_camp_adults",
		fmt.Sprintf("year = %d && household = 'hh_empty_0001'", year), "", 0, 0)
	if findErr != nil {
		t.Fatalf("query empty orphan: %v", findErr)
	}
	if len(empty) != 0 {
		t.Errorf("the genuinely empty orphan survived -- it carries no name and no attribute, " +
			"so #2198's admission rule says it should never have existed and #2335 does not " +
			"protect it")
	}

	named, findErr := app.FindRecordsByFilter("family_camp_adults",
		fmt.Sprintf("year = %d && household = 'hh_orphan_named_0001'", year), "", 0, 0)
	if findErr != nil {
		t.Fatalf("query named orphan: %v", findErr)
	}
	if len(named) != 0 {
		t.Errorf("the named orphan survived -- #2335 protects rows with no name, not rows " +
			"that merely carry attributes, and protecting this one would stop the sweep " +
			"deleting anything at all")
	}

	if got := countCollection(t, app, "family_camp_adults", year); got != 95 {
		t.Errorf("family_camp_adults holds %d rows, want 95 (90 named + 5 protected)", got)
	}
}

// TestFamilyCampSweepLogsProtectedNamelessAdultsFor2018 pins the year that
// carries half of #2335's measured population -- 89 of the 188 -- rather than
// only asserting an aggregate count, and pins that the protected count is
// LOGGED per run rather than merely correct on disk (the issue's fix
// direction: "count and log what was protected... so the population is
// visible rather than silent").
//
// Not parallel: it uses captureSweepLogs (orphan_sweep_test.go), which
// redirects the process-global slog default for the duration of the test.
func TestFamilyCampSweepLogsProtectedNamelessAdultsFor2018(t *testing.T) {
	const (
		year          = 2018
		protectedRows = 89
		// 200 rather than a bare 90: the guard refuses a sweep whose computed
		// set is below OrphanSweepRatioFloor of what is on disk, and 90 against
		// 90+89 lands at 50.3% -- half a row above the floor. The real 2018
		// replay sits at 965 computed against 1,054 existing (91.6%), so the
		// tight version was neither realistic nor stable against a floor
		// change. 200 against 289 is 69.2%.
		namedRows = 200
	)

	app := newFamilyCampReplayTestApp(t)

	for i := 1; i <= namedRows; i++ {
		seedRow(t, app, "family_camp_adults", map[string]any{
			"household": fmt.Sprintf("hh_2018_named_%04d", i), "year": year,
			"adult_number": 1, "name": fmt.Sprintf("Adult %04d", i),
		})
	}
	for i := 1; i <= protectedRows; i++ {
		seedRow(t, app, "family_camp_adults", map[string]any{
			"household": fmt.Sprintf("hh_2018_nameless_%04d", i), "year": year,
			"adult_number": 1, "date_of_birth": "1975-06-01",
		})
	}

	s := NewFamilyCampDerivedSync(app)
	s.SyncSuccessful = true

	existing, err := s.preloadExistingAdults(year)
	if err != nil {
		t.Fatalf("preload: %v", err)
	}
	if len(existing) != namedRows+protectedRows {
		t.Fatalf("preloaded %d rows, want %d", len(existing), namedRows+protectedRows)
	}
	for key, record := range existing {
		if record.GetString("name") != "" {
			s.ProcessedAdultKeys[key] = true
		}
	}

	logs := captureSweepLogs(t)

	deleted, sweepErr := s.deleteOrphanedAdults(existing, year)
	if sweepErr != nil {
		t.Fatalf("guard refused an ordinary sweep: %v", sweepErr)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- every unmatched 2018 row here is protected", deleted)
	}
	if got := countCollection(t, app, "family_camp_adults", year); got != namedRows+protectedRows {
		t.Errorf("family_camp_adults 2018 holds %d rows, want %d -- all 89 protected rows "+
			"must survive", got, namedRows+protectedRows)
	}

	// Assert against the PROTECTION line specifically, not the whole buffer.
	// A whole-buffer strings.Contains(logged, "count=89") passes on the
	// "Deleted orphaned family_camp_adults records count=89" line a run with no
	// protection at all emits -- i.e. it is satisfied by exactly the regression
	// it is supposed to catch.
	const protectedMsg = "Protected nameless-but-attributed family_camp_adults from sweep"
	protectedLine := ""
	for _, line := range strings.Split(logs.String(), "\n") {
		if strings.Contains(line, protectedMsg) {
			protectedLine = line
			break
		}
	}
	if protectedLine == "" {
		t.Fatalf("no %q log line at all:\n%s", protectedMsg, logs.String())
	}
	if !strings.Contains(protectedLine, "count=89") {
		t.Errorf("protected count not logged (want count=89): %s", protectedLine)
	}
	if !strings.Contains(protectedLine, "year=2018") {
		t.Errorf("protected-row log line does not name the year: %s", protectedLine)
	}
}

// TestFamilyCampDryRunDoesNotForecastDeletingProtectedNamelessAdults keeps the
// dry-run diff honest for the case #2335 protects. Dry-running a replay year
// and reading the diff before deciding is the documented predecessor step
// (docs/reference/family-camp-grain-collapse.md) -- a diff that still counted
// a protected row toward WouldDelete would tell an operator a real replay
// destroys data it will not actually touch.
func TestFamilyCampDryRunDoesNotForecastDeletingProtectedNamelessAdults(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	// A nameless row with no source values behind it at all -- by key-matching
	// alone this looks exactly like hhC, the fixture's genuine orphan. It
	// carries a date_of_birth, so #2335 protects it.
	seedRow(t, app, "family_camp_adults", map[string]any{
		"year": year, "household": "hhe000000000005",
		"adult_number": 1, "date_of_birth": "1990-03-14",
	})

	s := NewFamilyCampDerivedSync(app)
	s.Year = year
	s.DryRun = true

	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("dry run failed: %v", err)
	}

	adults := s.DryRunDiff["family_camp_adults"]
	if adults.WouldDelete != 1 {
		t.Errorf("adults.WouldDelete = %d, want 1 (hhC only) -- the protected nameless row "+
			"must not be forecast as a deletion", adults.WouldDelete)
	}
	if adults.Protected != 1 {
		t.Errorf("adults.Protected = %d, want 1", adults.Protected)
	}

	// A dry run writes nothing either way.
	if got := countCollection(t, app, "family_camp_adults", year); got != 4 {
		t.Errorf("family_camp_adults holds %d rows, want 4 -- the dry run wrote", got)
	}
}
