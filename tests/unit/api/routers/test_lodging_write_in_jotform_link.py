"""Writing a board write-in from a Jotform filing links the two in the same
request (kindred#2759 follow-up). Bare FastAPI app, never api.main."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.schemas.lodging import LodgingWriteResponse
from api.services.jotform_admin_service import JotformValidationError
from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import Permission

BODY: dict[str, Any] = {
    "year": 2026,
    "session_cm_id": 1000002,
    "unit_id": "u_cedar",
    "family_available": False,
    "occupant_name": "Pat Doe",
    "reason": "",
    "jotform_submission_id": "6600000000000000001",
}


def _user(*permissions: str) -> AuthUser:
    user = AuthUser(
        username="TestStaff", email="staff@example.com", display_name="Test Staff", groups=[], is_admin=False
    )
    user.permissions = set(permissions)
    return user


def _client(user: AuthUser) -> TestClient:
    with patch("api.routers.lodging.pb", MagicMock()):
        from api.routers.lodging import router
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_the_write_in_is_written_then_linked() -> None:
    order: list[str] = []
    writes = MagicMock()

    async def write(_req: object) -> LodgingWriteResponse:
        order.append("write")
        return LodgingWriteResponse(record_id="w1")

    writes.set_availability = AsyncMock(side_effect=write)
    jot = MagicMock()
    jot.check_write_in_filing = AsyncMock(side_effect=lambda *_: order.append("check"))
    jot.link_write_in = AsyncMock(side_effect=lambda *_: order.append("link"))
    with (
        patch("api.routers.lodging._writes", return_value=writes),
        patch("api.routers.lodging._jotform", return_value=jot),
    ):
        response = _client(_user(Permission.BUNKING_MANAGE)).put("/api/lodging/availability", json=BODY)

    assert response.status_code == 200
    assert order == ["check", "write", "link"]
    jot.check_write_in_filing.assert_awaited_once_with("6600000000000000001", 2026, 1000002)
    jot.link_write_in.assert_awaited_once_with("6600000000000000001", "u_cedar", "Pat Doe", "staff@example.com")


def test_a_filing_from_another_weekend_writes_nothing() -> None:
    writes = MagicMock()
    writes.set_availability = AsyncMock()
    jot = MagicMock()
    jot.check_write_in_filing = AsyncMock(side_effect=JotformValidationError("another weekend"))
    jot.link_write_in = AsyncMock()
    with (
        patch("api.routers.lodging._writes", return_value=writes),
        patch("api.routers.lodging._jotform", return_value=jot),
    ):
        response = _client(_user(Permission.BUNKING_MANAGE)).put("/api/lodging/availability", json=BODY)

    assert response.status_code == 422
    writes.set_availability.assert_not_awaited()
    jot.link_write_in.assert_not_awaited()


def test_a_filing_only_links_an_occupancy_write() -> None:
    """A release (`true`) or a clear (`null`) names no occupant to link."""
    for family_available in (True, None):
        response = _client(_user(Permission.BUNKING_MANAGE)).put(
            "/api/lodging/availability", json={**BODY, "family_available": family_available}
        )
        assert response.status_code == 422, family_available


def test_without_bunking_manage_nothing_is_written_or_linked() -> None:
    jot = MagicMock()
    jot.check_write_in_filing = AsyncMock()
    with patch("api.routers.lodging._jotform", return_value=jot):
        response = _client(_user()).put("/api/lodging/availability", json=BODY)
    assert response.status_code == 403
    jot.check_write_in_filing.assert_not_awaited()
