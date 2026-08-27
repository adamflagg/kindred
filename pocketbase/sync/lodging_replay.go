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
// blocked attribution and a string no alias covers all come back the same way
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
// resolver, the party-size indexes and the party's candidate weekends. All
// three are rebuilt here for one party. That costs ~1-2s, dominated by
// buildPartySizeIndexes' three table scans.
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
	// No blank-raw guard here, unlike ReplayPartylessIssue. Reviewers ask for
	// one; it would be dead code. All three grain queries filter `value != ''`
	// (lodging_assignments_sync.go), so no observation with an empty value ever
	// reaches ingestValue, and no party-scoped row can carry a blank raw_value.
	// The party-less guard exists for a different reason: an empty bound param
	// matches NO row in that function's fan-out query.
	raw := row.GetString("raw_value")

	s, err := newReplayScope(app, year)
	if err != nil {
		return result, err
	}

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

// ReplayPartylessIssue re-runs the placement for a resolved work-queue row that
// stands for a cabin STRING rather than for one party.
//
// unresolved_alias and ambiguous_alias are recorded with no party columns on
// purpose: the dedup key includes the party, so zeroing it collapses one
// unmapped string into ONE row however many households wrote it. That collapse
// is what keeps the queue reviewable, and it is why ReplayIssue -- which needs a
// party to attribute a placement -- refuses these rows. Stamping parties onto
// them to make ReplayIssue work would turn one queue item into hundreds.
//
// So the fan-out lives here instead: find every party that wrote this string in
// this year through this source field, and run the sync's own ingestValue once
// per party. It is the sync's grain loop restricted to one value, and it shares
// every index that loop builds -- one whole-year session index for the grain,
// not one scan per party.
//
// The count is PLACEMENTS, not parties: a caller has to be able to tell
// "resolved and placed 12" from "resolved, and 12 households are still stuck".
// A party whose value could not be placed leaves an open queue row behind, as it
// does for a party-scoped replay. The count stays meaningful alongside an error
// -- the assignments it counts are already committed -- and is 0 wherever
// nothing was written.
//
// ROUTING IS NOT TOTAL, and a caller must not assume it is. The party guards
// here and on ReplayIssue are exact complements, so no row is accepted by both
// -- but this function carries three refusals ReplayIssue has no counterpart
// for, and a party-less row of those shapes is refused by BOTH entry points and
// replayable by neither:
//
//   - field_zero_values and unknown_party (below), by kind;
//   - a row with no raw_value;
//   - a row whose source_field is not a registered assignment source, or whose
//     field is disabled or absent from custom_field_defs.
//
// field_zero_values is not hypothetical: this database holds an open one. A
// caller has to surface the error rather than treat it as a failed repair, and
// a UI should not offer a replay control on those rows at all.
//
// What IS accepted, then: unresolved_alias and ambiguous_alias -- the two kinds
// the fan-out exists for.
func ReplayPartylessIssue(app core.App, issueID string) (int, error) {
	row, err := app.FindRecordById("lodging_ingest_issues", issueID)
	if err != nil {
		return 0, fmt.Errorf("loading issue %s: %w", issueID, err)
	}
	if !row.GetBool("is_resolved") {
		return 0, fmt.Errorf("issue %s is not resolved; nothing to replay", issueID)
	}
	if row.GetInt("household_cm_id") > 0 || row.GetInt("person_cm_id") > 0 {
		return 0, fmt.Errorf("issue %s is party-scoped; use ReplayIssue", issueID)
	}
	// Two of the four party-less kinds route nowhere. Both would otherwise reach
	// the fan-out, place nothing, and report a quiet success.
	switch row.GetString("kind") {
	case issueFieldZeroValues:
		// Its raw_value names the FIELD that saw no values, not a cabin string, so
		// a fan-out searches for parties whose cabin answer is the field's own
		// name. Nothing here can repair it.
		return 0, fmt.Errorf(
			"issue %s is a field-level warning, not a cabin value; nothing to replay", issueID)
	case issueUnknownParty:
		// This one does name a real cabin string, which is what makes it
		// dangerous. The row exists BECAUSE its party has no CampMinder id for the
		// year -- and those are exactly the value rows partiesWritingValue skips,
		// since a placement cannot be keyed on them. So the party the row is about
		// can never be re-recorded and the row can never re-open; worse, if other
		// households wrote the same string the click would report placing them
		// while the named party stayed exactly as stuck as before. The repair is
		// upstream, in whichever sync should have produced the party.
		return 0, fmt.Errorf(
			"issue %s names a party with no CampMinder id; its repair is upstream, not a replay", issueID)
	}

	year := row.GetInt("year")
	if year == 0 {
		return 0, fmt.Errorf("issue %s has no year", issueID)
	}
	raw := row.GetString("raw_value")
	if raw == "" {
		// Nothing can match it: a bound empty parameter matches no row, and the
		// bare literal that would work instead (`value = ''`) matches every party
		// who answered nothing at all -- see eqOrEmpty.
		return 0, fmt.Errorf("issue %s has no raw value to replay", issueID)
	}
	sourceField := row.GetString("source_field")
	// The source field is the grain, and the grain is the table to read. Without
	// a registered one there is nowhere to look for the parties.
	field, ok := lodgingSourceFieldByName(sourceField)
	if !ok {
		return 0, fmt.Errorf(
			"issue %s names source field %q, which is not a lodging assignment source",
			issueID, sourceField)
	}
	byHousehold := field.Grain == grainHousehold

	// Resolved here rather than inside partiesWritingValue so that "the field is
	// switched off" is a refusal beside the other refusals, and cannot be
	// mistaken downstream for "no party wrote this string". The two produce the
	// same empty list and mean opposite things: one is a mapping a human has to
	// restore, the other is nothing left to do.
	fieldTargets, err := LodgingFieldDefIDs(app)
	if err != nil {
		return 0, fmt.Errorf("loading source field mappings: %w", err)
	}
	defIDs := defIDsForTarget(fieldTargets, field.primaryTarget())
	if len(defIDs) == 0 {
		return 0, fmt.Errorf(
			"issue %s reads source field %q, which is disabled or absent from custom_field_defs; "+
				"no value can be read through it", issueID, sourceField)
	}

	s, err := newReplayScope(app, year)
	if err != nil {
		return 0, err
	}

	parties, err := s.partiesWritingValue(year, field, defIDs, raw)
	if err != nil {
		return 0, fmt.Errorf("finding the parties that wrote %q: %w", raw, err)
	}
	if len(parties) == 0 {
		// The one quiet tick left, and the only one that earns it: the field is
		// mapped and readable, and no party writes this string this year -- staff
		// edited the CampMinder values after the row was queued. There is no
		// placement to make and no party to keep an item open for, so the row
		// stays ticked and the caller hears zero.
		return 0, nil
	}

	// One index for the whole grain, indexed into per party -- the same call and
	// the same result the sync's grain pass uses. sessionWindowsFor's per-party
	// filter is the wrong tool at this scale: it prunes in Go AFTER a whole-year
	// attendee scan, so calling it inside this loop would run one such scan per
	// household, and a string 300 households wrote is a common shape.
	sessionIndex, err := buildSessionIndex(
		app, year, sessionTypesForGrain(byHousehold), byHousehold, allParties)
	if err != nil {
		return 0, fmt.Errorf("building the session index: %w", err)
	}

	now := time.Now().UTC()
	placed := 0
	for _, p := range parties {
		before := s.issues.Observations()
		s.ingestValue(&ingestContext{
			Year:          year,
			Raw:           raw,
			SourceField:   sourceField,
			HouseholdCMID: p.HouseholdCMID,
			PersonCMID:    p.PersonCMID,
			Candidates:    sessionIndex[p.cmID()],
			LastUpdated:   p.LastUpdated,
			Now:           now,
		})
		// ingestValue queues an item on every path that fails to place and on no
		// path that succeeds, so "recorded nothing" is the same evidence
		// ReplayIssue's Placed rests on. Counted per party rather than per item:
		// two parties blocked by this one string share a dedup key.
		if s.issues.Observations() == before {
			placed++
		}
	}

	recorded := s.issues.Recorded()
	// Flush SETS occurrences rather than adding, which for a fan-out is exactly
	// right and is why the whole party list has to be walked even once it is
	// clear the string still fails: the count this pass observes IS the number of
	// parties still affected.
	if _, _, flushErr := s.issues.Flush(now); flushErr != nil {
		return placed, fmt.Errorf("flushing replay issues: %w", flushErr)
	}
	if err := reopenRecorded(s.issues, recorded); err != nil {
		return placed, err
	}
	return placed, nil
}

// newReplayScope wires a LodgingAssignmentsSync for one year with the three
// things ingestValue needs and nothing a whole-year run needs.
//
// Both replay entry points build these, and they have to build them the same
// way: replay's premise is that a click produces the placement the next sync
// would have written, and that only holds while there is one setup rather than
// two that can drift. ~1-2s, dominated by buildPartySizeIndexes' three scans --
// paid once per click, whether one party or three hundred follow.
func newReplayScope(app core.App, year int) (*LodgingAssignmentsSync, error) {
	s := NewLodgingAssignmentsSync(app)
	s.Year = year

	var err error
	if s.resolver, err = NewAliasResolver(app); err != nil {
		return nil, fmt.Errorf("building the alias resolver: %w", err)
	}
	if err = s.buildPartySizeIndexes(year); err != nil {
		return nil, fmt.Errorf("building party-size indexes: %w", err)
	}
	s.issues = NewIssueRecorder(app, year)
	return s, nil
}

// replayParty is one party that wrote the replayed string, and when they last
// touched the value. Exactly one of the two ids is set, as everywhere else in
// this ingest.
type replayParty struct {
	HouseholdCMID int
	PersonCMID    int
	LastUpdated   time.Time
}

// cmID returns whichever id this grain keys on.
func (p replayParty) cmID() int {
	if p.HouseholdCMID > 0 {
		return p.HouseholdCMID
	}
	return p.PersonCMID
}

// partiesWritingValue returns every party that wrote one cabin string, in one
// year, through one source field: the grain pass's scan narrowed to a single
// value.
//
// The source field picks the grain and with it the table, the party column and
// the mapped definitions. Narrowing to it is not an optimisation: source_field
// is part of the dedup key, so a string written through BOTH fields is two
// queue rows, and searching both tables would place the other row's parties on
// a click that never mentioned them.
//
// LastUpdated is read off the value row this loop already holds. That is the
// cheap way and the faithful one -- it is the same column observationTimestampFor
// re-reads for a party-scoped replay, and reading it inline is exactly what the
// grain passes do. time.Now() is not a substitute: for a past season it is after
// every weekend, so AttributeSession falls through to the last candidate and
// Flush overwrites the stored suggestion with it.
//
// defIDs comes from the caller because an empty one is a refusal there, not an
// empty result here: a field nobody mapped and a string nobody writes both
// produce no parties and mean opposite things.
//
//nolint:gocritic // hugeParam: one registry row, passed by value like the registry itself
func (s *LodgingAssignmentsSync) partiesWritingValue(
	year int, field lodgingSourceField, defIDs []string, raw string,
) ([]replayParty, error) {
	// Both value tables name their party relation after the grain.
	byHousehold := field.Grain == grainHousehold
	valueCollection, partyCollection := serviceNamePersonCustomValues, personsCollection
	if byHousehold {
		valueCollection, partyCollection = serviceNameHouseholdCustomValues, householdsCollection
	}

	params := dbx.Params{"raw": raw}
	filter := fmt.Sprintf("year = %d && value = {:raw} && %s",
		year, fieldDefClause(defIDs, params))
	rows, err := findAllRecords(s.App, valueCollection, filter, params)
	if err != nil {
		return nil, err
	}

	// The value rows address their party by PB relation; every key in this ingest
	// is a CampMinder id.
	cmIDs, err := s.cmIDsByPBID(partyCollection, year)
	if err != nil {
		return nil, err
	}

	out := make([]replayParty, 0, len(rows))
	at := make(map[int]int, len(rows)) // party CM id -> its index in out
	for _, v := range rows {
		cmID := cmIDs[v.GetString(field.Grain)]
		if cmID == 0 {
			// No CampMinder id to key a placement on. The grain pass queues this as
			// unknown_party and that row is untouched by this click, so nothing is
			// dropped by skipping it -- and its repair is upstream, in whichever
			// sync should have produced the party, not in this string's alias.
			continue
		}

		p := replayParty{HouseholdCMID: cmID}
		if !byHousehold {
			p = replayParty{PersonCMID: cmID}
		}
		p.LastUpdated, _ = ParseCampMinderTimestamp(v.GetString("last_updated"))

		if i, seen := at[cmID]; seen {
			// CampMinder holds one cabin answer per party per year, so a second row
			// for the same party is a duplicate rather than a second occupant. The
			// freshest one is the observation, the same rule observationTimestampFor
			// applies with its "-last_updated" ordering.
			if p.LastUpdated.After(out[i].LastUpdated) {
				out[i] = p
			}
			continue
		}
		at[cmID] = len(out)
		out = append(out, p)
	}
	return out, nil
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
// never touched: a write that failed last run and now succeeds, only to hit an
// ambiguous session, means the write really was fixed -- re-opening that row
// would send staff to inspect something no longer wrong while the real blocker
// sits in its own accurate row. But it ALSO covers the row that is not the replayed one --
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
//
// One row it must NOT reopen (#1899): an unresolved_alias/ambiguous_alias row
// ticked with resolved_alias still empty is an IGNORE, not a mapping --
// ignoreIngestIssue leaves it empty on purpose, and mapUnresolvedAlias always
// sets it. Both of this function's callers collapse these two kinds onto a
// dedup key with no party in it, so ANY replay -- a party-scoped ReplayIssue
// for an unrelated household, or ReplayPartylessIssue's own fan-out for a
// different string -- that happens to also fail to resolve the SAME raw_value
// lands on this row's exact key. Reopening it there would undo a staff
// decision as a side effect of someone else's click. A row that WAS mapped
// (resolved_alias set) but still fails to resolve some later year is a
// different situation -- the mapping itself may no longer cover it -- and
// must still reopen.
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
		if isIgnoredPartylessAliasRow(recorded[i].Kind, row) {
			continue
		}
		row.Set("is_resolved", false)
		if err := issues.app.Save(row); err != nil {
			return fmt.Errorf("reopening issue %s: %w", row.Id, err)
		}
	}
	return nil
}

// isIgnoredPartylessAliasRow reports whether row is an unresolved_alias or
// ambiguous_alias row staff resolved without mapping it. resolved_alias is
// only a meaningful signal for these two kinds -- every other kind's
// resolution path leaves it empty regardless, so checking it without this
// kind guard would also block a legitimate reopen of, say, a manually
// resolved no_session row that is still genuinely broken.
func isIgnoredPartylessAliasRow(kind string, row *core.Record) bool {
	if kind != issueUnresolvedAlias && kind != issueAmbiguousAlias {
		return false
	}
	return row.GetString("resolved_alias") == ""
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
		partyCollection, valueCollection = householdsCollection, serviceNameHouseholdCustomValues
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
	cmID := personCMID
	if byHousehold {
		cmID = householdCMID
	}

	index, err := buildSessionIndex(s.App, year, sessionTypesForGrain(byHousehold), byHousehold, cmID)
	if err != nil {
		return nil, err
	}
	return index[cmID], nil
}

// sessionTypesForGrain names the weekends a grain's cabin value can possibly
// describe: family weekends for a household's answer, adult ones for a person's.
//
// It is one function rather than a line in each replay path because the two
// have to agree with the sync's two grain passes and with each other. A replay
// that asked for the wrong type would find no candidate and queue a no_session
// item -- the repair reporting itself as a fresh problem.
func sessionTypesForGrain(byHousehold bool) []string {
	if byHousehold {
		return []string{sessionTypeFamily}
	}
	return []string{sessionTypeAdult}
}
