"""AgePreferenceImpossibility: requests at pool grade bounds are impossible."""

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


def test_age_pref_skips_check_when_requester_grade_is_unknown(mock_config):
    """grade=0 is the sentinel for 'grade not known yet' (see api/services/data_fetcher.py).

    When the requester has no known grade, we cannot decide impossibility — defer
    to the solver rather than reporting a spurious 'no younger peer' result that
    only fires because 0 happens to be less than every real grade."""
    p_unknown = make_person(1, session=100, gender="F", grade=0)
    p_real = make_person(2, session=100, gender="F", grade=5)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([p_unknown, p_real], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_all_same_grade_pool_wants_younger_is_satisfiable(mock_config):
    """Pool entirely at the requester's grade: an all-equal bunk satisfies
    'younger' per the canonical semantics (has younger OR no older), so the
    pre-check must not flag it (#1752 false positive)."""
    requester = make_person(1, session=100, gender="F", grade=10)
    peers = [make_person(i, session=100, gender="F", grade=10) for i in (2, 3, 4)]
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([requester, *peers], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_all_same_grade_pool_wants_older_is_satisfiable(mock_config):
    """Symmetric to the 'younger' case: all-equal bunk satisfies 'older'
    (has older OR no younger)."""
    requester = make_person(1, session=100, gender="F", grade=6)
    peers = [make_person(i, session=100, gender="F", grade=6) for i in (2, 3)]
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input([requester, *peers], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_same_and_older_pool_wants_younger_fires_with_pool_bounds(mock_config):
    """Same-grade + older peers, no younger: satisfaction depends on landing an
    all-same-grade bunk, so the risk warning stays — and the detail must carry
    BOTH pool bounds so the frontend can describe the pool."""
    requester = make_person(1, session=100, gender="F", grade=10)
    p_same = make_person(2, session=100, gender="F", grade=10)
    p_older = make_person(3, session=100, gender="F", grade=11)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([requester, p_same, p_older], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"
    assert reason.detail["pool_min_grade"] == 10
    assert reason.detail["pool_max_grade"] == 11


def test_same_and_younger_pool_wants_older_fires_with_pool_bounds(mock_config):
    """Mirror of the younger risk case: same-grade + younger peers, no older."""
    requester = make_person(1, session=100, gender="F", grade=5)
    p_same = make_person(2, session=100, gender="F", grade=5)
    p_younger = make_person(3, session=100, gender="F", grade=4)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input([requester, p_same, p_younger], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"
    assert reason.detail["pool_min_grade"] == 4
    assert reason.detail["pool_max_grade"] == 5


def test_all_strictly_older_pool_wants_younger_still_fires(mock_config):
    """Every peer strictly older: genuinely impossible (any bunk has older,
    none younger) — the warning must survive the boundary fix."""
    requester = make_person(1, session=100, gender="F", grade=9)
    peers = [make_person(i, session=100, gender="F", grade=10) for i in (2, 3)]
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([requester, *peers], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"


def test_ag_session_skips_age_preference_check(mock_config):
    """AG cabin membership is enrollment-driven — everyone in the AG session
    lands in its cabin, so placement-derived pre-checks don't apply (#1752).
    Mirrors the is_ag_session_bunk skips in grade_spread/grade_ratio/
    cabin_occupancy."""
    requester = make_person(1, session=100, gender="F", grade=10)
    p_same = make_person(2, session=100, gender="F", grade=10)
    p_older = make_person(3, session=100, gender="F", grade=11)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    ag_bunk = make_bunk(10, session=100, gender="AG", name="AG Cabin 3")
    input_data = make_input([requester, p_same, p_older], [ag_bunk], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_multi_bunk_ag_session_skips_age_preference_check(mock_config):
    """A single AG session can carry several AG cabins (#1800's plan-level
    pairing) — the skip is session-typed, not cabin-counted, because AG
    placement is enrollment-driven either way."""
    requester = make_person(1, session=100, gender="F", grade=10)
    p_same = make_person(2, session=100, gender="F", grade=10)
    p_older = make_person(3, session=100, gender="F", grade=11)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    ag_bunks = [
        make_bunk(10, session=100, gender="AG", name="AG Cabin 3"),
        make_bunk(20, session=100, gender="AG", name="AG Cabin 4"),
    ]
    input_data = make_input([requester, p_same, p_older], ag_bunks, [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_age_pref_ignores_peers_with_unknown_grade(mock_config):
    """Peers whose grade is 0 (unknown) should not be treated as 'younger than everyone'."""
    requester = make_person(1, session=100, gender="F", grade=5)
    p_unknown = make_person(2, session=100, gender="F", grade=0)  # would be 'younger' if counted
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="younger",
        session=100,
    )
    input_data = make_input([requester, p_unknown], [make_bunk(10, session=100, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    # After filtering unknown-grade peers, no eligible same-gender peer remains —
    # the constraint should report impossible for that reason, not silently
    # treat grade=0 as a valid 'younger' partner.
    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "age_pref_no_eligible_grade"
