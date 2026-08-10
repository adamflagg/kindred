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
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]
from pydantic import BaseModel

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    PlacementCopyRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
    SlotMergeRequest,
)
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


def _manage_user() -> AuthUser:
    """Bunking staff: holds bunking.manage, is not an admin.

    This is the whole point of the draft split -- the people who do this job
    place families without being admins, and the admin-only record of truth is
    never written from a UI.
    """
    user = AuthUser(
        username="TestBunkingStaff",
        email="bunking@example.com",
        display_name="Test Bunking Staff",
        groups=[],
        is_admin=False,
    )
    user.permissions = {Permission.BUNKING_MANAGE}
    return user


def _medical_reads(**kwargs: Any) -> list[Any]:
    """Two narrow reads: the household by cm_id, then its medical row."""
    query_filter = kwargs.get("query_params", {}).get("filter", "")
    if "cm_id = 2000001" in query_filter:
        return [_rec(id="hh_1", cm_id=2000001)]
    if 'household = "hh_1"' in query_filter:
        return [
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
            )
        ]
    return []


@pytest.fixture(autouse=True)
def _reset_lodging_cache() -> Generator[None]:
    """`lodging_cache` is a process-wide singleton (kindred#1963): the router
    builds a real `LodgingRepository` per request even in these router tests
    (`_build_app` only patches the PocketBase client, not the repository
    layer), so a value one test's mock warms would otherwise survive into the
    next test's assertions for the same year. Mirrors
    tests/unit/api/services/test_lodging_repository.py's fixture of the same
    name.
    """
    from api.dependencies import lodging_cache

    lodging_cache.invalidate_all()
    yield
    lodging_cache.invalidate_all()


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
            if _is_session_lookup(query_filter):
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


class TestScenarioParameter:
    """The optional scenario, end to end through the router.

    Asserts on the FILTERS the endpoint issues rather than on its payload: the
    thing that can silently break is the parameter not reaching the reads at
    all, which an empty-fixture payload assertion would happily pass.
    """

    @staticmethod
    def _capture(mock_pb: MagicMock) -> list[str]:
        seen: list[str] = []

        def record(**kwargs: Any) -> list[Any]:
            seen.append(kwargs.get("query_params", {}).get("filter", ""))
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
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

        mock_pb.collection.return_value.get_full_list.side_effect = record
        return seen

    def test_roster_without_a_scenario_reads_no_scenario_rows(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = admin_client
        seen = self._capture(mock_pb)

        response = client.get("/api/lodging/roster", params={"year": 2026, "session_cm_id": 1000001})

        assert response.status_code == 200
        assert not [f for f in seen if "scenario = " in f and 'scenario = ""' not in f], (
            f"production mode read a scenario: {seen}"
        )

    def test_roster_with_a_scenario_filters_the_draft_by_it(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        client, mock_pb = admin_client
        seen = self._capture(mock_pb)

        response = client.get(
            "/api/lodging/roster",
            params={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1"},
        )

        assert response.status_code == 200
        assert [f for f in seen if 'scenario = "scn_1"' in f], f"the scenario never reached a read: {seen}"

    def test_summary_accepts_a_scenario(self, admin_client: tuple[TestClient, MagicMock]) -> None:
        """The lander and the roster must be able to agree under a scenario,
        which they cannot do if only one of them takes the parameter."""
        client, mock_pb = admin_client
        mock_pb.collection.return_value.get_full_list.return_value = []

        response = client.get("/api/lodging/summary", params={"year": 2026, "scenario": "scn_1"})

        assert response.status_code == 200


class TestHouseholdJourneyEndpoint:
    """GET /api/lodging/households/{id}/journey (kindred#2073).

    A READ, so it is open to any authenticated user exactly as `/roster` is.
    It carries names, ages and grades -- the same fields the roster payload
    already publishes for the current weekend -- and no narrative, so it sits
    on the ordinary side of the PHI boundary.
    """

    def test_a_plain_authenticated_user_can_read_it(self, mock_pb: MagicMock) -> None:
        """Deliberately NOT `lodging.phi`-gated, and deliberately asserted
        with the same user the medical endpoint 403s: the two endpoints sit on
        the same path prefix, and a copy-paste of the wrong dependency would
        otherwise be invisible.
        """
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.lodging.pb", mock_pb):
            client = TestClient(_build_app(_plain_user(), mock_pb))
            response = client.get("/api/lodging/households/2000001/journey")

        assert response.status_code == 200
        assert response.json() == {"household_cm_id": 2000001, "years": []}

    def test_it_takes_no_year_because_the_window_is_discovered(self, mock_pb: MagicMock) -> None:
        """The sweep spans every year the household has a trace in, so there
        is no year to pass. A `?year=` parameter would imply the caller
        chooses the window, which is the misunderstanding that produces a
        journey truncated to one season.
        """
        seen: list[str] = []

        def record_filters(**kwargs: Any) -> list[Any]:
            seen.append(kwargs.get("query_params", {}).get("filter", ""))
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = record_filters

        with patch("api.routers.lodging.pb", mock_pb):
            TestClient(_build_app(ADMIN, mock_pb)).get("/api/lodging/households/2000001/journey")

        assert seen, "the endpoint issued no reads"
        assert all("year =" not in f for f in seen), f"a year predicate reached the journey reads: {seen}"

    def test_it_never_carries_medical_narrative(self, mock_pb: MagicMock) -> None:
        """The PHI boundary, restated at the newest endpoint on this prefix.

        `family_camp_medical` must not be read here at all -- not filtered
        out downstream, not read and discarded.
        """
        collections: list[str] = []

        def _collection(name: str) -> MagicMock:
            collections.append(name)
            col = MagicMock()
            col.get_full_list.return_value = []
            return col

        mock_pb.collection.side_effect = _collection

        with patch("api.routers.lodging.pb", mock_pb):
            response = TestClient(_build_app(ADMIN, mock_pb)).get("/api/lodging/households/2000001/journey")

        assert response.status_code == 200
        assert "family_camp_medical" not in collections


class TestMedicalEndpointIsPermissionGated:
    def test_user_without_the_permission_gets_403(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_plain_user(), mock_pb)
            client = TestClient(app)

            response = client.get("/api/lodging/households/2000001/medical", params={"year": 2026})

        assert response.status_code == 403
        assert Permission.LODGING_PHI in response.json()["detail"]

    def test_user_with_the_permission_gets_the_narrative(self, mock_pb: MagicMock) -> None:
        mock_pb.collection.return_value.get_full_list.side_effect = _medical_reads

        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_phi_user(), mock_pb)
            client = TestClient(app)
            response = client.get("/api/lodging/households/2000001/medical", params={"year": 2026})

        assert response.status_code == 200
        body = response.json()
        assert body["household_cm_id"] == 2000001
        assert body["cpap_info"] == "Uses a CPAP nightly"

    def test_the_medical_read_is_not_logged(self, mock_pb: MagicMock) -> None:
        """RBAC is the control, and there is no access log behind it.

        One existed, recording the caller by `username` so the log store
        would not inherit an email address. The ruling is that it should not
        exist at all: `lodging.phi` decides who may read this, and a log line
        is not a second gate.

        kindred#1889 is what made it actively wrong rather than merely
        unused. With the reveal button gone the panel fetches on mount, so
        "PHI reveal" fired on every panel open -- including households with
        nothing on file -- and could no longer tell a deliberate read from a
        click.

        This asserts the router has no logging surface AT ALL rather than
        that one call did not happen, which is what makes it hold against a
        re-add under a different event name. Patching `get_logger` would not:
        the binding it replaced was module-level, so by the time a test can
        patch anything the module is already imported and the patch is inert.
        """
        mock_pb.collection.return_value.get_full_list.side_effect = _medical_reads

        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_phi_user(), mock_pb)
            response = TestClient(app).get("/api/lodging/households/2000001/medical", params={"year": 2026})
            import api.routers.lodging as lodging_module

        assert response.status_code == 200
        assert not hasattr(lodging_module, "logger")

    def test_medical_read_does_not_load_the_whole_year(self, mock_pb: MagicMock) -> None:
        """One household in, one household's PHI out.

        Loading every family's medical row to answer one is a PHI-surface
        problem before it is a performance one.
        """
        seen: list[str] = []

        def record_filters(**kwargs: Any) -> list[Any]:
            seen.append(kwargs.get("query_params", {}).get("filter", ""))
            return _medical_reads(**kwargs)

        mock_pb.collection.return_value.get_full_list.side_effect = record_filters

        with patch("api.routers.lodging.pb", mock_pb):
            app = _build_app(_phi_user(), mock_pb)
            TestClient(app).get("/api/lodging/households/2000001/medical", params={"year": 2026})

        assert seen, "the endpoint issued no reads"
        assert all(f != "year = 2026" for f in seen), f"an unanchored whole-year read reached the PHI path: {seen}"

    def test_roster_payload_never_carries_medical_narrative(self, mock_pb: MagicMock) -> None:
        """Belt and braces over the schema-level boundary test.

        The household is deliberately given an enrolled child AND a medical
        row: with no attendee the roster would be empty and the assertion
        would hold without proving anything.

        Since kindred#1889 the roster path does not read the medical
        collection at all, so this passes structurally rather than by the
        service choosing not to serialise what it fetched. Kept anyway, and
        deliberately: it is the end-to-end net that catches a future read
        being reintroduced upstream of the schema, which the schema-level
        boundary test cannot see.
        """
        narrative = "Uses a CPAP nightly and needs an outlet"

        def get_full_list(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
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
        # The party exists, so the absence below is about a real roster.
        assert len(body["parties"]) == 1
        assert "has_medical_narrative" not in body["parties"][0]["flags"]
        assert narrative not in response.text


# --------------------------------------------------------------------- writes

# Every write endpoint: (verb, route TEMPLATE, request path, minimal valid body).
# The template and the request path differ wherever a path parameter is
# involved, and both are needed -- the template is what the router declares, the
# path is what a client actually calls.
#
# Driven as a table so the auth contract below cannot silently miss an endpoint
# added later: a write route absent from this table is a route nobody asserted a
# permission on, and the coverage test fails on exactly that.
WRITE_ENDPOINTS: list[tuple[str, str, str, dict[str, Any]]] = [
    (
        "POST",
        "/api/lodging/placements",
        "/api/lodging/placements",
        {
            "year": 2026,
            "session_cm_id": 1000001,
            "scenario": "scn_1",
            "household_cm_id": 2000001,
            "unit_ids": ["u1"],
        },
    ),
    (
        "DELETE",
        "/api/lodging/placements",
        "/api/lodging/placements",
        {"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1", "household_cm_id": 2000001},
    ),
    (
        "PUT",
        "/api/lodging/availability",
        "/api/lodging/availability",
        {
            "year": 2026,
            "session_cm_id": 1000001,
            "unit_id": "u1",
            "family_available": False,
            "reason": "Burst pipe",
        },
    ),
    (
        "POST",
        "/api/lodging/placements/copy",
        "/api/lodging/placements/copy",
        {"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1"},
    ),
    (
        "PUT",
        "/api/lodging/merge",
        "/api/lodging/merge",
        {
            "year": 2026,
            "session_cm_id": 1000001,
            "scenario": "scn_1",
            "unit_id": "u1",
            "combined": True,
        },
    ),
]

# The request model each row above posts against. Only used by the shape guard
# below, which is the half of this table nothing else asserts.
WRITE_MODELS: dict[tuple[str, str], type[BaseModel]] = {
    ("POST", "/api/lodging/placements"): PlacementWriteRequest,
    ("DELETE", "/api/lodging/placements"): PlacementDeleteRequest,
    ("PUT", "/api/lodging/availability"): AvailabilityWriteRequest,
    ("POST", "/api/lodging/placements/copy"): PlacementCopyRequest,
    ("PUT", "/api/lodging/merge"): SlotMergeRequest,
}


def _is_session_lookup(query_filter: str) -> bool:
    """Is this read `fetch_session`, or one of the lodging reads?

    `session_type` is the discriminator, and it has to be: every lodging read
    now carries `session_cm_id = 1000001` (kindred#2042), and the obvious
    `"cm_id = 1000001" in query_filter` test matches that as a SUBSTRING --
    handing a draft lookup the camp_sessions record and turning every create
    into an update of the weekend itself.
    """
    return "session_type" in query_filter and "cm_id = 1000001" in query_filter


def _session_lookup(**kwargs: Any) -> list[Any]:
    """Resolve the weekend; everything else reads empty, so writes create."""
    query_filter = kwargs.get("query_params", {}).get("filter", "")
    if _is_session_lookup(query_filter):
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


def _write_client(user: AuthUser, mock_pb: MagicMock) -> TestClient:
    mock_pb.collection.return_value.get_full_list.side_effect = _session_lookup
    mock_pb.collection.return_value.create.return_value = _rec(id="new_1")
    mock_pb.collection.return_value.update.return_value = _rec(id="existing_1")
    # An EMPTY scenario, which is what the copy endpoint requires. Left as a
    # bare MagicMock this reads as 1 -- MagicMock implements __int__ -- and
    # every copy would refuse with a 409 for a scenario holding nothing.
    mock_pb.collection.return_value.get_list.return_value = _rec(total_items=0)
    return TestClient(_build_app(user, mock_pb))


class TestWriteEndpointsRequireBunkingManage:
    """The fetchWithAuth-shaped auth contract.

    The frontend reaches these through `fetchWithAuth` from `useApiWithAuth()`,
    which attaches the PocketBase JWT from localStorage -- a raw `fetch` would
    silently 401. These assert the other half: that the endpoint actually
    checks, rather than trusting the collection rules underneath. Both layers
    are wanted, because the API writes to PocketBase with its own credentials
    and the collection rule never sees the caller.
    """

    @pytest.mark.parametrize(("verb", "path", "body"), [(v, p, b) for v, _, p, b in WRITE_ENDPOINTS])
    def test_a_user_without_the_permission_is_refused(
        self, mock_pb: MagicMock, verb: str, path: str, body: dict[str, Any]
    ) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_plain_user(), mock_pb)
            response = client.request(verb, path, json=body)

        assert response.status_code == 403, f"{verb} {path} did not refuse a user without bunking.manage"
        assert Permission.BUNKING_MANAGE in response.json()["detail"]

    @pytest.mark.parametrize(("verb", "path", "body"), [(v, p, b) for v, _, p, b in WRITE_ENDPOINTS])
    def test_bunking_staff_are_allowed(self, mock_pb: MagicMock, verb: str, path: str, body: dict[str, Any]) -> None:
        """Non-admin staff place families. That is the whole draft split."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.request(verb, path, json=body)

        assert response.status_code < 400, f"{verb} {path} refused bunking staff: {response.text}"

    def test_every_write_route_is_covered_by_the_table_above(self, mock_pb: MagicMock) -> None:
        """A new write endpoint must not be able to ship ungated.

        Without this, adding a POST route and forgetting `require_permission`
        passes every test in this file -- the table is only as good as its
        completeness, so the completeness is asserted rather than assumed.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            from api.routers.lodging import router

        declared = {(verb, template) for verb, template, _, _ in WRITE_ENDPOINTS}
        # getattr for both: `routes` is typed as list[BaseRoute], which declares
        # neither `path` nor `methods` -- those live on the APIRoute subclass,
        # and a Mount or WebSocketRoute would have one without the other.
        actual = {
            (method, str(getattr(route, "path", "")))
            for route in router.routes
            for method in getattr(route, "methods", set())
            if method in {"POST", "PUT", "PATCH", "DELETE"}
        }
        assert actual == declared, f"write routes not covered by the auth-contract table: {actual ^ declared}"

    @pytest.mark.parametrize(("verb", "template", "body"), [(v, t, b) for v, t, _, b in WRITE_ENDPOINTS])
    def test_every_table_body_names_only_fields_its_model_declares(
        self, verb: str, template: str, body: dict[str, Any]
    ) -> None:
        """A stale key here degrades the request instead of failing it.

        Pydantic IGNORES unknown keys, so a field deleted from a model lingers
        in this table silently. That is not theoretical: the availability row
        carried `scenario` and `state` after 1500000135 removed both, and
        because the leftovers dropped rather than 422'd, `family_available`
        stayed at its `None` default -- turning the row into a CLEAR-the-
        override no-op. `test_bunking_staff_are_allowed` still passed, because
        a no-op answers 200, so the permission gate looked covered for a write
        that never happened.
        """
        declared = set(WRITE_MODELS[(verb, template)].model_fields)
        assert set(body) <= declared, (
            f"{verb} {template} sends fields its model does not declare: {set(body) - declared}"
        )


class TestPlacementWrites:
    def test_a_new_placement_creates_a_draft_row(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_assignments_draft")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["scenario"] == "scn_1"
        assert payload["household_cm_id"] == 2000001
        assert payload["units"] == ["u1"]
        # session_cm_id is REQUIRED on the draft (1500000124's rule, carried
        # onto the twin): a row without it cannot survive its session being
        # recreated in a later year.
        assert payload["session_cm_id"] == 1000001
        assert payload["session"] == "sess_1"

    def test_an_existing_placement_is_updated_not_duplicated(self, mock_pb: MagicMock) -> None:
        """The draft's unique index would reject the second row anyway; this
        asserts we never ask it to."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'scenario = "scn_1"' in query_filter:
                return [_rec(id="draft_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u2"],
                },
            )

        assert response.status_code == 200
        assert mock_pb.collection.return_value.create.call_count == 0
        assert mock_pb.collection.return_value.update.call_args[0][0] == "draft_1"

    def test_a_placement_with_no_target_is_refused(self, mock_pb: MagicMock) -> None:
        """kindred#1974 retired the tombstone: unplacing is the DELETE.

        With no fall-through to the mirror, a row naming no unit renders
        exactly as no row at all does, so accepting one would be a second
        spelling of a state that already has one. 422 at the edge keeps the
        write layer total -- a row exists iff the party is placed.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": [],
                },
            )

        assert response.status_code == 422
        mock_pb.collection.return_value.create.assert_not_called()

    def test_deleting_a_placement_unplaces_the_party(self, mock_pb: MagicMock) -> None:
        """DELETE removes the row, and under replace semantics that IS the
        unplaced state -- there is nothing underneath for it to fall back to."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'scenario = "scn_1"' in query_filter:
                return [_rec(id="draft_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            response = client.request(
                "DELETE",
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                },
            )

        assert response.status_code == 200
        mock_pb.collection.return_value.delete.assert_called_once_with("draft_1")

    def test_a_placement_delete_race_is_not_an_error(self, mock_pb: MagicMock) -> None:
        """The row is found, then vanishes before the delete lands.

        Two staff clearing the same placement, or a double-click: the find
        above sees the row, but by the time the delete reaches PocketBase
        another caller has already removed it and PB answers 404. Left alone
        that is a bare ClientResponseError into the catch-all handler in
        api/main.py -- a 500 for a clear the board is entitled to make. This
        is idempotent for the same reason the no-row case already is: a 404
        here means the same thing "the row was never there" does.
        """

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'scenario = "scn_1"' in query_filter:
                return [_rec(id="draft_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            mock_pb.collection.return_value.delete.side_effect = ClientResponseError(
                "not found", status=404, data={}, url="", is_abort=False, original_error=None
            )
            response = client.request(
                "DELETE",
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                },
            )

        assert response.status_code == 200, response.text
        assert response.json()["deleted"] is False
        # The id IS known here -- the find above returned it -- so it is
        # reported. Only the row-never-existed case has no id to give, and that
        # case must stay distinguishable from this one.
        assert response.json()["record_id"] == "draft_1"

    def test_a_placement_delete_failure_that_is_not_a_race_still_errors(self, mock_pb: MagicMock) -> None:
        """Only "already gone" is swallowed. A 403 or a 500 from PocketBase is
        a real failure and must not be reported to the board as a clean no-op."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'scenario = "scn_1"' in query_filter:
                return [_rec(id="draft_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            mock_pb.collection.return_value.delete.side_effect = ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
            response = client.request(
                "DELETE",
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                },
            )

        # Pinned, not `>= 400`: a 500 would also satisfy that, and a 500 is the
        # precise outcome the idempotency change is supposed to rule out.
        assert response.status_code == 403

    def test_a_write_without_a_scenario_is_refused(self, mock_pb: MagicMock) -> None:
        """No scenario is the read-only CampMinder mirror, for everyone.

        Summer encodes the same rule -- ScenarioContext's isProductionMode
        disables every drop target. Accepting a scenario-less write here would
        be the one path around it.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 422

    def test_a_placement_naming_neither_grain_is_refused(self, mock_pb: MagicMock) -> None:
        """Exactly one grain, or the row keys on nothing and the unique index
        cannot dedupe it."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1", "unit_ids": ["u1"]},
            )

        assert response.status_code == 422

    def test_a_placement_naming_both_grains_is_refused(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "person_cm_id": 1000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 422

    def test_a_placement_naming_the_same_unit_twice_is_refused(self, mock_pb: MagicMock) -> None:
        """Distinct from the completeness rule removed in #1903 (see the
        deleted MergeWriteRequest._members_are_distinct, kindred history).

        `["u1", "u1"]` is a two-member placement to Pydantic and a one-member
        placement to a PocketBase relation field, which may collapse the
        duplicate on save. Post-collapse, `unit_ids` is the only way to build
        a multi-room slot, so a silently-collapsed duplicate does not just
        shrink the set -- it turns a merged-slot request into a plain one and
        still returns 200.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1", "u1"],
                },
            )

        assert response.status_code == 422

    def test_a_placement_over_the_unit_cap_is_refused(self, mock_pb: MagicMock) -> None:
        """21 units exceeds the field's own maxSelect of 20
        (1500000134_lodging_units_relation.js). Refusing here names the cap
        instead of surfacing a PocketBase validation error -- and on the
        update path that PocketBase error is unguarded and would otherwise
        escape as a 500 (lodging_write_service.py)."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": [f"u{i}" for i in range(21)],
                },
            )

        assert response.status_code == 422

    def test_losing_the_upsert_race_updates_instead_of_500ing(self, mock_pb: MagicMock) -> None:
        """Two staff dragging the same family at the same moment.

        Both find no draft row, both create, and the partial unique index
        rejects the loser. Left alone that is a bare ClientResponseError into
        the catch-all handler in api/main.py -- a 500 for a placement the board
        is entitled to make. The row the winner just wrote is exactly what this
        call wanted to write, so the loser adopts it and updates.
        """
        reads: list[list[Any]] = [[], [_rec(id="draft_raced")]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            return reads.pop(0) if reads else []

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 200, response.text
        mock_pb.collection.return_value.update.assert_called_once()
        assert mock_pb.collection.return_value.update.call_args[0][0] == "draft_raced"

    def test_a_create_failure_that_is_not_a_race_still_errors(self, mock_pb: MagicMock) -> None:
        """The retry is for a lost race, not a blanket swallow.

        If the re-read still finds no row, the create failed for some other
        reason and the caller must hear about it with the upstream status
        rather than a 200 reporting a placement that does not exist.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "boom", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 400
        mock_pb.collection.return_value.update.assert_not_called()

    def test_a_failed_re_read_after_a_lost_placement_race_keeps_its_status(self, mock_pb: MagicMock) -> None:
        """The recovery races too.

        The create loses the race, and then the re-read that decides whether it
        raced fails on its own -- PocketBase refuses it, or goes down between
        the two calls. That call is inside the except block, so leaving it
        unwrapped puts a bare ClientResponseError into the catch-all handler in
        api/main.py: a 500, which is the precise outcome this whole guard
        exists to remove. The retry's own failures go through pb_error_to_http
        exactly as the create's do.
        """
        reads: list[list[Any]] = [[]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            if reads:
                return reads.pop(0)
            raise ClientResponseError("forbidden", status=403, data={}, url="", is_abort=False, original_error=None)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        # Pinned, not `>= 400`: a 500 would also satisfy that, and a 500 is the
        # exact thing this guard rules out.
        assert response.status_code == 403

    def test_a_failed_update_after_a_lost_placement_race_keeps_its_status(self, mock_pb: MagicMock) -> None:
        """The winner's row is found, then the update onto it fails.

        The narrowest window of the three: the create lost, the re-read found
        the winner's row, and the update failed anyway -- the winner deleted it
        again, or PocketBase refused. Unwrapped that is the same bare 500.
        """
        reads: list[list[Any]] = [[], [_rec(id="draft_raced")]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            return reads.pop(0) if reads else []

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            mock_pb.collection.return_value.update.side_effect = ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 403

    def test_an_unknown_weekend_is_404_not_500(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = lambda **_: []
            response = client.post(
                "/api/lodging/placements",
                json={
                    "year": 2026,
                    "session_cm_id": 9999999,
                    "scenario": "scn_1",
                    "household_cm_id": 2000001,
                    "unit_ids": ["u1"],
                },
            )

        assert response.status_code == 404


class TestCopyFromMirror:
    """POST /placements/copy — the seed step replace semantics create.

    A scenario now starts EMPTY (kindred#1974), so this is what makes a new
    one usable. Summer seeds the same way, inside `POST /api/scenarios`; that
    endpoint copies `bunk_assignments` and returns zero rows for a weekend
    session, which is why this exists separately rather than being reused.
    """

    @staticmethod
    def _mirror_reads(**kwargs: Any) -> list[Any]:
        query_filter = kwargs.get("query_params", {}).get("filter", "")
        if "session_cm_id = 1000001" in query_filter:
            return [
                _rec(
                    id="assign_1",
                    household_cm_id=2000001,
                    person_cm_id=0,
                    units=["u1"],
                    source="campminder_sync",
                    expand={"units": [_rec(id="u1", code="ridge-a", name="Ridge A")]},
                )
            ]
        return _session_lookup(**kwargs)

    def test_copying_seeds_the_scenario_from_the_synced_placements(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = self._mirror_reads
            response = client.post(
                "/api/lodging/placements/copy",
                json={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1"},
            )

        assert response.status_code == 200, response.text
        assert response.json() == {"copied": 1, "skipped": 0}
        mock_pb.collection.assert_any_call("lodging_assignments_draft")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["scenario"] == "scn_1"
        assert payload["units"] == ["u1"]
        assert payload["household_cm_id"] == 2000001

    def test_copying_into_a_worked_scenario_is_a_409(self, mock_pb: MagicMock) -> None:
        """Refused, not merged: a second copy would overwrite the placements
        staff made and re-place every party they unplaced, since unplacing is
        now the absence of a row."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = self._mirror_reads
            mock_pb.collection.return_value.get_list.return_value = _rec(total_items=4)
            response = client.post(
                "/api/lodging/placements/copy",
                json={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1"},
            )

        assert response.status_code == 409
        mock_pb.collection.return_value.create.assert_not_called()

    def test_losing_the_seeding_race_is_a_409_not_a_400(self, mock_pb: MagicMock) -> None:
        """Two staff seeding at once, or one double-click.

        Both read an empty scenario, both start creating, and the draft's
        unique index rejects the loser. Left alone `pb_error_to_http` answers
        400 — a different status for the same "somebody already seeded this"
        the up-front check answers with a 409.
        """
        counts: list[Any] = [_rec(total_items=0), _rec(total_items=5)]

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = self._mirror_reads
            mock_pb.collection.return_value.get_list.side_effect = lambda *a, **k: counts.pop(0) if counts else counts
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.post(
                "/api/lodging/placements/copy",
                json={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1"},
            )

        assert response.status_code == 409, response.text

    def test_copying_without_a_scenario_is_refused(self, mock_pb: MagicMock) -> None:
        """The same rule every other write obeys: no scenario, no write."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/placements/copy",
                json={"year": 2026, "session_cm_id": 1000001, "scenario": ""},
            )

        assert response.status_code == 422

    def test_copying_into_an_unknown_weekend_is_404_not_500(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = lambda **_: []
            response = client.post(
                "/api/lodging/placements/copy",
                json={"year": 2026, "session_cm_id": 9999999, "scenario": "scn_1"},
            )

        assert response.status_code == 404


class TestAvailabilityWrites:
    def test_holding_a_cabin_creates_a_weekend_scoped_row(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": False,
                    "reason": "Burst pipe",
                },
            )

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_availability")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["unit"] == "u1"
        assert payload["family_available"] is False
        # The reason is display text and lives in the `note` COLUMN; the API
        # field is `reason`. See AvailabilityWriteRequest.
        assert payload["note"] == "Burst pipe"
        # WEEKEND-scoped, not scenario-scoped. 1500000135 deleted the dimension
        # -- a burst pipe closes a cabin in every plan for that weekend -- and
        # writing one anyway would recreate the overlay from the write side.
        assert "scenario" not in payload
        assert "state" not in payload

    def test_a_non_boolean_availability_is_refused(self, mock_pb: MagicMock) -> None:
        """The three-value enum is gone, so the edge validation is the bool.

        This replaces the old unknown-state check. `state` used to be pinned to
        the migration's select list here so a bad value failed at the edge with
        a 422 rather than at save time in production; the column is a bool now
        and the same argument applies to it.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": "reserved_for_the_dog",
                },
            )

        assert response.status_code == 422

    def test_a_write_is_accepted_with_no_scenario_at_all(self, mock_pb: MagicMock) -> None:
        """The endpoint was UNCALLABLE, and this is the test that says so.

        `AvailabilityWriteRequest` extended `ScenarioWriteRequest`, where
        `scenario` is `min_length=1`, so a body without one was a 422 -- and
        there was no scenario worth supplying, which is a large part of why the
        table still holds zero rows.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.put(
                "/api/lodging/availability",
                json={"year": 2026, "session_cm_id": 1000001, "unit_id": "u1", "family_available": True},
            )

        assert response.status_code == 200, response.text

    def test_clearing_the_override_deletes_the_row(self, mock_pb: MagicMock) -> None:
        """Back to whatever the unit's ROLE says, which is not the same as
        writing an override that happens to agree with it."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'unit = "u1"' in query_filter:
                return [_rec(id="avail_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": None,
                },
            )

        assert response.status_code == 200
        mock_pb.collection.return_value.delete.assert_called_once_with("avail_1")

    def test_an_availability_delete_race_is_not_an_error(self, mock_pb: MagicMock) -> None:
        """The override is found, then vanishes before the delete lands.

        Same race as the placement clear above, on `idx_lodging_avail_unique`
        instead of the draft's index: the find sees the row, but another
        caller removes it before this delete reaches PocketBase, which answers
        404. Left alone that is a bare ClientResponseError into the catch-all
        handler in api/main.py -- a 500 for a release the board is entitled to
        make. A 404 here means the same thing the no-row case already does.
        """

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'unit = "u1"' in query_filter:
                return [_rec(id="avail_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            mock_pb.collection.return_value.delete.side_effect = ClientResponseError(
                "not found", status=404, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": None,
                },
            )

        assert response.status_code == 200, response.text
        assert response.json()["deleted"] is False
        # Same as the placement clear above: the find returned the id, so the
        # response carries it rather than reading like the no-row case.
        assert response.json()["record_id"] == "avail_1"

    def test_an_availability_delete_failure_that_is_not_a_race_still_errors(self, mock_pb: MagicMock) -> None:
        """Only "already gone" is swallowed. A 403 or a 500 from PocketBase is
        a real failure and must not be reported to the board as a clean no-op."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'unit = "u1"' in query_filter:
                return [_rec(id="avail_1")]
            return _session_lookup(**kwargs)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = reads
            mock_pb.collection.return_value.delete.side_effect = ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": None,
                },
            )

        # Pinned, not `>= 400`: a 500 would also satisfy that, and a 500 is the
        # precise outcome the idempotency change is supposed to rule out.
        assert response.status_code == 403

    def test_losing_the_availability_upsert_race_updates_instead_of_500ing(self, mock_pb: MagicMock) -> None:
        """Two staff reserving the same unit for one weekend at the same
        moment.

        `idx_lodging_avail_unique` is UNIQUE on (session, year, unit), as
        1500000135 rebuilt it -- exactly the race `place_party` guards on the
        draft's
        own partial unique index. Both staff find no override, both create,
        and the index rejects the loser. Left alone that is a bare
        ClientResponseError into the catch-all handler in api/main.py -- a 500
        for a reservation the board is entitled to make. The row the winner
        just wrote is exactly what this call wanted to write, so the loser
        adopts it and updates.
        """
        reads: list[list[Any]] = [[], [_rec(id="avail_raced")]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            return reads.pop(0) if reads else []

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": False,
                    "reason": "Burst pipe",
                },
            )

        assert response.status_code == 200, response.text
        mock_pb.collection.return_value.update.assert_called_once()
        assert mock_pb.collection.return_value.update.call_args[0][0] == "avail_raced"

    def test_an_availability_create_failure_that_is_not_a_race_still_errors(self, mock_pb: MagicMock) -> None:
        """The retry is for a lost race, not a blanket swallow.

        If the re-read still finds no row, the create failed for some other
        reason and the caller must hear about it with the upstream status
        rather than a 200 reporting a reservation that does not exist.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "boom", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": False,
                    "reason": "Burst pipe",
                },
            )

        assert response.status_code == 400
        mock_pb.collection.return_value.update.assert_not_called()

    def test_a_failed_re_read_after_a_lost_availability_race_keeps_its_status(self, mock_pb: MagicMock) -> None:
        """The recovery races too, exactly as the placement upsert's does.

        The create loses to `idx_lodging_avail_unique`, then the re-read that
        decides whether it raced fails on its own. That call lives inside the
        except block, so unwrapped it is a bare ClientResponseError into the
        catch-all handler in api/main.py -- a 500, the outcome this guard is
        for.
        """
        reads: list[list[Any]] = [[]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            if reads:
                return reads.pop(0)
            raise ClientResponseError("forbidden", status=403, data={}, url="", is_abort=False, original_error=None)

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": False,
                    "reason": "Burst pipe",
                },
            )

        # Pinned, not `>= 400`: a 500 would also satisfy that, and a 500 is the
        # exact thing this guard rules out.
        assert response.status_code == 403

    def test_a_failed_update_after_a_lost_availability_race_keeps_its_status(self, mock_pb: MagicMock) -> None:
        """The winner's override is found, then the update onto it fails."""
        reads: list[list[Any]] = [[], [_rec(id="avail_raced")]]

        def staged(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if _is_session_lookup(query_filter):
                return _session_lookup(**kwargs)
            return reads.pop(0) if reads else []

        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            mock_pb.collection.return_value.get_full_list.side_effect = staged
            mock_pb.collection.return_value.create.side_effect = ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
            mock_pb.collection.return_value.update.side_effect = ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "unit_id": "u1",
                    "family_available": False,
                    "reason": "Burst pipe",
                },
            )

        assert response.status_code == 403
