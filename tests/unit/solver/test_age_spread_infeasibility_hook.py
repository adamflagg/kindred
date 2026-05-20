"""Feasibility-warning hook for the now-hard age_spread constraint.

The hard ``MAX_AGE_SPREAD_MONTHS`` ceiling makes one new infeasibility class
possible: a locked group whose members span >24 months in age cannot fit any
non-AG bunk. The generic ``find_infeasibility_cause`` would print
``"The age_spread constraint is causing infeasibility"`` — useful for the
developer, useless for the staff member who needs to split the group or take a
manual override on the bunking board.

This hook pre-empts that generic message with the actionable group + age
spread.
"""

from __future__ import annotations

from bunking.models_v2 import DirectSolverInput

from .impossibility.conftest import make_bunk, make_input, make_person


def _input_with_lock_group(
    *,
    group_id: str,
    member_birthdates: list[str],
) -> DirectSolverInput:
    """Build a minimal solver input with one named lock group."""
    persons = [make_person(cm_id=100 + i, session=1000, birthdate=bd) for i, bd in enumerate(member_birthdates)]
    bunks = [make_bunk(cm_id=10, session=1000)]
    input_data = make_input(persons=persons, bunks=bunks, requests=[])
    input_data.lock_groups_data = {group_id: [p.campminder_person_id for p in persons]}
    return input_data


def test_helper_returns_none_when_no_lock_groups() -> None:
    """No locked groups → no actionable diagnosis (caller falls back to generic)."""
    from bunking.solver.feasibility import _explain_age_spread_infeasibility

    input_data = make_input(
        persons=[make_person(cm_id=1, session=1000)],
        bunks=[make_bunk(cm_id=10, session=1000)],
        requests=[],
    )

    assert _explain_age_spread_infeasibility(input_data) is None


def test_helper_returns_none_when_lock_group_within_limit() -> None:
    """Locked group with members within 24mo of each other is fine."""
    from bunking.solver.feasibility import _explain_age_spread_infeasibility

    # 20mo spread (2014-01-01 vs 2015-09-01)
    input_data = _input_with_lock_group(group_id="g1", member_birthdates=["2014-01-01", "2015-09-01"])

    assert _explain_age_spread_infeasibility(input_data) is None


def test_helper_flags_group_with_25mo_spread() -> None:
    """Locked group spanning >24mo cannot fit any bunk under the hard cap."""
    from bunking.solver.feasibility import _explain_age_spread_infeasibility

    # 25mo spread (2014-01-01 vs 2016-02-01)
    input_data = _input_with_lock_group(group_id="age-mismatch", member_birthdates=["2014-01-01", "2016-02-01"])

    message = _explain_age_spread_infeasibility(input_data)
    assert message is not None
    assert "age-mismatch" in message
    # Action must be named (split or override).
    lower = message.lower()
    assert "split" in lower or "override" in lower


def test_helper_flags_large_group_with_three_year_spread() -> None:
    """A 3-year spread (~36mo) inside a lock group is clearly too wide."""
    from bunking.solver.feasibility import _explain_age_spread_infeasibility

    input_data = _input_with_lock_group(
        group_id="g42",
        member_birthdates=["2013-06-15", "2014-06-15", "2016-06-15"],
    )

    message = _explain_age_spread_infeasibility(input_data)
    assert message is not None
    assert "g42" in message


def test_message_names_the_age_limit_concretely() -> None:
    """The actionable message must surface the 24mo limit so staff know what
    threshold they need to fit under (or override)."""
    from bunking.solver import feasibility as fmod

    input_data = _input_with_lock_group(group_id="cabin-buddies", member_birthdates=["2014-01-01", "2016-06-01"])
    message = fmod._explain_age_spread_infeasibility(input_data)
    assert message is not None
    assert "cabin-buddies" in message
    assert "24" in message
    assert "month" in message.lower()
