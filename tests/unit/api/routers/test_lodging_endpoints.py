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

    def test_phi_reveal_is_logged_by_username_not_email(self, mock_pb: MagicMock) -> None:
        """The audit trail identifies the caller without storing their email.

        A PHI access log inherits the retention and access rules of the log
        store, not of the PHI surface. `username` identifies the caller just
        as well without putting an address into that store.
        """
        mock_pb.collection.return_value.get_full_list.side_effect = _medical_reads

        with (
            patch("api.routers.lodging.pb", mock_pb),
            patch("api.routers.lodging.logger") as mock_logger,
        ):
            app = _build_app(_phi_user(), mock_pb)
            TestClient(app).get("/api/lodging/households/2000001/medical", params={"year": 2026})

        extra = mock_logger.info.call_args[1]["extra"]
        assert extra["user"] == "TestNurse"
        assert "nurse@example.com" not in str(extra.values())
        assert extra["household_cm_id"] == 2000001
        assert extra["year"] == 2026

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
            "unit_id": "u1",
        },
    ),
    (
        "DELETE",
        "/api/lodging/placements",
        "/api/lodging/placements",
        {"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1", "household_cm_id": 2000001},
    ),
    (
        "POST",
        "/api/lodging/merges",
        "/api/lodging/merges",
        {
            "year": 2026,
            "session_cm_id": 1000001,
            "scenario": "scn_1",
            "member_unit_ids": ["u1", "u2"],
            "display_name": "Tenaya 1 and 2",
        },
    ),
    ("DELETE", "/api/lodging/merges/{merge_draft_id}", "/api/lodging/merges/mrgd_1", {}),
    (
        "PUT",
        "/api/lodging/availability",
        "/api/lodging/availability",
        {
            "year": 2026,
            "session_cm_id": 1000001,
            "scenario": "scn_1",
            "unit_id": "u1",
            "state": "reserved_staff",
        },
    ),
]


def _session_lookup(**kwargs: Any) -> list[Any]:
    """Resolve the weekend; everything else reads empty, so writes create."""
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


def _write_client(user: AuthUser, mock_pb: MagicMock) -> TestClient:
    mock_pb.collection.return_value.get_full_list.side_effect = _session_lookup
    mock_pb.collection.return_value.create.return_value = _rec(id="new_1")
    mock_pb.collection.return_value.update.return_value = _rec(id="existing_1")
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
        actual = {
            (method, route.path)
            for route in router.routes
            for method in getattr(route, "methods", set())
            if method in {"POST", "PUT", "PATCH", "DELETE"}
        }
        assert actual == declared, f"write routes not covered by the auth-contract table: {actual ^ declared}"


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
                    "unit_id": "u1",
                },
            )

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_assignments_draft")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["scenario"] == "scn_1"
        assert payload["household_cm_id"] == 2000001
        assert payload["unit"] == "u1"
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
                    "unit_id": "u2",
                },
            )

        assert response.status_code == 200
        assert mock_pb.collection.return_value.create.call_count == 0
        assert mock_pb.collection.return_value.update.call_args[0][0] == "draft_1"

    def test_a_placement_with_no_target_writes_the_tombstone(self, mock_pb: MagicMock) -> None:
        """Unplacing is a ROW, not a deletion.

        Deleting the draft row would fall back to the CampMinder mirror and put
        the family straight back in the cabin staff just dragged them out of.
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
                },
            )

        assert response.status_code == 200
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["unit"] == ""
        assert payload["merge"] == ""
        assert payload["merge_draft"] == ""

    def test_deleting_a_placement_restores_the_campminder_mirror(self, mock_pb: MagicMock) -> None:
        """DELETE removes the override entirely, which is a different thing
        from the tombstone above and the only way back to the synced value."""

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
                    "unit_id": "u1",
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
                json={"year": 2026, "session_cm_id": 1000001, "scenario": "scn_1", "unit_id": "u1"},
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
                    "unit_id": "u1",
                },
            )

        assert response.status_code == 422

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
                    "unit_id": "u1",
                },
            )

        assert response.status_code == 404


class TestMergeWrites:
    def test_creating_a_merge_writes_the_draft_table(self, mock_pb: MagicMock) -> None:
        """The board's merges never touch lodging_merges.

        That table is the ingest's, materialised from CampMinder cabin strings,
        and staff hold no write on it.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/merges",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "member_unit_ids": ["u1", "u2"],
                    "display_name": "Tenaya 1 and 2",
                },
            )

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_merges_draft")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["member_units"] == ["u1", "u2"]
        assert payload["scenario"] == "scn_1"
        assert payload["session_cm_id"] == 1000001

    def test_a_merge_of_fewer_than_two_units_is_refused(self, mock_pb: MagicMock) -> None:
        """member_units is minSelect 2. Refusing here names the member count
        instead of surfacing a PocketBase validation error."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/merges",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "member_unit_ids": ["u1"],
                },
            )

        assert response.status_code == 422

    def test_the_member_set_is_not_validated_for_completeness(self, mock_pb: MagicMock) -> None:
        """A partial building is a legitimate merge.

        The rule "a merge is legal iff its members are the complete child set
        of some container" was built through nine tasks and REMOVED in #1903:
        every member set is hand-authored, so a deliberate partial booking and
        a mis-click produce byte-identical rows. This pins the absence, because
        the idea is appealing enough to be re-added by someone who has not read
        docs/architecture/lodging-occupancy.md.
        """
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.post(
                "/api/lodging/merges",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "member_unit_ids": ["u1", "u2"],
                },
            )

        assert response.status_code == 200

    def test_deleting_a_merge_removes_the_draft_row(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.delete("/api/lodging/merges/mrgd_1")

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_merges_draft")
        mock_pb.collection.return_value.delete.assert_called_once_with("mrgd_1")


class TestAvailabilityWrites:
    def test_setting_a_state_creates_a_scenario_scoped_row(self, mock_pb: MagicMock) -> None:
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "unit_id": "u1",
                    "state": "reserved_staff",
                },
            )

        assert response.status_code == 200
        mock_pb.collection.assert_any_call("lodging_availability")
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["unit"] == "u1"
        assert payload["state"] == "reserved_staff"
        assert payload["scenario"] == "scn_1"

    def test_an_unknown_state_is_refused(self, mock_pb: MagicMock) -> None:
        """The select list in the migration is the constraint. A value that is
        not in it fails at save time in production and nowhere else."""
        with patch("api.routers.lodging.pb", mock_pb):
            client = _write_client(_manage_user(), mock_pb)
            response = client.put(
                "/api/lodging/availability",
                json={
                    "year": 2026,
                    "session_cm_id": 1000001,
                    "scenario": "scn_1",
                    "unit_id": "u1",
                    "state": "reserved_for_the_dog",
                },
            )

        assert response.status_code == 422

    def test_clearing_a_state_deletes_the_scenario_row(self, mock_pb: MagicMock) -> None:
        """Back to whatever the live plan says, which is not the same as
        writing an override that happens to agree with it."""

        def reads(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            if 'scenario = "scn_1"' in query_filter:
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
                    "scenario": "scn_1",
                    "unit_id": "u1",
                    "state": None,
                },
            )

        assert response.status_code == 200
        mock_pb.collection.return_value.delete.assert_called_once_with("avail_1")
