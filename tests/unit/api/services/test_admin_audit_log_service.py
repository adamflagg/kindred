"""The admin audit log read service (spec 2026-09-26 §6): the filter, the
view-as merge and the person list. PocketBase is faked; the filter string is
asserted as PocketBase will receive it."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from typing import Any

import pytest

from api.services.admin_audit_log_service import AdminAuditLogService, build_filter, to_entry


def _row(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "r" + str(abs(hash(str(fields))) % 10**14).zfill(14),
        "created": datetime(2026, 9, 25, 16, 20, 7),
        "type": "settings",
        "action": "update",
        "actor_kind": "user",
        "actor_id": "u1",
        "actor_email": "alex.rivera@example.com",
        "actor_name": "Alex Rivera",
        "collection": "",
        "record_id": "",
        "target_label": "",
        "before": None,
        "after": None,
        "fields": "",
        "session_id": "",
        "detail": None,
        "ip": "10.0.20.5",
    }
    base.update(fields)
    return SimpleNamespace(**base)


class FakeCollection:
    def __init__(self, rows: list[SimpleNamespace], stops: list[SimpleNamespace] | None = None) -> None:
        self.rows = rows
        self.stops = stops or []
        self.list_calls: list[tuple[int, int, dict[str, Any]]] = []
        self.full_calls: list[dict[str, Any]] = []

    def get_list(self, page: int, per_page: int, query_params: dict[str, Any]) -> SimpleNamespace:
        self.list_calls.append((page, per_page, query_params))
        return SimpleNamespace(items=self.rows, total_items=42, page=page, per_page=per_page)

    def get_full_list(self, batch: int, query_params: dict[str, Any]) -> list[SimpleNamespace]:
        self.full_calls.append(query_params)
        return self.stops if "view_as_stop" in query_params["filter"] else self.rows


class FakePB:
    def __init__(self, collection: FakeCollection) -> None:
        self._collection = collection

    def collection(self, name: str) -> FakeCollection:
        assert name == "admin_audit_log"
        return self._collection


def test_default_filter_hides_sign_ins_and_view_as_stop_rows() -> None:
    assert build_filter(types=[], actor=None, q=None, sign_ins=False) == (
        "action != 'view_as_stop' && type != 'sign_in'"
    )


def test_the_sign_ins_chip_shows_everything() -> None:
    assert build_filter(types=[], actor=None, q=None, sign_ins=True) == "action != 'view_as_stop'"


def test_type_buttons_combine_with_the_sign_ins_chip() -> None:
    assert build_filter(types=["roles", "access"], actor=None, q=None, sign_ins=True) == (
        "action != 'view_as_stop' && (type = 'access' || type = 'roles' || type = 'sign_in')"
    )


def test_actor_and_q_are_escaped() -> None:
    got = build_filter(types=["settings"], actor='o"brien@example.com', q="Cabin 14'", sign_ins=False)
    assert 'actor_email = "o\\"brien@example.com"' in got
    assert 'target_label ~ "Cabin 14\\\'"' in got


def test_q_never_searches_before_after_or_detail() -> None:
    """Values can be long and would surface family data in results (spec §6)."""
    got = build_filter(types=[], actor=None, q="Emma Johnson", sign_ins=False)
    for field in ("actor_name", "actor_email", "target_label", "collection", "record_id", "fields"):
        assert f'{field} ~ "Emma Johnson"' in got
    for never in ("before", "after", "detail"):
        assert never not in got


def test_to_entry_splits_fields_and_formats_created() -> None:
    entry = to_entry(_row(fields="beds name", before={"beds": 8}, after={"beds": 10}))
    assert entry.fields == ["beds", "name"]
    assert entry.created == "2026-09-25T16:20:07Z"
    assert entry.before == {"beds": 8}


@pytest.mark.asyncio
async def test_list_page_passes_paging_and_newest_first() -> None:
    collection = FakeCollection([_row()])
    page = await AdminAuditLogService(FakePB(collection)).list_page(
        types=[], actor=None, q=None, sign_ins=False, page=3, per_page=15
    )
    assert collection.list_calls[0][:2] == (3, 15)
    assert collection.list_calls[0][2]["sort"] == "-created,-id"
    assert (page.page, page.per_page, page.total) == (3, 15, 42)


@pytest.mark.asyncio
async def test_a_view_as_session_is_one_line_with_its_end() -> None:
    start = _row(type="view_as", action="view_as_start", session_id="sess-0001", detail={"persona": "Registrar"})
    open_start = _row(type="view_as", action="view_as_start", session_id="sess-0002", detail={"persona": "Finance"})
    stop = _row(type="view_as", action="view_as_stop", session_id="sess-0001", created=datetime(2026, 9, 25, 16, 34, 0))
    collection = FakeCollection([start, open_start], stops=[stop])
    page = await AdminAuditLogService(FakePB(collection)).list_page(
        types=[], actor=None, q=None, sign_ins=False, page=1, per_page=10
    )
    by_session = {i.session_id: i for i in page.items}
    assert by_session["sess-0001"].ended == "2026-09-25T16:34:00Z"
    assert by_session["sess-0002"].ended is None  # a closed tab: no end recorded
    assert 'session_id = "sess-0001"' in collection.full_calls[0]["filter"]


@pytest.mark.asyncio
async def test_a_stop_from_a_different_actor_does_not_end_the_start() -> None:
    """One admin must not be able to end another admin's preview on screen: a
    stop with the same session_id but a different actor_id leaves the start
    open (matching by session_id alone would let it through)."""
    start = _row(
        type="view_as",
        action="view_as_start",
        session_id="sess-0003",
        actor_id="admin-1",
        detail={"persona": "Registrar"},
    )
    stop = _row(
        type="view_as",
        action="view_as_stop",
        session_id="sess-0003",
        actor_id="admin-2",
        created=datetime(2026, 9, 25, 16, 34, 0),
    )
    collection = FakeCollection([start], stops=[stop])
    page = await AdminAuditLogService(FakePB(collection)).list_page(
        types=[], actor=None, q=None, sign_ins=False, page=1, per_page=10
    )
    assert page.items[0].ended is None


@pytest.mark.asyncio
async def test_actors_are_distinct_newest_name_first_and_sorted() -> None:
    rows = [
        _row(actor_email="jordan.lee@example.com", actor_name="Jordan Lee"),
        _row(actor_email="alex.rivera@example.com", actor_name="Alex Rivera"),
        _row(actor_email="alex.rivera@example.com", actor_name="Alex R."),
        _row(actor_email="owner@example.com", actor_name=""),
    ]
    actors = (await AdminAuditLogService(FakePB(FakeCollection(rows))).list_actors()).actors
    assert [(a.email, a.name) for a in actors] == [
        ("alex.rivera@example.com", "Alex Rivera"),
        ("jordan.lee@example.com", "Jordan Lee"),
        ("owner@example.com", ""),
    ]
