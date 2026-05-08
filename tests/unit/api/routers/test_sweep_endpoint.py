"""TDD tests for /solver/run-sweep schema and endpoint plumbing.

Endpoint integration is exercised manually; here we cover:
- SweepRequest validator (XOR session/scenario, year required for session,
  budget bounds, label length)
- SweepResponse shape
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.solver import SweepRequest, SweepResponse


class TestSweepRequest:
    def test_session_only_with_year_is_valid(self) -> None:
        req = SweepRequest(session_cm_id=2, year=2026)
        assert req.session_cm_id == 2
        assert req.scenario_id is None
        assert req.time_budgets == [30, 60, 180, 300]

    def test_scenario_only_is_valid(self) -> None:
        req = SweepRequest(scenario_id="scen_abc")
        assert req.scenario_id == "scen_abc"

    def test_rejects_both_session_and_scenario(self) -> None:
        with pytest.raises(ValidationError, match="Exactly one"):
            SweepRequest(session_cm_id=2, year=2026, scenario_id="scen_abc")

    def test_rejects_neither_source(self) -> None:
        with pytest.raises(ValidationError, match="Exactly one"):
            SweepRequest(time_budgets=[30])

    def test_session_without_year_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="year is required"):
            SweepRequest(session_cm_id=2)

    def test_empty_budgets_rejected(self) -> None:
        with pytest.raises(ValidationError, match="at least one"):
            SweepRequest(session_cm_id=2, year=2026, time_budgets=[])

    def test_zero_budget_rejected(self) -> None:
        with pytest.raises(ValidationError, match="> 0"):
            SweepRequest(session_cm_id=2, year=2026, time_budgets=[0, 60])

    def test_negative_budget_rejected(self) -> None:
        with pytest.raises(ValidationError, match="> 0"):
            SweepRequest(session_cm_id=2, year=2026, time_budgets=[-30])

    def test_too_large_budget_rejected(self) -> None:
        with pytest.raises(ValidationError, match="<= 3600"):
            SweepRequest(session_cm_id=2, year=2026, time_budgets=[7200])

    def test_label_too_long_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SweepRequest(session_cm_id=2, year=2026, label="x" * 200)


class TestSweepResponse:
    def test_basic_shape(self) -> None:
        resp = SweepResponse(sweep_id="sw_abc", run_ids=["r1", "r2"])
        assert resp.sweep_id == "sw_abc"
        assert resp.run_ids == ["r1", "r2"]
