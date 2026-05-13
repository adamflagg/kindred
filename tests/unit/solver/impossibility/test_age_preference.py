"""AgePreferenceImpossibility: requests at pool grade bounds are impossible."""

from __future__ import annotations

from bunking.solver.constraints.age_preference import AgePreferenceImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = AgePreferenceImpossibility()


def test_older_preference_at_max_grade_is_impossible(mock_config):
    """Camper at the highest grade wants 'older' but no older grade exists in the pool."""
    p_at_max = make_person(1, session=100, gender="F", grade=10)
    p_other = make_person(2, session=100, gender="F", grade=8)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input([p_at_max, p_other], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"
    assert reason.detail["direction"] == "older"


def test_younger_preference_at_min_grade_is_impossible(mock_config):
    p_at_min = make_person(1, session=100, gender="F", grade=3)
    p_other = make_person(2, session=100, gender="F", grade=5)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([p_at_min, p_other], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"
    assert reason.detail["direction"] == "younger"


def test_older_preference_with_older_peer_is_not_impossible(mock_config):
    p_mid = make_person(1, session=100, gender="F", grade=5)
    p_older = make_person(2, session=100, gender="F", grade=8)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input([p_mid, p_older], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_age_pref_same_gender_only(mock_config):
    """Older peers of opposite gender don't satisfy the preference."""
    p_at_max = make_person(1, session=100, gender="F", grade=10)
    p_higher_other_gender = make_person(2, session=100, gender="M", grade=12)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input(
        [p_at_max, p_higher_other_gender],
        [make_bunk(10, session=100, gender="F"), make_bunk(11, session=100, gender="M")],
        [req],
    )
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None  # M grade-12 doesn't count for F grade-10 camper
