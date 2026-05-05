"""Integration tests for bunking.satisfaction.aggregate.session_satisfaction.

Uses a mocked PocketBase client so tests are pure (no IO).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.satisfaction.aggregate import session_satisfaction
from bunking.satisfaction.api_shape import SatisfactionResponse
from bunking.satisfaction.bucket import RequestBucket


def _person(cm_id: int, grade: int = 10, gender: str = "M") -> Any:
    p = MagicMock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    return p


def _assignment(person_cm_id: int, bunk_cm_id: int) -> Any:
    a = MagicMock()
    a.person_cm_id = person_cm_id
    a.bunk_cm_id = bunk_cm_id
    return a


def _build_pb_mock(persons: list[Any], assignments: list[Any], requests: list[dict[str, Any]]) -> MagicMock:
    pb = MagicMock()

    def _collection(name: str) -> Any:
        col = MagicMock()
        # Match the constant names used in session_satisfaction.
        # The mock returns the right list based on which collection was requested.
        if "person" in name.lower():
            col.get_full_list.return_value = persons
        elif "draft" in name.lower():
            col.get_full_list.return_value = []  # empty for prod-path tests
        elif "assignment" in name.lower():
            col.get_full_list.return_value = assignments
        elif "request" in name.lower():
            col.get_full_list.return_value = requests
        else:
            col.get_full_list.return_value = []
        return col

    pb.collection.side_effect = _collection
    return pb


class TestSessionSatisfactionProductionPath:
    @pytest.fixture
    def pb_with_data(self) -> MagicMock:
        persons = [_person(1, 10), _person(2, 10), _person(3, 10)]
        assignments = [
            _assignment(1, 100),
            _assignment(2, 100),
            _assignment(3, 101),
        ]
        # 1 → 2 satisfied (same bunk); 1 → 3 unsatisfied (different bunk)
        requests = [
            {
                "id": "r1",
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": "bunk_with",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            {
                "id": "r2",
                "requester_id": 1,
                "requestee_id": 3,
                "request_type": "bunk_with",
                "source_field": "bunk_with",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
        ]
        return _build_pb_mock(persons, assignments, requests)

    def test_returns_typed_response(self, pb_with_data: MagicMock) -> None:
        resp = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb_with_data)
        assert isinstance(resp, SatisfactionResponse)
        assert resp.session_cm_id == 999
        assert resp.year == 2026
        assert resp.scenario_id is None

    def test_aggregates_each_camper_with_requests(self, pb_with_data: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_with_data)
        # Camper 1 has 2 requests in this fixture
        assert 1 in resp.campers
        camper1 = resp.campers[1]
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].total == 2
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1


class TestSessionSatisfactionScenarioPath:
    def test_scenario_id_routes_to_draft_collection(self) -> None:
        from api.constants.collections import BUNK_ASSIGNMENTS, BUNK_ASSIGNMENTS_DRAFT

        persons = [_person(1)]
        assignments = [_assignment(1, 100)]
        requests: list[dict[str, Any]] = []
        pb = _build_pb_mock(persons, assignments, requests)

        resp = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id="scenario-abc", pb_client=pb)

        assert resp.scenario_id == "scenario-abc"
        # Verify routing: draft collection was queried, prod was not.
        called_collections = [call.args[0] for call in pb.collection.call_args_list]
        assert BUNK_ASSIGNMENTS_DRAFT in called_collections
        assert BUNK_ASSIGNMENTS not in called_collections


class TestMultiSession:
    """Widened signature: session_cm_ids accepts multiple ids for AG clusters."""

    def test_multi_session_filter_strings_contain_both_ids(self) -> None:
        """Filters passed to PB must include both session ids when a cluster is requested."""
        tracked_filters: list[str] = []

        # Build tracked mock collections without recursive side_effect calls.
        def _make_col(name: str) -> MagicMock:
            col = MagicMock()

            def _get_full_list(**kwargs: Any) -> list[Any]:
                tracked_filters.append(kwargs.get("filter", ""))
                if "person" in name.lower():
                    return [_person(1)]
                if "draft" in name.lower():
                    return []
                if "assignment" in name.lower():
                    return [_assignment(1, 100)]
                if "request" in name.lower():
                    return []
                return []

            col.get_full_list.side_effect = _get_full_list
            return col

        pb = MagicMock()
        pb.collection.side_effect = _make_col

        resp = session_satisfaction(
            session_cm_ids=[999, 998],
            year=2026,
            scenario_id=None,
            pb_client=pb,
        )

        # Primary session is reported in response
        assert resp.session_cm_id == 999

        # Verify both session ids appear in assignment and request filters
        assignment_filter = next(f for f in tracked_filters if "session.cm_id" in f)
        request_filter = next(f for f in tracked_filters if "session_id = 999" in f)

        assert "session.cm_id = 999" in assignment_filter
        assert "session.cm_id = 998" in assignment_filter
        assert "session_id = 999" in request_filter
        assert "session_id = 998" in request_filter

    def test_empty_session_cm_ids_raises(self) -> None:
        pb = _build_pb_mock([], [], [])
        with pytest.raises(ValueError, match="session_cm_ids must contain at least one id"):
            session_satisfaction(session_cm_ids=[], year=2026, scenario_id=None, pb_client=pb)
