package bunkrequests

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// countPreUpdateCache reports the number of entries currently held in the
// package-private preUpdateCache. Used by tests that assert no cache leak
// across hook invocations.
func countPreUpdateCache() int {
	n := 0
	preUpdateCache.Range(func(_, _ any) bool {
		n++
		return true
	})
	return n
}

// drainPreUpdateCache empties preUpdateCache so cross-test pollution can't
// affect leak assertions in this package's tests.
func drainPreUpdateCache() {
	preUpdateCache.Range(func(k, _ any) bool {
		preUpdateCache.Delete(k)
		return true
	})
}

// mustFindRecord reloads a bunk_requests row by id and fails the test on
// any read error — replaces the noisy `_` discard pattern.
func mustFindRecord(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	r, err := app.FindRecordById("bunk_requests", id)
	if err != nil {
		t.Fatalf("FindRecordById %q: %v", id, err)
	}
	return r
}

// mustFindCollection returns the bunk_requests collection or fails the test.
func mustFindCollection(t *testing.T, app core.App) *core.Collection {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("bunk_requests")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", err)
	}
	return col
}

// setupBunkRequestsCollection creates a minimal bunk_requests collection in
// the test app — only the fields the reciprocity hook reads/writes. The
// production schema has many more fields but they're irrelevant here.
func setupBunkRequestsCollection(t *testing.T, app core.App) {
	t.Helper()
	col := core.NewBaseCollection("bunk_requests")
	col.Fields.Add(&core.NumberField{Name: "requester_id", Required: true})
	col.Fields.Add(&core.NumberField{Name: "requestee_id"})
	col.Fields.Add(&core.SelectField{
		Name:      "request_type",
		Required:  true,
		Values:    []string{"bunk_with", "not_bunk_with", "age_preference"},
		MaxSelect: 1,
	})
	col.Fields.Add(&core.SelectField{
		Name:      "status",
		Required:  true,
		Values:    []string{"pending", "resolved", "declined"},
		MaxSelect: 1,
	})
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	col.Fields.Add(&core.NumberField{Name: "session_id", Required: true})
	col.Fields.Add(&core.BoolField{Name: "is_reciprocal"})
	if err := app.Save(col); err != nil {
		t.Fatalf("setupBunkRequestsCollection: save: %v", err)
	}
}

// makeRequest creates and persists a bunk_request record with the given
// pair coords + status. Returns the saved record.
func makeRequest(t *testing.T, app core.App, requester, requestee int, rtype, status string) *core.Record {
	t.Helper()
	return makeRequestWithID(t, app, "", requester, requestee, rtype, status)
}

// makeRequestWithID is like makeRequest but lets the caller pin a specific
// record ID — used by tests that exercise the lowest-id-wins behavior of
// findRow when multiple siblings share pair coords.
func makeRequestWithID(
	t *testing.T, app core.App, id string,
	requester, requestee int, rtype, status string,
) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("bunk_requests")
	if err != nil {
		t.Fatalf("makeRequest: find collection: %v", err)
	}
	r := core.NewRecord(col)
	if id != "" {
		r.Id = id
	}
	r.Set("requester_id", requester)
	r.Set("requestee_id", requestee)
	r.Set("request_type", rtype)
	r.Set("status", status)
	r.Set("year", 2026)
	r.Set("session_id", 1235404)
	r.Set("is_reciprocal", false)
	if err := app.Save(r); err != nil {
		t.Fatalf("makeRequest: save: %v", err)
	}
	return r
}

// Test 1: Create resolved A→B and B→A, then call RecomputePairReciprocity
// directly. Both rows should end up with is_reciprocal=true.
func TestRecomputePairReciprocity_CreatesPair(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)

	// Insert pair as raw rows (is_reciprocal=false initially).
	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Call helper directly — it should fix both rows.
	err = RecomputePairReciprocity(app, 2026, 1235404, 100, 200, "bunk_with")
	if err != nil {
		t.Fatalf("RecomputePairReciprocity: %v", err)
	}

	// Reload from DB.
	gotAB, err := app.FindRecordById("bunk_requests", rowAB.Id)
	if err != nil {
		t.Fatalf("reload AB: %v", err)
	}
	gotBA, err := app.FindRecordById("bunk_requests", rowBA.Id)
	if err != nil {
		t.Fatalf("reload BA: %v", err)
	}

	if !gotAB.GetBool("is_reciprocal") {
		t.Errorf("A→B: expected is_reciprocal=true, got false")
	}
	if !gotBA.GetBool("is_reciprocal") {
		t.Errorf("B→A: expected is_reciprocal=true, got false")
	}
}

// Test 2: With the hook registered, inserting B→A on top of an existing
// resolved A→B should fire the hook and flip both rows' is_reciprocal=true.
func TestHook_FiresOnCreate(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)

	// NOTE: we can't pass *tests.TestApp to RegisterHooks (which expects
	// *pocketbase.PocketBase). Use the lower-level event API directly,
	// matching what RegisterHooks does.
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")

	// At this point only A→B exists; the hook fired but B→A doesn't exist
	// yet, so A→B's flag stays false.
	gotAB := mustFindRecord(t, app, rowAB.Id)
	if gotAB.GetBool("is_reciprocal") {
		t.Errorf("after lone A→B insert: expected is_reciprocal=false, got true")
	}

	// Now insert B→A. Hook fires, recompute finds both rows resolved → both flip.
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	gotAB = mustFindRecord(t, app, rowAB.Id)
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotAB.GetBool("is_reciprocal") {
		t.Errorf("after pair complete: A→B expected is_reciprocal=true, got false")
	}
	if !gotBA.GetBool("is_reciprocal") {
		t.Errorf("after pair complete: B→A expected is_reciprocal=true, got false")
	}
}

// registerHooksOnApp wires the same hooks RegisterHooks does, but takes a
// core.App (which the *tests.TestApp implements). We can't pass *tests.TestApp
// to RegisterHooks because it expects *pocketbase.PocketBase.
func registerHooksOnApp(app core.App) {
	wireHooks(app)
}

// Test 3 — #1059 direct reproduction: pair both reciprocal=true, delete one,
// surviving partner's flag should flip to false.
func TestHook_DeletionFlipsPartner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity: both reciprocal after pair complete.
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("setup precondition: expected B→A reciprocal=true, got false")
	}

	// Delete A→B; hook should fire and recompute B→A.
	if err := app.Delete(rowAB); err != nil {
		t.Fatalf("delete AB: %v", err)
	}

	gotBA = mustFindRecord(t, app, rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after A→B delete: B→A expected is_reciprocal=false, got true (#1059 bug)")
	}
}

// Test 4 — #1069 coverage: status flip resolved → declined on one row should
// flip the partner's is_reciprocal to false (declined doesn't count as
// reciprocal).
func TestHook_StatusFlipFlipsPartner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity check.
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected B→A reciprocal=true")
	}

	// Flip A→B to declined; hook fires on update.
	rowAB.Set("status", "declined")
	if err := app.Save(rowAB); err != nil {
		t.Fatalf("save flipped AB: %v", err)
	}

	gotBA = mustFindRecord(t, app, rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after A→B flip to declined: B→A expected is_reciprocal=false, got true")
	}
	gotAB := mustFindRecord(t, app, rowAB.Id)
	if gotAB.GetBool("is_reciprocal") {
		t.Errorf("after A→B flip to declined: A→B expected is_reciprocal=false, got true")
	}
}

// #1445: Multi-sibling case — production allows multiple rows for the same
// (requester, requestee, request_type, year, session) when source_field differs.
// When flipping the request_type of a non-lowest-id sibling, the hook's
// findRow returned only the lowest-id sibling and updated it (a no-op when
// it was already correct), leaving the just-flipped row stale. Asserts that
// EVERY sibling sharing the destination pair coords has is_reciprocal recomputed.
func TestHook_RequestTypeFlipUpdatesAllSiblings(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	// Setup mirrors prod: Asher (100) has one not_bunk_with → Owen (200) sibling
	// from the CM not_bunk_with field, AND one bunk_with → Owen sibling parsed
	// from staff notes. Owen has bunk_with → Asher. Force deterministic IDs so
	// sibFirst < sibSecond lexicographically — production triggers this when
	// staff_notes parses arrive after the CM field row gets a lower auto-ID.
	sibFirst := makeRequestWithID(t, app, "aaa01first00000", 100, 200, "not_bunk_with", "resolved")
	sibSecond := makeRequestWithID(t, app, "zzz99second0000", 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity: sibSecond (bunk_with) is reciprocal with rowBA.
	gotSecond := mustFindRecord(t, app, sibSecond.Id)
	if !gotSecond.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected bunk_with sibling is_reciprocal=true")
	}
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected B→A is_reciprocal=true")
	}
	gotFirst := mustFindRecord(t, app, sibFirst.Id)
	if gotFirst.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected not_bunk_with sibling is_reciprocal=false (no partner)")
	}

	// Refetch sibSecond fresh from DB to mirror the production update flow —
	// the frontend always loads the latest state before patching, so its
	// is_reciprocal reflects the cascade-updated DB value (true). The original
	// test Go pointer still holds stale in-memory is_reciprocal=false from
	// when makeRequest ran, and saving that would mask the production bug.
	sibSecondFresh := mustFindRecord(t, app, sibSecond.Id)

	// Flip the SECOND sibling (higher ID, currently bunk_with) to not_bunk_with.
	// Now there are TWO not_bunk_with siblings from A→B; B has no not_bunk_with
	// partner. Both must end up reciprocal=false. The lower-ID sibFirst was
	// already false; the just-flipped sibSecond was true (from its bunk_with
	// life) and must be cleared.
	sibSecondFresh.Set("request_type", "not_bunk_with")
	if err := app.Save(sibSecondFresh); err != nil {
		t.Fatalf("save flipped sibSecond: %v", err)
	}

	gotSecond = mustFindRecord(t, app, sibSecond.Id)
	if gotSecond.GetBool("is_reciprocal") {
		t.Errorf("after flip: higher-ID sibling expected is_reciprocal=false, got true (multi-sibling recompute miss)")
	}
	gotFirst = mustFindRecord(t, app, sibFirst.Id)
	if gotFirst.GetBool("is_reciprocal") {
		t.Errorf("after flip: pre-existing not_bunk_with sibling (lower ID) expected is_reciprocal=false, got true")
	}
	gotBA = mustFindRecord(t, app, rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after flip: B→A expected is_reciprocal=false (old bunk_with pair orphaned), got true")
	}
}

// Diagnostic — #1445 reproduction: flipping request_type on a reciprocal pair
// must clear is_reciprocal on BOTH the mutated row AND the orphaned partner.
// Mirror of TestHook_StatusFlipFlipsPartner but flips request_type instead.
func TestHook_RequestTypeFlipFlipsBoth(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity check — initial pair both reciprocal.
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected B→A reciprocal=true")
	}
	gotAB := mustFindRecord(t, app, rowAB.Id)
	if !gotAB.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected A→B reciprocal=true")
	}

	// Flip A→B from bunk_with → not_bunk_with. The old pair (100,200,bunk_with)
	// is now orphaned (only B→A has bunk_with). The new pair (100,200,not_bunk_with)
	// has only A→B (B has no not_bunk_with). Both rows should end up reciprocal=false.
	rowAB.Set("request_type", "not_bunk_with")
	if err := app.Save(rowAB); err != nil {
		t.Fatalf("save mutated AB: %v", err)
	}

	gotAB = mustFindRecord(t, app, rowAB.Id)
	if gotAB.GetBool("is_reciprocal") {
		t.Errorf("after A→B request_type flip: A→B expected is_reciprocal=false, got true (same-row recompute miss)")
	}
	gotBA = mustFindRecord(t, app, rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after A→B request_type flip: B→A expected is_reciprocal=false, got true (old-pair recompute miss)")
	}
}

// Test 5 — Cross-session: A→B in session 1, B→A in session 2 → neither reciprocal.
func TestHook_CrossSessionNotReciprocal(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	col := mustFindCollection(t, app)
	rowAB := core.NewRecord(col)
	rowAB.Set("requester_id", 100)
	rowAB.Set("requestee_id", 200)
	rowAB.Set("request_type", "bunk_with")
	rowAB.Set("status", "resolved")
	rowAB.Set("year", 2026)
	rowAB.Set("session_id", 1235404)
	rowAB.Set("is_reciprocal", false)
	if err := app.Save(rowAB); err != nil {
		t.Fatal(err)
	}

	rowBA := core.NewRecord(col)
	rowBA.Set("requester_id", 200)
	rowBA.Set("requestee_id", 100)
	rowBA.Set("request_type", "bunk_with")
	rowBA.Set("status", "resolved")
	rowBA.Set("year", 2026)
	rowBA.Set("session_id", 9999999) // DIFFERENT session
	rowBA.Set("is_reciprocal", false)
	if err := app.Save(rowBA); err != nil {
		t.Fatal(err)
	}

	gotAB := mustFindRecord(t, app, rowAB.Id)
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if gotAB.GetBool("is_reciprocal") || gotBA.GetBool("is_reciprocal") {
		t.Errorf("cross-session: expected both reciprocal=false, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}
}

// Test 6 — Cross-type: A→B bunk_with, B→A not_bunk_with → neither reciprocal.
func TestHook_CrossTypeNotReciprocal(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "not_bunk_with", "resolved")

	gotAB := mustFindRecord(t, app, rowAB.Id)
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if gotAB.GetBool("is_reciprocal") || gotBA.GetBool("is_reciprocal") {
		t.Errorf("cross-type: expected both reciprocal=false, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}
}

// Test 7 — age_preference: hook is a no-op, no errors.
func TestHook_AgePreferenceNoop(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	col := mustFindCollection(t, app)
	r := core.NewRecord(col)
	r.Set("requester_id", 100)
	r.Set("requestee_id", 0) // age_preference has no requestee
	r.Set("request_type", "age_preference")
	r.Set("status", "resolved")
	r.Set("year", 2026)
	r.Set("session_id", 1235404)
	r.Set("is_reciprocal", false)

	if err := app.Save(r); err != nil {
		t.Fatalf("age_preference save (with hook): %v", err)
	}
	got := mustFindRecord(t, app, r.Id)
	if got.GetBool("is_reciprocal") {
		t.Errorf("age_preference: expected reciprocal=false, got true")
	}
}

// Test 8 — Self-referential row: hook is a no-op, no errors.
func TestHook_SelfReferentialNoop(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	r := makeRequest(t, app, 100, 100, "bunk_with", "resolved") // requester == requestee

	got := mustFindRecord(t, app, r.Id)
	if got.GetBool("is_reciprocal") {
		t.Errorf("self-referential: expected reciprocal=false, got true")
	}
}

// Test 9 — Idempotency: invoking the helper directly on an already-correct
// pair should produce zero saves and not error.
func TestRecomputePairReciprocity_IdempotentOnAlreadyCorrect(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Both should already be reciprocal=true after hooks fire from Save.
	gotAB := mustFindRecord(t, app, rowAB.Id)
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotAB.GetBool("is_reciprocal") || !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected both reciprocal=true, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}

	abUpdated := gotAB.GetDateTime("updated").Time()
	baUpdated := gotBA.GetDateTime("updated").Time()

	// Direct invocation on already-correct pair.
	if err := RecomputePairReciprocity(app, 2026, 1235404, 100, 200, "bunk_with"); err != nil {
		t.Fatalf("RecomputePairReciprocity: %v", err)
	}

	gotAB2 := mustFindRecord(t, app, rowAB.Id)
	gotBA2 := mustFindRecord(t, app, rowBA.Id)

	// updated timestamp should not have moved if no save happened.
	if !gotAB2.GetDateTime("updated").Time().Equal(abUpdated) {
		t.Errorf("idempotent call wrote A→B unnecessarily; updated changed")
	}
	if !gotBA2.GetDateTime("updated").Time().Equal(baUpdated) {
		t.Errorf("idempotent call wrote B→A unnecessarily; updated changed")
	}
}

// Test 11 — Failed update must not leak preUpdateCache entries.
//
// captureOldCoords stashes pre-mutation coords keyed by record ID before
// e.Next() runs. If e.Next() returns an error, AfterUpdateSuccess never
// fires and the LoadAndDelete inside runRecompute never clears the entry —
// the package-global sync.Map leaks one entry per failed update.
func TestHook_FailedUpdateDoesNotLeakCache(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	row := makeRequest(t, app, 100, 200, "bunk_with", "resolved")

	// Bind a second OnRecordUpdate hook that returns an error so the chain's
	// e.Next() inside captureOldCoords' wrapper sees a failure.
	forceErr := errors.New("force update failure")
	app.OnRecordUpdate("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		return forceErr
	})

	drainPreUpdateCache()

	row.Set("status", "declined")
	if err := app.Save(row); !errors.Is(err, forceErr) {
		t.Fatalf("expected forced update failure, got %v", err)
	}

	if got := countPreUpdateCache(); got != 0 {
		t.Errorf("preUpdateCache leak: expected 0 entries after failed update, got %d", got)
	}
}

// Test 10 — ID mutation orphans the old partner.
//
// If the requester_id (or requestee_id) on an existing row is mutated, the
// hook's post-update recompute targets only the NEW pair coords. The OLD
// partner row, whose pair is now broken (its mate's coords no longer match),
// is silently left with stale is_reciprocal=true. The fix is for runRecompute
// to also recompute the OLD coords (from e.Record.Original()) when they differ
// from the new coords.
func TestHook_RequesterIDMutationRecomputesOldPair(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	// Precondition: pair (100, 200) both resolved → both reciprocal=true.
	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")
	gotBA := mustFindRecord(t, app, rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: B→A expected reciprocal=true, got false")
	}

	// Mutate A→B's requester_id from 100 → 300. The (100, 200) pair coords are
	// now orphaned: B→A still points at requester 100, but no row at (100, 200)
	// exists any more. B→A's is_reciprocal must flip to false.
	rowAB.Set("requester_id", 300)
	if err := app.Save(rowAB); err != nil {
		t.Fatalf("save mutated AB: %v", err)
	}

	gotBA = mustFindRecord(t, app, rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after requester_id mutation: B→A expected is_reciprocal=false (old pair orphaned), got true")
	}
}
