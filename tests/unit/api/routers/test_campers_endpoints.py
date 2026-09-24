"""/api/campers endpoint contract (kindred#2776).

Builds its own bare FastAPI app rather than importing api.main -- importing
api.main from a test poisons auth for the whole xdist run.
"""

from typing import Any
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user

PERSON = 1000001

PLAIN_USER = AuthUser(
    username="TestUser",
    email="test@example.com",
    display_name="Test User",
    groups=[],
    is_admin=False,
)


def _build_app(mock_pb: MagicMock) -> FastAPI:
    with patch("api.routers.campers.pb", mock_pb):
        from api.routers.campers import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: PLAIN_USER
    return app


def _pb(**lists: list[Any]) -> MagicMock:
    """One `get_full_list` per collection; every other collection is empty."""
    by_name: dict[str, MagicMock] = {}

    def collection(name: str) -> MagicMock:
        if name not in by_name:
            by_name[name] = MagicMock()
            by_name[name].get_full_list.return_value = lists.get(name, [])
        return by_name[name]

    mock_pb = MagicMock()
    mock_pb.collection.side_effect = collection
    return mock_pb


def _attendee(year: int, cm_id: int, session_type: str, name: str) -> MagicMock:
    session = MagicMock(cm_id=cm_id, session_type=session_type, parent_id=0, start_date="", end_date="")
    session.name = name
    return MagicMock(year=year, expand={"session": session})


class TestGetCamperJourney:
    def test_a_plain_authenticated_user_can_read_it(self) -> None:
        """Open to any authenticated user, like the two lodging reads it
        replaces (`/households/{id}/journey`, `/persons/{id}/housing`): cabin
        names and weekends, no narrative."""
        mock_pb = _pb()
        with patch("api.routers.campers.pb", mock_pb):
            response = TestClient(_build_app(mock_pb)).get(f"/api/campers/{PERSON}/journey", params={"year": 2026})

        assert response.status_code == 200
        assert response.json() == {
            "rows": [],
            "counts": {"summers": 0, "family_weekends": 0, "adult_weekends": 0},
            "teen_cabins": [],
        }

    def test_the_year_is_required(self) -> None:
        """The issue's contract: rows are the years BEFORE the viewed one, so a
        journey without a year has no meaning."""
        mock_pb = _pb()
        with patch("api.routers.campers.pb", mock_pb):
            response = TestClient(_build_app(mock_pb)).get(f"/api/campers/{PERSON}/journey")

        assert response.status_code == 422

    def test_it_returns_the_merged_rows(self) -> None:
        mock_pb = _pb(attendees=[_attendee(2024, 100, "main", "Session 2")])
        with patch("api.routers.campers.pb", mock_pb):
            response = TestClient(_build_app(mock_pb)).get(f"/api/campers/{PERSON}/journey", params={"year": 2026})

        assert response.status_code == 200
        assert response.json()["rows"] == [
            {
                "year": 2024,
                "session_name": "Session 2",
                "session_type": "main",
                "bunk_name": None,
                "bunk_name_recorded": None,
                "start_date": "",
                "end_date": "",
            }
        ]

    def test_it_requires_an_authenticated_user(self) -> None:
        from api.routers.campers import router

        route = next(r for r in router.routes if isinstance(r, APIRoute) and r.path.endswith("/journey"))
        assert any(dep.call is get_current_user for dep in route.dependant.dependencies)
