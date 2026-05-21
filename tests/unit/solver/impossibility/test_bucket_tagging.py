"""ImpossibleItem.bucket — classification from source_field."""

import logging

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_bunk_with_source_field_classifies_as_material_parent(mock_config):
    """A request with source_field='bunk_request_form' → bucket='material_parent'."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000002, gender="F", grade=5)  # different session
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req = make_request("r1", requester=1, requestee=2, source_field="bunk_request_form")
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    assert len(report.flat) == 1
    assert report.flat[0].bucket == "material_parent"


def test_socialize_with_source_field_classifies_as_immaterial_parent(mock_config):
    """source_field='socialize_with' → bucket='immaterial_parent'."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000002, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req = make_request(
        "r1",
        requester=1,
        requestee=2,
        request_type="bunk_with",
        source_field="socialize_with",
    )
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    assert len(report.flat) == 1
    assert report.flat[0].bucket == "immaterial_parent"


def test_not_bunk_with_source_field_classifies_as_staff(mock_config):
    """source_field='staff_not_bunk_with' → bucket='staff'.

    Uses a self-conflict scenario (bunk_with + not_bunk_with to the same target)
    to trigger impossibility for the not_bunk_with request.
    """
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000001, gender="F", grade=5)  # same session
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req_bunk_with = make_request(
        "r1",
        requester=1,
        requestee=2,
        request_type="bunk_with",
        source_field="bunk_request_form",
    )
    req_not_bunk_with = make_request(
        "r2",
        requester=1,
        requestee=2,
        request_type="not_bunk_with",
        source_field="staff_not_bunk_with",
    )
    inp = make_input([p1, p2], bunks, [req_bunk_with, req_not_bunk_with])

    report = validate_impossibility(inp, mock_config)
    # Both requests are flagged as impossible (self_conflict).
    nbw_items = [item for item in report.flat if item.request_id == "r2"]
    assert len(nbw_items) == 1
    assert nbw_items[0].bucket == "staff"


def test_missing_source_field_yields_bucket_none(mock_config):
    """Empty source_field → bucket=None, no raise.

    Empty string short-circuits the `if req.source_field:` guard in
    `_record_item` — no `classify_request` call, no debug log.
    """
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000002, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req = make_request("r1", requester=1, requestee=2, source_field="")
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    assert len(report.flat) == 1
    assert report.flat[0].bucket is None


def test_unknown_source_field_yields_bucket_none(mock_config, caplog):
    """Bogus source_field value → bucket=None, debug log emitted, no raise."""
    caplog.set_level(logging.DEBUG, logger="bunking.solver.impossibility")
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000002, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    req = make_request(
        "r1",
        requester=1,
        requestee=2,
        source_field="totally_made_up_value",
    )
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    assert len(report.flat) == 1
    assert report.flat[0].bucket is None
    assert "impossibility: unknown source_field" in caplog.text
    # Per the repo logging contract (CLAUDE.md): "Format log messages as ... key=value".
    # Assert structured key=value pairs rather than prose interpolation.
    assert "source_field='totally_made_up_value'" in caplog.text
    assert "request_id='r1'" in caplog.text
