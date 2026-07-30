package sync

import "errors"

// The dual-grain invariant (spec 3.5): exactly one party identifier and exactly
// one placement per assignment row.
//
// PocketBase enforces none of it. lodging_assignments.unit and .merge are both
// optional relations, and household_cm_id / person_cm_id are both optional
// numbers, so every illegal shape below saves with a 200. Plan 1 kept the
// invariant above the database deliberately -- a partial unique index cannot
// express "exactly one of these two" -- which makes this function the only place
// it exists at all.
var (
	ErrGrainNoParty        = errors.New("assignment has neither household_cm_id nor person_cm_id")
	ErrGrainBothParties    = errors.New("assignment has both household_cm_id and person_cm_id")
	ErrGrainNoPlacement    = errors.New("assignment has neither unit nor merge")
	ErrGrainBothPlacements = errors.New("assignment has both unit and merge")
)

// AssignmentGrain is the identity half of a lodging_assignments row.
type AssignmentGrain struct {
	HouseholdCMID int
	PersonCMID    int
	UnitID        string
	MergeID       string
}

// ValidateAssignmentGrain returns nil only for the two legal shapes:
//
//	household + unit | household + merge   -> family camp
//	person    + unit | person    + merge   -> adult weekends, or one person
//	                                          pulled out of their household's row
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

	hasUnit := g.UnitID != ""
	hasMerge := g.MergeID != ""
	switch {
	case !hasUnit && !hasMerge:
		return ErrGrainNoPlacement
	case hasUnit && hasMerge:
		return ErrGrainBothPlacements
	}
	return nil
}
