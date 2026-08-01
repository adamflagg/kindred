package sync

import (
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

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
func ReplayIssue(app core.App, issueID string) error {
	row, err := app.FindRecordById("lodging_ingest_issues", issueID)
	if err != nil {
		return fmt.Errorf("loading issue %s: %w", issueID, err)
	}
	if !row.GetBool("is_resolved") {
		return fmt.Errorf("issue %s is not resolved; nothing to replay", issueID)
	}

	householdCMID := row.GetInt("household_cm_id")
	personCMID := row.GetInt("person_cm_id")
	if householdCMID == 0 && personCMID == 0 {
		return fmt.Errorf("issue %s carries neither a household nor a person", issueID)
	}

	year := row.GetInt("year")
	if year == 0 {
		return fmt.Errorf("issue %s has no year", issueID)
	}

	s := NewLodgingAssignmentsSync(app)
	s.Year = year

	if s.resolver, err = NewAliasResolver(app); err != nil {
		return fmt.Errorf("building the alias resolver: %w", err)
	}
	if s.unitTree, err = BuildUnitTree(app); err != nil {
		return fmt.Errorf("building the unit tree: %w", err)
	}
	if err = s.buildPartySizeIndexes(year); err != nil {
		return fmt.Errorf("building party-size indexes: %w", err)
	}
	s.issues = NewIssueRecorder(app, year)

	candidates, err := s.sessionWindowsFor(householdCMID, personCMID, year)
	if err != nil {
		return fmt.Errorf("loading session windows: %w", err)
	}

	now := time.Now().UTC()
	s.ingestValue(&ingestContext{
		Year:          year,
		Raw:           row.GetString("raw_value"),
		SourceField:   row.GetString("source_field"),
		HouseholdCMID: householdCMID,
		PersonCMID:    personCMID,
		Candidates:    candidates,
		// The original observation's timestamp is not on the row, and
		// AttributeSession uses it only to break ties between overlapping
		// windows. Replaying with "now" is honest: this IS a fresh decision,
		// made after a human corrected the registry.
		LastUpdated: now,
		Now:         now,
	})

	// A replay that placed the value records nothing, so this writes nothing. A
	// replay that did NOT -- a registry still half-repaired -- re-queues onto the
	// same dedup key, refreshing the row staff already ticked rather than adding a
	// second one. Flush SETS occurrences to what this pass observed, which is
	// right here because a party-scoped row describes a single value: CampMinder
	// holds one cabin answer per party per year.
	if _, _, err := s.issues.Flush(now); err != nil {
		return fmt.Errorf("flushing replay issues: %w", err)
	}
	return nil
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
