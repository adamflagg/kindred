from tests.unit.bunking.solver.conftest import build_solver_context, create_bunk, create_person


def test_context_has_empty_staff_nbw_fields_by_default():
    ctx = build_solver_context(
        persons=[create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5)],
        bunks=[create_bunk(cm_id=2001, name="G-1", gender="F")],
    )
    assert ctx.staff_nbw_yields == []
    assert ctx.staff_nbw_skip_pairs == set()
