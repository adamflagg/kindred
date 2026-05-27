"""Hard staff/manual not_bunk_with separation (#1541)."""

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.constraints.base import SolverContext
from tests.unit.bunking.solver.conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_infeasible,
    is_optimal_or_feasible,
)


def _nbw(request_id: str, requester: int, requested: int | None, source_field: str) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type="not_bunk_with",
        session_cm_id=1000,
        year=2025,
        source_field=source_field,
        confidence_score=1.0,
        status="resolved",
    )


def _bunk_with(request_id: str, requester: int, requested: int, source_field: str) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type="bunk_with",
        session_cm_id=1000,
        year=2025,
        source_field=source_field,
        confidence_score=1.0,
        status="resolved",
    )


def _two_girls_two_bunks(requests: list[DirectBunkRequest], debug: dict[str, bool] | None = None) -> SolverContext:
    return build_solver_context(
        persons=[
            create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5),
            create_person(cm_id=200, first_name="Liam", last_name="Garcia", gender="F", grade=5),
        ],
        bunks=[
            create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12),
            create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12),
        ],
        requests=requests,
        debug_constraints=debug,
    )


def _force_together(ctx: SolverContext, cm_a: int, cm_b: int, bunk_idx: int = 0) -> None:
    a = ctx.person_idx_map[cm_a]
    b = ctx.person_idx_map[cm_b]
    ctx.model.Add(ctx.assignments[(a, bunk_idx)] == 1)
    ctx.model.Add(ctx.assignments[(b, bunk_idx)] == 1)


def test_staff_not_bunk_with_forces_separation():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks([_nbw("n1", 100, 200, "staff_not_bunk_with")])
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))


def test_manual_not_bunk_with_forces_separation():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks([_nbw("n1", 100, 200, "manual")])
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))


def test_parent_not_bunk_with_not_forced():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    # bunk_request_form NBW is HARD_MSO, not HARD_MNT — staff_separation ignores it.
    ctx = _two_girls_two_bunks([_nbw("n1", 100, 200, "bunk_request_form")])
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))


def test_notes_not_bunk_with_not_forced():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks([_nbw("n1", 100, 200, "bunking_notes")])
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))


def test_target_not_in_roster_no_constraint():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = build_solver_context(
        persons=[create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5)],
        bunks=[
            create_bunk(cm_id=2001, name="G-1", gender="F"),
            create_bunk(cm_id=2002, name="G-2", gender="F"),
        ],
        requests=[_nbw("n1", 100, 999, "staff_not_bunk_with")],  # 999 not in roster
    )
    add_staff_separation_constraints(ctx)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))


def test_disabled_via_debug():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks([_nbw("n1", 100, 200, "staff_not_bunk_with")], debug={"staff_separation": True})
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))


def test_carveout_yields_when_positive_requester_has_one_mp():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    # Liam (200) parents request only "bunk with Emma" → his SOLE MP request.
    ctx = _two_girls_two_bunks(
        [
            _nbw("n1", 100, 200, "staff_not_bunk_with"),
            _bunk_with("p1", 200, 100, "bunk_request_form"),
        ]
    )
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)  # carve-out → no hard separation → together is feasible
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))
    assert len(ctx.staff_nbw_yields) == 1
    y = ctx.staff_nbw_yields[0]
    assert y["nbw_request_id"] == "n1"
    assert y["protected_parent_request_id"] == "p1"
    assert y["protected_camper_cm"] == 200


def test_carveout_holds_when_positive_requester_has_multiple_mp():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    # Liam (200) has TWO MP requests → MSO met via Noah, so the staff NBW holds.
    ctx = build_solver_context(
        persons=[
            create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5),
            create_person(cm_id=200, first_name="Liam", last_name="Garcia", gender="F", grade=5),
            create_person(cm_id=300, first_name="Noah", last_name="Chen", gender="F", grade=5),
        ],
        bunks=[create_bunk(cm_id=2001, name="G-1", gender="F"), create_bunk(cm_id=2002, name="G-2", gender="F")],
        requests=[
            _nbw("n1", 100, 200, "staff_not_bunk_with"),
            _bunk_with("p1", 200, 100, "bunk_request_form"),
            _bunk_with("p2", 200, 300, "bunk_request_form"),
        ],
    )
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))
    assert ctx.staff_nbw_yields == []


def test_carveout_covers_both_directions():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    # The NBW subject's own family wants the target — Emma (100) sole MP toward Liam.
    ctx = _two_girls_two_bunks(
        [
            _nbw("n1", 100, 200, "staff_not_bunk_with"),
            _bunk_with("p1", 100, 200, "bunk_request_form"),
        ]
    )
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))
    assert ctx.staff_nbw_yields[0]["protected_camper_cm"] == 100


def test_carveout_requires_material_parent_positive():
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    # A bunking_notes (STAFF, non-MP) bunk_with does NOT trigger the carve-out.
    ctx = _two_girls_two_bunks(
        [
            _nbw("n1", 100, 200, "staff_not_bunk_with"),
            _bunk_with("p1", 200, 100, "bunking_notes"),
        ]
    )
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))
    assert ctx.staff_nbw_yields == []


def _age_pref(request_id: str, requester: int, source_field: str = "bunk_request_form") -> DirectBunkRequest:
    """Create an age_preference request (no requestee)."""
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=None,
        request_type="age_preference",
        session_cm_id=1000,
        year=2025,
        source_field=source_field,
        confidence_score=1.0,
        status="resolved",
    )


def test_parent_and_staff_nbw_coexist_separation_still_hard():
    """Post-fix deduped shape: a parent HARD_MSO NBW and a staff HARD_MNT NBW for
    the SAME pair both survive. The staff row must still force separation."""
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks(
        [
            _nbw("n_parent", 100, 200, "bunk_request_form"),
            _nbw("n_staff", 100, 200, "staff_not_bunk_with"),
        ]
    )
    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))


def test_carveout_fires_when_sole_real_mp_is_bunk_with_and_age_pref_suppressed():
    """#1664: suppressed form age_preference does NOT inflate _possible_mp_count.

    Liam (200) has:
      - a bunk_request_form bunk_with toward Emma (100)  → material, mp_count = 1
      - a bunk_request_form age_preference               → suppressed by #1664 (real form BW present)

    After migration, _possible_mp_count(ctx, 200) == 1, so the MSO-protection
    carve-out fires and the staff not_bunk_with yields.

    Before migration (using is_material_parent_request directly), the age_pref
    would also be counted → mp_count == 2 → no yield.
    """
    from bunking.solver.constraints.staff_separation import add_staff_separation_constraints

    ctx = _two_girls_two_bunks(
        [
            _nbw("n1", 100, 200, "staff_not_bunk_with"),
            _bunk_with("p1", 200, 100, "bunk_request_form"),
            _age_pref("a1", 200),  # suppressed by #1664 → not in material_request_ids
        ]
    )
    # Verify suppression: age_pref not in material set, bunk_with is.
    assert "p1" in ctx.material_request_ids
    assert "a1" not in ctx.material_request_ids

    add_staff_separation_constraints(ctx)
    _force_together(ctx, 100, 200)
    assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))
    assert len(ctx.staff_nbw_yields) == 1
    y = ctx.staff_nbw_yields[0]
    assert y["nbw_request_id"] == "n1"
    assert y["protected_parent_request_id"] == "p1"
    assert y["protected_camper_cm"] == 200
