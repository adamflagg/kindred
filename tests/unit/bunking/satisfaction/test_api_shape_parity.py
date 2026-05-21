"""Snapshot test: Python SatisfactionResponse JSON shape matches the captured fixture.

This guards against drift between bunking/satisfaction/api_shape.py (Python) and
frontend/src/types/satisfaction.ts (TypeScript). If this test fails, the TS types
must be updated to match the new Python shape (or vice versa, if the Python change
was unintentional).

To recapture after an intentional shape change:
    RECAPTURE=1 uv run pytest tests/unit/bunking/satisfaction/test_api_shape_parity.py
"""

import json
import os
from pathlib import Path

import pytest

from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import RequestBucket

# Co-located in baselines/ (gitignore explicitly excepts *.json in this dir).
# __file__ is tests/unit/bunking/satisfaction/test_api_shape_parity.py
SHAPE_FIXTURE = Path(__file__).parent / "baselines" / "satisfaction_api_shape.json"


def _sample_response() -> SatisfactionResponse:
    return SatisfactionResponse(
        campers={
            1: CamperSatisfaction(
                person_cm_id=1,
                per_request=[
                    PerRequestStatus(
                        request_id="r1",
                        bucket=RequestBucket.MATERIAL_PARENT,
                        satisfied=True,
                    )
                ],
                counted_totals={
                    RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=1, total=1),
                    RequestBucket.STAFF: BucketCount(satisfied=0, total=0),
                },
                immaterial=BucketCount(satisfied=0, total=0),
                flags=SatisfactionFlags(
                    parent_min_one_violation=False,
                    staff_unsatisfied_alert=False,
                    has_any_counted_request=True,
                ),
            )
        },
        session_cm_id=5,
        year=2026,
        scenario_id=None,
    )


def _key_skeleton(o: object) -> object:
    """Return a structure-only view: keys preserved, leaf values replaced with type names."""
    if isinstance(o, dict):
        return {k: _key_skeleton(v) for k, v in sorted(o.items())}
    if isinstance(o, list):
        return [_key_skeleton(o[0])] if o else []
    return type(o).__name__


def test_satisfaction_response_shape_matches_fixture() -> None:
    """Key skeleton of the serialised response must match the captured fixture."""
    actual = json.loads(_sample_response().model_dump_json())
    recapture = os.environ.get("RECAPTURE") == "1"

    # Finding #17: previously, RECAPTURE=1 only wrote the fixture when it didn't
    # already exist — but the failure message ("re-run with RECAPTURE=1 to update")
    # implied otherwise. Now RECAPTURE=1 always writes, so the user-facing
    # contract matches the implementation.
    if recapture:
        SHAPE_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        SHAPE_FIXTURE.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
        pytest.skip(f"captured parity fixture (RECAPTURE=1) at {SHAPE_FIXTURE}")

    if not SHAPE_FIXTURE.exists():
        pytest.fail(f"missing fixture {SHAPE_FIXTURE}; run with RECAPTURE=1 to create it")

    expected = json.loads(SHAPE_FIXTURE.read_text())
    assert _key_skeleton(actual) == _key_skeleton(expected), (
        "SatisfactionResponse JSON shape has drifted from the captured fixture. "
        "Update frontend/src/types/satisfaction.ts to match, then re-run with "
        "RECAPTURE=1 to update the fixture."
    )
