"""Casework writes: every one validated, then committed with its log row (campership sub-project 5)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AliasRow
from api.services.financial_aid_session_resolver import normalize_option_text
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"


async def built() -> tuple[FakeAidStore, AsyncMock, FinancialAidCaseworkService]:
    store, rebuild = seeded_store(), AsyncMock()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 2 (All-Gender Cabin)", summer_ask=700.0))
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    return store, rebuild, FinancialAidCaseworkService(store, rebuild=rebuild)


def rows(store: FakeAidStore) -> list[dict[str, Any]]:
    return list(store.change_log)


@pytest.mark.asyncio
async def test_resolving_an_unmatched_request_activates_it_and_can_remember_the_alias() -> None:
    store, rebuild, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    assert request.status == "unmatched_session"
    out = await casework.resolve_session(request.id, 1000103, "All-gender option.", True, ACTOR)
    assert (out.session_cm_id, out.status, out.session_resolution) == (1000103, "active", "staff")
    assert AliasRow("summer", normalize_option_text("Session 2 (All-Gender Cabin)"), 1000103) in store.aliases
    resolved, alias = rows(store)
    assert [(r["entity"], r["action"]) for r in (resolved, alias)] == [
        ("aid_requests", "resolve_session"),
        ("aid_session_aliases", "create_alias"),
    ]
    assert resolved["operation_id"] == alias["operation_id"]  # one staff action, one operation, one batch
    assert {(r["actor"], r["reason"]) for r in (resolved, alias)} == {(ACTOR, "All-gender option.")}
    assert (resolved["before"]["session_cm_id"], resolved["after"]["session_cm_id"]) == (0, 1000103)
    assert (resolved["before"]["status"], resolved["after"]["status"]) == ("unmatched_session", "active")
    assert len(store.operations) == 1
    rebuild.assert_awaited_once_with(YEAR)


@pytest.mark.asyncio
async def test_resolving_into_an_occupied_slot_is_refused_with_the_holder() -> None:
    store, _, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    holder = store.request_for(person=1000011, program="summer")
    store.requests[request.id] = replace(request, person_cm_id=1000011)
    with pytest.raises(DuplicateRequestError) as caught:
        await casework.resolve_session(request.id, 1000101, "r", False, ACTOR)
    assert caught.value.holder_id == holder.id
    assert (store.operations, store.change_log) == ([], [])


@pytest.mark.asyncio
async def test_a_session_outside_the_program_or_a_withdrawn_request_is_refused() -> None:
    store, _, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    with pytest.raises(CaseworkValidationError):
        await casework.resolve_session(request.id, 1000202, "r", False, ACTOR)
    store.requests[request.id] = replace(request, status="withdrawn")
    with pytest.raises(CaseworkValidationError):
        await casework.resolve_session(request.id, 1000103, "r", False, ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.resolve_session("nope00000000000", 1000103, "r", False, ACTOR)


@pytest.mark.asyncio
async def test_marking_a_duplicate_names_the_survivor_and_is_logged() -> None:
    store, _, casework = await built()
    survivor = store.request_for(person=1000011, program="summer")
    extra = store.request_for(person=1000015, program="summer")
    store.requests[extra.id] = replace(extra, person_cm_id=1000011)
    out = await casework.mark_duplicate(extra.id, survivor.id, "Same camper, same session.", ACTOR)
    assert (out.status, out.duplicate_of) == ("duplicate", survivor.id)
    (row,) = rows(store)
    assert (row["entity_id"], row["action"], row["after"]) == (
        extra.id,
        "mark_duplicate",
        {"status": "duplicate", "duplicate_of": survivor.id},
    )
    assert store.operations[0]["require_reason"] is True


@pytest.mark.asyncio
async def test_a_separated_parents_second_request_for_the_same_camper_can_be_marked_a_duplicate() -> None:
    store, _, casework = await built()
    survivor = store.request_for(person=1000011, program="summer")
    extra = store.request_for(person=1000015, program="summer")
    store.requests[extra.id] = replace(extra, person_cm_id=1000011, household_cm_id=1000009)  # the other parent
    out = await casework.mark_duplicate(extra.id, survivor.id, "Second parent's application.", ACTOR)
    assert (out.status, out.duplicate_of) == ("duplicate", survivor.id)


@pytest.mark.asyncio
async def test_a_duplicate_must_be_the_same_camper_and_the_survivor_active() -> None:
    store, _, casework = await built()
    mine = store.request_for(person=1000011, program="summer")
    theirs = store.request_for(person=1000021, program="summer")
    with pytest.raises(CaseworkValidationError):
        await casework.mark_duplicate(theirs.id, mine.id, "r", ACTOR)
    with pytest.raises(CaseworkValidationError):
        await casework.mark_duplicate(mine.id, mine.id, "r", ACTOR)
    other = store.request_for(person=1000015, program="summer")
    store.requests[other.id] = replace(other, person_cm_id=1000011)
    store.requests[mine.id] = replace(mine, status="withdrawn")
    with pytest.raises(CaseworkValidationError):
        await casework.mark_duplicate(other.id, mine.id, "r", ACTOR)


@pytest.mark.asyncio
async def test_a_staff_headcount_is_stored_with_its_source_and_only_on_family_requests() -> None:
    store, _, casework = await built()
    family = store.request_for(household=1000001, program="family_camp")
    out = await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR)
    assert (out.headcount_non_infant, out.headcount_infant, out.headcount_source) == (4, 1, "declared")
    (row,) = rows(store)
    assert row["before"] == {"headcount_non_infant": 3, "headcount_infant": 0, "headcount_source": "billed"}
    assert row["after"] == {"headcount_non_infant": 4, "headcount_infant": 1, "headcount_source": "declared"}
    again = await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR)
    assert (again.headcount_non_infant, len(store.operations)) == (4, 1)  # nothing changed, nothing written
    summer = store.request_for(person=1000011, program="summer")
    with pytest.raises(CaseworkValidationError):
        await casework.set_headcount(summer.id, 1, 0, "declared", "r", ACTOR)
    with pytest.raises(CaseworkValidationError):
        await casework.set_headcount(family.id, 0, 0, "declared", "r", ACTOR)


@pytest.mark.asyncio
async def test_capacity_is_created_then_updated_and_logged_with_before_and_after() -> None:
    store, _, casework = await built()
    first = await casework.set_capacity(YEAR, 1000101, 120, "Board figure.", "finance@example.com")
    second = await casework.set_capacity(YEAR, 1000101, 110, "", "finance@example.com")
    assert (first.capacity, second.capacity) == (120, 110)
    assert [r["before"] for r in rows(store)] == [None, {"capacity": 120, "note": "Board figure."}]
    assert [r["after"]["capacity"] for r in rows(store)] == [120, 110]
    assert len({r["entity_id"] for r in rows(store)}) == 1  # one aid_session_capacity record
    with pytest.raises(CaseworkNotFoundError):
        await casework.set_capacity(YEAR, 1000999, 10, "", "finance@example.com")
