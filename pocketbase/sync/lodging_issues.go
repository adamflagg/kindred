package sync

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Work-queue kinds. These strings must match lodging_ingest_issues.kind's select
// values exactly (migration 1500000122); PocketBase rejects anything else.
const (
	// A cabin string with no alias row covering this year.
	issueUnresolvedAlias = "unresolved_alias"
	// Two or more alias rows whose year windows both contain this year, so the
	// string resolves to more than one thing. Only reachable via the Plan 3
	// admin UI, which can add overlapping windows the seed does not.
	issueAmbiguousAlias = "ambiguous_alias"
	// The household or person attends more than one weekend and CampMinder holds
	// a single cabin value for the year. Spec 3.6 calls this out as the honest
	// limit of backfill: flag it, do not guess.
	issueAmbiguousSession = "ambiguous_session"
	// A cabin value whose household or person has no active enrolment in a
	// family/adult session that year -- cancelled, waitlisted, or in progress.
	issueNoSession = "no_session"
	// Spec 4.4's passive warning: a mapped field saw zero values this year.
	issueFieldZeroValues = "field_zero_values"
	// The household or person row the value hangs off does not exist for this
	// year, so there is no CampMinder id to key a placement on. Skipping the
	// value outright would be a silent drop, which spec 6.2 forbids -- and the
	// value is counted before the skip, so even the field_zero_values warning
	// stays quiet. Queue it instead: the fix is upstream, in whichever sync
	// should have produced the missing row.
	issueUnknownParty = "unknown_party"
	// The placement resolved and attributed cleanly but could not be persisted
	// -- a merge that would not materialize, or an assignment the database
	// refused. Stats.Errors and the log already carry this, but neither is
	// durable or queryable, so the value would otherwise vanish once the log
	// rotates.
	issueWriteFailed = "write_failed"
)

// Issue is one work-queue item. Zero-valued HouseholdCMID / PersonCMID mean "not
// specific to one party" and collapse the item across parties -- an unmapped
// cabin string is one thing to fix, however many households hit it.
type Issue struct {
	Kind          string
	RawValue      string
	SourceField   string
	Year          int
	HouseholdCMID int
	PersonCMID    int
	// SuggestedSession is a camp_sessions PB record id, advisory only. No
	// assignment row is ever written from it.
	SuggestedSession string
	CandidateCMIDs   []int
}

func (i *Issue) dedupKey() string {
	return fmt.Sprintf("%d\x00%s\x00%s\x00%s\x00%d\x00%d",
		i.Year, i.Kind, i.RawValue, i.SourceField, i.HouseholdCMID, i.PersonCMID)
}

type pendingIssue struct {
	issue       Issue
	occurrences int
}

// IssueRecorder accumulates work-queue items in memory and writes them once, so
// a backfill that meets the same unmapped string 472 times produces one row with
// occurrences=472 rather than 472 rows.
type IssueRecorder struct {
	app     core.App
	year    int
	pending map[string]*pendingIssue
	order   []string // insertion order, so Flush is deterministic
}

// NewIssueRecorder returns a recorder that accumulates work-queue items for one
// year. Call Flush once at the end of the run to write them.
func NewIssueRecorder(app core.App, year int) *IssueRecorder {
	return &IssueRecorder{
		app:     app,
		year:    year,
		pending: make(map[string]*pendingIssue),
	}
}

// Record adds one observation. Repeated identical observations increment the
// occurrence count rather than queueing another item.
//
// Issue is passed by value on purpose: callers build one inline per observation
// and the recorder keeps its own copy. Nothing here is hot path.
//
//nolint:gocritic // hugeParam, see above
func (r *IssueRecorder) Record(i Issue) {
	if i.Year == 0 {
		i.Year = r.year
	}
	key := i.dedupKey()
	if p, ok := r.pending[key]; ok {
		p.occurrences++
		// Later observations may carry a suggestion the first did not.
		if p.issue.SuggestedSession == "" {
			p.issue.SuggestedSession = i.SuggestedSession
		}
		return
	}
	r.pending[key] = &pendingIssue{issue: i, occurrences: 1}
	r.order = append(r.order, key)
}

// Recorded returns every item accumulated so far, in the order they were first
// recorded.
//
// A whole-year sync has no use for this -- it queues thousands of items and
// cares only about the flushed totals. A replay processes ONE value and has to
// answer "did this click place the value, and if not, is the thing blocking it
// still the thing the row NAMES", which is precisely "what did the pass
// record". ingestValue can record two items for one value (an alias failure and
// an attribution failure), so this returns all of them rather than the first.
//
// The items come back whole rather than as kinds, because the caller compares
// them on the full dedup tuple: the same kind for a different party is a
// different item.
func (r *IssueRecorder) Recorded() []Issue {
	out := make([]Issue, 0, len(r.order))
	for _, key := range r.order {
		out = append(out, r.pending[key].issue)
	}
	return out
}

// Observations returns the total number of Record calls this recorder has
// taken, counting repeats of an item it already held.
//
// The party-less fan-out needs "did THIS party's value come through clean",
// asked once per party, and the ITEM count cannot answer it: two parties
// blocked by the same unmapped string collapse onto one dedup key, so the
// second blocked party would look like a placement. Every Record moves this by
// one, deduplicated or not.
func (r *IssueRecorder) Observations() int {
	total := 0
	for _, p := range r.pending {
		total += p.occurrences
	}
	return total
}

// CountOf returns the total observations recorded for a kind, across items.
func (r *IssueRecorder) CountOf(kind string) int {
	total := 0
	for _, p := range r.pending {
		if p.issue.Kind == kind {
			total += p.occurrences
		}
	}
	return total
}

// Flush upserts every accumulated item. occurrences is SET to what this run
// observed rather than added to, so re-running the sync is idempotent.
// is_resolved is written only on create -- once staff tick an item, a later sync
// must not un-tick it.
func (r *IssueRecorder) Flush(now time.Time) (created, updated int, err error) {
	col, err := r.app.FindCollectionByNameOrId("lodging_ingest_issues")
	if err != nil {
		return 0, 0, fmt.Errorf("finding lodging_ingest_issues: %w", err)
	}
	stamp := now.UTC().Format("2006-01-02 15:04:05.000Z")

	for _, key := range r.order {
		p := r.pending[key]
		existing, findErr := r.findExisting(&p.issue)
		if findErr != nil {
			return created, updated, findErr
		}

		rec := existing
		isNew := rec == nil
		if isNew {
			rec = core.NewRecord(col)
			rec.Set("kind", p.issue.Kind)
			rec.Set("raw_value", p.issue.RawValue)
			rec.Set("source_field", p.issue.SourceField)
			rec.Set("year", p.issue.Year)
			rec.Set("household_cm_id", p.issue.HouseholdCMID)
			rec.Set("person_cm_id", p.issue.PersonCMID)
			rec.Set("first_seen", stamp)
			rec.Set("is_resolved", false)
		}
		rec.Set("occurrences", p.occurrences)
		rec.Set("last_seen", stamp)
		// The advisory fields are only overwritten when this run actually
		// produced them. Record preserves the first non-empty suggestion within a
		// run; blanking a stored one here would undo that across runs, and a
		// re-run whose last_updated stops parsing would silently strip an open
		// queue item of its one-click confirmation.
		if isNew || p.issue.SuggestedSession != "" {
			rec.Set("suggested_session", p.issue.SuggestedSession)
		}
		if isNew || len(p.issue.CandidateCMIDs) > 0 {
			rec.Set("candidate_session_cm_ids", p.issue.CandidateCMIDs)
		}

		if saveErr := r.app.Save(rec); saveErr != nil {
			return created, updated, fmt.Errorf("saving issue %q: %w", p.issue.RawValue, saveErr)
		}
		if isNew {
			created++
		} else {
			updated++
		}
	}
	return created, updated, nil
}

// eqOrEmpty renders a text-column equality clause into filter, registering a
// bound parameter unless the value is empty.
//
// Two traps in one helper, both verified against a live PocketBase:
//
//   - A bound parameter whose value is the EMPTY STRING matches nothing. For a
//     row whose scenario is the empty string, `scenario = {:sc}` with sc="" returns
//     0 rows, while the same comparison written as a bare SQL literal returns it.
//     So empty values have to be literals.
//   - Everything else must stay parameterised. Several real cabin strings carry
//     an apostrophe, and interpolating one into a quoted SQL literal is a syntax
//     error rather than a miss -- the exact bug that left Plan 1's alias verifier
//     unable to pass no matter what was seeded. (The strings themselves are not
//     quoted here: verify-no-hardcoded-lodging.sh forbids unit names in
//     application source, comments included. See lodging_issues_test.go.)
func eqOrEmpty(column, paramName, value string, params dbx.Params) string {
	if value == "" {
		return column + " = ''"
	}
	params[paramName] = value
	return column + " = {:" + paramName + "}"
}

// findExisting looks the item up on the same six columns as
// idx_lodging_issues_dedup.
func (r *IssueRecorder) findExisting(i *Issue) (*core.Record, error) {
	params := dbx.Params{
		"year":   i.Year,
		"hh":     i.HouseholdCMID,
		"person": i.PersonCMID,
	}
	filter := "year = {:year} && household_cm_id = {:hh} && person_cm_id = {:person} && " +
		eqOrEmpty("kind", "kind", i.Kind, params) + " && " +
		eqOrEmpty("raw_value", "raw", i.RawValue, params) + " && " +
		eqOrEmpty("source_field", "field", i.SourceField, params)

	rows, err := r.app.FindRecordsByFilter("lodging_ingest_issues", filter, "", 1, 0, params)
	if err != nil {
		return nil, fmt.Errorf("looking up issue %q: %w", i.RawValue, err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}
