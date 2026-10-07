"""Season › History's routes (D49, §7.6): the gate, the rules check and the error mapping. Bare app (persona_client)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from api.schemas.financial_aid_history import (
    HistoryFiguresOut,
    HistoryOperationDetailOut,
    HistoryOperationOut,
    HistoryPageOut,
    HistoryRowOut,
)
from api.services.financial_aid_season_history import HistoryNotFoundError
from bunking.rbac.permissions import Permission
from tests.unit.rbac.permission_personas import (
    PERSONA_FINANCE,
    PERSONA_REGISTRAR,
    assert_persona_access,
    assert_requires_permission,
    persona_client,
)

PAGE = HistoryPageOut(year=2031, page=1, per_page=50, total=0, operations=[], actors=[], kind_counts=[])


def _stub() -> MagicMock:
    stub = MagicMock()
    stub.page = AsyncMock(return_value=PAGE)
    stub.operation = AsyncMock(side_effect=HistoryNotFoundError("no such operation"))
    return stub


def test_the_routes_let_through_exactly_view() -> None:
    from api.routers import financial_aid as r

    with patch.object(r, "_history", return_value=_stub()):
        assert_persona_access(
            r.router, "GET", "/api/financial-aid/history/2031", allowed={PERSONA_REGISTRAR, PERSONA_FINANCE}
        )
        assert_persona_access(
            r.router,
            "GET",
            f"/api/financial-aid/history/2031/operations/{'a' * 15}",
            allowed={PERSONA_REGISTRAR, PERSONA_FINANCE},
        )
    assert_requires_permission(r.get_season_history, Permission.FINANCIAL_AID_VIEW)
    assert_requires_permission(r.get_season_history_operation, Permission.FINANCIAL_AID_VIEW)


def test_rules_rows_follow_the_readers_rules_permission() -> None:
    from api.routers import financial_aid as r

    for persona, rules in ((PERSONA_REGISTRAR, False), (PERSONA_FINANCE, True)):
        stub = _stub()
        with patch.object(r, "_history", return_value=stub):
            response = persona_client(r.router, persona).get(
                "/api/financial-aid/history/2031", params={"kind": ["rules", "holds"], "q": "march", "page": 2}
            )
        assert response.status_code == 200
        f = stub.page.call_args.args[1]
        assert (f.rules, f.kinds, f.text, stub.page.call_args.kwargs["page"]) == (
            rules,
            frozenset({"rules", "holds"}),
            "march",
            2,
        )


def test_an_unknown_operation_is_404_and_a_malformed_id_422() -> None:
    from api.routers import financial_aid as r

    with patch.object(r, "_history", return_value=_stub()):
        client = persona_client(r.router, PERSONA_REGISTRAR)
        assert client.get(f"/api/financial-aid/history/2031/operations/{'a' * 15}").status_code == 404
        assert client.get("/api/financial-aid/history/2031/operations/NOT-AN-ID").status_code == 422


def test_an_opened_operations_rows_carry_request_id_and_session_and_both_are_optional() -> None:
    """§9.8 (PR 3): each row names its request and session; a row built without them still serializes, as None."""
    from api.routers import financial_aid as r

    at = datetime(2031, 3, 9, 18, 0, tzinfo=UTC)
    op = HistoryOperationOut(
        operation_id="a" * 15,
        at=at,
        actor="finance@example.com",
        kind="offers",
        reason="",
        rows=2,
        counts=[],
        rules_versions=[],
        rules_sections=[],
        summary="",
        figures=HistoryFiguresOut(requests=1, families=1, locked=None, round3_entered=None, asked=None),
        effect=None,
    )
    common: dict[str, Any] = {
        "at": at,
        "entity": "aid_decisions",
        "action": "post",
        "actor": "finance@example.com",
        "reason": "",
        "before": None,
        "after": None,
        "changes": [],
        "household_cm_id": 1000001,
        "household_name": "The Johnson Family",
        "camper_name": "Emma Johnson",
        "against_parent": None,
    }
    named = HistoryRowOut(entity_id="req000000000001:1", request_id="req000000000001", session_cm_id=1000102, **common)
    bare = HistoryRowOut(entity_id="req000000000002:1", **common)  # built without the two keys: they default
    stub = _stub()
    stub.operation = AsyncMock(return_value=HistoryOperationDetailOut(year=2031, operation=op, rows=[named, bare]))
    with patch.object(r, "_history", return_value=stub):
        response = persona_client(r.router, PERSONA_FINANCE).get(
            f"/api/financial-aid/history/2031/operations/{'a' * 15}"
        )
    assert response.status_code == 200
    assert [(row["request_id"], row["session_cm_id"]) for row in response.json()["rows"]] == [
        ("req000000000001", 1000102),
        (None, None),
    ]
