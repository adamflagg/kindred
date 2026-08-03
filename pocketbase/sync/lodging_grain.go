package sync

import "errors"

// The dual-grain invariant (spec 3.5): exactly one party identifier and at
// least one placement per assignment row.
//
// PocketBase enforces none of it. lodging_assignments.units is an optional
// relation, and household_cm_id / person_cm_id are both optional numbers, so
// every illegal shape below saves with a 200. Plan 1 kept the invariant above
// the database deliberately -- a partial unique index cannot express "exactly
// one of these two" -- which makes this function the only place it exists at
// all.
var (
	ErrGrainNoParty     = errors.New("assignment has neither household_cm_id nor person_cm_id")
	ErrGrainBothParties = errors.New("assignment has both household_cm_id and person_cm_id")
	ErrGrainNoPlacement = errors.New("assignment has no units")
)

// AssignmentGrain is the identity half of a lodging_assignments row.
type AssignmentGrain struct {
	HouseholdCMID int
	PersonCMID    int
	UnitIDs       []string
}

// ValidateAssignmentGrain returns nil only for the two legal shapes:
//
//	household + units   -> family camp
//	person    + units   -> adult weekends, or one person pulled out of their
//	                        household's row
//
// Note the party test compares against 0, never against the empty string.
// PocketBase number columns are NUMERIC DEFAULT 0 NOT NULL so an unset id is 0,
// and SQLite evaluates a number-vs-empty-string inequality as TRUE -- the same
// trap that would have collapsed every person-grain row onto
// household_cm_id = 0 in Plan 1's unique indexes.
func ValidateAssignmentGrain(g AssignmentGrain) error {
	hasHousehold := g.HouseholdCMID > 0
	hasPerson := g.PersonCMID > 0
	switch {
	case !hasHousehold && !hasPerson:
		return ErrGrainNoParty
	case hasHousehold && hasPerson:
		return ErrGrainBothParties
	}

	if len(g.UnitIDs) == 0 {
		return ErrGrainNoPlacement
	}
	return nil
}
