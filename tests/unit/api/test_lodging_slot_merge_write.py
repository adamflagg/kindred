"""The merge write is legal both inside a scenario and at the weekend level.

`test_scenario_is_required` used to pin the opposite: the schema refused a
blank `scenario` because the CampMinder mirror was never supposed to be
overridable, and the collection's `scenario` relation was required so a blank
one could not be stored anyway (1500000139). The owner has reversed that call
-- a merge is a fact about the weekend, not only about a plan, the same
argument 1500000135 already made for lodging_availability -- and 1500000140
makes `scenario` optional. A blank `scenario` is now the WEEKEND-LEVEL row,
not a refused request, so the old refusal test is replaced rather than kept
alongside a contradicting one.
"""

import pytest
from pydantic import ValidationError

from api.schemas.lodging import SlotMergeRequest


def test_a_blank_scenario_is_the_weekend_level_write() -> None:
    # No longer refused (1500000140): a blank scenario builds cleanly and is
    # the WEEKEND-LEVEL row, seen on the CampMinder mirror and inherited by
    # every scenario -- see resolve_combined in lodging_roster_service.py.
    request = SlotMergeRequest(year=2026, session_cm_id=1309514, scenario="", unit_id="rec1", combined=True)
    assert request.scenario == ""


def test_scenario_defaults_to_the_weekend_level_when_omitted() -> None:
    # Omitting the field entirely reaches the same weekend-level row as
    # passing "" explicitly -- the default is not a separate third state.
    request = SlotMergeRequest(year=2026, session_cm_id=1309514, unit_id="rec1", combined=True)
    assert request.scenario == ""


def test_session_cm_id_must_be_positive() -> None:
    # The board defaults sessionCmId to 0 for tests that do not exercise
    # writes; 0 must never reach the database.
    with pytest.raises(ValidationError):
        SlotMergeRequest(year=2026, session_cm_id=0, scenario="scn1", unit_id="rec1", combined=True)


def test_a_valid_request_builds() -> None:
    request = SlotMergeRequest(year=2026, session_cm_id=1309514, scenario="scn1", unit_id="rec1", combined=False)
    assert request.combined is False
