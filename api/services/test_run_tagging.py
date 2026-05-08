"""TDD tests for run details composition."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from api.services.run_tagging import build_run_details


@pytest.mark.asyncio
async def test_production_run_with_no_sweep() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(
        return_value=[MagicMock(config_key="constraint.grade_spread.max", config_value="2")]
    )

    with patch("api.services.run_tagging.get_git_sha", return_value="abc1234"):
        details = await build_run_details(
            pb=pb,
            session_label="Session 2 — 2026",
            scenario_id=None,
            scenario_name=None,
            session_attendee_count=98,
            sweep_id=None,
            sweep_label=None,
        )

    assert details["git_sha"] == "abc1234"
    assert details["config_snapshot"] == {"constraint.grade_spread.max": "2"}
    assert details["source_label"] == "Session 2 — 2026 · Production"
    assert details["source_kind"] == "production"
    assert details["scenario_id_at_run"] is None
    assert details["session_attendee_count"] == 98
    assert details["sweep_id"] is None
    assert details["sweep_label"] is None


@pytest.mark.asyncio
async def test_scenario_run_with_sweep() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])

    with patch("api.services.run_tagging.get_git_sha", return_value="def5678"):
        details = await build_run_details(
            pb=pb,
            session_label="Session 2 — 2026",
            scenario_id="scen_abc",
            scenario_name="what-if-strict-grades",
            session_attendee_count=98,
            sweep_id="sweep_uuid",
            sweep_label="post-cleanup",
        )

    assert details["source_label"] == 'Session 2 — 2026 · scenario "what-if-strict-grades"'
    assert details["source_kind"] == "scenario"
    assert details["scenario_id_at_run"] == "scen_abc"
    assert details["sweep_id"] == "sweep_uuid"
    assert details["sweep_label"] == "post-cleanup"


@pytest.mark.asyncio
async def test_scenario_with_no_name_falls_back_to_id() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])

    with patch("api.services.run_tagging.get_git_sha", return_value="abc"):
        details = await build_run_details(
            pb=pb,
            session_label="Session 1",
            scenario_id="scen_xyz",
            scenario_name=None,
            session_attendee_count=50,
            sweep_id=None,
            sweep_label=None,
        )

    assert details["source_label"] == 'Session 1 · scenario "scen_xyz"'
