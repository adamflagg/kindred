"""ImpossibilityReport.campers_no_resolved_possible — camper-level rollup of
campers whose entire resolved request set is structurally impossible.

Analogous to ``mp_campers_entirely_impossible`` but covers ALL resolved
requests, not just MATERIAL_PARENT. Powers the
``unsatisfied_no_possible`` diagnostic in
``_check_must_satisfy_one_violations``, which must be invariant across
solve outcomes — it counts an input-property fact (the camper has zero
solver-actionable resolved requests), not a post-solve placement fact.
"""

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_camper_with_all_resolved_requests_impossible_is_listed(mock_config):
    """A camper whose every resolved request is impossible appears in the rollup,
    regardless of the request bucket (MATERIAL_PARENT or STAFF)."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    # STAFF-source request to an absent target -> impossible (target_not_in_solver).
    requests = [
        make_request("r1", requester=1, requestee=777, source_field="bunking_notes", session=1000001),
    ]
    input_data = make_input([p1], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    entries = report.campers_no_resolved_possible
    assert len(entries) == 1
    assert entries[0]["cm_id"] == 1
    assert entries[0]["name"]  # non-empty display name


def test_camper_with_at_least_one_possible_resolved_request_is_not_listed(mock_config):
    """If any resolved request is possible, the camper is solver-actionable
    and must NOT appear, even if other resolved requests are impossible."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [
        make_request("r_ok", requester=1, requestee=2, session=1000001),  # possible
        make_request("r_bad", requester=1, requestee=777, session=1000001),  # impossible
    ]
    input_data = make_input([p1, p2], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    assert report.campers_no_resolved_possible == []


def test_camper_with_only_impossible_mp_requests_is_listed(mock_config):
    """A camper with only MATERIAL_PARENT requests, all impossible, appears in
    BOTH rollups — mp_campers_entirely_impossible (MP subset) AND
    campers_no_resolved_possible (entire resolved set)."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [make_request("r1", requester=1, requestee=777, session=1000001)]
    input_data = make_input([p1], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    assert len(report.mp_campers_entirely_impossible) == 1
    assert len(report.campers_no_resolved_possible) == 1
    assert report.campers_no_resolved_possible[0]["cm_id"] == 1


def test_camper_with_only_pending_requests_is_not_listed(mock_config):
    """A camper whose only requests are pending/declined has no resolved set —
    they are not 'no_possible'; the diagnostic ignores non-resolved requests."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    pending_request = make_request("r1", requester=1, requestee=777, session=1000001)
    pending_request.status = "pending"
    input_data = make_input([p1], bunks, [pending_request])

    report = validate_impossibility(input_data, mock_config)

    assert report.campers_no_resolved_possible == []


def test_camper_with_no_requests_is_not_listed(mock_config):
    """A camper with no requests at all is not 'no_possible'."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    input_data = make_input([p1], bunks, [])

    report = validate_impossibility(input_data, mock_config)

    assert report.campers_no_resolved_possible == []
