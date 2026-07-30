package sync

import (
	"errors"
	"testing"
)

// TestValidateAssignmentGrain covers every state the database accepts but the
// design forbids. PocketBase enforces none of these: lodging_assignments.unit
// and .merge are both optional relations and household_cm_id / person_cm_id are
// both optional numbers, so all four illegal shapes save with a 200. This
// function is the only place the invariant exists.
func TestValidateAssignmentGrain(t *testing.T) {
	cases := []struct {
		name string
		in   AssignmentGrain
		want error
	}{
		{
			name: "household into an atomic room (family camp, ~94% of rows)",
			in:   AssignmentGrain{HouseholdCMID: 9001, UnitID: "u_ridge_a"},
		},
		{
			name: "person into a merged slot (an adult weekend placement)",
			in:   AssignmentGrain{PersonCMID: 5001, MergeID: "m_tioga_12"},
		},
		{
			name: "neither party",
			in:   AssignmentGrain{UnitID: "u_ridge_a"},
			want: ErrGrainNoParty,
		},
		{
			name: "both parties",
			in:   AssignmentGrain{HouseholdCMID: 9001, PersonCMID: 5001, UnitID: "u_ridge_a"},
			want: ErrGrainBothParties,
		},
		{
			name: "no placement",
			in:   AssignmentGrain{HouseholdCMID: 9001},
			want: ErrGrainNoPlacement,
		},
		{
			name: "both placements",
			in:   AssignmentGrain{HouseholdCMID: 9001, UnitID: "u_ridge_a", MergeID: "m_tioga_12"},
			want: ErrGrainBothPlacements,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateAssignmentGrain(tc.in)
			if tc.want == nil {
				if err != nil {
					t.Fatalf("ValidateAssignmentGrain(%+v) = %v, want nil", tc.in, err)
				}
				return
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("ValidateAssignmentGrain(%+v) = %v, want %v", tc.in, err, tc.want)
			}
		})
	}
}

// TestAssignmentGrainIllegalStatesReallySaveInPocketBase documents WHY the guard
// exists rather than trusting the schema. If PocketBase ever starts rejecting
// these, this test fails and the guard can be reconsidered -- but until then the
// invariant has no database backing.
func TestAssignmentGrainIllegalStatesReallySaveInPocketBase(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, 1309514, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)

	// Neither party, no placement: the emptiest illegal row there is.
	id := saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sess, "year": 2025, "source": "campminder_sync",
	})
	if id == "" {
		t.Fatal("expected PocketBase to accept the row (that is the point of this test)")
	}
}
