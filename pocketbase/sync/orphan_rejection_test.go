package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin kindred#2295: rejecting a record must stop deleting
// its row.
//
// The mechanism is an ordering, and it is the same in every service that
// rejects. From financial_lookups.go:
//
//	pbData, err := s.transformFinancialCategoryToPB(data)
//	if err != nil {
//	    s.Stats.Rejected++
//	    continue                  // <-- jumps past the tracking below
//	}
//	...
//	s.TrackProcessedKey(cmID, 0)  // only reached by records that survived
//	...
//	s.DeleteOrphans("financial_categories", ...)   // deletes everything untracked
//
// The `continue` skips TrackProcessedKey, so the rejected record's key is absent
// from the processed set, so the sweep reads its existing row as an orphan and
// removes it. A record that fails to transform this run costs the good value
// stored by the last one.
//
// Every test here therefore asserts about ROWS ON DISK, not about what the guard
// returned. "The guard refused" is not the property that matters; "the row is
// still there" is.

// widgetKey mirrors the CompositeKey shape the real getIDFuncs build.
func widgetKey(n int) string { return fmt.Sprintf("%d|2026", n) }

// seedWidgets writes n rows named widget-001..widget-00n.
func seedWidgets(t *testing.T, app core.App, n int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= n; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}
}

// widgetIDFunc keys a seeded widget row the way a real service's getIDFunc does.
func widgetIDFunc(record *core.Record) (string, bool) {
	var n int
	if _, err := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); err != nil {
		return "", false
	}
	return widgetKey(n), true
}

// rejectingSweepFixture builds the exact situation a rejecting run leaves behind:
// `seeded` rows on disk, every key tracked except the rejected record's (30) and
// a genuine orphan (40) that CampMinder really did delete.
const (
	rejectedWidget = 30
	orphanWidget   = 40
	seededWidgets  = 50
)

func rejectingSweepFixture(t *testing.T, rejected int) (core.App, BaseSyncService) {
	t.Helper()

	app := newOrphanSweepTestApp(t, "widgets", "name")
	seedWidgets(t, app, seededWidgets)

	b := BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
		Stats:          Stats{Rejected: rejected},
	}
	for i := 1; i <= seededWidgets; i++ {
		if i == rejectedWidget || i == orphanWidget {
			continue
		}
		b.ProcessedKeys[widgetKey(i)] = true
	}

	return app, b
}

// TestBaseDeleteOrphansKeepsTheRejectedRecordsRow is the headline. This is the
// path NINE of the thirteen rejecting services sweep through -- bunks,
// custom_field_definitions, divisions, financial_lookups, person_tag_definitions,
// session_groups, sessions, staff and staff_lookups. Two more
// (person_custom_field_values, household_custom_field_values) opt into the guarded
// variant, financial_transactions sweeps from preloaded records, and persons is
// structurally exempt. An earlier revision of this comment said eleven.
func TestBaseDeleteOrphansKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans returned %v -- a rejection is warn-only (kindred#2284) "+
			"and must skip the sweep without failing the run", err)
	}

	if _, err := app.FindRecordById("widgets", orphanTestID(rejectedWidget)); err != nil {
		t.Fatalf("the rejected record's existing row was deleted: %v -- one bad record "+
			"this run destroyed the good value stored by the last one", err)
	}
	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d -- the sweep ran against a set it knows is incomplete",
			remaining, seededWidgets)
	}
}

// TestBaseDeleteOrphansSweepsWhenNothingWasRejected is the negative control.
// Without it, a guard that skipped every sweep would pass every test above.
func TestBaseDeleteOrphansSweepsWhenNothingWasRejected(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 0)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets-2 {
		t.Fatalf("%d rows survived, want %d -- a clean run must still collect its orphans",
			remaining, seededWidgets-2)
	}
}

// TestBaseDeleteOrphansRejectionLeavesGenuineOrphansBehind pins the KNOWN COST of
// skipping, so that nobody later reads it as a bug and "fixes" it.
//
// Skipping the whole collection was chosen over tracking the rejected record's
// key: the `Invalid ... cm_id` branch fires precisely because there is no usable
// key, so key-tracking can only ever cover half the cases, and half a fix that
// looks whole is worse than a blunt honest one. The price is that a genuine
// orphan waits for a run in which nothing was rejected. A service sitting at
// rejected > 0 run after run is the signal to go fix the upstream data.
func TestBaseDeleteOrphansRejectionLeavesGenuineOrphansBehind(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}

	if _, err := app.FindRecordById("widgets", orphanTestID(orphanWidget)); err != nil {
		t.Fatalf("a genuine orphan was collected on a run that rejected a record: %v -- "+
			"this is INTENDED behavior, not a bug: the computed set is known-incomplete, "+
			"so nothing in this collection may be swept against it", err)
	}
}

// TestBaseDeleteOrphansGuardedKeepsTheRejectedRecordsRow covers the opted-in
// entry point -- persons, person_custom_field_values, household_custom_field_values,
// attendees, bunk_plans and bunk_assignments all sweep through it. The collapse
// guard and the rejection skip are independent verdicts and both have to hold.
func TestBaseDeleteOrphansGuardedKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	err := b.DeleteOrphansGuarded("widgets", widgetIDFunc, "widget", "year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: len(b.ProcessedKeys)})
	if err != nil {
		t.Fatalf("DeleteOrphansGuarded returned %v, want nil -- a rejection skips, it does not fail", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d", remaining, seededWidgets)
	}
}

// TestDeleteOrphansFromPreloadedKeepsTheRejectedRecordsRow covers the third
// entry point. financial_transactions is the only rejecting service that sweeps
// this way, and it has two reject sites.
func TestDeleteOrphansFromPreloadedKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	preloaded := map[any]*core.Record{}
	for i := 1; i <= seededWidgets; i++ {
		rec, err := app.FindRecordById("widgets", orphanTestID(i))
		if err != nil {
			t.Fatalf("reload widget %d: %v", i, err)
		}
		preloaded[widgetKey(i)] = rec
	}

	if err := b.DeleteOrphansFromPreloaded(preloaded, "widget"); err != nil {
		t.Fatalf("DeleteOrphansFromPreloaded: %v", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d -- the preloaded sweep deleted the rejected "+
			"record's row", remaining, seededWidgets)
	}
}

// TestPersonCustomFieldValuesSweepKeepsRowsWhenARecordWasRejected runs a real
// production sweep, not a fixture-shaped one: the same deleteOrphans that
// kindred#2266 rewrote, with the service's own key format.
func TestPersonCustomFieldValuesSweepKeepsRowsWhenARecordWasRejected(t *testing.T) {
	t.Parallel()
	const seeded = 40

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
		Stats:          Stats{Rejected: 1},
	}}
	// One value came back from CampMinder with no usable field id, so it was
	// rejected before TrackProcessedCompositeKey ran. Its row is row 1.
	for i := 2; i <= seeded; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	if remaining := countRows(t, app, "person_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- the rejected value's stored row was deleted",
			remaining, seeded)
	}
}

// ---------------------------------------------------------------------------
// persons -- the combined sync, and the one service whose rejections land in a
// sub-entity's Stats rather than its own
// ---------------------------------------------------------------------------

func newHouseholdsTestApp(t *testing.T) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("households")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	for _, f := range []string{
		"greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title",
		"household_phone", "billing_address1", "billing_address2", "billing_city",
		"billing_state", "billing_postal_code", "billing_country",
	} {
		col.Fields.Add(&core.TextField{Name: f})
	}
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save households: %v", saveErr)
	}

	return app
}

func seedHousehold(t *testing.T, app core.App, cmID, year int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("households")
	if err != nil {
		t.Fatalf("find households: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("cm_id", cmID)
	rec.Set("year", year)
	rec.Set("greeting", "stored last run")
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("seed household %d: %v", cmID, saveErr)
	}
}

func householdCMIDs(t *testing.T, app core.App, year int) map[int]bool {
	t.Helper()
	records, err := app.FindRecordsByFilter("households", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("re-query households: %v", err)
	}
	found := map[int]bool{}
	for _, rec := range records {
		cmID, ok := rec.Get("cm_id").(float64)
		if !ok {
			t.Fatalf("household %s has no numeric cm_id", rec.Id)
		}
		found[int(cmID)] = true
	}
	return found
}

// TestPersonsHouseholdRejectionIsNotAnInfrastructureError is the behavioral half
// of the reclassification. A household that will not transform is upstream data
// quality, and counting it as an infrastructure Errors fails the whole persons
// run under the kindred#2284 escalation.
func TestPersonsHouseholdRejectionIsNotAnInfrastructureError(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		FieldDiffStats: map[string]int{},
	}}

	stats := s.processHouseholds(map[int]map[string]any{
		100: {"ID": float64(100), "Greeting": "good"},
		200: {"Greeting": "no ID at all"}, // rejected by transformHouseholdToPB
	}, map[int]*core.Record{}, 2026)

	if stats.Rejected != 1 {
		t.Errorf("householdStats.Rejected = %d, want 1", stats.Rejected)
	}
	if stats.Errors != 0 {
		t.Errorf("householdStats.Errors = %d, want 0 -- a household that will not transform is "+
			"upstream data quality, and counting it as infrastructure fails the persons run",
			stats.Errors)
	}
	if stats.Created != 1 {
		t.Errorf("householdStats.Created = %d, want 1 -- the good household must still land", stats.Created)
	}
}

// TestPersonsHouseholdSweepStillCollectsOrphansWhenAHouseholdWasRejected is the
// exception, and it asserts the OPPOSITE of every other test in this file.
//
// persons is the one rejecting service whose sweep is not endangered by its own
// rejections, and the reason is structural: processedHouseholdIDs is built in
// processBatchPersons, from the same `id > 0` gate as extractedHouseholds and
// UPSTREAM of transformHouseholdToPB. The sweep's key set is therefore never short
// of what the transform saw. A rejected household is already tracked, its row is
// never read as an orphan, and there is nothing for a guard to protect.
//
// So deleteHouseholdOrphans takes no rejection guard, and this test pins that
// deliberately. Adding one here would suppress a legitimate sweep on every run
// carrying a rejection, for no benefit -- genuine orphans would simply accumulate.
// An earlier revision of kindred#2295, and the revert commit on PR #2293, both said
// the deletion held across all thirteen files. It is twelve.
func TestPersonsHouseholdSweepStillCollectsOrphansWhenAHouseholdWasRejected(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	seedHousehold(t, app, 100, 2026) // still upstream
	seedHousehold(t, app, 200, 2026) // this run rejected it
	seedHousehold(t, app, 900, 2026) // a genuine orphan

	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		FieldDiffStats: map[string]int{},
	}}

	stats := s.processHouseholds(map[int]map[string]any{
		100: {"ID": float64(100), "Greeting": "good"},
		200: {"Greeting": "no ID at all"},
	}, map[int]*core.Record{}, 2026)
	if stats.Rejected != 1 {
		t.Fatalf("fixture did not reject: Rejected = %d", stats.Rejected)
	}

	// processedIDs the production shape: built before the transform ran, so the
	// rejected household is in it and the orphan is not.
	processedIDs := map[int]bool{100: true, 200: true}

	if err := s.deleteHouseholdOrphans(2026, processedIDs); err != nil {
		t.Fatalf("deleteHouseholdOrphans: %v", err)
	}

	survivors := householdCMIDs(t, app, 2026)
	if !survivors[200] {
		t.Error("the rejected household's row was deleted -- upstream tracking is what " +
			"protects it here, and it has stopped working")
	}
	if !survivors[100] {
		t.Error("household 100 was deleted -- it is still upstream")
	}
	if survivors[900] {
		t.Error("the genuine orphan survived a run that merely rejected a household -- " +
			"persons needs no rejection guard, and adding one only leaves real orphans behind")
	}
}

// TestPersonsTracksEveryHouseholdItWillLaterTransform pins the structural fact the
// exception above rests on, so that the exception cannot rot into a defect.
//
// extractUniqueHouseholds and the tracking loop in processBatchPersons share one
// gate -- `data["ID"].(float64)` must succeed and be > 0 -- and that gate is
// LOGICALLY IDENTICAL to the only thing transformHouseholdToPB validates. So the
// transform cannot fail for a household that reached it, and every household it is
// handed has already been tracked. Move the tracking below the transform, or widen
// what the transform rejects on, and persons silently joins the other twelve -- with
// no guard to catch it.
//
// The fixture is deliberately wide: every shape that could make the two gates
// disagree, driven through the real processBatchPersons and the real transform.
func TestPersonsTracksEveryHouseholdItWillLaterTransform(t *testing.T) {
	t.Parallel()

	// Each entry is one household slot on one person, covering the ways an ID can
	// be absent, unusable, or fine. None may end up handed to the transform without
	// having been tracked first.
	households := []struct {
		name      string
		slot      string
		household map[string]any
	}{
		{"a normal household", "PrincipalHousehold",
			map[string]any{"ID": float64(100), "Greeting": "kept"}},
		{"id zero", "PrimaryChildhoodHousehold",
			map[string]any{"ID": float64(0), "Greeting": "no id"}},
		{"id negative", "AlternateChildhoodHousehold",
			map[string]any{"ID": float64(-5)}},
		{"id missing entirely", "PrincipalHousehold",
			map[string]any{"Greeting": "no id key at all"}},
		{"id as a string, the JSON shape that would not assert", "PrincipalHousehold",
			map[string]any{"ID": "100"}},
		{"id as an int rather than float64", "PrincipalHousehold",
			map[string]any{"ID": 100}},
		{"a household with nothing but an id", "PrincipalHousehold",
			map[string]any{"ID": float64(700)}},
		{"a large id", "PrincipalHousehold",
			map[string]any{"ID": float64(2147483647)}},
	}

	for _, tc := range households {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			s := &PersonsSync{
				BaseSyncService:  BaseSyncService{ProcessedKeys: map[string]bool{}},
				missingDataStats: map[string]int{},
			}
			result := &personBatchResult{
				extractedHouseholds:   map[int]map[string]any{},
				processedHouseholdIDs: map[int]bool{},
				personHouseholdMap:    map[int]personHouseholdIDs{},
			}

			// No CamperDetails, so processPerson returns early and touches no
			// database -- the household extraction below it runs either way, which
			// is the point.
			s.processBatchPersons([]map[string]any{{
				"ID":         float64(1),
				"Households": map[string]any{tc.slot: tc.household},
			}}, map[int]bool{}, nil, nil, nil, 2026, result)

			for id, household := range result.extractedHouseholds {
				if !result.processedHouseholdIDs[id] {
					t.Errorf("household %d will be handed to transformHouseholdToPB but was "+
						"never tracked -- the sweep would read its row as an orphan", id)
				}
				if _, err := s.transformHouseholdToPB(household, 2026); err != nil {
					t.Errorf("household %d was extracted but rejects at transform (%v) -- the "+
						"two id gates have drifted apart, which is what made the other twelve "+
						"unsafe", id, err)
				}
			}
		})
	}
}

// TestPersonsExtractedHouseholdsAlwaysTransform states the exemption as the property
// it actually is, rather than by example, and drives the two gates directly against
// each other so a change to either is caught even if processBatchPersons is
// refactored away.
//
// The property is an IMPLICATION, not an equivalence, and the distinction is worth
// stating because the two gates are NOT identical. Extraction requires
// `data["ID"].(float64)` to succeed AND be > 0; transformHouseholdToPB rejects only
// when that assertion fails or the value is == 0. A NEGATIVE id therefore passes the
// transform while failing extraction.
//
// That asymmetry is in the safe direction and cannot hurt anything: extraction is
// what feeds the transform, so a household extraction rejects is never handed to it
// at all. What must never happen is the converse -- a household that IS extracted
// (and therefore tracked, in the same loop) failing the transform. That is the only
// way a household could reach the reject site, and it is what this asserts.
func TestPersonsExtractedHouseholdsAlwaysTransform(t *testing.T) {
	t.Parallel()

	payloads := []map[string]any{
		{"ID": float64(1)},
		{"ID": float64(0)},
		{"ID": float64(-1)},
		{"ID": "1"},
		{"ID": 1},
		{"ID": nil},
		{},
		{"Greeting": "only a greeting"},
		{"ID": float64(1), "BillingAddress": map[string]any{"City": "Springfield"}},
	}

	s := &PersonsSync{
		BaseSyncService:  BaseSyncService{ProcessedKeys: map[string]bool{}},
		missingDataStats: map[string]int{},
	}

	for i, payload := range payloads {
		// The extraction gate, verbatim from extractUniqueHouseholds/processBatchPersons.
		// Passing it is exactly what also writes processedHouseholdIDs[id].
		id, ok := payload["ID"].(float64)
		extracted := ok && id > 0
		if !extracted {
			continue // never handed to the transform, so it cannot be the untracked one
		}

		if _, err := s.transformHouseholdToPB(payload, 2026); err != nil {
			t.Errorf("payload %d was extracted -- and therefore tracked -- but fails the "+
				"transform (%v). The reject site at persons.go is now reachable, so a "+
				"rejected household's row becomes sweepable and persons.go needs the "+
				"rejection guard the other twelve have.", i, err)
		}
	}
}
