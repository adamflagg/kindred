"""ImpossibilityReport.affected_campers — count unique requester cm_ids."""

from __future__ import annotations

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_affected_campers_counts_cm_id_zero(mock_config):
    """cm_id=0 is a valid identifier and must be counted, not silently dropped.

    The historical truthiness filter (``if item.requester.get("cm_id")``) silently
    excluded campers whose cm_id resolved to 0. Tighten to ``is not None``.
    """
    p1 = make_person(0, session=1000001, gender="F", grade=5)
    p2 = make_person(1, session=1000002, gender="F", grade=5)  # different session
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req = make_request("r1", requester=0, requestee=1, source_field="bunk_with")
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    assert len(report.flat) == 1
    assert report.flat[0].requester["cm_id"] == 0
    assert report.affected_campers == 1
