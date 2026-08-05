"""The merge write refuses outside a scenario."""

import pytest
from pydantic import ValidationError

from api.schemas.lodging import SlotMergeRequest


def test_scenario_is_required() -> None:
    # The mirror is never overridable. The schema refuses before the service
    # is reached, so there is no path that writes a scenario-less override.
    with pytest.raises(ValidationError):
        SlotMergeRequest(year=2026, session_cm_id=1309514, scenario="", unit_id="rec1", combined=True)


def test_session_cm_id_must_be_positive() -> None:
    # The board defaults sessionCmId to 0 for tests that do not exercise
    # writes; 0 must never reach the database.
    with pytest.raises(ValidationError):
        SlotMergeRequest(year=2026, session_cm_id=0, scenario="scn1", unit_id="rec1", combined=True)


def test_a_valid_request_builds() -> None:
    request = SlotMergeRequest(year=2026, session_cm_id=1309514, scenario="scn1", unit_id="rec1", combined=False)
    assert request.combined is False
