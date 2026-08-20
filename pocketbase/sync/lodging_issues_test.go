package sync

import (
	"testing"
	"time"
)

var testNow = time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)

// TestIssueKindsMatchTheMigration keeps the Go constants in step with
// lodging_ingest_issues.kind's select values (migration 1500000122). PocketBase
// rejects any other string at save time, so a typo here surfaces as a failed
// sync rather than a compile error. It also gives every constant a reader --
// golangci-lint runs with `unused` enabled and would otherwise flag the ones no
// code path has reached yet.
func TestIssueKindsMatchTheMigration(t *testing.T) {
	t.Parallel()
	want := []string{
		"unresolved_alias",
		"ambiguous_alias",
		"ambiguous_session",
		"no_session",
		"field_zero_values",
	}
	got := []string{
		issueUnresolvedAlias,
		issueAmbiguousAlias,
		issueAmbiguousSession,
		issueNoSession,
		issueFieldZeroValues,
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("kind %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestIssueRecorderCollapsesRepeats mirrors the real 2022 backfill: the cabin
// string "River Side - R1" appears on five different households and has no alias
// row. That is ONE thing for staff to fix, so it must be one queue item with an
// occurrence count -- not five rows to wade through.
func TestIssueRecorderCollapsesRepeats(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	r := NewIssueRecorder(app, 2022)

	// Five different households hit the same unmapped string.
	for range 5 {
		r.Record(Issue{
			Kind:        issueUnresolvedAlias,
			RawValue:    "River Side - R1",
			SourceField: fieldNameFamilyCampCabin,
			Year:        2022,
			// Deliberately 0: an unmapped STRING is not a per-household problem,
			// so the dedup key must collapse across households.
			HouseholdCMID: 0,
		})
	}

	if got := r.CountOf(issueUnresolvedAlias); got != 5 {
		t.Errorf("CountOf = %d, want 5 (occurrences, not rows)", got)
	}

	created, updated, err := r.Flush(testNow)
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if created != 1 || updated != 0 {
		t.Errorf("Flush = (%d created, %d updated), want (1, 0)", created, updated)
	}

	rows, err := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 issue row, got %d", len(rows))
	}
	if rows[0].GetInt("occurrences") != 5 {
		t.Errorf("occurrences = %d, want 5", rows[0].GetInt("occurrences"))
	}
	if rows[0].GetBool("is_resolved") {
		t.Error("a newly recorded issue must start unresolved")
	}
}

// TestIssueRecorderFlushIsIdempotent: re-running the sync must not double the
// counts or add rows. occurrences is SET to what this run observed, not added to.
func TestIssueRecorderFlushIsIdempotent(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)

	for pass := 0; pass < 2; pass++ {
		r := NewIssueRecorder(app, 2022)
		r.Record(Issue{Kind: issueUnresolvedAlias, RawValue: "Ridge 2",
			SourceField: fieldNameFamilyCampCabin, Year: 2022})
		r.Record(Issue{Kind: issueUnresolvedAlias, RawValue: "Ridge 2",
			SourceField: fieldNameFamilyCampCabin, Year: 2022})
		r.Record(Issue{Kind: issueUnresolvedAlias, RawValue: "Ridge 2",
			SourceField: fieldNameFamilyCampCabin, Year: 2022})
		r.Record(Issue{Kind: issueUnresolvedAlias, RawValue: "Ridge 2",
			SourceField: fieldNameFamilyCampCabin, Year: 2022})
		created, updated, err := r.Flush(testNow)
		if err != nil {
			t.Fatalf("pass %d Flush: %v", pass, err)
		}
		if pass == 0 && (created != 1 || updated != 0) {
			t.Errorf("pass 0: (%d, %d), want (1, 0)", created, updated)
		}
		if pass == 1 && (created != 0 || updated != 1) {
			t.Errorf("pass 1: (%d, %d), want (0, 1)", created, updated)
		}
	}

	rows, err := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row after two passes, got %d", len(rows))
	}
	if rows[0].GetInt("occurrences") != 4 {
		t.Errorf("occurrences = %d, want 4 (set, not accumulated)", rows[0].GetInt("occurrences"))
	}
}

// TestIssueRecorderKeepsPerHouseholdIssuesSeparate: an ambiguous_session IS a
// per-household problem, so two households must produce two rows even though the
// raw value and source field are identical.
func TestIssueRecorderKeepsPerHouseholdIssuesSeparate(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	r := NewIssueRecorder(app, 2025)

	r.Record(Issue{Kind: issueAmbiguousSession, RawValue: "Ridge A",
		SourceField: fieldNameFamilyCampCabin, Year: 2025, HouseholdCMID: 9001,
		CandidateCMIDs: []int{1309514, 1354939}})
	r.Record(Issue{Kind: issueAmbiguousSession, RawValue: "Ridge A",
		SourceField: fieldNameFamilyCampCabin, Year: 2025, HouseholdCMID: 9002,
		CandidateCMIDs: []int{1309514, 1354939}})

	created, _, err := r.Flush(testNow)
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if created != 2 {
		t.Errorf("created = %d, want 2 (one per household)", created)
	}
}

// TestIssueRecorderFlushKeepsAnEarlierSuggestion: Record deliberately preserves
// the first non-empty SuggestedSession ("later observations may carry a
// suggestion the first did not"), so Flush must not undo that across runs. A
// re-run whose last_updated stops parsing produces no suggestion; writing that
// emptiness over an open queue item takes its one-click confirmation with it.
func TestIssueRecorderFlushKeepsAnEarlierSuggestion(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)

	first := NewIssueRecorder(app, 2025)
	first.Record(Issue{Kind: issueAmbiguousSession, RawValue: "Ridge A",
		SourceField: fieldNameFamilyCampCabin, Year: 2025, HouseholdCMID: 9001,
		SuggestedSession: sess, CandidateCMIDs: []int{1309514, 1354939}})
	if _, _, err := first.Flush(testNow); err != nil {
		t.Fatalf("first Flush: %v", err)
	}

	// The same item next run, but the timestamp no longer parses, so there is
	// nothing to base a suggestion on.
	second := NewIssueRecorder(app, 2025)
	second.Record(Issue{Kind: issueAmbiguousSession, RawValue: "Ridge A",
		SourceField: fieldNameFamilyCampCabin, Year: 2025, HouseholdCMID: 9001,
		CandidateCMIDs: []int{1309514, 1354939}})
	if _, updated, err := second.Flush(testNow); err != nil {
		t.Fatalf("second Flush: %v", err)
	} else if updated != 1 {
		t.Fatalf("second Flush updated %d rows, want 1", updated)
	}

	rows, err := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 issue row, got %d", len(rows))
	}
	if got := rows[0].GetString("suggested_session"); got != sess {
		t.Errorf("suggested_session = %q, want %q -- a run with no suggestion must not blank the stored one", got, sess)
	}
}

// TestIssueRecorderHandlesApostrophes: real cabin strings contain apostrophes
// (two area-prefixed building strings from the same area). A
// filter built by string concatenation would be a syntax error here, which is
// exactly the class of bug that made Plan 1's alias verifier unable to pass.
func TestIssueRecorderHandlesApostrophes(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	r := NewIssueRecorder(app, 2024)
	r.Record(Issue{Kind: issueUnresolvedAlias, RawValue: "Golden Triangle - Doctor's House",
		SourceField: fieldNameFamilyCampCabin, Year: 2024})

	if _, _, err := r.Flush(testNow); err != nil {
		t.Fatalf("Flush with an apostrophe in raw_value: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 issue row, got %d", len(rows))
	}
	if got := rows[0].GetString("raw_value"); got != "Golden Triangle - Doctor's House" {
		t.Errorf("apostrophe string round-tripped as %q", got)
	}
}
