"""Pins kindred#2164: summer's scenario-copy logic moves out of the router and
into `SummerScenarioWriteService` (`api/services/summer_scenario_write_service.py`),
constructed by the router exactly the way `_seed_weekend_scenario` already
builds `LodgingWriteService(LodgingRepository(pb))` -- see
`TestWeekendCreationRoutesThroughLodgingWriteService` in
`test_scenarios_program_aware.py` for the weekend-side precedent this mirrors.

Two structural facts, and getting either wrong breaks a different way:

- The service is constructed with the ROUTER's own `pb` -- the one 33 other
  tests in this suite patch via `patch("api.routers.scenarios.pb", ...)` --
  not a `from api.dependencies import pb` of its own. Asserting the mock
  constructor was called with the patched `pb` object is what proves
  injection rather than a module-level import: an import would still let the
  test pass its HTTP assertions while quietly talking to a real,
  unpatched PocketBase client underneath.
- The router calls into the service rather than a retired module-level
  `_seed_summer_scenario` helper.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from tests.unit.api.routers.test_scenarios_program_aware import _build_app, _ctx, _rec


class TestSummerScenarioWriteServiceExtraction:
    def test_router_constructs_the_service_with_its_own_pb_and_delegates(self) -> None:
        mock_pb = MagicMock()
        mock_pb.collection.return_value.create.return_value = _rec(
            id="scn_new", name="May 8", is_active=True, description=""
        )
        mock_write_service = MagicMock()
        mock_write_service.seed_summer_scenario = AsyncMock(return_value=None)

        app = _build_app()
        body = {"name": "May 8", "session_cm_id": 1235404, "year": 2026, "copy_from_production": True}
        with (
            patch("api.routers.scenarios.pb", mock_pb),
            patch("api.routers.scenarios.graph_cache", MagicMock()),
            patch(
                "api.routers.scenarios.build_session_context",
                AsyncMock(return_value=_ctx(session_type="main")),
            ),
            patch(
                "api.routers.scenarios.SummerScenarioWriteService",
                return_value=mock_write_service,
            ) as mock_cls,
        ):
            resp = TestClient(app).post("/api/scenarios", json=body)

        assert resp.status_code == 200, resp.text
        # Constructed with the router's OWN (patched) pb, not a client the
        # service imported for itself.
        mock_cls.assert_called_once_with(mock_pb)
        mock_write_service.seed_summer_scenario.assert_awaited_once()
