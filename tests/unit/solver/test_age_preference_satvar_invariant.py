"""Pins the invariant that makes the per-bunk satvar loop branchless.

`_create_age_preference_satisfaction_var` walks every bunk and builds the
`bad_grade_present_vars` list via:

    [bunk_has_grade[(bunk_idx, bad_grade)] for bad_grade in bad_grades]

Without a guard, this list can only become empty if `bunk_has_grade` is
sparse on `(bunk_idx, bad_grade)` keys. `_build_bunk_has_grade_vars`
guarantees it is NOT sparse: it cross-products every bunk with every grade
that appears in the roster, and `bad_grades` is by construction a subset
of those roster grades. So the per-bunk loop never observes an empty list.

If this test ever fails, `bunk_has_grade` has become sparse and any code
that iterates `bad_grades` against it must guard against an empty result.
At the time this test was added (issue #1467), the empty-list guard had
already been deleted from `_create_age_preference_satisfaction_var` because
this invariant was always true. Restore the guard and add coverage for
the sparse case before merging the sparsifying change.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from bunking.solver.constraints.age_preference import _build_bunk_has_grade_vars
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.impossibility.conftest import make_bunk, make_input, make_person


def test_bunk_has_grade_is_dense_over_roster_grades_and_bunks() -> None:
    persons = [
        make_person(1, session=1000, gender="F", grade=4),
        make_person(2, session=1000, gender="F", grade=5),
        make_person(3, session=1000, gender="F", grade=6),
        make_person(4, session=1000, gender="F", grade=6),  # duplicate grade
        make_person(5, session=1000, gender="F", grade=7),
    ]
    bunks = [
        make_bunk(100, session=1000, gender="F"),
        make_bunk(200, session=1000, gender="F"),
        make_bunk(300, session=1000, gender="F"),
    ]
    solver = DirectBunkingSolver(make_input(persons, bunks, []), config_service=MagicMock())
    ctx = solver._build_solver_context()

    bunk_has_grade = _build_bunk_has_grade_vars(ctx)

    roster_grades = {p.grade for p in persons}
    expected_keys = {(b_idx, g) for b_idx in range(len(bunks)) for g in roster_grades}
    assert set(bunk_has_grade.keys()) == expected_keys
