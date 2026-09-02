"""Requester fallback shape for an off-roster requester — kindred#2689.

``_record_item`` looks up the requester in ``ctx.person_by_cm_id`` fresh, even
when the predicate that flagged the request (e.g. ``MalformedRequestImpossibility``)
doesn't itself require the requester to be on the roster. When the requester
isn't found, the recorded item falls back to a one-key dict
(``{"cm_id": ...}``) instead of the five-key ``_camper_dict`` shape. This test
locks in that shape so a change to the fallback — widening it, or replacing it
with something else — is a deliberate, visible diff here rather than a silent
drift the frontend has to guess at.
"""

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_request


def test_off_roster_requester_yields_one_key_requester_dict(mock_config):
    """A malformed bunk_with from a requester who isn't in the persons list
    (e.g. a request surviving a camper's removal from the solver's roster)
    is still recorded — MalformedRequestImpossibility doesn't require the
    requester to be on the roster — but ``requester`` is the one-key
    fallback, not the full camper dict.
    """
    # cm_id 999 is intentionally absent from the persons list passed to make_input.
    req = make_request("r1", requester=999, requestee=None, request_type="bunk_with", session=100)
    input_data = make_input([], [make_bunk(10, session=100)], [req])

    report = validate_impossibility(input_data, mock_config)

    assert len(report.flat) == 1
    item = report.flat[0]
    assert item.reason_code == "malformed"
    assert item.requester == {"cm_id": 999}
    assert set(item.requester.keys()) == {"cm_id"}


def test_on_roster_requester_yields_full_camper_dict(mock_config):
    """Contrast case: when the requester IS on the roster, the recorded item
    gets the full five-key ``_camper_dict`` shape, not the fallback.
    """
    from .conftest import make_person

    p1 = make_person(1, session=100, gender="F", grade=6)
    req = make_request("r1", requester=1, requestee=None, request_type="bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])

    report = validate_impossibility(input_data, mock_config)

    assert len(report.flat) == 1
    item = report.flat[0]
    assert item.reason_code == "malformed"
    assert set(item.requester.keys()) == {"cm_id", "name", "grade", "gender", "session_cm_id"}
