"""build(year) re-homes a request when its camper's household changes within one aid family.

The wiring: the season's aid_household_links decide "one family" (family_household_set, staff links included), the
planner's moves go through the run's one commit, and each moved record logs ONE aid_change_log row, action
"move_household". Fictional data only (tests/CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_decisions_service import _shares_as_of
from api.services.financial_aid_intake_plan import IntakePlan, Move
from api.services.financial_aid_intake_service import FinancialAidIntakeService, IntakeReport, plan_writes
from api.services.financial_aid_intake_types import (
    AdditionRecord,
    ApplicationRecord,
    AttendeeRow,
    CorrectionRecord,
    PayerShareRecord,
    RequestRecord,
)
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent, fold_rounds
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, intake_rules

OLD, NEW, OTHER = 1000001, 1000005, 1000009
EMMA, SAMUEL = 1000011, 1000012  # siblings: Emma and Samuel Johnson
SESSION_2, TASTE_1 = 1000101, 1000104
MOVE = "move_household"


def link(household_cm_id: int, family_key: str = "family-1", *, excluded: bool = False) -> SimpleNamespace:
    """An aid_household_links row as family_household_set reads it; a staff link has the same shape."""
    return SimpleNamespace(household_cm_id=household_cm_id, family_key=family_key, excluded=excluded)


def siblings_store() -> FakeAidStore:
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [
        fa_row(EMMA, OLD, summer="Session 2", summer_ask=1500.0, total_gross_income=85000.0),
        fa_row(SAMUEL, OLD, summer="Session 2", summer_ask=1200.0, total_gross_income=85000.0),
    ]
    store.attendees = [AttendeeRow(EMMA, OLD, SESSION_2, 2), AttendeeRow(SAMUEL, OLD, SESSION_2, 2)]
    store.links = [link(OLD), link(NEW)]
    return store


def move(store: FakeAidStore, person: int, to: int) -> None:
    """What #3242 plus the aid-form sync do: the camper's form row and registration name the new household."""
    store.fa_rows = [replace(r, household_cm_id=to) if r.person_cm_id == person else r for r in store.fa_rows]
    store.attendees = [replace(a, household_cm_id=to) if a.person_cm_id == person else a for a in store.attendees]


async def build(store: FakeAidStore) -> IntakeReport:
    return await FinancialAidIntakeService(store).build(YEAR)


def rows_since(store: FakeAidStore, start: int) -> list[dict[str, Any]]:
    return store.change_log[start:]


@pytest.mark.asyncio
async def test_one_camper_moving_to_an_empty_household_of_the_family_keeps_its_posted_request_in_place() -> None:
    """The case CampMinder will produce (the primary fixture): one camper alone on the old household's application
    moves to a household of the same aid family (joined by a staff link) that holds nothing yet. The request carries
    a POSTED Round 1. Expected: one move in place, zero withdrawals and zero creates; the decision stays on it."""
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [fa_row(EMMA, OLD, summer="Session 2", summer_ask=3000.0, total_gross_income=60000.0)]
    store.attendees = [AttendeeRow(EMMA, OLD, SESSION_2, 2)]
    store.links = [link(OLD, "staff:family-1"), link(NEW, "staff:family-1")]
    await build(store)
    (request,) = store.requests.values()
    (application,) = store.applications.values()
    (share,) = store.payer_shares.values()
    store.decision_events.append(
        DecisionEvent(
            id="evt000000000001",
            request_id=request.id,
            round=1,
            kind="post",
            created=datetime(2027, 3, 9, tzinfo=UTC),
            amount=Decimal(3000),
            lock_source="tick",
        )
    )
    start, writes = len(store.change_log), len(store.writes)

    move(store, EMMA, NEW)
    report = await build(store)

    (after,) = store.requests.values()
    assert (after.id, after.status, after.household_cm_id, after.application_id) == (
        request.id,
        "active",
        NEW,
        application.id,
    )
    assert store.applications[application.id].household_cm_id == NEW
    (moved_share,) = store.payer_shares.values()
    assert (moved_share.request_id, moved_share.household_cm_id, moved_share.share_pct, moved_share.source) == (
        request.id,
        NEW,
        share.share_pct,
        share.source,
    )
    assert fold_rounds(store.decision_events)[request.id][1].posted
    new_writes = store.writes[writes:]
    # A payer share's log key names its household (share_entity_id), so its move is the old key's delete and the
    # new key's create: an as-of read then replays it on NEW (test_a_moved_default_share_replays_...).
    assert sorted(new_writes) == sorted(
        [
            ("PATCH aid_requests", request.id),
            ("PATCH aid_applications", application.id),
            ("DELETE aid_payer_shares", share.id),
            ("POST aid_payer_shares", moved_share.id),
        ]
    )
    rows = rows_since(store, start)
    assert [(r["entity"], r["action"]) for r in rows if r["entity_id"] == request.id] == [("aid_requests", MOVE)]
    assert {r["action"] for r in rows} == {MOVE}
    assert (report.requests_moved, report.requests_created, report.applications_created) == (1, 0, 0)
    assert "withdrawn" not in {(r.get("after") or {}).get("status") for r in rows}  # a delete row has no after

    writes = len(store.writes)
    again = await build(store)
    assert (len(store.writes), again.operation_id) == (writes, "")


def share_log(store: FakeAidStore, instants: list[tuple[int, datetime]]) -> list[LogRow]:
    """The fake's aid_payer_shares log rows as the as-of read takes them; rows from index i on carry instant t."""
    rows: list[LogRow] = []
    for index, row in enumerate(store.change_log):
        if row["entity"] != "aid_payer_shares":
            continue
        created = max(t for start, t in instants if start <= index)
        rows.append(
            LogRow(f"log{index:012d}", row["entity"], row["entity_id"], row.get("before"), row.get("after"), created)
        )
    return rows


@pytest.mark.asyncio
async def test_a_moved_default_share_replays_on_its_new_household_as_of_after_the_move() -> None:
    """Payer shares are replayed per "<request>:<household>" key (_shares_as_of). The move must close the old key and
    open the new one, or an as-of read after it shows the share still on OLD and the request's share history as
    unreplayable."""
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [fa_row(EMMA, OLD, summer="Session 2", summer_ask=3000.0, total_gross_income=60000.0)]
    store.attendees = [AttendeeRow(EMMA, OLD, SESSION_2, 2)]
    store.links = [link(OLD, "staff:family-1"), link(NEW, "staff:family-1")]
    first = datetime(2027, 3, 1, tzinfo=UTC)
    second = datetime(2027, 3, 10, tzinfo=UTC)
    await build(store)
    (request,) = store.requests.values()
    moved_at = len(store.change_log)
    move(store, EMMA, NEW)
    await build(store)
    log = share_log(store, [(0, first), (moved_at, second)])
    current = list(store.payer_shares.values())

    after, bad_requests, bad_households = _shares_as_of(current, log, datetime(2027, 3, 11, tzinfo=UTC))
    assert (bad_requests, bad_households) == (frozenset(), frozenset())
    assert [(s.household_cm_id, s.share_pct) for s in after[request.id]] == [(NEW, Decimal(100))]

    before, bad_requests, _ = _shares_as_of(current, log, datetime(2027, 3, 5, tzinfo=UTC))
    assert bad_requests == frozenset()
    assert [(s.household_cm_id, s.share_pct) for s in before[request.id]] == [(OLD, Decimal(100))]


def test_a_moves_records_are_written_together_ahead_of_the_runs_other_writes() -> None:
    """A run over the batch limit is chunked, each chunk atomic. A move's records (request, its corrections, its default
    share, the camper's addition) go together, before the run's other updates and creates, so a later chunk failing
    can never strand a share or an addition on the household the request left (the next run would not see a move)."""
    app_old = ApplicationRecord("app000000000001", YEAR, OLD, "active", {}, (EMMA, SAMUEL), ())
    moved = RequestRecord(
        id="req000000000001",
        year=YEAR,
        application_id=app_old.id,
        household_cm_id=OLD,
        person_cm_id=SAMUEL,
        session_cm_id=SESSION_2,
        program_key="summer",
        program_option_text="Session 2",
        program_option_key="session-2",
        session_resolution="auto",
        ask=1200.0,
        headcount_non_infant=1,
        headcount_infant=0,
        headcount_source="billed",
        status="active",
        duplicate_of="",
    )
    stays = replace(moved, id="req000000000002", person_cm_id=EMMA)
    share = PayerShareRecord("sh0000000000001", YEAR, moved.id, OLD, Decimal(100), "intake_default", "system:intake")
    plan = IntakePlan(
        application_updates=[(app_old.id, {"member_person_cm_ids": [EMMA]})],
        request_updates=[(stays.id, {"ask": 1300.0})],
        request_moves=[Move(moved.id, OLD, NEW)],
        share_moves=[Move(share.id, OLD, NEW, moved.id)],
        addition_moves=[Move("add000000000001", OLD, NEW)],
    )
    plan.application_creates.append(
        (NEW, {"status": "active", "answers": {}, "member_person_cm_ids": [SAMUEL], "flags": []})
    )
    writes = plan_writes(YEAR, plan, [app_old], [moved, stays], shares=[share])
    order = [(w.collection, w.action, w.log_action) for w in writes]
    assert order == [
        ("aid_applications", "create", None),
        ("aid_requests", "update", MOVE),
        ("aid_payer_shares", "delete", MOVE),
        ("aid_payer_shares", "create", MOVE),
        ("aid_request_additions", "update", MOVE),
        ("aid_applications", "update", None),
        ("aid_requests", "update", None),
    ]
    delete, create = writes[2], writes[3]
    assert (delete.record_id, delete.entity_id) == (share.id, f"{moved.id}:{OLD}")
    assert create.entity_id == f"{moved.id}:{NEW}"
    assert create.data is not None
    assert {k: create.data[k] for k in ("request", "household_cm_id", "source", "actor")} == {
        "request": moved.id,
        "household_cm_id": NEW,
        "source": "intake_default",
        "actor": "system:intake",
    }


@pytest.mark.asyncio
async def test_a_camper_with_a_withdrawn_request_still_moves_in_place_and_the_withdrawn_request_rides_along() -> None:
    """The prod shape after an earlier answer change: the camper's application also holds a withdrawn request. Only
    live requests decide the in-place re-key (owner ruling 2026-10-16), and the withdrawn one moves with the
    application, still withdrawn: no application or request is created and nothing is withdrawn."""
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [fa_row(EMMA, OLD, summer="Taste of Camp 1", summer_ask=900.0, total_gross_income=60000.0)]
    store.attendees = [AttendeeRow(EMMA, OLD, SESSION_2, 2), AttendeeRow(EMMA, OLD, TASTE_1, 2)]
    store.links = [link(OLD, "staff:family-1"), link(NEW, "staff:family-1")]
    await build(store)
    store.fa_rows = [fa_row(EMMA, OLD, summer="Session 2", summer_ask=3000.0, total_gross_income=60000.0)]
    await build(store)
    statuses = sorted(r.status for r in store.requests.values())
    assert statuses == ["active", "withdrawn"]
    (application,) = store.applications.values()
    start, writes = len(store.change_log), len(store.writes)

    move(store, EMMA, NEW)
    report = await build(store)

    assert {(r.household_cm_id, r.application_id) for r in store.requests.values()} == {(NEW, application.id)}
    assert sorted(r.status for r in store.requests.values()) == statuses
    assert len(store.applications) == 1
    assert (store.applications[application.id].household_cm_id, store.applications[application.id].status) == (
        NEW,
        "active",
    )
    new_writes = store.writes[writes:]
    assert {w[0] for w in new_writes if w[0].startswith("POST")} == {"POST aid_payer_shares"}
    rows = rows_since(store, start)
    assert {row["action"] for row in rows} == {MOVE}
    assert sorted(r["entity"] for r in rows if r["entity"] == "aid_requests") == ["aid_requests"] * 2
    assert report.applications_created == 0

    writes = len(store.writes)
    again = await build(store)
    assert (len(store.writes), again.operation_id) == (writes, "")


@pytest.mark.asyncio
async def test_unchanged_data_writes_nothing_with_the_family_linked() -> None:
    store = siblings_store()
    await build(store)
    writes = len(store.writes)
    report = await build(store)
    assert (len(store.writes), report.operation_id, report.requests_moved) == (writes, "", 0)


@pytest.mark.asyncio
async def test_both_siblings_moving_within_one_family_keep_their_requests_application_and_shares() -> None:
    store = siblings_store()
    await build(store)
    before = {r.person_cm_id: r for r in store.requests.values()}
    (application,) = store.applications.values()
    shares = {s.request_id: s.id for s in store.payer_shares.values()}
    start, writes = len(store.change_log), len(store.writes)

    move(store, EMMA, NEW)
    move(store, SAMUEL, NEW)
    report = await build(store)

    after = {r.person_cm_id: r for r in store.requests.values()}
    assert len(store.requests) == 2  # nothing created
    for person in (EMMA, SAMUEL):
        moved = after[person]
        assert moved.id == before[person].id
        assert (moved.household_cm_id, moved.status, moved.application_id) == (NEW, "active", application.id)
        assert {k: v for k, v in moved.__dict__.items() if k != "household_cm_id"} == {
            k: v for k, v in before[person].__dict__.items() if k != "household_cm_id"
        }
    assert store.applications[application.id].household_cm_id == NEW
    assert len(store.applications) == 1
    assert sorted((s.request_id, s.household_cm_id) for s in store.payer_shares.values()) == sorted(
        (rid, NEW) for rid in shares
    )
    rows = rows_since(store, start)
    assert {row["action"] for row in rows} == {MOVE}
    assert sorted(row["entity"] for row in rows) == [
        "aid_applications",
        *["aid_payer_shares"] * 4,  # each share: the old key's delete, the new key's create
        "aid_requests",
        "aid_requests",
    ]
    for person in (EMMA, SAMUEL):
        (row,) = [r for r in rows if r["entity"] == "aid_requests" and r["entity_id"] == before[person].id]
        assert (row["before"], row["after"], row["actor"]) == (
            {"household_cm_id": OLD},
            {"household_cm_id": NEW},
            "system:intake",
        )
    assert {row["operation_id"] for row in rows} == {report.operation_id}
    # No request or application is created; only the default shares are re-made on NEW.
    assert {w[0] for w in store.writes[writes:] if w[0].startswith("POST")} == {"POST aid_payer_shares"}
    assert (report.requests_moved, report.requests_created, report.requests_updated) == (2, 0, 0)

    # Case 7: the next run on the same data writes nothing.
    writes = len(store.writes)
    again = await build(store)
    assert (len(store.writes), again.operation_id) == (writes, "")


@pytest.mark.asyncio
async def test_a_move_to_a_household_outside_the_family_keeps_withdraw_and_create() -> None:
    store = siblings_store()
    await build(store)
    old_ids = {r.id for r in store.requests.values()}
    move(store, EMMA, OTHER)
    move(store, SAMUEL, OTHER)
    report = await build(store)
    assert {store.requests[i].status for i in old_ids} == {"withdrawn"}
    assert (report.requests_created, report.requests_moved) == (2, 0)
    assert MOVE not in {row["action"] for row in store.change_log}


@pytest.mark.asyncio
async def test_an_excluded_link_does_not_make_one_family() -> None:
    store = siblings_store()
    store.links = [link(OLD), link(NEW, excluded=True)]
    await build(store)
    move(store, EMMA, NEW)
    move(store, SAMUEL, NEW)
    report = await build(store)
    assert (report.requests_created, report.requests_moved) == (2, 0)


@pytest.mark.asyncio
async def test_one_sibling_moving_takes_its_request_and_its_own_corrections_to_the_new_households_application() -> None:
    """Case 2. The request lands on the new household's application, so the household page shows it there and staff
    can correct it there; its own (request-level) corrections move with it, so its effective ask stays what staff
    set. The application-level answers and their corrections stay with the sibling who stayed."""
    store = siblings_store()
    await build(store)
    samuel = next(r for r in store.requests.values() if r.person_cm_id == SAMUEL)
    (old_app,) = store.applications.values()
    ask_fix = CorrectionRecord(
        "cor000000000001", YEAR, old_app.id, samuel.id, "ask", "1100.00", "1200.00", "Lower ask.", "a@example.com", ""
    )
    income_fix = CorrectionRecord(
        "cor000000000002", YEAR, old_app.id, "", "total_gross_income", "80000", "85000", "Paystub.", "a@example.com", ""
    )
    store.corrections.extend([ask_fix, income_fix])
    start = len(store.change_log)

    move(store, SAMUEL, NEW)
    report = await build(store)

    moved = store.requests[samuel.id]
    new_app = next(a for a in store.applications.values() if a.household_cm_id == NEW)
    assert (moved.household_cm_id, moved.application_id, moved.status) == (NEW, new_app.id, "active")
    assert store.applications[old_app.id].member_person_cm_ids == (EMMA,)
    assert store.applications[old_app.id].status == "active"
    by_id = {c.id: c for c in store.corrections}
    assert by_id["cor000000000001"].application_id == new_app.id
    assert by_id["cor000000000002"].application_id == old_app.id
    (share,) = [s for s in store.payer_shares.values() if s.request_id == samuel.id]
    assert share.household_cm_id == NEW
    rows = rows_since(store, start)
    (request_row,) = [r for r in rows if r["entity"] == "aid_requests" and r["entity_id"] == samuel.id]
    assert (request_row["action"], request_row["before"], request_row["after"]) == (
        MOVE,
        {"household_cm_id": OLD, "application": old_app.id},
        {"household_cm_id": NEW, "application": new_app.id},
    )
    (correction_row,) = [r for r in rows if r["entity"] == "aid_application_corrections"]
    assert (correction_row["action"], correction_row["entity_id"]) == (MOVE, "cor000000000001")
    assert report.requests_moved == 1

    # Staff correct the moved request on its new household, as the household page offers.
    await FinancialAidCaseworkService(store).add_correction(
        YEAR, NEW, "ask", "1000", "Family called back.", "a@example.com", request_id=samuel.id
    )

    writes = len(store.writes)
    await build(store)
    assert len(store.writes) == writes


@pytest.mark.asyncio
async def test_a_moved_campers_added_request_and_its_addition_follow_the_camper() -> None:
    """Case 6: the addition row is keyed on its household; it moves with the camper's request in the same run, so
    the next run neither withdraws the added request nor rebuilds it on the old household."""
    store = siblings_store()
    store.attendees.append(AttendeeRow(SAMUEL, OLD, TASTE_1, 2))
    added = AdditionRecord(
        id="add000000000001",
        year=YEAR,
        household_cm_id=OLD,
        person_cm_id=SAMUEL,
        program_key="summer",
        session_cm_id=TASTE_1,
        ask=400.0,
        source="staff",
        reason="Second session, staff added",
        actor="registrar@example.com",
    )
    store.additions[added.id] = added
    await build(store)
    added_request = next(r for r in store.requests.values() if r.program_option_key == f"added:{TASTE_1}")
    assert (added_request.status, added_request.household_cm_id) == ("active", OLD)
    start = len(store.change_log)

    move(store, EMMA, NEW)
    move(store, SAMUEL, NEW)
    report = await build(store)

    assert store.additions[added.id].household_cm_id == NEW
    after = store.requests[added_request.id]
    assert (after.household_cm_id, after.status) == (NEW, "active")
    assert len(store.requests) == 3  # nothing created
    rows = rows_since(store, start)
    (addition_row,) = [r for r in rows if r["entity"] == "aid_request_additions"]
    assert (addition_row["action"], addition_row["entity_id"]) == (MOVE, added.id)
    assert {row["action"] for row in rows} == {MOVE}
    assert report.requests_moved == 3

    writes = len(store.writes)
    again = await build(store)
    assert (len(store.writes), again.operation_id) == (writes, "")
