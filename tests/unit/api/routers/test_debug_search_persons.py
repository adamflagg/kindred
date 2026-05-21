"""Tests for GET /api/debug/search-persons endpoint."""

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


def _make_attendee_with_expand(
    person_cm_id: int,
    first_name: str,
    last_name: str,
    session_cm_id: int,
    grade: int | None = None,
) -> MagicMock:
    """Create a mock attendee record with expanded person and session."""
    person = _make_mock_pb_record(cm_id=person_cm_id, first_name=first_name, last_name=last_name, grade=grade)
    session = _make_mock_pb_record(cm_id=session_cm_id)
    return _make_mock_pb_record(
        person_id=person_cm_id,
        expand={"person": person, "session": session},
    )


@pytest.fixture
def mock_pb() -> MagicMock:
    """Create a mock PocketBase client."""
    return MagicMock()


@pytest.fixture
def client_with_mock_pb(mock_pb: MagicMock) -> Generator[tuple[TestClient, MagicMock]]:
    """Create test client with mocked PB client."""
    with patch("api.routers.debug.pb", mock_pb):
        from api.routers.debug import router

        app = FastAPI()
        app.include_router(router)
        _override_auth(app)

        yield TestClient(app), mock_pb


class TestSearchPersons:
    """Test GET /api/debug/search-persons endpoint."""

    def test_queries_attendees_not_persons(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Search must query enrolled attendees with person expand, not persons directly."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])

        client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        # Must call attendees collection (not persons)
        mock_pb.collection.assert_called_with("attendees")

        # Verify the filter includes enrollment criteria + name match + year
        call_args = mock_collection.get_list.call_args
        query_params = call_args[1].get("query_params", {})
        filter_str = query_params.get("filter", "")
        assert "year = 2025" in filter_str
        assert "status_id = 2" in filter_str
        assert "person.first_name" in filter_str or "person.last_name" in filter_str
        # Must expand person and session to get names and session CM IDs
        assert "person" in query_params.get("expand", "")
        assert "session" in query_params.get("expand", "")

    def test_returns_matching_persons(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Enrolled persons matching the query are returned with session CM IDs."""
        client, mock_pb = client_with_mock_pb

        attendee = _make_attendee_with_expand(
            person_cm_id=12345,
            first_name="Emma",
            last_name="Johnson",
            session_cm_id=1000001,
            grade=5,
        )
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[attendee])

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
        """No results when no attendees match the query."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])

        response = client.get("/api/debug/search-persons", params={"q": "Zzzzz", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_multiple_sessions_grouped_per_person(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Person enrolled in multiple sessions gets all session CM IDs in one result."""
        client, mock_pb = client_with_mock_pb

        att1 = _make_attendee_with_expand(
            person_cm_id=12345, first_name="Liam", last_name="Garcia", session_cm_id=1000001, grade=7
        )
        att2 = _make_attendee_with_expand(
            person_cm_id=12345, first_name="Liam", last_name="Garcia", session_cm_id=1000002, grade=7
        )
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[att1, att2])

        response = client.get("/api/debug/search-persons", params={"q": "Liam", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert sorted(data["items"][0]["sessions"]) == [1000001, 1000002]

    def test_multiple_persons_returned(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Multiple different persons matching the query are returned separately."""
        client, mock_pb = client_with_mock_pb

        att1 = _make_attendee_with_expand(
            person_cm_id=12345, first_name="Emma", last_name="Johnson", session_cm_id=1000001, grade=5
        )
        att2 = _make_attendee_with_expand(
            person_cm_id=67890, first_name="Emma", last_name="Garcia", session_cm_id=1000001, grade=6
        )
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[att1, att2])

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        cm_ids = {item["cm_id"] for item in data["items"]}
        assert cm_ids == {12345, 67890}

    def test_skips_attendees_without_person_expand(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Attendees with missing person expand data are gracefully skipped."""
        client, mock_pb = client_with_mock_pb

        # Attendee with no expand data
        broken_attendee = _make_mock_pb_record(person_id=99999, expand=None)
        good_attendee = _make_attendee_with_expand(
            person_cm_id=12345, first_name="Emma", last_name="Johnson", session_cm_id=1000001, grade=5
        )
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[broken_attendee, good_attendee])

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["cm_id"] == 12345

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

    def test_escapes_double_quotes_in_query(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Double quotes in query string are escaped for PocketBase filter."""
        client, mock_pb = client_with_mock_pb

        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=[])

        response = client.get("/api/debug/search-persons", params={"q": 'O"Brien', "year": 2025})

        assert response.status_code == 200
        # Verify the filter used escaped quotes
        call_args = mock_collection.get_list.call_args
        filter_str = call_args[1].get("query_params", {}).get("filter", "")
        # The raw double-quote in O"Brien must be escaped for the PB filter
        assert 'O\\"Brien' in filter_str

    def test_limits_to_20_results(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """At most 20 unique persons are returned."""
        client, mock_pb = client_with_mock_pb

        attendees = [
            _make_attendee_with_expand(
                person_cm_id=10000 + i, first_name="Emma", last_name=f"Test{i}", session_cm_id=1000001
            )
            for i in range(25)
        ]
        mock_collection = mock_pb.collection.return_value
        mock_collection.get_list.return_value = MagicMock(items=attendees)

        response = client.get("/api/debug/search-persons", params={"q": "Emma", "year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 20
