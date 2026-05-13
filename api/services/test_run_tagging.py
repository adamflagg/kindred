"""TDD tests for run details composition."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from pocketbase.models.record import Record


def _config_row(category: str, subcategory: str | None, config_key: str, value: object) -> Record:
    """Real `pocketbase.Record` shaped per migration 1500000011_config.js."""
    return Record(
        {
            "id": f"cfg_{category}_{config_key}",
            "category": category,
            "subcategory": subcategory,
            "config_key": config_key,
            "value": value,
        }
    )


# ---------------------------------------------------------------------------
# _shorten_session_name — pure helper (Steps 3-6)
# ---------------------------------------------------------------------------


def test_shorten_session_name_numbered() -> None:
    from api.services.run_tagging import _shorten_session_name

    assert _shorten_session_name("Session 2") == "2"
    assert _shorten_session_name("Session 2a") == "2a"
    assert _shorten_session_name("Session 10") == "10"


def test_shorten_session_name_quest() -> None:
    from api.services.run_tagging import _shorten_session_name

    assert _shorten_session_name("Quest Session 1") == "Quest"
    assert _shorten_session_name("Quest 2026") == "Quest"


def test_shorten_session_name_taste() -> None:
    from api.services.run_tagging import _shorten_session_name

    assert _shorten_session_name("Taste of Camp") == "Taste"
    # Split cohorts must be distinguishable on solver-debug source labels.
    assert _shorten_session_name("Taste of Camp 1") == "Taste 1"
    assert _shorten_session_name("Taste of Camp 2") == "Taste 2"


def test_shorten_session_name_ag() -> None:
    from api.services.run_tagging import _shorten_session_name

    assert _shorten_session_name("All-Gender Cabin-Session 2 (Grades 7-8)") == "2"
    assert _shorten_session_name("AG Session 3") == "3"


def test_shorten_session_name_empty() -> None:
    from api.services.run_tagging import _shorten_session_name

    assert _shorten_session_name("") == ""


# ---------------------------------------------------------------------------
# _lookup_session_short_name — async PB helper (Steps 7-10)
# ---------------------------------------------------------------------------


def _mock_pb_returning(name: str) -> MagicMock:
    """Build a PB mock whose camp_sessions.get_first_list_item returns a record with `name`."""
    record = MagicMock()
    record.name = name
    collection = MagicMock()
    collection.get_first_list_item = MagicMock(return_value=record)
    pb = MagicMock()
    pb.collection = MagicMock(return_value=collection)
    return pb


@pytest.mark.asyncio
async def test_lookup_session_short_name_numbered() -> None:
    from api.services.run_tagging import _lookup_session_short_name

    pb = _mock_pb_returning("Session 2 (Grades 6-8)")
    result = await _lookup_session_short_name(pb, session_cm_id=1235406, year=2026)
    assert result == "S2"


@pytest.mark.asyncio
async def test_lookup_session_short_name_quest() -> None:
    from api.services.run_tagging import _lookup_session_short_name

    pb = _mock_pb_returning("Quest Session 1")
    result = await _lookup_session_short_name(pb, session_cm_id=1235410, year=2026)
    assert result == "SQuest"


@pytest.mark.asyncio
async def test_lookup_session_short_name_fallback_on_lookup_failure() -> None:
    """When PB lookup raises, return S{cm_id} so the run still records."""
    from api.services.run_tagging import _lookup_session_short_name

    collection = MagicMock()
    collection.get_first_list_item = MagicMock(side_effect=Exception("not found"))
    pb = MagicMock()
    pb.collection = MagicMock(return_value=collection)
    result = await _lookup_session_short_name(pb, session_cm_id=999, year=2026)
    assert result == "S999"


# ---------------------------------------------------------------------------
# build_run_details — refactored to take session_cm_id + year (Steps 11-15)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_run_details_production_short_label() -> None:
    """build_run_details should produce 'S2 · Production' format."""
    from api.services.run_tagging import build_run_details

    pb = _mock_pb_returning("Session 2 (Grades 6-8)")
    pb.collection.return_value.get_full_list = MagicMock(
        return_value=[_config_row("constraint", "grade_spread", "max", 2)]
    )
    with patch("api.services.run_tagging.get_git_sha", return_value="abc1234"):
        with patch("api.services.run_tagging.snapshot_solver_config", return_value={}):
            details = await build_run_details(
                pb=pb,
                session_cm_id=1235406,
                year=2026,
                scenario_id=None,
                scenario_name=None,
                session_attendee_count=100,
                sweep_id=None,
                sweep_label=None,
            )

    assert details["source_label"] == "S2 · Production"
    assert details["source_kind"] == "production"
    assert details["git_sha"] == "abc1234"
    assert details["session_attendee_count"] == 100


@pytest.mark.asyncio
async def test_build_run_details_scenario_short_label() -> None:
    from api.services.run_tagging import build_run_details

    pb = _mock_pb_returning("Session 2 (Grades 6-8)")
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])
    with patch("api.services.run_tagging.get_git_sha", return_value="def5678"):
        with patch("api.services.run_tagging.snapshot_solver_config", return_value={}):
            details = await build_run_details(
                pb=pb,
                session_cm_id=1235406,
                year=2026,
                scenario_id="scen_xyz",
                scenario_name="what-if-strict-grades",
                session_attendee_count=100,
                sweep_id=None,
                sweep_label=None,
            )

    assert details["source_label"] == 'S2 · scenario "what-if-strict-grades"'
    assert details["source_kind"] == "scenario"


@pytest.mark.asyncio
async def test_build_run_details_scenario_no_name_falls_back_to_id() -> None:
    from api.services.run_tagging import build_run_details

    pb = _mock_pb_returning("Session 2 (Grades 6-8)")
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])
    with patch("api.services.run_tagging.get_git_sha", return_value="abc"):
        with patch("api.services.run_tagging.snapshot_solver_config", return_value={}):
            details = await build_run_details(
                pb=pb,
                session_cm_id=1235406,
                year=2026,
                scenario_id="scen_xyz",
                scenario_name=None,
                session_attendee_count=50,
                sweep_id=None,
                sweep_label=None,
            )

    assert details["source_label"] == 'S2 · scenario "scen_xyz"'
