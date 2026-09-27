"""A `duplicate` whose survivor is no longer active is never left stranded (campership sub-project 5).

Staff mark a request a duplicate of the one kept (spec 9.2). When the kept request later
stops being active -- the family rewords or deletes that answer, or the other parent's
household withdraws -- the duplicate must not be left with no live request for its camper
(or family) and session. At the end of every build, by STATE, not by what this run withdrew:

* its chain of duplicates leads to an active request: it is re-pointed there, still `duplicate`;
* some request holds the slot: it is re-pointed to that holder, still `duplicate`;
* the slot is free: it is revived `active` with the `duplicate_survivor_withdrawn` hold, and
  the default 100% payer share for its own household (the old survivor's shares stay there).
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AttendeeRow, RequestRecord
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"
REVIVED = "duplicate_survivor_withdrawn"


def _codes(record: RequestRecord) -> list[str]:
    return [str(f.get("code")) for f in record.flags]


def _shares(store: FakeAidStore, request_id: str) -> list[tuple[int, int]]:
    return sorted(
        (s.household_cm_id, int(s.share_pct)) for s in store.payer_shares.values() if s.request_id == request_id
    )


async def _hold_codes(store: FakeAidStore, household_cm_id: int, request_id: str) -> list[tuple[str, str]]:
    detail = await FinancialAidCaseworkService(store).application_detail(YEAR, household_cm_id)
    (request,) = [r for r in detail.requests if r.id == request_id]
    return [(i.code, i.severity) for i in request.issues]


async def _separated_parents(*other_households: int) -> tuple[FakeAidStore, FinancialAidIntakeService, list[str]]:
    """Camper 1000011 in Session 2, kept on household 1000001's request; each other household
    files for the same camper and session, and staff mark every one of those a duplicate."""
    store = seeded_store()
    for household in other_households:
        store.fa_rows.append(fa_row(1000011, household, summer="Session 2", summer_ask=1500.0))
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    holder = store.request_for(person=1000011, household=1000001, program="summer")
    casework = FinancialAidCaseworkService(store)
    duplicates = []
    for household in other_households:
        claimant = store.request_for(person=1000011, household=household, program="summer")
        await casework.mark_duplicate(claimant.id, holder.id, "Other parent's application.", ACTOR)
        duplicates.append(claimant.id)
    return store, service, [holder.id, *duplicates]


def _drop_survivor_answer(store: FakeAidStore) -> None:
    store.fa_rows[0] = fa_row(1000011, 1000001, total_gross_income=85000.0)  # household 1000001 drops summer


@pytest.mark.asyncio
async def test_a_family_camp_duplicate_follows_a_reworded_survivor_then_revives_when_it_is_deleted() -> None:
    store = seeded_store()
    # Every wording lands on Family Camp 6: the household is enrolled there (registration first).
    store.fa_rows.append(fa_row(1000013, 1000001, fc="FC Six", fc_ask=900.0))
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    kept = store.request_for(household=1000001, program="family_camp", status="active")
    extra = store.request_for(household=1000001, program="family_camp", status="duplicate_pending")
    await FinancialAidCaseworkService(store).mark_duplicate(extra.id, kept.id, "Same weekend twice.", ACTOR)

    # The family rewords the kept answer: the old request is withdrawn, a new one takes the slot.
    store.fa_rows[1] = fa_row(1000012, 1000001, fc="Weekend Six", fc_ask=900.0, total_gross_income=85000.0)
    await service.build(YEAR)
    reworded = store.request_for(household=1000001, program="family_camp", status="active")
    assert reworded.id not in (kept.id, extra.id)
    assert (store.requests[extra.id].status, store.requests[extra.id].duplicate_of) == ("duplicate", reworded.id)

    # Then deletes it: nothing is left holding the weekend, so the duplicate comes back, held.
    store.fa_rows[1] = fa_row(1000012, 1000001, total_gross_income=85000.0)
    await service.build(YEAR)
    revived = store.requests[extra.id]
    assert (revived.status, revived.duplicate_of) == ("active", "")
    assert {"code": REVIVED, "detail": {"withdrawn_survivor": reworded.id}} in [dict(f) for f in revived.flags]
    assert _shares(store, extra.id) == [(1000001, 100)]
    assert (REVIVED, "hold") in await _hold_codes(store, 1000001, extra.id)


@pytest.mark.asyncio
async def test_the_other_parents_duplicate_revives_when_the_survivors_household_withdraws() -> None:
    store, service, (holder, duplicate) = await _separated_parents(1000002)
    _drop_survivor_answer(store)
    await service.build(YEAR)
    assert store.requests[holder].status == "withdrawn"
    revived = store.requests[duplicate]
    assert (revived.status, revived.duplicate_of, revived.household_cm_id) == ("active", "", 1000002)
    assert REVIVED in _codes(revived)
    assert _shares(store, duplicate) == [(1000002, 100)]  # its own household; the old split stays on the old one
    assert (REVIVED, "hold") in await _hold_codes(store, 1000002, duplicate)


@pytest.mark.asyncio
async def test_a_duplicate_of_a_duplicate_is_re_pointed_to_the_active_end_of_the_chain() -> None:
    store, service, (holder, first, second) = await _separated_parents(1000002, 1000003)
    store.requests[second] = replace(store.requests[second], duplicate_of=first)  # second -> first -> holder
    await service.build(YEAR)
    assert (store.requests[second].status, store.requests[second].duplicate_of) == ("duplicate", holder)
    assert (store.requests[first].status, store.requests[first].duplicate_of) == ("duplicate", holder)


@pytest.mark.asyncio
async def test_a_stranded_duplicate_is_re_pointed_to_whoever_now_holds_the_slot_and_stays_a_duplicate() -> None:
    store, service, (holder, duplicate) = await _separated_parents(1000002)
    store.fa_rows.append(fa_row(1000011, 1000003, summer="Session 2", summer_ask=1500.0))
    await service.build(YEAR)
    waiting = store.request_for(person=1000011, household=1000003, program="summer")
    assert (waiting.status, waiting.duplicate_of) == ("duplicate_pending", holder)
    _drop_survivor_answer(store)
    await service.build(YEAR)
    assert store.requests[waiting.id].status == "active"  # the pending claimant takes the slot
    after = store.requests[duplicate]
    assert (after.status, after.duplicate_of) == ("duplicate", waiting.id)  # staff already answered: not pending
    assert REVIVED not in _codes(after)


@pytest.mark.asyncio
async def test_two_stranded_duplicates_of_one_slot_revive_one_and_re_point_the_other() -> None:
    store, service, (holder, first, second) = await _separated_parents(1000002, 1000003)
    _drop_survivor_answer(store)
    await service.build(YEAR)  # the fake refuses a second active row for the slot, as PocketBase does
    active = [r for r in (store.requests[first], store.requests[second]) if r.status == "active"]
    (revived,) = active
    (other,) = [r for r in (store.requests[first], store.requests[second]) if r.id != revived.id]
    assert (other.status, other.duplicate_of) == ("duplicate", revived.id)
    assert REVIVED in _codes(revived)


@pytest.mark.asyncio
async def test_a_duplicate_stranded_before_this_run_is_healed() -> None:
    store, service, (holder, duplicate) = await _separated_parents(1000002)
    _drop_survivor_answer(store)
    store.requests[holder] = replace(store.requests[holder], status="withdrawn")  # withdrawn by an earlier run
    await service.build(YEAR)
    assert (store.requests[duplicate].status, store.requests[duplicate].duplicate_of) == ("active", "")
    assert REVIVED in _codes(store.requests[duplicate])


@pytest.mark.asyncio
async def test_a_revival_is_idempotent_and_its_hold_survives_the_next_build() -> None:
    store, service, (_, duplicate) = await _separated_parents(1000002)
    _drop_survivor_answer(store)
    await service.build(YEAR)
    revived = store.requests[duplicate]
    report = await service.build(YEAR)
    assert (report.requests_updated, report.requests_created, report.payer_shares_created) == (0, 0, 0)
    assert report.operation_id == ""
    assert store.requests[duplicate] == revived
    assert (REVIVED, "hold") in await _hold_codes(store, 1000002, duplicate)


@pytest.mark.asyncio
async def test_an_unmatched_duplicate_whose_survivor_is_gone_revives_unmatched_and_held() -> None:
    # A duplicate may name no session (mark_duplicate allows it); with no slot to hold, it
    # comes back as unmatched, never active on session 0.
    store = seeded_store()
    store.attendees.append(AttendeeRow(1000011, 1000001, 1000102, 2))  # enrolled in two: the text must pick
    store.fa_rows.append(fa_row(1000011, 1000002, summer="Some session we never ran", summer_ask=1500.0))
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    holder = store.request_for(person=1000011, household=1000001, program="summer")
    extra = store.request_for(person=1000011, household=1000002, program="summer")
    assert (extra.status, extra.session_cm_id) == ("unmatched_session", 0)
    await FinancialAidCaseworkService(store).mark_duplicate(extra.id, holder.id, "Same camper.", ACTOR)
    _drop_survivor_answer(store)
    await service.build(YEAR)
    revived = store.requests[extra.id]
    assert (revived.status, revived.duplicate_of, revived.session_cm_id) == ("unmatched_session", "", 0)
    assert REVIVED in _codes(revived)
    assert (REVIVED, "hold") in await _hold_codes(store, 1000002, extra.id)


@pytest.mark.asyncio
async def test_an_unmatched_duplicate_of_a_duplicate_follows_the_chain_instead_of_reviving() -> None:
    # With no session there is no slot to look up: only the chain leads to the survivor.
    store = seeded_store()
    store.fa_rows.append(fa_row(1000011, 1000002, summer="Session 2", summer_ask=1500.0))
    store.fa_rows.append(fa_row(1000011, 1000003, summer="Some session we never ran", summer_ask=1500.0))
    store.attendees.append(AttendeeRow(1000011, 1000001, 1000102, 2))  # enrolled in two: the text must pick
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    holder = store.request_for(person=1000011, household=1000001, program="summer")
    middle = store.request_for(person=1000011, household=1000002, program="summer")
    unmatched = store.request_for(person=1000011, household=1000003, program="summer")
    assert unmatched.session_cm_id == 0
    casework = FinancialAidCaseworkService(store)
    await casework.mark_duplicate(middle.id, holder.id, "Other parent.", ACTOR)
    await casework.mark_duplicate(unmatched.id, holder.id, "Third copy.", ACTOR)
    store.requests[unmatched.id] = replace(store.requests[unmatched.id], duplicate_of=middle.id)
    await service.build(YEAR)
    after = store.requests[unmatched.id]
    assert (after.status, after.duplicate_of) == ("duplicate", holder.id)
    assert REVIVED not in _codes(after)
