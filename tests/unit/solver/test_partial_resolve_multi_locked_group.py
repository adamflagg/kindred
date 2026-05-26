"""Fix #3 — group lock relaxation when ALL members are locked but in DIFFERENT bunks.

TDD: test written BEFORE the fix and verified RED.
"""

from ortools.sat.python import cp_model

from bunking.solver.constraints.group_locks import add_group_lock_constraints
from bunking.solver.constraints.locked_bunks import add_locked_bunk_constraints
from tests.unit.bunking.solver.conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_optimal_or_feasible,
)


def test_group_all_locked_in_different_bunks_is_feasible() -> None:
    """A 2-person friend group where each member is pinned in a DIFFERENT locked bunk.

    Without the fix:
      - Both members are in locked_occupant_idxs → `all(i in locked_occupant_idxs for i in group_indices)`
        is True → the straddle guard is NOT triggered → add_group_lock_constraints applies the
        "stay together" constraint → but each person's locked bunk pin forces them into
        DIFFERENT bunks → contradiction → INFEASIBLE.

    After the fix:
      - The guard also checks whether all locked members share the SAME locked bunk.
        They don't (person A in bunk 2001, person B in bunk 2002) → relax the group →
        FEASIBLE.
    """
    person_a = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="M", grade=5)
    person_b = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="M", grade=5)

    locked_bunk_a = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)
    locked_bunk_b = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=12)

    ctx = build_solver_context(persons=[person_a, person_b], bunks=[locked_bunk_a, locked_bunk_b])

    # Pin each member in a DIFFERENT locked bunk
    ctx.input.locked_bunks = {
        2001: [1001],  # Emma pinned in B-1
        2002: [1002],  # Liam pinned in B-2
    }
    ctx.input.lock_groups_data = {"g1": [1001, 1002]}  # they're in a friend group

    add_locked_bunk_constraints(ctx)
    add_group_lock_constraints(ctx)

    status = cp_model.CpSolver().Solve(ctx.model)
    assert is_optimal_or_feasible(status), (
        f"Expected FEASIBLE but got {status}. "
        "A friend group split across two DIFFERENT locked bunks should be relaxed "
        "(both members are locked, but in different cabins — no 'stay together' is possible)."
    )
