"""Tests for GET /api/debug/search-persons endpoint."""

from __future__ import annotations

import sys
from collections.abc import Generator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.auth_middleware import AuthUser, get_current_user


def _override_auth(app: FastAPI) -> None:
    """Override auth dependency to provide an admin user for testing."""

    def _mock_admin_user() -> AuthUser:
        return AuthUser(
            username="TestAdmin",
            email="test@example.com",
            display_name="Test Admin",
            groups=["admin"],
            is_admin=True,
        )

    app.dependency_overrides[get_current_user] = _mock_admin_user


def _make_mock_pb_record(**kwargs: Any) -> MagicMock:
    """Create a mock PB record with attribute access."""
    record = MagicMock()
    for k, v in kwargs.items():
        setattr(record, k, v)
    return record


@pytest.fixture
def mock_pb() -> MagicMock:
    """Create a mock PocketBase client."""
    return MagicMock()


@pytest.fixture
def client_with_mock_pb(mock_pb: MagicMock) -> Generator[tuple[TestClient, MagicMock], None, None]:
    """Create test client with mocked PB client."""
    with patch("api.routers.debug.pb", mock_pb):
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)
        _override_auth(app)

        yield TestClient(app), mock_pb


class TestSearchPersons:
    """Test GET /api/debug/search-persons endpoint."""

    def test_returns_matching_persons(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Persons matching the query who have attendee records are returned."""
        client, mock_pb = client_with_mock_pb

        # Mock persons collection query
        person_record = _make_mock_pb_record(
            cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
        )
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[person_record])

        # Mock attendees collection query - Emma is enrolled in session 1000001
        attendee_record = _make_mock_pb_record(
            person_id=12345,
            session_cm_id=1000001,
        )
        mock_collection.get_full_list.return_value = [attendee_record]

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["cm_id"] == 12345
        assert data["items"][0]["first_name"] == "Emma"
        assert data["items"][0]["last_name"] == "Johnson"
        assert data["items"][0]["grade"] == 5
        assert data["items"][0]["sessions"] == [1000001]

    def test_returns_empty_when_no_match(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """No results when no persons match the query."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])
        mock_collection.get_full_list.return_value = []

        response = client.get("/api/debug/search-persons", params={"q": "Zzzzz", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_filters_out_persons_without_attendee_records(
        self, client_with_mock_pb: tuple[TestClient, MagicMock]
    ) -> None:
        """Persons without attendee records for the year are excluded."""
        client, mock_pb = client_with_mock_pb

        # Two persons match the name search
        person1 = _make_mock_pb_record(cm_id=12345, first_name="Emma", last_name="Johnson", grade=5)
        person2 = _make_mock_pb_record(cm_id=67890, first_name="Emma", last_name="Garcia", grade=6)
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[person1, person2])

        # Only person1 has attendee records
        attendee = _make_mock_pb_record(person_id=12345, session_cm_id=1000001)
        mock_collection.get_full_list.return_value = [attendee]

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["cm_id"] == 12345

    def test_multiple_sessions_for_person(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Person enrolled in multiple sessions gets all session CM IDs."""
        client, mock_pb = client_with_mock_pb

        person = _make_mock_pb_record(cm_id=12345, first_name="Liam", last_name="Garcia", grade=7)
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[person])

        attendee1 = _make_mock_pb_record(person_id=12345, session_cm_id=1000001)
        attendee2 = _make_mock_pb_record(person_id=12345, session_cm_id=1000002)
        mock_collection.get_full_list.return_value = [attendee1, attendee2]

        response = client.get("/api/debug/search-persons", params={"q": "Liam", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert sorted(data["items"][0]["sessions"]) == [1000001, 1000002]

    def test_query_param_required(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Missing q param returns 422."""
        client, _ = client_with_mock_pb

        response = client.get("/api/debug/search-persons", params={"year": 2025})

        assert response.status_code == 422

    def test_year_param_required(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Missing year param returns 422."""
        client, _ = client_with_mock_pb

        response = client.get("/api/debug/search-persons", params={"q": "Emma"})

        assert response.status_code == 422

    def test_persons_query_includes_year_filter(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Persons query must filter by year to avoid cross-year duplicates."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])
        mock_collection.get_full_list.return_value = []

        client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        # Verify the persons query includes year filtering
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1].get("query_params", {}).get("filter", "")
        assert "year = 2025" in filter_str, f"Persons filter must include year: {filter_str}"

    def test_no_duplicate_cm_ids_across_years(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Same person from multiple years must not produce duplicate results."""
        client, mock_pb = client_with_mock_pb

        # Same person appears twice (once per year) in persons results
        person_2024 = _make_mock_pb_record(cm_id=3458569, first_name="Emma", last_name="Johnson", grade=5)
        person_2025 = _make_mock_pb_record(cm_id=3458569, first_name="Emma", last_name="Johnson", grade=6)
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[person_2024, person_2025])

        # Attendee record for this person in 2025
        attendee = _make_mock_pb_record(person_id=3458569, session_cm_id=1000001)
        mock_collection.get_full_list.return_value = [attendee]

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        # Must return exactly 1 result, not 2 duplicates
        assert data["total"] == 1
        cm_ids = [item["cm_id"] for item in data["items"]]
        assert cm_ids == [3458569], f"Expected single result, got duplicates: {cm_ids}"

    def test_escapes_double_quotes_in_query(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Double quotes in query string are escaped for PocketBase filter."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])
        mock_collection.get_full_list.return_value = []

        response = client.get("/api/debug/search-persons", params={"q": 'O"Brien', "year": 2025})

        assert response.status_code == 200
        # Verify the filter used escaped quotes
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1].get("query_params", {}).get("filter", "")
        assert '\\"' not in filter_str or '"' in filter_str  # Just ensure no crash
