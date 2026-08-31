package sync

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// confirmedSessions holds the weekend staff confirmed for each party, split by
// grain and keyed on the CampMinder id -- the same key every other cross-table
// relationship in this project uses.
//
// The zero value is usable: reading from a nil map yields 0, which is
// "unconfirmed". That matters because newReplayScope wires a
// LodgingAssignmentsSync without ever calling Sync(), so anything Sync() alone
// populated has to degrade to "nothing confirmed" rather than panic.
type confirmedSessions struct {
	byHousehold map[int]int
	byPerson    map[int]int
}

// forParty returns the confirmed weekend for whichever grain the observation
// carries. Exactly one of the two ids is ever set, as everywhere else in this
// ingest.
func (c confirmedSessions) forParty(householdCMID, personCMID int) int {
	if householdCMID > 0 {
		return c.byHousehold[householdCMID]
	}
	return c.byPerson[personCMID]
}

// loadConfirmedSessions reads every confirmed weekend for one year off the work
// queue.
//
// CampMinder holds one cabin value per party per year and cannot say which
// weekend it describes, so a party attending two weekends has no key to write
// an assignment on and the sync writes no row at all. The queue row is where
// staff answer that; this is the sync reading the answer back.
//
// WHY THE SYNC READS IT AT ALL, rather than leaving confirmation entirely to
// the replay a tick triggers. Two things would otherwise freeze the moment a
// household is confirmed. party_size is recomputed every run from enrollment
// and the adults table -- buildPartySizeIndexes exists precisely because a
// wrong party size is a wrong cabin capacity -- and the cabin string itself
// moves when staff re-key it in CampMinder. Neither reaches the board again
// unless the sync's own pass can place the party, so a confirmation the sync
// could not see would pin a household to whatever was true on the day it was
// confirmed.
//
// KEYED ON THE PARTY, NOT ON raw_value. The dedup key includes raw_value, so a
// re-keyed cabin string queues a SECOND row rather than updating the first. The
// human's decision is about the WEEKEND, which the new string does not change,
// and dropping the placement because the cabin moved would be the worse answer.
// The candidate check at the write path is what keeps that from over-reaching:
// a confirmation survives a changed cabin string, never a changed enrollment.
//
// Ordered by last_seen ascending so the last write into each map wins. Where a
// party somehow carries two confirmations, the fresher one is the row the sync
// is STILL recording -- a row whose blocker is gone stops being re-observed and
// its last_seen freezes -- so "most recently seen" is "describes the value the
// party holds today". id is the tiebreak, purely so the result is deterministic.
func loadConfirmedSessions(app core.App, year int) (confirmedSessions, error) {
	out := confirmedSessions{
		byHousehold: map[int]int{},
		byPerson:    map[int]int{},
	}

	// Note the spaces around every operator -- PocketBase's filter parser
	// silently returns wrong results without them.
	rows, err := app.FindRecordsByFilter("lodging_ingest_issues",
		"year = {:year} && confirmed_session_cm_id > 0", "last_seen,id", 0, 0,
		dbx.Params{"year": year})
	if err != nil {
		return out, fmt.Errorf("reading confirmed weekends for %d: %w", year, err)
	}

	for _, r := range rows {
		confirmed := r.GetInt("confirmed_session_cm_id")
		switch hh := r.GetInt("household_cm_id"); {
		case hh > 0:
			out.byHousehold[hh] = confirmed
		case r.GetInt("person_cm_id") > 0:
			out.byPerson[r.GetInt("person_cm_id")] = confirmed
		}
		// A row with neither id names a cabin STRING rather than a party
		// (unresolved_alias and friends collapse across parties by design), so a
		// confirmation on one has nobody to place and is skipped.
	}
	return out, nil
}

// confirmedAttribution pins a cabin value to the weekend a human confirmed.
//
// It is AttributeSession's counterpart for the one case the heuristic must
// never settle: a party attending two or more weekends against CampMinder's
// single per-year value. AttributeSession returns an advisory BestGuess and
// places nothing there, deliberately -- "a wrong cabin on the board is worse
// than a blank one" -- and that ruling stands. This function does not soften
// it; it applies an answer a human already gave.
//
// THE STORED NUMBER IS RESOLVED AGAINST candidates, NEVER TRUSTED DIRECTLY, and
// a miss returns false rather than a placement. Three reasons, any one of which
// would be enough:
//
//   - Attribution.SessionCMID() resolves the CampMinder id by scanning
//     Candidates and returns 0 for a non-member, while
//     lodging_assignments.session_cm_id is REQUIRED (migration 1500000124). A
//     non-candidate would therefore not write a wrong row -- it would fail
//     inside upsertAssignment, one layer below where the mistake was made.
//   - Candidates IS the party's slice of the session index deleteLodgingOrphans
//     reads, so a confirmation resolved through it can never be swept by the
//     same run that wrote it. kindred#2626/#2641 is the measured failure of that
//     class: a widened write key whose orphan key did not move deleted its own
//     new rows and the run reported SUCCESS.
//   - Enrollment moves after a confirmation is made. A household that cancels
//     the weekend it was confirmed onto is not placed there any more, and no
//     column constraint could express that -- the constraint is enrollment, not
//     existence.
//
// The synthesized Reason is attrSingleSession because that is what every reader
// downstream tests: it means "this value is attributable to exactly one
// weekend", which a confirmation makes true. It is not a claim that the party
// attends only one.
func confirmedAttribution(candidates []SessionWindow, confirmedCMID int) (Attribution, bool) {
	if confirmedCMID <= 0 {
		return Attribution{}, false
	}
	for _, c := range candidates {
		if c.CMID == confirmedCMID {
			return Attribution{
				SessionID:  c.ID,
				Candidates: candidates,
				Reason:     attrSingleSession,
			}, true
		}
	}
	return Attribution{}, false
}
