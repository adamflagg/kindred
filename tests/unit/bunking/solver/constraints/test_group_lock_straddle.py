from ortools.sat.python import cp_model

from bunking.solver.constraints.group_locks import add_group_lock_constraints
from bunking.solver.constraints.locked_bunks import add_locked_bunk_constraints

from ..conftest import build_solver_context, create_bunk, create_person, is_optimal_or_feasible


def test_straddling_group_is_relaxed_not_infeasible():
    # Group {1001, 1002}. 1001 is pinned in locked bunk 2001; 1002 is free.
    # The group's "stay together" lock would force 1002 into 2001 too, but the
    # cabin lock forbids 1002 there -> contradiction. The straddle guard relaxes
    # the group so the model stays FEASIBLE (cabin lock wins; 1002 floats to 2002).
    campers = [
        create_person(cm_id=1000 + i, first_name=f"C{i}", last_name="T", gender="M", grade=5) for i in range(1, 3)
    ]
    locked = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)
    free = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=12)
    ctx = build_solver_context(persons=campers, bunks=[locked, free])
    ctx.input.locked_bunks = {2001: [1001]}
    ctx.input.lock_groups_data = {"g1": [1001, 1002]}  # backing field for ctx.input.group_locks
    add_locked_bunk_constraints(ctx)
    add_group_lock_constraints(ctx)
    # conftest already constrains each camper to exactly one bunk
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))
