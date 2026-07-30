package sync

import (
	"fmt"
	"strings"
	"testing"
)

const testSessionStart = "2025-05-23 07:00:00.000Z"
const testSessionEnd = "2025-05-26 07:00:00.000Z"

// TestEnsureMergeIsIdempotent: lodging_merges has no unique index on the member
// set (a set is not indexable), so without application-level dedup every
// backfill run would create another merge row for the same two rooms.
func TestEnsureMergeIsIdempotent(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family", testSessionStart, testSessionEnd, 2025)
	tioga1 := addUnit(t, app, "gt-tioga-1")
	tioga2 := addUnit(t, app, "gt-tioga-2")

	first, err := EnsureMerge(app, sess, 2025, "", []string{tioga1, tioga2}, "Tioga")
	if err != nil {
		t.Fatalf("EnsureMerge first: %v", err)
	}
	second, err := EnsureMerge(app, sess, 2025, "", []string{tioga1, tioga2}, "Tioga")
	if err != nil {
		t.Fatalf("EnsureMerge second: %v", err)
	}
	if first != second {
		t.Errorf("EnsureMerge returned two ids (%s, %s) for one member set", first, second)
	}

	rows, err := app.FindRecordsByFilter("lodging_merges", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find merges: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("expected 1 merge row, got %d", len(rows))
	}
}

// TestEnsureMergeIgnoresMemberOrder: PocketBase returns relation ids in storage
// order, which is not guaranteed stable, so the identity of a merge must be the
// SET of members and not the slice.
func TestEnsureMergeIgnoresMemberOrder(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family", testSessionStart, testSessionEnd, 2025)
	a := addUnit(t, app, "gt-tenaya-1")
	b := addUnit(t, app, "gt-tenaya-2")

	first, err := EnsureMerge(app, sess, 2025, "", []string{a, b}, "Tenaya")
	if err != nil {
		t.Fatalf("EnsureMerge: %v", err)
	}
	second, err := EnsureMerge(app, sess, 2025, "", []string{b, a}, "Tenaya")
	if err != nil {
		t.Fatalf("EnsureMerge reversed: %v", err)
	}
	if first != second {
		t.Errorf("member order changed the merge identity: %s vs %s", first, second)
	}
}

// TestEnsureMergeIsPerSessionAndScenario: spec 3.4 makes merges scenario-scoped
// so two plans for the same weekend can merge differently, and per-session
// because a merge is one weekend's arrangement, not a permanent building change.
func TestEnsureMergeIsPerSessionAndScenario(t *testing.T) {
	app := newLodgingTestApp(t)
	sessA := addSession(t, app, 1309514, "Family Camp 1", "family", testSessionStart, testSessionEnd, 2025)
	sessB := addSession(t, app, 1309519, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)
	u1 := addUnit(t, app, "gt-tioga-1")
	u2 := addUnit(t, app, "gt-tioga-2")

	live, err := EnsureMerge(app, sessA, 2025, "", []string{u1, u2}, "Tioga")
	if err != nil {
		t.Fatalf("live merge: %v", err)
	}
	otherSession, err := EnsureMerge(app, sessB, 2025, "", []string{u1, u2}, "Tioga")
	if err != nil {
		t.Fatalf("other-session merge: %v", err)
	}
	scenario, err := EnsureMerge(app, sessA, 2025, "scn_abc", []string{u1, u2}, "Tioga")
	if err != nil {
		t.Fatalf("scenario merge: %v", err)
	}

	if live == otherSession {
		t.Error("one merge row was shared across two sessions")
	}
	if live == scenario {
		t.Error("the live plan and a scenario shared one merge row")
	}
}

// TestEnsureMergeRejectsFewerThanTwoMembers: lodging_merges.member_units has
// minSelect 2. Catching it here gives a useful error instead of a PocketBase
// validation failure deep inside the backfill.
func TestEnsureMergeRejectsFewerThanTwoMembers(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family", testSessionStart, testSessionEnd, 2025)
	only := addUnit(t, app, "ridge-a")

	if _, err := EnsureMerge(app, sess, 2025, "", []string{only}, "Ridge A"); err == nil {
		t.Error("EnsureMerge accepted a single-member merge; member_units has minSelect 2")
	}
	if _, err := EnsureMerge(app, sess, 2025, "", nil, ""); err == nil {
		t.Error("EnsureMerge accepted an empty member set")
	}
}

// TestEnsureMergeRejectsMoreThanMaxMembers: member_units is minSelect 2,
// maxSelect 20 (migration 1500000118). The lower bound is already guarded; the
// upper one has to be too, or an oversized set fails as a PocketBase validation
// error deep inside the backfill instead of at the call site.
func TestEnsureMergeRejectsMoreThanMaxMembers(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family", testSessionStart, testSessionEnd, 2025)

	tooMany := make([]string, 0, maxMergeMembers+1)
	for i := range maxMergeMembers + 1 {
		tooMany = append(tooMany, addUnit(t, app, fmt.Sprintf("unit-%02d", i)))
	}

	_, err := EnsureMerge(app, sess, 2025, "", tooMany, "Oversized")
	if err == nil {
		t.Fatalf("EnsureMerge accepted %d members; member_units has maxSelect %d",
			len(tooMany), maxMergeMembers)
	}
	// PocketBase would also reject this at save time, but only after the lookup
	// query has run and with an error that names the field rather than the count.
	// Assert OUR guard fired, or this test would pass with the guard deleted.
	if !strings.Contains(err.Error(), "member units") {
		t.Errorf("error was %q; want the call-site member-count guard, not a PocketBase validation error", err)
	}
}
