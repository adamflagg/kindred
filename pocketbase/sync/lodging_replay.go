package sync

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ReplayResult reports what one replay actually did.
//
// A bare error cannot say this. ingestValue never errors -- a placement, a
// still-illegal merge and a string no alias covers all come back the same way
// -- so a caller handed only `error` can report "done" and nothing else, which
// is how a half-finished repair came to look like a success.
type ReplayResult struct {
	// Placed is true when the value came out the far end with an assignment row
	// behind it. A row a human has already moved (staff_touched) counts: the
	// placement exists and the human owns it.
	Placed bool
	// Blockers are the work-queue kinds this pass recorded, in the order
	// ingestValue recorded them. Empty exactly when Placed.
	Blockers []string
}

// ReplayIssue re-runs the placement for one resolved work-queue row.
//
// Why this exists: resolving a queue item creates an alias and ticks the row,
// but never created the assignment -- the placement appeared only on the next
// family_camp_derived run, 8-10 minutes per year. The queue was a log, not a
// work queue.
//
// This is a SCOPED MINI-SYNC, not a pure function call. ingestValue needs the
// resolver, the unit tree, the party-size indexes and the party's candidate
// weekends. All four are rebuilt here for one party. That costs ~1-2s,
// dominated by buildPartySizeIndexes' three table scans.
//
// It deliberately calls ingestValue rather than reimplementing placement. A
// second placement path would drift from the sync's, and the drift would show
// up as placements that differ depending on whether staff clicked or waited.
//
// Only a row that names a party can be replayed. unresolved_alias and
// ambiguous_alias rows deliberately carry neither (their dedup key collapses
// them across parties -- one unmapped string is one thing to fix), so they are
// refused here; repairing those means replaying every value that used the
// string, which is a different, fan-out entry point.
func ReplayIssue(app core.App, issueID string) (ReplayResult, error) {
	var result ReplayResult

	row, err := app.FindRecordById("lodging_ingest_issues", issueID)
	if err != nil {
		return result, fmt.Errorf("loading issue %s: %w", issueID, err)
	}
	if !row.GetBool("is_resolved") {
		return result, fmt.Errorf("issue %s is not resolved; nothing to replay", issueID)
	}

	householdCMID := row.GetInt("household_cm_id")
	personCMID := row.GetInt("person_cm_id")
	if householdCMID == 0 && personCMID == 0 {
		return result, fmt.Errorf("issue %s carries neither a household nor a person", issueID)
	}

	year := row.GetInt("year")
	if year == 0 {
		return result, fmt.Errorf("issue %s has no year", issueID)
	}
	raw := row.GetString("raw_value")

	s := NewLodgingAssignmentsSync(app)
	s.Year = year

	if s.resolver, err = NewAliasResolver(app); err != nil {
		return result, fmt.Errorf("building the alias resolver: %w", err)
	}
	if s.unitTree, err = BuildUnitTree(app); err != nil {
		return result, fmt.Errorf("building the unit tree: %w", err)
	}
	if err = s.buildPartySizeIndexes(year); err != nil {
		return result, fmt.Errorf("building party-size indexes: %w", err)
	}
	s.issues = NewIssueRecorder(app, year)

	candidates, err := s.sessionWindowsFor(householdCMID, personCMID, year)
	if err != nil {
		return result, fmt.Errorf("loading session windows: %w", err)
	}
	lastUpdated, err := s.observationTimestampFor(householdCMID, personCMID, year, raw)
	if err != nil {
		return result, fmt.Errorf("loading the observation timestamp: %w", err)
	}

	now := time.Now().UTC()
	s.ingestValue(&ingestContext{
		Year:          year,
		Raw:           raw,
		SourceField:   row.GetString("source_field"),
		HouseholdCMID: householdCMID,
		PersonCMID:    personCMID,
		Candidates:    candidates,
		LastUpdated:   lastUpdated,
		Now:           now,
	})

	recorded := s.issues.Recorded()
	result.Blockers = make([]string, 0, len(recorded))
	for i := range recorded {
		result.Blockers = append(result.Blockers, recorded[i].Kind)
	}
	result.Placed = len(recorded) == 0

	// A replay that placed the value records nothing, so this writes nothing. A
	// replay that hit the SAME problem again lands on the same dedup key,
	// refreshing the row staff already ticked rather than adding a second one; a
	// replay blocked by something else creates that item's own row, open. Flush
	// SETS occurrences to what this pass observed, which is right here because a
	// party-scoped row describes a single value: CampMinder holds one cabin
	// answer per party per year.
	if _, _, flushErr := s.issues.Flush(now); flushErr != nil {
		return result, fmt.Errorf("flushing replay issues: %w", flushErr)
	}

	if err := reopenRecorded(s.issues, recorded); err != nil {
		return result, err
	}
	return result, nil
}

// reopenRecorded clears is_resolved on the row backing every item this pass
// recorded.
//
// Flush cannot do it: it writes is_resolved only on CREATE, deliberately, so
// that a nightly sync meeting the same bad value again cannot un-tick what
// staff ticked. A replay is the other actor. It IS the click, and a click that
// wrote no placement has not finished the job -- a value with no placement and
// no open row anywhere has silently vanished, which is the log-not-a-work-queue
// failure this file exists to remove.
//
// Scoping this to the RECORDED items rather than to the replayed row is what
// makes the invariant hold. It re-opens the replayed row exactly when that
// row's own blocker recurred, so a row whose named blocker is gone is still
// never touched: repairing an illegal merge and then hitting an ambiguous
// session means the merge really was fixed, and re-opening it would send staff
// to inspect something no longer wrong while the real blocker sits in its own
// accurate row. But it ALSO covers the row that is not the replayed one --
// blockers accumulate across runs, staff tick them all, and a pass that re-hits
// an already-ticked sibling would otherwise leave nothing open at all.
//
// findExisting is reused rather than matching fields here, so the lookup is the
// same dedup tuple as idx_lodging_issues_dedup and Flush -- (year, kind,
// raw_value, source_field, household_cm_id, person_cm_id). Kind alone would be
// wrong: the same kind for a different party is a different queue item.
//
// It re-reads rather than reusing an in-memory copy, because Flush has just
// saved its own instance of these records with a fresh last_seen and writing a
// stale copy would roll that back. Call it AFTER Flush: the rows have to exist
// before they can be re-opened.
//
// One window this does not close: if Flush itself errors, ReplayIssue returns
// before reaching here, so a row can stay ticked with no placement behind it.
// That is left alone deliberately -- the error is surfaced to the caller rather
// than swallowed, and a re-click replays cleanly.
func reopenRecorded(issues *IssueRecorder, recorded []Issue) error {
	for i := range recorded {
		row, err := issues.findExisting(&recorded[i])
		if err != nil {
			return fmt.Errorf("locating the %s row to reopen it: %w", recorded[i].Kind, err)
		}
		if row == nil {
			// Flush wrote this row moments ago, so a miss means the lookup and the
			// write disagree about identity. Failing loudly beats returning nil to a
			// caller that would read it as "repaired".
			return fmt.Errorf("no queue row found for the %s item just flushed", recorded[i].Kind)
		}
		if !row.GetBool("is_resolved") {
			continue
		}
		row.Set("is_resolved", false)
		if err := issues.app.Save(row); err != nil {
			return fmt.Errorf("reopening issue %s: %w", row.Id, err)
		}
	}
	return nil
}

// observationTimestampFor reads last_updated off the source custom-value row
// this queue item came from.
//
// It is not decoration, and time.Now() is not an acceptable stand-in.
// AttributeSession uses this timestamp to pick suggested_session -- the
// one-click confirmation the queue offers staff on an ambiguous row -- by
// walking the candidates for the first weekend starting on or after it. For any
// past season now is after every window, so the walk falls through to the LAST
// candidate, and Flush overwrites a non-empty suggestion: replaying would
// quietly swap a correct guess for the final weekend of the year.
//
// Reading the real value also makes replay's attribution identical to the
// sync's, which is the whole premise of reusing ingestValue.
//
// A missing row is not an error. Staff may have edited the CampMinder value
// since the item was queued, so nothing matches the raw string; the zero time
// makes AttributeSession return no suggestion at all, and Flush then preserves
// whatever is stored -- the same contract a sync re-run has when last_updated
// stops parsing.
func (s *LodgingAssignmentsSync) observationTimestampFor(
	householdCMID, personCMID, year int, raw string,
) (time.Time, error) {
	if raw == "" {
		return time.Time{}, nil
	}

	// The serviceName constants are the collections' own names -- each source sync
	// is named for the table it fills -- so they read as collection names here,
	// not as job references.
	partyCollection, valueCollection := personsCollection, serviceNamePersonCustomValues
	partyColumn, target := "person", targetCabinAssignmentPerson
	partyCMID := personCMID
	if householdCMID > 0 {
		partyCollection, valueCollection = serviceNameHouseholds, serviceNameHouseholdCustomValues
		partyColumn, target = "household", targetCabinAssignmentHousehold
		partyCMID = householdCMID
	}

	// Both custom-value tables address their party by PB relation while the queue
	// row carries the CampMinder id, so the id has to be translated first.
	parties, err := s.App.FindRecordsByFilter(partyCollection,
		"cm_id = {:cm} && year = {:year}", "", 1, 0,
		dbx.Params{"cm": partyCMID, "year": year})
	if err != nil {
		return time.Time{}, fmt.Errorf("looking up %s %d: %w", partyCollection, partyCMID, err)
	}
	if len(parties) == 0 {
		return time.Time{}, nil
	}

	fieldTargets, err := LodgingFieldDefIDs(s.App)
	if err != nil {
		return time.Time{}, fmt.Errorf("loading source field mappings: %w", err)
	}
	defIDs := defIDsForTarget(fieldTargets, target)
	if len(defIDs) == 0 {
		return time.Time{}, nil // the field is unmapped or disabled
	}

	params := dbx.Params{"party": parties[0].Id, "raw": raw}
	filter := fmt.Sprintf("year = %d && %s = {:party} && value = {:raw} && %s",
		year, partyColumn, fieldDefClause(defIDs, params))
	rows, err := s.App.FindRecordsByFilter(valueCollection, filter, "-last_updated", 1, 0, params)
	if err != nil {
		return time.Time{}, fmt.Errorf("reading %s: %w", valueCollection, err)
	}
	if len(rows) == 0 {
		return time.Time{}, nil
	}

	// A value that does not parse yields the zero time, same as a missing row.
	ts, _ := ParseCampMinderTimestamp(rows[0].GetString("last_updated"))
	return ts, nil
}

// sessionWindowsFor returns the weekend windows this party's value could
// describe: the same slice the sync's whole-year index would hold for it.
//
// Grain picks the session types, exactly as the two sync passes do -- the
// household grain reads the family-camp field and looks at family weekends, the
// person grain reads the reportable field and looks at adult weekends. The two
// are never both set on one observation, so testing the household id first is
// the same branch ingestValue's callers already took.
func (s *LodgingAssignmentsSync) sessionWindowsFor(
	householdCMID, personCMID, year int,
) ([]SessionWindow, error) {
	byHousehold := householdCMID > 0
	cmID, sessionTypes := personCMID, []string{sessionTypeAdult}
	if byHousehold {
		cmID, sessionTypes = householdCMID, []string{sessionTypeFamily}
	}

	index, err := buildSessionIndex(s.App, year, sessionTypes, byHousehold, cmID)
	if err != nil {
		return nil, err
	}
	return index[cmID], nil
}
