"""Payer shares (spec 9.2; owner rulings 2026-09-25): percentages stored, dollars computed."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from api.services.financial_aid_casework_service import (
    CaseworkValidationError,
    FinancialAidCaseworkService,
    request_out,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord
from api.services.financial_aid_payer_shares import (
    PayerShareError,
    ShareSpec,
    fill_remainder,
    share_status,
    split_award,
    validate_shares,
)
from bunking.pocketbase_batch import BatchRequestFailedError
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, seeded_store

ACTOR = "registrar@example.com"
HOME, OTHER, THIRD = 1000001, 1000009, 1000008  # HOME is the application's own household


def pct(household: int, value: str) -> ShareSpec:
    return ShareSpec(household, Decimal(value))


def test_shares_are_complete_only_at_exactly_100_percent() -> None:
    assert share_status([pct(HOME, "100")]) == "complete"
    assert share_status([pct(HOME, "60"), pct(OTHER, "40")]) == "complete"
    assert share_status([pct(HOME, "33.3334"), pct(OTHER, "33.3333"), pct(THIRD, "33.3333")]) == "complete"
    assert share_status([pct(HOME, "60"), pct(OTHER, "30")]) == "incomplete"
    assert share_status([]) == "incomplete"


@pytest.mark.parametrize(
    "shares",
    [
        [],
        [pct(HOME, "50"), pct(HOME, "50")],  # one household twice
        [pct(HOME, "0")],
        [pct(HOME, "100.01")],
        [pct(HOME, "12.34567")],  # more than four decimals
        [pct(0, "100")],  # not a CampMinder household
        [pct(1000000 + n, "1") for n in range(1, 12)],  # more than ten
    ],
)
def test_bad_shares_are_refused(shares: list[ShareSpec]) -> None:
    with pytest.raises(PayerShareError):
        validate_shares(shares)


def test_setting_one_of_two_shares_fills_the_other_with_the_remainder() -> None:
    assert fill_remainder([pct(HOME, "100")], OTHER, Decimal(40)) == [pct(HOME, "60"), pct(OTHER, "40")]
    assert fill_remainder([pct(HOME, "60"), pct(OTHER, "40")], HOME, Decimal(75)) == [
        pct(HOME, "75"),
        pct(OTHER, "25"),
    ]
    assert fill_remainder([pct(HOME, "60"), pct(OTHER, "40")], OTHER, Decimal(100)) == [pct(OTHER, "100")]


def test_with_three_shares_the_others_stay_and_staff_balance_them() -> None:
    three = [pct(HOME, "50"), pct(OTHER, "30"), pct(THIRD, "20")]
    filled = fill_remainder(three, OTHER, Decimal(40))
    assert filled == [pct(HOME, "50"), pct(THIRD, "20"), pct(OTHER, "40")]  # sorted by household id
    assert share_status(filled) == "incomplete"  # 110%: holds until staff fix it


def test_split_award_gives_whole_dollars_with_the_remainder_to_the_applications_household() -> None:
    assert split_award(Decimal(2201), [pct(HOME, "60"), pct(OTHER, "40")], HOME) == {
        OTHER: Decimal(880),
        HOME: Decimal(1321),
    }
    assert split_award(Decimal(2201), [pct(HOME, "50"), pct(OTHER, "50")], HOME) == {
        OTHER: Decimal(1100),
        HOME: Decimal(1101),
    }
    three = [pct(HOME, "33.3334"), pct(OTHER, "33.3333"), pct(THIRD, "33.3333")]
    assert split_award(Decimal(1000), three, HOME) == {THIRD: Decimal(333), HOME: Decimal(334), OTHER: Decimal(333)}


def test_when_the_award_changes_the_percentages_stay_and_the_dollars_recompute() -> None:
    shares = [pct(HOME, "60"), pct(OTHER, "40")]
    assert split_award(Decimal(2501), shares, HOME) == {OTHER: Decimal(1000), HOME: Decimal(1501)}


def test_without_the_applications_household_the_largest_share_takes_the_remainder() -> None:
    assert split_award(Decimal(2201), [pct(OTHER, "60"), pct(THIRD, "40")], HOME) == {
        THIRD: Decimal(880),
        OTHER: Decimal(1321),
    }


def test_split_award_refuses_shares_that_do_not_add_up() -> None:
    with pytest.raises(PayerShareError):
        split_award(Decimal(2201), [pct(HOME, "60")], HOME)


async def built(
    awards: dict[str, Decimal] | None = None,
) -> tuple[FakeAidStore, FinancialAidCaseworkService]:
    """`awards` stands in for sub-project 10's AwardSource: request id -> its priced amount."""
    store = seeded_store()
    await FinancialAidIntakeService(store).build(YEAR)
    store.operations.clear()
    store.change_log.clear()
    priced = awards if awards is not None else {}

    async def award_of(request: RequestRecord) -> Decimal | None:
        return priced.get(request.id)

    return store, FinancialAidCaseworkService(store, award_source=award_of)


def shares_of(store: FakeAidStore, request_id: str) -> list[tuple[int, Decimal]]:
    return sorted((s.household_cm_id, s.share_pct) for s in store.payer_shares.values() if s.request_id == request_id)


@pytest.mark.asyncio
async def test_staff_split_a_request_between_two_households_and_it_is_logged() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    out = await casework.set_payer_shares(summer.id, [pct(HOME, "50"), pct(OTHER, "50")], "Parents split it.", ACTOR)
    assert [(s.household_cm_id, s.share_pct, s.source, s.amount) for s in out.payer_shares] == [
        (HOME, Decimal(50), "staff", None),  # no award yet, so no dollars
        (OTHER, Decimal(50), "staff", None),
    ]
    assert out.payer_share_status == "complete"
    home, other = sorted(store.change_log, key=lambda row: row["entity_id"])
    assert (home["entity_id"], other["entity_id"]) == (f"{summer.id}:{HOME}", f"{summer.id}:{OTHER}")
    assert {(r["entity"], r["action"], r["actor"], r["reason"]) for r in (home, other)} == {
        ("aid_payer_shares", "set_payer_shares", ACTOR, "Parents split it.")
    }
    assert home["operation_id"] == other["operation_id"]  # one staff action, one operation
    assert (home["before"]["share_pct"], home["after"]["share_pct"]) == ("100", "50")  # only what changed
    assert (other["before"], other["after"]["household_cm_id"], other["after"]["share_pct"]) == (None, OTHER, "50")


@pytest.mark.asyncio
async def test_setting_one_households_share_fills_the_remainder_in_one_operation() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    out = await casework.set_household_share(
        summer.id, OTHER, share_pct=Decimal(40), reason="Other parent pays 40%.", actor=ACTOR
    )
    assert [(s.household_cm_id, s.share_pct) for s in out.payer_shares] == [(HOME, Decimal(60)), (OTHER, Decimal(40))]
    assert out.payer_share_status == "complete"
    (operation,) = store.operations  # both households' shares: one commit
    assert sorted((w.action, w.entity_id) for w in operation["writes"]) == [
        ("create", f"{summer.id}:{OTHER}"),
        ("update", f"{summer.id}:{HOME}"),
    ]
    (entered,) = [row for row in store.change_log if row["entity_id"] == f"{summer.id}:{OTHER}"]
    assert entered["after"]["entered"] == {"household_cm_id": OTHER, "share_pct": "40"}


@pytest.mark.asyncio
async def test_a_two_household_split_commits_both_shares_or_neither() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    store.fail_on = ("aid_payer_shares", "POST")  # the new household's share is refused
    with pytest.raises(BatchRequestFailedError):
        await casework.set_household_share(
            summer.id, OTHER, share_pct=Decimal(40), reason="Other parent pays 40%.", actor=ACTOR
        )
    assert shares_of(store, summer.id) == [(HOME, Decimal(100))]  # the remainder update rolled back too
    assert store.change_log == []


def test_dollars_are_read_only_and_follow_the_current_award() -> None:
    request = RequestRecord(
        "req000000000001",
        YEAR,
        "app000000000001",
        HOME,
        1000011,
        1000101,
        "summer",
        "Session 2",
        "session 2",
        "exact",
        1500.0,
        0,
        0,
        "",
        "active",
        "",
    )
    shares = [
        PayerShareRecord("shr000000000001", YEAR, request.id, HOME, Decimal(60), "staff", ACTOR),
        PayerShareRecord("shr000000000002", YEAR, request.id, OTHER, Decimal(40), "staff", ACTOR),
    ]
    before = request_out(request, [], shares, award=Decimal(2201))
    after_appeal = request_out(request, [], shares, award=Decimal(2501))
    assert [(s.share_pct, s.amount) for s in before.payer_shares] == [
        (Decimal(60), Decimal(1321)),
        (Decimal(40), Decimal(880)),
    ]
    assert [(s.share_pct, s.amount) for s in after_appeal.payer_shares] == [
        (Decimal(60), Decimal(1501)),
        (Decimal(40), Decimal(1000)),
    ]
    assert [s.amount for s in request_out(request, [], shares).payer_shares] == [None, None]  # no award, no dollars


@pytest.mark.asyncio
async def test_an_incomplete_split_is_stored_and_reported() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    out = await casework.set_payer_shares(summer.id, [pct(HOME, "60")], "Waiting on the other parent.", ACTOR)
    assert out.payer_share_status == "incomplete"


@pytest.mark.asyncio
async def test_bad_share_writes_are_refused_and_nothing_is_written() -> None:
    store, casework = await built()
    summer = store.request_for(person=1000011, program="summer")
    with pytest.raises(CaseworkValidationError):
        await casework.set_payer_shares(summer.id, [pct(HOME, "100")], "  ", ACTOR)
    with pytest.raises(CaseworkValidationError):  # no reason
        await casework.set_household_share(summer.id, OTHER, share_pct=Decimal(40), reason=" ", actor=ACTOR)
    store.requests[summer.id] = replace(summer, status="withdrawn")
    with pytest.raises(CaseworkValidationError):
        await casework.set_payer_shares(summer.id, [pct(HOME, "100")], "r", ACTOR)
    assert (store.operations, store.change_log) == ([], [])  # refused before anything was sent
    assert shares_of(store, summer.id) == [(HOME, Decimal(100))]
