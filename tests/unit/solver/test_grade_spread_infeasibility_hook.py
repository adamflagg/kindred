"""Feasibility-warning hook for the now-hard grade_spread constraint.

The hard 2-grade ceiling makes one new infeasibility class possible: a locked
group whose members span more than ``MAX_UNIQUE_GRADES_PER_BUNK`` unique
grades cannot fit in any bunk. The generic ``find_infeasibility_cause`` would
print ``"The grade_spread constraint is causing infeasibility"`` — useful for
the developer, useless for the staff member who needs to split the group or
take a manual override on the bunking board.

This hook pre-empts that generic message with the actionable grade list.
"""

from bunking.models_v2 import DirectSolverInput

from .impossibility.conftest import make_bunk, make_input, make_person


def _input_with_lock_group(
    *,
    group_id: str,
    member_grades: list[int],
    other_grades: list[int] | None = None,
) -> DirectSolverInput:
    """Build a minimal solver input with one named lock group."""
    persons = [make_person(cm_id=100 + i, session=1000, grade=g) for i, g in enumerate(member_grades)]
    extra = other_grades or []
    persons.extend(make_person(cm_id=200 + i, session=1000, grade=g) for i, g in enumerate(extra))
    bunks = [make_bunk(cm_id=10, session=1000)]
    input_data = make_input(persons=persons, bunks=bunks, requests=[])
    # group_locks is a property over lock_groups_data
    input_data.lock_groups_data = {group_id: [p.campminder_person_id for p in persons[: len(member_grades)]]}
    return input_data


def test_helper_returns_none_when_no_lock_groups() -> None:
    """No locked groups → no actionable diagnosis (caller falls back to generic)."""
    from bunking.solver.feasibility import _explain_grade_spread_infeasibility

    input_data = make_input(
        persons=[make_person(cm_id=1, session=1000, grade=5)],
        bunks=[make_bunk(cm_id=10, session=1000)],
        requests=[],
    )

    assert _explain_grade_spread_infeasibility(input_data) is None


def test_helper_returns_none_when_lock_group_within_limit() -> None:
    """Locked group spanning 2 grades is allowed; no warning."""
    from bunking.solver.feasibility import _explain_grade_spread_infeasibility

    input_data = _input_with_lock_group(group_id="g1", member_grades=[5, 5, 6])

    assert _explain_grade_spread_infeasibility(input_data) is None


def test_helper_flags_three_grade_lock_group() -> None:
    """Locked group spanning 3+ grades cannot fit any bunk under the 2-grade limit."""
    from bunking.solver.feasibility import _explain_grade_spread_infeasibility

    input_data = _input_with_lock_group(group_id="seven-siblings", member_grades=[5, 6, 7])

    message = _explain_grade_spread_infeasibility(input_data)
    assert message is not None
    assert "seven-siblings" in message
    # Grade list must surface in the message — staff need to see which grades.
    for grade in ("5", "6", "7"):
        assert grade in message
    # Action must be named (split or override).
    lower = message.lower()
    assert "split" in lower or "override" in lower


def test_helper_flags_four_grade_lock_group_with_gap() -> None:
    """Non-consecutive grades still count as distinct unique grades."""
    from bunking.solver.feasibility import _explain_grade_spread_infeasibility

    input_data = _input_with_lock_group(group_id="g42", member_grades=[4, 5, 7, 8])

    message = _explain_grade_spread_infeasibility(input_data)
    assert message is not None
    assert "g42" in message


def test_message_names_the_grade_limit_concretely() -> None:
    """The actionable message must surface the 2-grade limit so staff know the
    next action is split-or-override, not "what does '2-grade' mean"."""
    from bunking.solver import feasibility as fmod

    input_data = _input_with_lock_group(group_id="cabin-buddies", member_grades=[4, 5, 6])
    message = fmod._explain_grade_spread_infeasibility(input_data)
    assert message is not None
    assert "cabin-buddies" in message
    assert "2-grade" in message or "2 unique" in message or "two unique" in message.lower()


def test_hook_has_no_dead_grade_none_guard() -> None:
    """``DirectPerson.grade: int`` is non-Optional — the ``is not None`` guard
    in the lock-group grade comprehension is unreachable dead code."""
    import inspect

    from bunking.solver.feasibility import _explain_grade_spread_infeasibility

    source = inspect.getsource(_explain_grade_spread_infeasibility)
    assert ".grade is not None" not in source, (
        "DirectPerson.grade is typed `int` (non-Optional). The `is not None` "
        "guard in the locked-group grade set comprehension is unreachable; "
        "remove it."
    )
