"""Tests for GET /api/debug/original-requests/by-camper/{cm_id} endpoint."""

import sys
from collections.abc import Generator
from pathlib import Path
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


def _make_mock_pb_record(
    record_id: str = "rec_orig_1",
    first_name: str = "Emma",
    last_name: str = "Johnson",
    preferred_name: str | None = None,
    field: str = "bunk_with",
    content: str = "I want to bunk with Liam Garcia",
    year: int = 2025,
    processed: str | None = None,
) -> MagicMock:
    """Create a mock PocketBase record for original_bunk_requests with expand.

    expand is a dict (matching PocketBase SDK Record.expand: dict[str, Any]),
    but expanded values are Record objects with attribute access, not dicts.
    """
    # Requester is a Record object — attributes, not dict keys
    requester = MagicMock(spec=[])  # spec=[] removes default MagicMock methods like .get()
    requester.first_name = first_name
    requester.last_name = last_name
    requester.preferred_name = preferred_name

    record = MagicMock()
    record.id = record_id
    record.field = field
    record.content = content
    record.year = year
    record.processed = processed
    # expand is a dict, but values are Record objects (not dicts)
    record.expand = {"requester": requester}
    return record


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


def _make_mock_attendee(
    person_id: str = "pb_person_1",
    person_cm_id: int = 12345,
    first_name: str = "Emma",
    last_name: str = "Johnson",
    preferred_name: str | None = None,
) -> MagicMock:
    """Create a mock PocketBase attendee record with expanded person.

    expand is a dict (matching PocketBase SDK), values are Record objects.
    """
    person = MagicMock()
    person.id = person_id
    person.cm_id = person_cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.preferred_name = preferred_name

    attendee = MagicMock()
    attendee.expand = {"person": person}
    return attendee


def _setup_attendee_lookup(
    mock_pb: MagicMock,
    attendees: list[MagicMock] | None = None,
    person_id: str = "pb_person_1",
    person_cm_id: int = 12345,
) -> dict[str, MagicMock]:
    """Set up mock PB to route attendees.get_list and original_bunk_requests.get_full_list.

    Returns a dict of collection mocks keyed by collection name for assertions.
    """
    if attendees is None:
        attendees = [_make_mock_attendee(person_id=person_id, person_cm_id=person_cm_id)]

    attendee_result = MagicMock()
    attendee_result.items = attendees

    # Create per-collection mocks
    attendees_col = MagicMock()
    attendees_col.get_list.return_value = attendee_result

    orig_requests_col = MagicMock()
    orig_requests_col.get_full_list.return_value = []

    collections = {
        "attendees": attendees_col,
        "original_bunk_requests": orig_requests_col,
    }

    def route_collection(name: str) -> MagicMock:
        return collections.get(name, MagicMock())

    mock_pb.collection.side_effect = route_collection
    return collections


class TestOriginalRequestsByCamper:
    """Test GET /api/debug/original-requests/by-camper/{cm_id} endpoint."""

    def test_queries_attendees_not_persons(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Endpoint must look up camper via attendees (year-scoped enrollment), not persons."""
        client, mock_pb = client_with_mock_pb

        _setup_attendee_lookup(mock_pb)

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        # Verify attendees was queried, not persons
        mock_pb.collection.assert_any_call("attendees")
        call_args_list = [str(c) for c in mock_pb.collection.call_args_list]
        assert not any("persons" in c for c in call_args_list), "Should query attendees, not persons"

    def test_attendee_filter_includes_year_and_enrollment(
        self, client_with_mock_pb: tuple[TestClient, MagicMock]
    ) -> None:
        """Attendee query must filter by year, status_id, and person.cm_id."""
        client, mock_pb = client_with_mock_pb

        collections = _setup_attendee_lookup(mock_pb)

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        filter_str = collections["attendees"].get_list.call_args[1]["query_params"]["filter"]
        assert "year = 2025" in filter_str
        assert "status_id = 2" in filter_str
        assert "person.cm_id = 12345" in filter_str

    def test_returns_requests_for_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Returns original requests filtered to the specified camper's cm_id."""
        client, mock_pb = client_with_mock_pb

        record1 = _make_mock_pb_record(record_id="rec_1")
        record2 = _make_mock_pb_record(record_id="rec_2", field="not_bunk_with", content="Not with Olivia Chen")

        collections = _setup_attendee_lookup(mock_pb)
        collections["original_bunk_requests"].get_full_list.return_value = [record1, record2]

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert all(item["requester_cm_id"] == 12345 for item in data["items"])
        assert data["items"][0]["source_field"] == "bunk_with"
        assert data["items"][1]["source_field"] == "not_bunk_with"

    def test_returns_empty_for_unenrolled_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Returns empty list when camper has no active enrollment for the year."""
        client, mock_pb = client_with_mock_pb

        _setup_attendee_lookup(mock_pb, attendees=[])

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_year_param_required(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Missing year param returns 422."""
        client, _ = client_with_mock_pb

        response = client.get("/api/debug/original-requests/by-camper/12345")

        assert response.status_code == 422

    def test_uses_preferred_name_when_available(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Uses preferred_name over first_name when available."""
        client, mock_pb = client_with_mock_pb

        record = _make_mock_pb_record(
            record_id="rec_1",
            first_name="Elizabeth",
            preferred_name="Liz",
            last_name="Johnson",
        )

        collections = _setup_attendee_lookup(mock_pb)
        collections["original_bunk_requests"].get_full_list.return_value = [record]

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["requester_name"] == "Liz Johnson"

    def test_processed_field_maps_correctly(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """processed=None maps to False, non-None maps to True."""
        client, mock_pb = client_with_mock_pb

        unprocessed = _make_mock_pb_record(record_id="rec_1", processed=None)
        processed = _make_mock_pb_record(record_id="rec_2", processed="2025-06-15T10:00:00Z")

        collections = _setup_attendee_lookup(mock_pb)
        collections["original_bunk_requests"].get_full_list.return_value = [unprocessed, processed]

        response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["processed"] is False
        assert data["items"][1]["processed"] is True
