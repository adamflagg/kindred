"""Casework writes: every one validated, then committed with its log row (campership sub-project 5)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from api.services.financial_aid_casework_service import (
    CaseworkNotFoundError,
    CaseworkValidationError,
    DuplicateRequestError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AttendeeRow, CapacityRecord
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"


async def built() -> tuple[FakeAidStore, FinancialAidCaseworkService]:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 2 (All-Gender Cabin)", summer_ask=700.0))
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    return store, FinancialAidCaseworkService(store)


def rows(store: FakeAidStore) -> list[dict[str, Any]]:
    return list(store.change_log)


@pytest.mark.asyncio
async def test_resolving_an_unmatched_request_activates_it_and_remembers_nothing_else() -> None:
    # Registration first (owner ruling 2026-09-27): a staff pick is this request's alone; no
    # alias is written for later campers on the same option.
    store, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    assert request.status == "unmatched_session"
    out = await casework.resolve_session(request.id, 1000103, "All-gender option.", ACTOR)
    assert (out.session_cm_id, out.status, out.session_resolution) == (1000103, "active", "staff")
    (resolved,) = rows(store)
    assert (resolved["entity"], resolved["action"]) == ("aid_requests", "resolve_session")
    assert (resolved["actor"], resolved["reason"]) == (ACTOR, "All-gender option.")
    assert (resolved["before"]["session_cm_id"], resolved["after"]["session_cm_id"]) == (0, 1000103)
    assert (resolved["before"]["status"], resolved["after"]["status"]) == ("unmatched_session", "active")
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_resolving_into_an_occupied_slot_is_refused_with_the_holder() -> None:
    store, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    holder = store.request_for(person=1000011, program="summer")
    store.requests[request.id] = replace(request, person_cm_id=1000011)
    with pytest.raises(DuplicateRequestError) as caught:
        await casework.resolve_session(request.id, 1000101, "r", ACTOR)
    assert caught.value.holder_id == holder.id
    assert (store.operations, store.change_log) == ([], [])


@pytest.mark.asyncio
async def test_a_session_outside_the_program_or_a_withdrawn_request_is_refused() -> None:
    store, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    with pytest.raises(CaseworkValidationError):
        await casework.resolve_session(request.id, 1000202, "r", ACTOR)
    store.requests[request.id] = replace(request, status="withdrawn")
    with pytest.raises(CaseworkValidationError):
        await casework.resolve_session(request.id, 1000103, "r", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.resolve_session("nope00000000000", 1000103, "r", ACTOR)


@pytest.mark.asyncio
async def test_marking_a_duplicate_names_the_survivor_and_is_logged() -> None:
    store, casework = await built()
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
    store, casework = await built()
    survivor = store.request_for(person=1000011, program="summer")
    extra = store.request_for(person=1000015, program="summer")
    store.requests[extra.id] = replace(extra, person_cm_id=1000011, household_cm_id=1000009)  # the other parent
    out = await casework.mark_duplicate(extra.id, survivor.id, "Second parent's application.", ACTOR)
    assert (out.status, out.duplicate_of) == ("duplicate", survivor.id)


@pytest.mark.asyncio
async def test_marking_a_duplicate_refuses_a_different_session() -> None:
    store, casework = await built()
    survivor = store.request_for(person=1000011, program="summer")  # active, session 1000101
    extra = store.request_for(person=1000015, program="summer")  # same camper, wrong session
    store.requests[extra.id] = replace(extra, person_cm_id=1000011, session_cm_id=1000105)
    with pytest.raises(CaseworkValidationError):
        await casework.mark_duplicate(extra.id, survivor.id, "r", ACTOR)


@pytest.mark.asyncio
async def test_a_same_session_duplicate_pending_request_from_another_household_can_be_marked_a_duplicate() -> None:
    store, casework = await built()
    survivor = store.request_for(person=1000011, program="summer")  # active, session 1000101
    extra = store.request_for(person=1000015, program="summer")
    store.requests[extra.id] = replace(
        extra,
        person_cm_id=1000011,
        household_cm_id=1000009,  # the other parent
        session_cm_id=survivor.session_cm_id,
        status="duplicate_pending",
        duplicate_of=survivor.id,
    )
    out = await casework.mark_duplicate(extra.id, survivor.id, "Second parent's application.", ACTOR)
    assert (out.status, out.duplicate_of) == ("duplicate", survivor.id)


@pytest.mark.asyncio
async def test_a_duplicate_must_be_the_same_camper_and_the_survivor_active() -> None:
    store, casework = await built()
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
    store, casework = await built()
    family = store.request_for(household=1000001, program="family_camp")
    out = await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR)
    assert (out.headcount_non_infant, out.headcount_infant, out.headcount_source) == (4, 1, "declared")
    (row,) = rows(store)
    assert row["before"] == {"headcount_non_infant": 3, "headcount_infant": 0, "headcount_source": "billed"}
    assert row["after"] == {"headcount_non_infant": 4, "headcount_infant": 1, "headcount_source": "declared"}
    again = await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR)
    assert (again.headcount_non_infant, len(store.operations)) == (4, 1)  # nothing changed, nothing written
    summer = store.request_for(person=1000011, program="summer")
    with pytest.raises(CaseworkValidationError, match="^only a family-camp request has a number of people$"):
        await casework.set_headcount(summer.id, 1, 0, "declared", "r", ACTOR)
    with pytest.raises(CaseworkValidationError):
        await casework.set_headcount(family.id, 0, 0, "declared", "r", ACTOR)


@pytest.mark.asyncio
async def test_capacity_is_created_then_updated_and_logged_with_before_and_after() -> None:
    store, casework = await built()
    first = await casework.set_capacity(YEAR, 1000101, 120, "Board figure.", "finance@example.com")
    second = await casework.set_capacity(YEAR, 1000101, 110, "", "finance@example.com")
    assert (first.capacity, second.capacity) == (120, 110)
    assert [r["before"] for r in rows(store)] == [None, {"capacity": 120, "note": "Board figure."}]
    assert [r["after"]["capacity"] for r in rows(store)] == [120, 110]
    assert len({r["entity_id"] for r in rows(store)}) == 1  # one aid_session_capacity record
    with pytest.raises(CaseworkNotFoundError):
        await casework.set_capacity(YEAR, 1000999, 10, "", "finance@example.com")


@pytest.mark.asyncio
async def test_set_capacity_by_a_different_actor_with_the_same_figure_writes_nothing() -> None:
    store, casework = await built()
    first = await casework.set_capacity(YEAR, 1000101, 120, "Board figure.", "finance@example.com")
    second = await casework.set_capacity(YEAR, 1000101, 120, "Board figure.", "other-staff@example.com")
    assert (first.capacity, second.capacity) == (120, 120)
    assert len(store.operations) == 1  # a different actor re-entering the same figure writes nothing


@pytest.mark.asyncio
async def test_resolving_again_to_the_same_session_writes_nothing() -> None:
    store, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    await casework.resolve_session(request.id, 1000103, "All-gender option.", ACTOR)
    store.operations.clear()
    store.change_log.clear()
    resolved = store.request_for(person=1000015, program="summer")
    out = await casework.resolve_session(resolved.id, 1000103, "Repeat.", ACTOR)
    assert (out.session_cm_id, out.status) == (1000103, "active")
    assert (store.operations, store.change_log) == ([], [])


@pytest.mark.asyncio
async def test_a_staff_resolution_survives_a_rebuild_that_would_resolve_elsewhere() -> None:
    store, casework = await built()
    request = store.request_for(person=1000015, program="summer")
    await casework.resolve_session(request.id, 1000103, "All-gender option.", ACTOR)
    store.attendees.append(AttendeeRow(1000015, 1000001, 1000102, 2))  # registration now says Session 2a
    await FinancialAidIntakeService(store).build(YEAR)
    kept = store.requests[request.id]
    assert (kept.session_cm_id, kept.session_resolution, kept.status) == (1000103, "staff", "active")
    assert {"code": "not_enrolled", "detail": {"session_cm_id": 1000103}} in [dict(f) for f in kept.flags]


async def in_training_store() -> tuple[FakeAidStore, FinancialAidCaseworkService]:
    """One option text names both in-training sessions; the first camper is enrolled in
    neither, the second in the Specialist one."""
    store = seeded_store()
    store.fa_rows.append(fa_row(1000016, 1000001, summer="In-Training", summer_ask=600.0))
    store.fa_rows.append(fa_row(1000017, 1000001, summer="In-Training", summer_ask=600.0))
    store.attendees.append(AttendeeRow(1000017, 1000001, 1000108, 2))
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    return store, FinancialAidCaseworkService(store)


@pytest.mark.asyncio
async def test_an_option_naming_several_sessions_still_resolves_one_camper_at_a_time() -> None:
    store, casework = await in_training_store()
    request = store.request_for(person=1000016, program="summer")
    out = await casework.resolve_session(request.id, 1000107, "Counselor track.", ACTOR)
    assert (out.session_cm_id, out.status, out.session_resolution) == (1000107, "active", "staff")
    await FinancialAidIntakeService(store).build(YEAR)
    # The Specialist-registered camper on the same option is still decided by registration.
    specialist = store.request_for(person=1000017, program="summer")
    assert (specialist.session_cm_id, specialist.session_resolution) == (1000108, "enrollment")


@pytest.mark.asyncio
async def test_a_headcount_reason_code_is_checked_against_the_seasons_codes_and_logged() -> None:
    """Decision 6: one list for cost overrides and headcounts, the season's cost.override_reasons."""
    store, _ = await built()

    async def codes(year: int) -> tuple[str, ...]:
        return ("headcount", "discount")

    casework = FinancialAidCaseworkService(store, reason_codes=codes)
    family = store.request_for(household=1000001, program="family_camp")
    with pytest.raises(CaseworkValidationError, match="whim is not one of"):
        await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR, reason_code="whim")
    assert store.operations == []
    await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR, reason_code="headcount")
    (row,) = rows(store)
    assert row["reason"] == "headcount: Family told us."  # the code leads the operation's reason (plan review fix 10)
    assert row["after"] == {"headcount_non_infant": 4, "headcount_infant": 1, "headcount_source": "declared"}


@pytest.mark.asyncio
async def test_without_a_code_source_the_rules_defaults_apply() -> None:
    store, casework = await built()
    family = store.request_for(household=1000001, program="family_camp")
    out = await casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR, reason_code="headcount")
    assert out.headcount_non_infant == 4


@pytest.mark.asyncio
async def test_the_capacity_read_lists_the_seasons_sessions_by_id() -> None:
    store, casework = await built()
    for year, session, figure in ((YEAR, 1000102, 90), (YEAR, 1000101, 120), (YEAR + 1, 1000101, 70)):
        store.capacity[(year, session)] = CapacityRecord(
            id=f"cap{session:012d}",
            year=year,
            session_cm_id=session,
            capacity=figure,
            note="Board figure.",
            actor=ACTOR,
        )
    out = await casework.capacities(YEAR)
    assert out.year == YEAR
    assert [(c.session_cm_id, c.capacity, c.note) for c in out.sessions] == [
        (1000101, 120, "Board figure."),
        (1000102, 90, "Board figure."),
    ]
    assert (await casework.capacities(YEAR + 2)).sessions == []
