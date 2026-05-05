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
        resp = session_satisfaction(session_cm_id=999, year=2026, scenario_id=None, pb_client=pb_with_data)
        assert isinstance(resp, SatisfactionResponse)
        assert resp.session_cm_id == 999
        assert resp.year == 2026
        assert resp.scenario_id is None

    def test_aggregates_each_camper_with_requests(self, pb_with_data: MagicMock) -> None:
        resp = session_satisfaction(999, 2026, None, pb_with_data)
        # Camper 1 has 2 requests in this fixture
        assert 1 in resp.campers
        camper1 = resp.campers[1]
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].total == 2
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1


class TestSessionSatisfactionScenarioPath:
    def test_scenario_id_passed_through(self) -> None:
        persons = [_person(1)]
        assignments = [_assignment(1, 100)]
        requests: list[dict[str, Any]] = []
        pb = _build_pb_mock(persons, assignments, requests)
        resp = session_satisfaction(session_cm_id=999, year=2026, scenario_id="scenario-abc", pb_client=pb)
        assert resp.scenario_id == "scenario-abc"
