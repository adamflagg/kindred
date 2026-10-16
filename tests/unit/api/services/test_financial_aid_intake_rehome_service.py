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
from api.services.financial_aid_intake_service import FinancialAidIntakeService, IntakeReport
from api.services.financial_aid_intake_types import AdditionRecord, AttendeeRow, CorrectionRecord
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
    assert store.payer_shares[share.id].household_cm_id == NEW
    assert fold_rounds(store.decision_events)[request.id][1].posted
    new_writes = store.writes[writes:]
    assert sorted(new_writes) == sorted(
        [
            ("PATCH aid_requests", request.id),
            ("PATCH aid_applications", application.id),
            ("PATCH aid_payer_shares", share.id),
        ]
    )
    rows = rows_since(store, start)
    assert [(r["entity"], r["action"]) for r in rows if r["entity_id"] == request.id] == [("aid_requests", MOVE)]
    assert {r["action"] for r in rows} == {MOVE}
    assert (report.requests_moved, report.requests_created, report.applications_created) == (1, 0, 0)
    assert "withdrawn" not in {r.get("after", {}).get("status") for r in rows}

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
    assert {s.request_id: (s.id, s.household_cm_id) for s in store.payer_shares.values()} == {
        rid: (sid, NEW) for rid, sid in shares.items()
    }
    rows = rows_since(store, start)
    assert {row["action"] for row in rows} == {MOVE}
    assert sorted(row["entity"] for row in rows) == [
        "aid_applications",
        "aid_payer_shares",
        "aid_payer_shares",
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
    assert all(not w[0].startswith("POST") for w in store.writes[writes:])  # no create, of anything
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
