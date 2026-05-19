"""ImpossibilityReport.mp_campers_entirely_impossible — camper-level MP rollup."""

from __future__ import annotations

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_camper_with_all_mp_requests_impossible_is_listed(mock_config):
    """A camper whose every MP request is impossible appears in the rollup,
    with the distinct reason codes that hit their MP requests."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    # Camper 1's only MP request (source_field=bunk_request_form -> MATERIAL_PARENT
    # bucket) targets cm_id 777, absent from the roster -> target_not_in_solver.
    requests = [make_request("r1", requester=1, requestee=777, session=1000001)]
    input_data = make_input([p1], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    entries = report.mp_campers_entirely_impossible
    assert len(entries) == 1
    assert entries[0]["cm_id"] == 1
    assert entries[0]["name"]  # non-empty display name
    assert entries[0]["reason_codes"] == ["target_not_in_solver"]


def test_camper_with_one_possible_mp_request_is_not_listed(mock_config):
    """If at least one MP request is possible, the camper is solver-actionable
    and must NOT appear in the rollup."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [
        make_request("r_ok", requester=1, requestee=2, session=1000001),  # possible
        make_request("r_bad", requester=1, requestee=777, session=1000001),  # impossible
    ]
    input_data = make_input([p1, p2], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    assert report.mp_campers_entirely_impossible == []


def test_camper_with_no_mp_requests_is_not_listed(mock_config):
    """A camper with no MP requests at all is not 'entirely impossible'."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    # source_field="bunking_notes" -> STAFF bucket, NOT material-parent.
    requests = [
        make_request("r1", requester=1, requestee=777, source_field="bunking_notes", session=1000001),
    ]
    input_data = make_input([p1], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    assert report.mp_campers_entirely_impossible == []
