"""Tests for GET /api/debug/original-requests/by-camper/{cm_id} endpoint."""

from __future__ import annotations

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


def _make_mock_original_request(
    record_id: str = "rec_orig_1",
    requester_cm_id: int = 12345,
    first_name: str = "Emma",
    last_name: str = "Johnson",
    preferred_name: str | None = None,
    field: str = "bunk_with",
    content: str = "I want to bunk with Liam Garcia",
    year: int = 2025,
    processed: str | None = None,
) -> MagicMock:
    """Create a mock OriginalRequest object matching the loader's output."""
    record = MagicMock()
    record.id = record_id
    record.requester_cm_id = requester_cm_id
    record.first_name = first_name
    record.last_name = last_name
    record.preferred_name = preferred_name
    record.field = field
    record.content = content
    record.year = year
    record.processed = processed
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


class TestOriginalRequestsByCamper:
    """Test GET /api/debug/original-requests/by-camper/{cm_id} endpoint."""

    def test_returns_requests_for_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Returns original requests filtered to the specified camper's cm_id."""
        client, mock_pb = client_with_mock_pb

        record1 = _make_mock_original_request(record_id="rec_1", requester_cm_id=12345)
        record2 = _make_mock_original_request(
            record_id="rec_2", requester_cm_id=12345, field="not_bunk_with", content="Not with Olivia Chen"
        )
        record_other = _make_mock_original_request(record_id="rec_3", requester_cm_id=99999)

        with patch("api.routers.debug.OriginalRequestsLoader") as MockLoader:
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_filter.return_value = [record1, record2, record_other]

            response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert all(item["requester_cm_id"] == 12345 for item in data["items"])
        assert data["items"][0]["source_field"] == "bunk_with"
        assert data["items"][1]["source_field"] == "not_bunk_with"

    def test_returns_empty_for_unknown_camper(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """Returns empty list when no requests match the cm_id."""
        client, mock_pb = client_with_mock_pb

        record_other = _make_mock_original_request(record_id="rec_1", requester_cm_id=99999)

        with patch("api.routers.debug.OriginalRequestsLoader") as MockLoader:
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_filter.return_value = [record_other]

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

        record = _make_mock_original_request(
            record_id="rec_1",
            requester_cm_id=12345,
            first_name="Elizabeth",
            preferred_name="Liz",
            last_name="Johnson",
        )

        with patch("api.routers.debug.OriginalRequestsLoader") as MockLoader:
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_filter.return_value = [record]

            response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["requester_name"] == "Liz Johnson"

    def test_processed_field_maps_correctly(self, client_with_mock_pb: tuple[TestClient, MagicMock]) -> None:
        """processed=None maps to False, non-None maps to True."""
        client, mock_pb = client_with_mock_pb

        unprocessed = _make_mock_original_request(record_id="rec_1", requester_cm_id=12345, processed=None)
        processed = _make_mock_original_request(
            record_id="rec_2", requester_cm_id=12345, processed="2025-06-15T10:00:00Z"
        )

        with patch("api.routers.debug.OriginalRequestsLoader") as MockLoader:
            mock_loader = MagicMock()
            MockLoader.return_value = mock_loader
            mock_loader.load_by_filter.return_value = [unprocessed, processed]

            response = client.get("/api/debug/original-requests/by-camper/12345", params={"year": 2025})

        assert response.status_code == 200
        data = response.json()
        assert data["items"][0]["processed"] is False
        assert data["items"][1]["processed"] is True
