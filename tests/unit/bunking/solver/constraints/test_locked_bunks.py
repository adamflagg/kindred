from ortools.sat.python import cp_model

from bunking.solver.constraints.locked_bunks import add_locked_bunk_constraints

from ..conftest import build_solver_context, create_bunk, create_person, is_optimal_or_feasible


def test_locked_occupants_pinned_and_others_excluded():
    # 3 campers, 2 male bunks. Lock bunk 2001 with camper 1001 in it.
    campers = [
        create_person(cm_id=1000 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
        for i in range(1, 4)
    ]  # 1001, 1002, 1003
    locked = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)
    free = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=12)

    ctx = build_solver_context(persons=campers, bunks=[locked, free])
    ctx.input.locked_bunks = {2001: [1001]}

    add_locked_bunk_constraints(ctx)

    solver = cp_model.CpSolver()
    status = solver.Solve(ctx.model)
    assert is_optimal_or_feasible(status)

    locked_idx = ctx.bunk_idx_map[2001]
    # 1001 pinned into locked bunk
    assert solver.Value(ctx.assignments[(ctx.person_idx_map[1001], locked_idx)]) == 1
    # 1002 and 1003 cannot be in the locked bunk
    assert solver.Value(ctx.assignments[(ctx.person_idx_map[1002], locked_idx)]) == 0
    assert solver.Value(ctx.assignments[(ctx.person_idx_map[1003], locked_idx)]) == 0
