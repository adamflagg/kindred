"""ImpossibilityReport.mp_campers_entirely_impossible — camper-level MP rollup."""

from bunking.solver.impossibility import _camper_dict, validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_camper_dict_includes_session_cm_id() -> None:
    """Multi-enrollment dedup on the frontend depends on session_cm_id being
    present in mp_campers_entirely_impossible entries."""
    person = make_person(1, session=1000001, gender="F", grade=4)
    result = _camper_dict(person)
    assert result["session_cm_id"] == 1000001
    # Existing fields preserved
    assert result["cm_id"] == 1
    assert result["name"]  # non-empty display name
    assert result["grade"] == 4
    assert result["gender"] == "F"


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


def test_age_pref_suppressed_with_possible_bunk_with_not_entirely_impossible(mock_config):
    """A camper with a suppressed age_preference + a POSSIBLE bunk_with is NOT
    in mp_campers_entirely_impossible.

    #1664 suppression: when a bunk_request_form age_preference is contextually
    suppressed (requester also has a resolved-possible bunk_request_form bunk_with),
    the rollup must use the contextual material set — not is_material_parent_request.

    Both before and after migration the bunk_with is possible, so the all-impossible
    check fails and the camper is correctly NOT listed. This locks the baseline.
    """
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000001, gender="F", grade=6)  # possible bunk_with target
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [
        make_request("bw1", requester=1, requestee=2, session=1000001),  # possible bunk_with
        make_request(
            "ap1",
            requester=1,
            requestee=None,
            request_type="age_preference",
            source_field="bunk_request_form",
            age_preference_target="older",
            session=1000001,
        ),
    ]
    input_data = make_input([p1, p2], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    # bw1 is possible → age_pref is suppressed → material set = {bw1}
    # bw1 is possible → camper is NOT entirely impossible
    assert report.mp_campers_entirely_impossible == []


def test_age_pref_not_suppressed_when_bunk_with_impossible_camper_is_entirely_impossible(mock_config):
    """A camper whose ONLY bunk_with is impossible and also has an impossible age_pref
    IS in mp_campers_entirely_impossible.

    When the bunk_with is impossible, the suppression gate does not fire → the
    age_pref remains in the material set. Both requests are impossible → camper IS
    entirely impossible.

    Pre-migration: is_material_parent_request sees both as material (same result).
    Post-migration: compute_material_request_ids sees no possible bunk_with →
    suppression does not apply → both remain material → same result.

    This test guards the invariant; it should pass both before and after migration.
    """
    # grade=6 at the top of a session that has only one girl → no older F peers → age_pref impossible
    p1 = make_person(1, session=1000001, gender="F", grade=6)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [
        make_request("bw_imp", requester=1, requestee=777, session=1000001),  # impossible: target_not_in_solver
        make_request(
            "ap_imp",
            requester=1,
            requestee=None,
            request_type="age_preference",
            source_field="bunk_request_form",
            age_preference_target="older",
            session=1000001,
        ),
    ]
    input_data = make_input([p1], bunks, requests)

    report = validate_impossibility(input_data, mock_config)

    # bw_imp impossible → suppression gate inactive → age_pref is material
    # age_pref impossible (grade=6 → no older F) → both impossible → listed
    entries = report.mp_campers_entirely_impossible
    assert len(entries) == 1
    assert entries[0]["cm_id"] == 1
