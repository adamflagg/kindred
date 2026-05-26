"""Shape tests for POST /api/solver/pre-validate.

After the Stream 6 refactor, the endpoint must:
  - Include a top-level ``impossibility_report`` field with keys:
    total_impossible, affected_campers, by_reason, flat
  - Remove ``statistics.unsatisfiable_requests``
  - Preserve valid / errors / warnings / statistics / session_breakdown /
    related_sessions in the response

Auth override pattern mirrors test_satisfaction_router.py:
- Build a minimal FastAPI app with just the solver router.
- Override get_current_user with an admin user.
- Patch module-level deps so no real PB or network calls occur.
"""

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.models_v2 import DirectBunk, DirectSolverInput


def _admin_user() -> AuthUser:
    return AuthUser(
        username="TestAdmin",
        email="test@example.com",
        display_name="Test Admin",
        groups=["admin"],
        is_admin=True,
    )


def _empty_solver_input() -> DirectSolverInput:
    """Minimal DirectSolverInput with no persons, bunks, or requests."""
    return DirectSolverInput(persons=[], requests=[], bunks=[])


@dataclass
class _FakeReport:
    """Minimal stand-in for ImpossibilityReport.

    Mirrors the real dataclass field-for-field so ``asdict(report)`` in the
    route produces the same shape the frontend expects.
    """

    total_impossible: int = 0
    affected_campers: int = 0
    by_reason: dict[str, object] = field(default_factory=dict)
    flat: list[object] = field(default_factory=list)
    mp_campers_entirely_impossible: list[dict[str, object]] = field(default_factory=list)
    by_bucket_count: dict[str, int] = field(default_factory=dict)


def _make_session_ctx(session_cm_id: int = 1000001, year: int = 2026) -> MagicMock:
    ctx = MagicMock()
    ctx.session_cm_id = session_cm_id
    ctx.year = year
    ctx.session_relation_filter = f"session.cm_id = {session_cm_id}"
    ctx.session_id_filter = f"session_cm_id = {session_cm_id}"
    ctx.related_session_ids = [session_cm_id]
    return ctx


def _mock_pb() -> MagicMock:
    """Minimal mock of the PocketBase client that returns empty lists."""
    mock = MagicMock()
    mock.collection.return_value.get_full_list.return_value = []
    return mock


@pytest.fixture
def client() -> TestClient:
    from api.routers import solver

    app = FastAPI()
    app.include_router(solver.router)
    app.dependency_overrides[get_current_user] = _admin_user
    return TestClient(app)


_PAYLOAD = {"session_cm_id": 1000001, "year": 2026}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def _apply_standard_mocks(
    mock_build_ctx: AsyncMock,
    mock_fetch: AsyncMock,
    mock_prepare: MagicMock,
    mock_validate: MagicMock,
    mock_config: MagicMock,
    report: _FakeReport | None = None,
) -> None:
    """Set return values on the standard set of mocks."""
    mock_build_ctx.return_value = _make_session_ctx()
    mock_fetch.return_value = ([], [], [], [], [])
    mock_prepare.return_value = _empty_solver_input()
    mock_validate.return_value = report or _FakeReport()
    mock_config.get_instance.return_value = MagicMock()


def test_response_includes_impossibility_report(client: TestClient) -> None:
    """Response must contain top-level ``impossibility_report`` key."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "impossibility_report" in body, "missing impossibility_report field"
    ir = body["impossibility_report"]
    assert "total_impossible" in ir
    assert "affected_campers" in ir
    assert "by_reason" in ir
    assert "flat" in ir


def test_statistics_does_not_include_unsatisfiable_requests(client: TestClient) -> None:
    """``statistics.unsatisfiable_requests`` must not be present in the response."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "statistics" in body
    assert "unsatisfiable_requests" not in body["statistics"], (
        "statistics.unsatisfiable_requests must be removed; use impossibility_report instead"
    )


def test_standard_fields_preserved(client: TestClient) -> None:
    """valid / errors / warnings / statistics / session_breakdown / related_sessions must still be present."""
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    for key in ("valid", "errors", "warnings", "statistics", "session_breakdown", "related_sessions"):
        assert key in body, f"missing required field: {key}"

    stats = body["statistics"]
    for key in (
        "total_campers",
        "total_bunks",
        "total_capacity",
        "total_requests",
        "campers_with_requests",
        "campers_without_requests",
    ):
        assert key in stats, f"missing statistics.{key}"


def test_prevalidate_response_no_clusters_key(client: TestClient) -> None:
    """impossibility_report should not contain a clusters field after Stage 4 cleanup.

    This test is intentionally RED until Task A7 removes the clusters serializer
    from api/routers/solver.py and bunking/solver/direct_solver.py.
    """
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "impossibility_report" in body
    assert "clusters" not in body["impossibility_report"], (
        f"clusters key should be removed, got {list(body['impossibility_report'].keys())}"
    )


def test_capacity_breakdown_uses_actual_bunk_capacities(client: TestClient) -> None:
    """Segmented (boys/girls/AG) capacity must sum each bunk's actual capacity,
    not multiply bunk count by DEFAULT_BUNK_CAPACITY.

    Regression guard: real bunks vary in size, so a count*default approximation
    produces false 'over capacity' errors when bunks happen to be smaller (or
    misses real overflow when bunks are larger) than the default."""
    bunks = [
        # Boys: 2 bunks summing to 8+10 = 18 beds (not 2 * DEFAULT_BUNK_CAPACITY=24)
        DirectBunk(id="b1", campminder_id=1, name="Cabin A", capacity=8, gender="M", session_cm_id=1000001),
        DirectBunk(id="b2", campminder_id=2, name="Cabin B", capacity=10, gender="M", session_cm_id=1000001),
        # Girls: 1 bunk with 14 beds (not 1 * 12 = 12)
        DirectBunk(id="b3", campminder_id=3, name="Cabin C", capacity=14, gender="F", session_cm_id=1000001),
        # AG/Mixed: 1 bunk with 6 beds (not 1 * 12 = 12)
        DirectBunk(id="b4", campminder_id=4, name="Cabin D", capacity=6, gender="Mixed", session_cm_id=1000001),
    ]
    solver_input = DirectSolverInput(persons=[], requests=[], bunks=bunks)

    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        mock_build_ctx.return_value = _make_session_ctx()
        mock_fetch.return_value = ([], [], [], [], [])
        mock_prepare.return_value = solver_input
        mock_validate.return_value = _FakeReport()
        mock_config.get_instance.return_value = MagicMock()
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    breakdown = resp.json()["statistics"]["capacity_breakdown"]
    assert breakdown["boys"]["beds"] == 18, breakdown
    assert breakdown["girls"]["beds"] == 14, breakdown
    assert breakdown["ag"]["beds"] == 6, breakdown


def test_response_includes_mp_campers_entirely_impossible(client: TestClient) -> None:
    """The /solver/pre-validate response surfaces the camper-level MP rollup."""
    fake_report = _FakeReport(
        total_impossible=1,
        affected_campers=1,
        mp_campers_entirely_impossible=[
            {
                "cm_id": 1,
                "name": "Emma Johnson",
                "grade": 5,
                "gender": "F",
                "reason_codes": ["target_not_in_solver"],
            },
        ],
    )
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config, report=fake_report)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    ir = resp.json()["impossibility_report"]
    assert "mp_campers_entirely_impossible" in ir
    assert ir["mp_campers_entirely_impossible"] == [
        {
            "cm_id": 1,
            "name": "Emma Johnson",
            "grade": 5,
            "gender": "F",
            "reason_codes": ["target_not_in_solver"],
        },
    ]


def test_response_includes_by_bucket_count(client: TestClient) -> None:
    """The /solver/pre-validate response surfaces the per-bucket counts.

    Regression guard: a prior hand-rolled response dict omitted this field,
    causing the frontend modal to crash on ``report.by_bucket_count[bucket]``
    when rendering filter chips.

    The endpoint strips immaterial_parent entries (Group 65 #1537), so only
    material_parent and staff counts appear in the response.
    """
    fake_report = _FakeReport(
        total_impossible=4,
        affected_campers=3,
        by_bucket_count={"material_parent": 2, "immaterial_parent": 1, "staff": 1},
    )
    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config, report=fake_report)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    ir = resp.json()["impossibility_report"]
    assert "by_bucket_count" in ir, f"missing by_bucket_count; got keys {list(ir.keys())}"
    # immaterial_parent is filtered out by _filter_immaterial_from_report
    assert ir["by_bucket_count"] == {
        "material_parent": 2,
        "staff": 1,
    }
    assert "immaterial_parent" not in ir["by_bucket_count"]


def test_pre_validate_excludes_immaterial_from_impossibility_report(client: TestClient) -> None:
    """IMMATERIAL_PARENT bucket rows are filtered from report.flat and by_reason.

    Group 65 #1537 — socialize_with requests are parent age-pref dropdowns and
    are not actionable signals for staff. The pre-check modal should not surface
    them in the impossibility list.

    Fixture: report has 1 bunk_with item (material_parent bucket) and
    1 socialize_with item (immaterial_parent bucket). After filtering, only
    the material_parent item remains; total_impossible and affected_campers
    are re-derived from the filtered set.
    """
    from bunking.solver.impossibility import ImpossibleItem

    material_item = ImpossibleItem(
        request_id="r_bw",
        reason_code="cross_gender",
        reason_message="Emma Johnson requested Liam Garcia but they are different genders.",
        request_type="bunk_with",
        requester={"cm_id": 10, "name": "Emma Johnson", "grade": 6, "gender": "F"},
        requestee={"cm_id": 20, "name": "Liam Garcia", "grade": 6, "gender": "M"},
        detail={},
        bucket="material_parent",
    )
    immaterial_item = ImpossibleItem(
        request_id="r_sw",
        reason_code="cross_session",
        reason_message="Olivia Chen requested Riley Sam but they are in different sessions.",
        request_type="socialize_with",
        requester={"cm_id": 30, "name": "Olivia Chen", "grade": 7, "gender": "F"},
        requestee={"cm_id": 40, "name": "Riley Sam", "grade": 7, "gender": "F"},
        detail={},
        bucket="immaterial_parent",
    )
    fake_report = _FakeReport(
        total_impossible=2,
        affected_campers=2,
        by_reason={
            "cross_gender": [material_item],
            "cross_session": [immaterial_item],
        },
        flat=[material_item, immaterial_item],
        by_bucket_count={"material_parent": 1, "immaterial_parent": 1},
    )

    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config, report=fake_report)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    ir = resp.json()["impossibility_report"]

    # flat must contain only the material_parent item
    flat_buckets = {item.get("bucket") for item in ir["flat"]}
    assert "immaterial_parent" not in flat_buckets, f"immaterial_parent leaked into flat: {flat_buckets}"
    assert "material_parent" in flat_buckets, "material_parent item was incorrectly removed"

    # by_reason keys that have immaterial items must be empty or absent
    for reason_code, items in ir["by_reason"].items():
        immaterial_in_reason = [i for i in items if i.get("bucket") == "immaterial_parent"]
        assert immaterial_in_reason == [], (
            f"immaterial_parent item found in by_reason[{reason_code!r}]: {immaterial_in_reason}"
        )

    # totals are re-derived from the filtered set
    assert ir["total_impossible"] == 1, f"expected 1, got {ir['total_impossible']}"
    assert ir["affected_campers"] == 1, f"expected 1, got {ir['affected_campers']}"


def test_response_propagates_self_conflict_bucket(client: TestClient) -> None:
    """A self_conflict bucket in the impossibility report is present in the response."""
    from bunking.solver.impossibility import ImpossibleItem

    self_conflict_item = ImpossibleItem(
        request_id="r_bw",
        reason_code="self_conflict",
        reason_message="Emma Johnson has both a 'bunk_with' and a 'not_bunk_with' request toward Liam Garcia.",
        request_type="bunk_with",
        requester={"cm_id": 1, "name": "Emma Johnson", "grade": 6, "gender": "F"},
        requestee={"cm_id": 2, "name": "Liam Garcia", "grade": 6, "gender": "M"},
        detail={
            "conflicting_request_id": "r_nbw",
            "requested_person_cm_id": 2,
            "this_type": "bunk_with",
            "conflicting_type": "not_bunk_with",
        },
    )
    fake_report = _FakeReport(
        total_impossible=1,
        affected_campers=1,
        by_reason={"self_conflict": [self_conflict_item]},
        flat=[self_conflict_item],
    )

    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        _apply_standard_mocks(mock_build_ctx, mock_fetch, mock_prepare, mock_validate, mock_config, report=fake_report)
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    ir = body["impossibility_report"]
    assert ir["total_impossible"] == 1
    assert ir["affected_campers"] == 1
    assert "self_conflict" in ir["by_reason"]
    bucket = ir["by_reason"]["self_conflict"]
    assert len(bucket) == 1
    assert bucket[0]["reason_code"] == "self_conflict"
    assert bucket[0]["request_id"] == "r_bw"
    assert bucket[0]["detail"]["conflicting_request_id"] == "r_nbw"


def test_total_requests_excludes_immaterial_rows(client: TestClient) -> None:
    """statistics.total_requests must count only COUNTED-bucket requests.

    Regression guard for GitHub #1665: the pre-validate endpoint was using
    ``len(solver_input.requests)`` which includes socialize_with rows that
    classify as IMMATERIAL_PARENT. The solver's own finish-stats use
    ``is_counted_request()`` as the filter, so the two counts diverged by
    the number of socialize_with / immaterial rows (~5 in session 2a).

    Fixture: 3 counted requests (2 × bunk_request_form bunk_with, 1 × manual
    not_bunk_with) + 2 immaterial requests (socialize_with source field).
    The endpoint must report total_requests = 3, not 5.
    """
    from bunking.models_v2 import DirectBunkRequest, DirectSolverInput

    counted_requests = [
        # Emma Johnson → Liam Garcia (bunk_with, counted form field)
        DirectBunkRequest(
            id="r1",
            requester_person_cm_id=10,
            requested_person_cm_id=20,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2026,
            source_field="bunk_request_form",
            status="resolved",
        ),
        # Olivia Chen → Riley Sam (bunk_with, counted form field)
        DirectBunkRequest(
            id="r2",
            requester_person_cm_id=30,
            requested_person_cm_id=40,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2026,
            source_field="bunk_request_form",
            status="resolved",
        ),
        # Samuel Johnson: staff manual not_bunk_with (counted staff bucket)
        DirectBunkRequest(
            id="r3",
            requester_person_cm_id=50,
            requested_person_cm_id=60,
            request_type="not_bunk_with",
            session_cm_id=1000001,
            year=2026,
            source_field="manual",
            status="resolved",
        ),
    ]
    immaterial_requests = [
        # socialize_with rows — IMMATERIAL_PARENT bucket, excluded from counts
        DirectBunkRequest(
            id="r4",
            requester_person_cm_id=10,
            requested_person_cm_id=None,
            request_type="age_preference",
            session_cm_id=1000001,
            year=2026,
            source_field="socialize_with",
            status="resolved",
        ),
        DirectBunkRequest(
            id="r5",
            requester_person_cm_id=30,
            requested_person_cm_id=None,
            request_type="age_preference",
            session_cm_id=1000001,
            year=2026,
            source_field="socialize_with",
            status="resolved",
        ),
    ]
    solver_input = DirectSolverInput(
        persons=[],
        requests=counted_requests + immaterial_requests,
        bunks=[],
    )

    with (
        patch("api.routers.solver.pb", _mock_pb()),
        patch("api.routers.solver.build_session_context", new_callable=AsyncMock) as mock_build_ctx,
        patch("api.routers.solver.fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
        patch("api.routers.solver.prepare_direct_solver_input") as mock_prepare,
        patch("api.routers.solver.validate_impossibility") as mock_validate,
        patch("api.routers.solver.ConfigLoader") as mock_config,
    ):
        mock_build_ctx.return_value = _make_session_ctx()
        mock_fetch.return_value = ([], [], [], [], [])
        mock_prepare.return_value = solver_input
        mock_validate.return_value = _FakeReport()
        mock_config.get_instance.return_value = MagicMock()
        resp = client.post("/api/solver/pre-validate", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    stats = resp.json()["statistics"]
    assert stats["total_requests"] == 3, (
        f"Expected 3 (counted only), got {stats['total_requests']}; "
        f"socialize_with rows must not be counted (GitHub #1665)"
    )
