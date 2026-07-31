"""/api/lodging endpoint contract.

The router builds its own bare FastAPI app rather than importing api.main —
importing api.main from a test poisons auth for the whole xdist run and
produces spurious 401s elsewhere in the suite.
"""

from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission


def _rec(**kwargs: Any) -> MagicMock:
    record = MagicMock()
    for key, value in kwargs.items():
        setattr(record, key, value)
    return record


def _build_app(user: AuthUser, mock_pb: MagicMock) -> FastAPI:
    with patch("api.routers.lodging.pb", mock_pb):
        from api.routers.lodging import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return app


ADMIN = AuthUser(
    username="TestAdmin",
    email="test@example.com",
    display_name="Test Admin",
    groups=["admin"],
    is_admin=True,
)


def _plain_user() -> AuthUser:
    user = AuthUser(
        username="TestStaff",
        email="staff@example.com",
        display_name="Test Staff",
        groups=[],
        is_admin=False,
    )
    user.permissions = set()
    return user


def _phi_user() -> AuthUser:
    user = AuthUser(
        username="TestNurse",
        email="nurse@example.com",
        display_name="Test Nurse",
        groups=[],
        is_admin=False,
    )
    user.permissions = {Permission.LODGING_PHI}
    return user


@pytest.fixture
def mock_pb() -> MagicMock:
    client = MagicMock()
    client.collection.return_value.get_full_list.return_value = []
    return client


@pytest.fixture
def admin_client(mock_pb: MagicMock) -> Generator[tuple[TestClient, MagicMock]]:
    with patch("api.routers.lodging.pb", mock_pb):
        yield TestClient(_build_app(ADMIN, mock_pb)), mock_pb


class TestSessionsEndpoint:
    def test_returns_family_and_adult_sessions(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = admin_client
        mock_pb.collection.return_value.get_full_list.return_value = [
            _rec(
                id="sess_1",
                cm_id=1000001,
                name="Family Camp 1",
                session_type="family",
                start_date="2026-09-04",
                end_date="2026-09-07",
                sort_order=1,
            ),
        ]

        response = client.get("/api/lodging/sessions", params={"year": 2026})

        assert response.status_code == 200
        body = response.json()
        assert body["year"] == 2026
        assert body["sessions"][0]["session_cm_id"] == 1000001
        assert body["sessions"][0]["session_type"] == "family"

    def test_rejects_an_out_of_range_year(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, _ = admin_client
        assert client.get("/api/lodging/sessions", params={"year": 1899}).status_code == 422


class TestRosterEndpoint:
    def test_unknown_session_is_404_not_500(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = admin_client
        mock_pb.collection.return_value.get_full_list.return_value = []

        response = client.get("/api/lodging/roster", params={"year": 2026, "session_cm_id": 9999999})

        assert response.status_code == 404
        assert "9999999" in response.json()["detail"]

    def test_returns_the_roster_shape(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = admin_client

        def get_full_list(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if "cm_id = 1000001" in query_filter:
                return [
                    _rec(
                        id="sess_1",
                        cm_id=1000001,
                        name="Family Camp 1",
                        session_type="family",
                        start_date="",
                        end_date="",
                        sort_order=1,
                    )
                ]
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_full_list

        response = client.get("/api/lodging/roster", params={"year": 2026, "session_cm_id": 1000001})

        assert response.status_code == 200
        body = response.json()
        assert body["session_cm_id"] == 1000001
        assert body["session_name"] == "Family Camp 1"
        assert body["parties"] == []
        assert body["units"] == []
        assert body["counts"]["parties_total"] == 0


class TestMedicalEndpointIsPermissionGated:
    def test_user_without_the_permission_gets_403(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_plain_user(), mock_pb)
            client = TestClient(app)

            response = client.get("/api/lodging/households/2000001/medical", params={"year": 2026})

        assert response.status_code == 403
        assert Permission.LODGING_PHI in response.json()["detail"]

    def test_user_with_the_permission_gets_the_narrative(self, mock_pb: MagicMock) -> None:
        def get_full_list(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if query_filter == "year = 2026":
                return [
                    _rec(id="hh_1", cm_id=2000001),
                    _rec(
                        id="med_1",
                        household="hh_1",
                        cpap_info="Uses a CPAP nightly",
                        physician_info="",
                        special_needs_info="",
                        allergy_info="",
                        dietary_info="",
                        additional_info="",
                        bathroom_explain="",
                        accommodation_explain="",
                    ),
                ]
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_full_list

        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_phi_user(), mock_pb)
            client = TestClient(app)
            response = client.get("/api/lodging/households/2000001/medical", params={"year": 2026})

        assert response.status_code == 200
        body = response.json()
        assert body["household_cm_id"] == 2000001
        assert body["cpap_info"] == "Uses a CPAP nightly"

    def test_roster_payload_never_carries_medical_narrative(self, mock_pb: MagicMock) -> None:
        """Belt and braces over the schema-level boundary test.

        The household is deliberately given an enrolled child and a medical
        row, so a party is actually built with has_medical_narrative set. With
        no attendee the roster would be empty and this assertion would hold
        without proving anything.
        """
        narrative = "Uses a CPAP nightly and needs an outlet"

        def get_full_list(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if "cm_id = 1000001" in query_filter:
                return [
                    _rec(
                        id="sess_1",
                        cm_id=1000001,
                        name="Family Camp 1",
                        session_type="family",
                        start_date="",
                        end_date="",
                        sort_order=1,
                    )
                ]
            if "status_id = 2" in query_filter:
                return [
                    _rec(
                        person_id=1000001,
                        expand={
                            "person": _rec(
                                cm_id=1000001,
                                first_name="Noah",
                                last_name="Smith",
                                preferred_name="",
                                age=12,
                                grade=7,
                                household="hh_1",
                            )
                        },
                    )
                ]
            if query_filter == "year = 2026":
                return [
                    _rec(id="hh_1", cm_id=2000001, mailing_title="The Smith Family", greeting=""),
                    _rec(
                        id="med_1",
                        household="hh_1",
                        cpap_info=narrative,
                        physician_info="",
                        special_needs_info="",
                        allergy_info="",
                        dietary_info="",
                        additional_info="",
                        bathroom_explain="",
                        accommodation_explain="",
                    ),
                ]
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = get_full_list

        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(ADMIN, mock_pb)
            response = TestClient(app).get("/api/lodging/roster", params={"year": 2026, "session_cm_id": 1000001})

        assert response.status_code == 200
        body = response.json()
        # The party exists and is flagged, so the absence below is meaningful.
        assert len(body["parties"]) == 1
        assert body["parties"][0]["flags"]["has_medical_narrative"] is True
        assert narrative not in response.text
