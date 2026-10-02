"""The household page's aggregate (clean spec §6.3; D26 scope, D32 cards and chips, D77 band totals, D59
confirmation). Fictional only: the Johnson family (1000001) applied for Emma; the Garcia household (1000002)
pays half of Emma's request and applied for Liam alone; household 1000003 is unrelated. The page's scope is households
(D26), and it shows every request a household in it applied for (Decision 4)."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import replace
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

import api.schemas.financial_aid_decisions as decision_schemas
from api.schemas.financial_aid_decisions import (
    CancellationOut,
    ConfirmationOut,
    GridRowOut,
    PostedIn,
    PostedRow,
    RoundOut,
    ShareConfirmationOut,
)
from api.schemas.financial_aid_grants import GrantRowOut, GrantsResponse, RequestShareOut
from api.schemas.financial_aid_intake import AnswerOut, ApplicationDetailResponse, RequestOut
from api.services.financial_aid_casework_service import CaseworkNotFoundError
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow, RequestShare
from api.services.financial_aid_household_page import (
    HouseholdNotFoundError,
    HouseholdPageService,
    band_grants_by_request,
    grant_rows_with_band_flag,
    household_money,
    page_scope,
    request_grants,
    share_lines,
    totals,
)
from api.services.financial_aid_intake_types import PayerShareRecord
from bunking.financial_aid.decisions import DecisionEvent, RoundState
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

JOHNSON, GARCIA, OTHER = 1000001, 1000002, 1000003
EMMA, LIAM, OLIVIA = "reqemma00000001", "reqliam00000001", "reqoliv00000001"


def _season() -> tuple[dict[str, Any], dict[str, tuple[PayerShareRecord, ...]]]:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON, person=1000011)
    seed_request(store, LIAM, household=GARCIA, person=1000021)
    seed_request(store, OLIVIA, household=OTHER, person=1000031)
    shares: dict[str, tuple[PayerShareRecord, ...]] = {
        EMMA: (share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "50")),
        LIAM: (share_row(LIAM, GARCIA, "100"),),
        OLIVIA: (share_row(OLIVIA, OTHER, "100"),),
    }
    return dict(store.requests), shares


def _round(n: int, status: str, **over: Any) -> RoundOut:
    base: dict[str, Any] = {
        "round": n,
        "status": status,
        "ask": None,
        "asked_on": None,
        "decided": None,
        "posted": None,
        "posted_on": None,
        "accepted": False,
        "pending_approval": None,
        "would_change_by": None,
        "counts_toward_budget": True,
        "rules_version": 1,
    }
    return RoundOut(**{**base, **over})


def _row(request_id: str, household: int, **over: Any) -> GridRowOut:
    base: dict[str, Any] = {
        "request_id": request_id,
        "household_cm_id": household,
        "family_name": f"Family {household}",
        "person_cm_id": household * 10 + 1,
        "camper_name": "",
        "session_cm_id": 1000101,
        "session_name": "Session 2",
        "program_key": "summer",
        "pool": "camp",
        "request_status": "active",
        "tier": 2,
        "cost": 2000.0,
        "rounds": [_round(1, "needs_offer", decided=1500.0)],
        "total_decided": 1500.0,
        "total_posted": None,
        "holds": [],
        "released_holds": [],
        "notes": [],
    }
    return GridRowOut(**{**base, **over})


def _confirmation(status: str, locked: float, held: float, shares: list[ShareConfirmationOut]) -> ConfirmationOut:
    return ConfirmationOut(
        status=status,
        locked=locked,
        in_campminder=held,
        gap=held - locked,
        on=date(2031, 3, 10),
        reconciled=False,
        family_unplaced=0.0,
        shares=shares,
    )


# --- scope (D26) -------------------------------------------------------------------------------------


def test_the_scope_is_the_opened_household_and_every_household_with_a_share_in_its_requests() -> None:
    """D26: the scope is households; the page shows every request a household in it applied for (Decision 4)."""
    requests, shares = _season()
    scope = page_scope(JOHNSON, requests, shares)
    assert scope.households == (JOHNSON, GARCIA)
    assert scope.request_ids == (EMMA, LIAM)  # Liam's request is the paying household's own


def test_the_scope_runs_both_ways_from_the_paying_household() -> None:
    """D26: the requests it applied for and the requests it pays a share of; the opened household is chip 1."""
    requests, shares = _season()
    scope = page_scope(GARCIA, requests, shares)
    assert scope.request_ids == (LIAM, EMMA)
    assert scope.households == (GARCIA, JOHNSON)


def test_a_household_with_no_request_is_a_scope_of_one() -> None:
    """D8: grants or postings only still open a page."""
    requests, shares = _season()
    scope = page_scope(1000009, requests, shares)
    assert (scope.request_ids, scope.households) == ((), (1000009,))


# --- share lines (D32, §6.3 item 4) -----------------------------------------------------------------


def test_two_payers_split_the_decided_award_in_whole_dollars() -> None:
    requests, shares = _season()
    lines = share_lines(_row(EMMA, JOHNSON), shares[EMMA], {JOHNSON: 1, GARCIA: 2})
    assert [(s.household_cm_id, s.chip, s.share_pct, s.decided, s.posted, s.status) for s in lines] == [
        (JOHNSON, 1, 50.0, 750.0, None, None),
        (GARCIA, 2, 50.0, 750.0, None, None),
    ]


def test_each_share_carries_its_own_confirmation_once_posted() -> None:
    requests, shares = _season()
    row = _row(
        EMMA,
        JOHNSON,
        rounds=[_round(1, "posted", decided=1500.0, posted=1500.0, posted_on=date(2031, 3, 9))],
        total_posted=1500.0,
        confirmation=_confirmation(
            "short",
            1500.0,
            750.0,
            [
                ShareConfirmationOut(household_cm_id=JOHNSON, expected=750.0, in_campminder=750.0, status="confirmed"),
                ShareConfirmationOut(
                    household_cm_id=GARCIA, expected=750.0, in_campminder=0.0, status="not_in_campminder"
                ),
            ],
        ),
    )
    lines = share_lines(row, shares[EMMA], {JOHNSON: 1, GARCIA: 2})
    assert [(s.posted, s.in_campminder, s.status) for s in lines] == [
        (750.0, 750.0, "confirmed"),
        (750.0, 0.0, "not_in_campminder"),
    ]


def test_one_payer_is_one_money_line_with_the_requests_confirmation() -> None:
    requests, shares = _season()
    row = _row(
        LIAM,
        GARCIA,
        rounds=[_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))],
        total_decided=1800.0,
        total_posted=1800.0,
        confirmation=_confirmation("short", 1800.0, 1500.0, []),
    )
    (line,) = share_lines(row, shares[LIAM], {GARCIA: 1})
    assert (line.decided, line.posted, line.in_campminder, line.status) == (1800.0, 1800.0, 1500.0, "short")


def test_a_request_with_no_share_row_is_its_applicants_whole() -> None:
    """Plan review minor 3: no payer-share row means the applying household pays it all (request_scope's reading)."""
    (line,) = share_lines(_row(EMMA, JOHNSON), (), {JOHNSON: 1})
    assert (line.household_cm_id, line.chip, line.share_pct, line.decided) == (JOHNSON, 1, 100.0, 1500.0)


def test_shares_that_dont_add_up_show_no_dollars() -> None:
    """§6.3: shares not adding to 100% hold the request; there is no split to show."""
    lines = share_lines(_row(EMMA, JOHNSON), (share_row(EMMA, JOHNSON, "60"),), {JOHNSON: 1})
    assert [(s.share_pct, s.decided) for s in lines] == [(60.0, None)]


# --- the band (D77) and the cards (D32) ---------------------------------------------------------------


def test_the_family_share_is_cost_less_decided_less_grants_over_included_requests() -> None:
    """§5.8's worked example: two requests at $6,760, aid decided $5,220, a $1,000 grant -> $7,300."""
    rows = [
        _row(EMMA, JOHNSON, cost=6760.0, total_decided=2610.0),
        _row(LIAM, GARCIA, cost=6760.0, total_decided=2610.0),
        _row(OLIVIA, OTHER, cost=6760.0, total_decided=2610.0, request_status="withdrawn"),  # not included
    ]
    out = totals(rows, {EMMA: Decimal(1000), OLIVIA: Decimal(500)})
    assert (out.cost, out.decided, out.grants, out.family_share, out.posted) == (13520.0, 5220.0, 1000.0, 7300.0, None)


def test_a_last_dollar_grant_counts_in_the_band_and_the_share_never_goes_below_zero() -> None:
    """Decision 7 (⚠, waiting on the owner): the band subtracts a grant from a grantor that pays after the camp's
    award (D77's live lines, D143), as the budget's below-the-line money does. Before that grantor reverses its
    first full-price line the subtraction would go negative; the share stops at $0. Flipping the reading is
    band_grants_by_request plus this test."""
    last_dollar = grant_row(EMMA, "2000", pays_after_camp_aid=True)
    grants = band_grants_by_request([last_dollar])
    assert grants == {EMMA: Decimal(2000)}
    out = totals([_row(EMMA, JOHNSON)], grants)  # cost 2,000, decided 1,500, grant 2,000
    assert (out.grants, out.family_share) == (2000.0, 0.0)


def test_the_family_share_floors_each_request_at_zero_before_summing() -> None:
    """Owner ruling 2026-10-01: an over-covered request (a minimum award paid though grants cover the cost, an
    ignored late grant) is $0, not a negative that cancels a sibling's real share: -108 and +1,000 read 1,000."""
    rows = [
        _row(EMMA, JOHNSON, cost=1000.0, total_decided=1108.0),  # -108
        _row(LIAM, GARCIA, cost=2000.0, total_decided=1000.0),  # +1,000
    ]
    assert totals(rows, {}).family_share == 1000.0
    assert totals([rows[0]], {}).family_share == 0.0


def test_with_no_included_request_the_band_has_no_grants_figure() -> None:
    """Plan review minor 2: a grants-only household's band reads "—", not "$0", beside a register that lists money."""
    out = totals([], {})
    assert (out.cost, out.decided, out.grants, out.family_share, out.posted) == (None, None, None, None, None)


def test_the_family_share_waits_for_every_included_request_to_be_decided() -> None:
    rows = [_row(EMMA, JOHNSON), _row(LIAM, GARCIA, total_decided=None, rounds=[_round(1, "held")])]
    out = totals(rows, {})
    assert (out.cost, out.decided, out.grants, out.family_share) == (4000.0, 1500.0, 0.0, None)


def test_a_cancelled_request_leaves_the_band() -> None:
    from api.schemas.financial_aid_decisions import CancellationOut

    cancelled = CancellationOut(by="kindred", on=date(2031, 5, 1), reason="medical", note="")
    rows = [_row(EMMA, JOHNSON), _row(LIAM, GARCIA, cancellation=cancelled)]
    out = totals(rows, {})
    assert (out.cost, out.decided, out.family_share) == (2000.0, 1500.0, 500.0)


def test_posted_folds_its_confirmation_into_states() -> None:
    """D77: "posted · 1 short $210"."""
    posted = [_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))]
    rows = [
        _row(
            EMMA,
            JOHNSON,
            rounds=posted,
            total_decided=1800.0,
            total_posted=1800.0,
            confirmation=_confirmation("short", 1800.0, 1590.0, []),
        ),
        _row(
            LIAM,
            GARCIA,
            rounds=posted,
            total_decided=1800.0,
            total_posted=1800.0,
            confirmation=_confirmation("confirmed", 1800.0, 1800.0, []),
        ),
    ]
    out = totals(rows, {})
    assert out.posted == 3600.0
    assert [(s.status, s.count, s.gap) for s in out.states] == [("confirmed", 1, 0.0), ("short", 1, -210.0)]


def test_a_household_card_carries_its_own_share_of_decided_and_posted() -> None:
    requests, shares = _season()
    rows = [
        _row(EMMA, JOHNSON),
        _row(
            LIAM,
            GARCIA,
            rounds=[_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))],
            total_decided=1800.0,
            total_posted=1800.0,
            confirmation=_confirmation("confirmed", 1800.0, 1800.0, []),
        ),
    ]
    chips = {GARCIA: 1, JOHNSON: 2}
    garcia = household_money(GARCIA, rows, shares, chips)
    assert (garcia.decided, garcia.posted, garcia.in_campminder) == (2550.0, 1800.0, 1800.0)
    assert [(s.status, s.count) for s in garcia.states] == [("confirmed", 1)]
    johnson = household_money(JOHNSON, rows, shares, chips)
    assert (johnson.decided, johnson.posted, johnson.in_campminder, johnson.states) == (750.0, None, None, [])


def test_a_row_has_no_include_override_and_its_included_is_live_and_not_cancelled() -> None:
    """Owner ruling: no staff exclusion; a request leaves the band only by being cancelled or not live."""
    assert "include_override" not in GridRowOut.model_fields
    out = totals([_row(EMMA, JOHNSON), _row(LIAM, GARCIA)], {})
    assert (out.cost, out.decided) == (4000.0, 3000.0)


def _split_request(first_pct: str, second_pct: str, confirmation: ConfirmationOut) -> tuple[list[GridRowOut], Any]:
    posted = [_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))]
    rows = [_row(EMMA, JOHNSON, rounds=posted, total_decided=1800.0, total_posted=1800.0, confirmation=confirmation)]
    shares = {EMMA: (share_row(EMMA, JOHNSON, first_pct), share_row(EMMA, GARCIA, second_pct))}
    return rows, shares


def test_a_card_shows_no_gap_while_the_requests_shares_do_not_add_up() -> None:
    """Mid-rebalance (60% + 30%): the share table shows "-" for the request, so each card reads no CampMinder
    figure and no state for it, never the request's whole figure as its own."""
    rows, shares = _split_request("60", "30", _confirmation("short", 1800.0, 1590.0, []))
    chips = {JOHNSON: 1, GARCIA: 2}
    for household in (JOHNSON, GARCIA):
        card = household_money(household, rows, shares, chips)
        assert (card.in_campminder, card.states) == (None, [])
        line = next(x for x in share_lines(rows[0], shares[EMMA], chips) if x.household_cm_id == household)
        assert (line.in_campminder, line.status) == (None, None)


def test_a_card_shows_its_own_shares_gap_when_the_shares_add_up() -> None:
    held = [
        ShareConfirmationOut(household_cm_id=JOHNSON, expected=1080.0, in_campminder=1000.0, status="short"),
        ShareConfirmationOut(household_cm_id=GARCIA, expected=720.0, in_campminder=720.0, status="confirmed"),
    ]
    rows, shares = _split_request("60", "40", _confirmation("short", 1800.0, 1720.0, held))
    chips = {JOHNSON: 1, GARCIA: 2}
    johnson = household_money(JOHNSON, rows, shares, chips)
    assert (johnson.posted, johnson.in_campminder) == (1080.0, 1000.0)
    assert [(s.status, s.count, s.gap) for s in johnson.states] == [("short", 1, -80.0)]
    garcia = household_money(GARCIA, rows, shares, chips)
    assert [(s.status, s.count, s.gap) for s in garcia.states] == [("confirmed", 1, 0.0)]


def test_a_single_payer_card_still_carries_the_requests_whole_figure() -> None:
    rows = [
        _row(
            LIAM,
            GARCIA,
            rounds=[_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))],
            total_decided=1800.0,
            total_posted=1800.0,
            confirmation=_confirmation("short", 1800.0, 1590.0, []),
        )
    ]
    card = household_money(GARCIA, rows, {LIAM: (share_row(LIAM, GARCIA, "100"),)}, {GARCIA: 1})
    assert card.in_campminder == 1590.0
    assert [(s.status, s.count, s.gap) for s in card.states] == [("short", 1, -210.0)]


def test_a_lone_payer_whose_share_is_not_100_shows_no_gap() -> None:
    """One payer at 60% doesn't add up either: `split` yields it no decided or posted part, so its card never reads
    the request's whole CampMinder figure as a gap against a posted of nothing."""
    rows = [
        _row(
            LIAM,
            GARCIA,
            rounds=[_round(1, "posted", decided=1800.0, posted=1800.0, posted_on=date(2031, 3, 9))],
            total_decided=1800.0,
            total_posted=1800.0,
            confirmation=_confirmation("short", 1800.0, 1590.0, []),
        )
    ]
    shares = {LIAM: (share_row(LIAM, GARCIA, "60"),)}
    card = household_money(GARCIA, rows, shares, {GARCIA: 1})
    assert (card.in_campminder, card.states) == (None, [])
    [line] = share_lines(rows[0], shares[LIAM], {GARCIA: 1})
    assert (line.in_campminder, line.status) == (None, None)


def test_a_reversed_split_request_reads_reversed_for_every_payer() -> None:
    """A clawed-back request's confirmation carries no per-share lines even when its shares add up: nothing is left
    in CampMinder for any payer, so each line reads $0 and reversed."""
    reversed_ = _confirmation("reversed", 0.0, 0.0, [])
    rows, shares = _split_request("60", "40", reversed_)
    lines = share_lines(rows[0], shares[EMMA], {JOHNSON: 1, GARCIA: 2})
    assert [(x.household_cm_id, x.in_campminder, x.status) for x in lines] == [
        (JOHNSON, 0.0, "reversed"),
        (GARCIA, 0.0, "reversed"),
    ]


# --- the service: one season, one grants load, the page's own reads ----------------------------------


def _grant_out(household: int, request_id: str | None, amount: float, txn: int) -> GrantRowOut:
    return GrantRowOut(
        kind="ledger",
        transaction_cm_id=txn,
        commitment_id="",
        household_cm_id=household,
        family_name=f"Family {household}",
        person_cm_id=0,
        camper_name="",
        camper_basis="ledger",
        session_cm_id=1000101,
        session_name="Session 2",
        program_family="summer",
        grantor_key="regional_fund",
        grantor_name="Regional Fund",
        description="Regional Grant",
        source_family="other_outside",
        funder_type="outside",
        amount=amount,
        recorded_on="2027-02-10",
        is_reversed=False,
        reversal_date="",
        cancelled=False,
        counts=True,
        fulfils_commitment_id="",
        requests=[RequestShareOut(request_id=request_id, amount=amount)] if request_id else [],
    )


class _Grants:
    def __init__(self) -> None:
        self.loads = 0
        self.rows: list[RegisterRow] = [grant_row(EMMA, "200")]
        self.read_out = GrantsResponse(
            year=YEAR,
            grants=[_grant_out(JOHNSON, EMMA, 200.0, 9001), _grant_out(OTHER, None, 500.0, 9002)],
            needs_camper=[],
            unmapped=[],
            waiting=[],
            expected=[],
        )

    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[RegisterRow]]:
        self.loads += 1
        return self.read_out, self.rows


def _ask(value: str) -> AnswerOut:
    return AnswerOut(
        field="ask", synced=value, effective=value, corrected=False, changed_since_correction=False, history=[]
    )


class _Casework:
    def __init__(self, store: FakeDecisionsStore) -> None:
        self.store = store

    async def application_detail(self, year: int, household_cm_id: int) -> ApplicationDetailResponse:
        own = [r for r in self.store.requests.values() if r.household_cm_id == household_cm_id]
        if not own:
            raise CaseworkNotFoundError("no application for that family and season")
        return ApplicationDetailResponse(
            year=year,
            household_cm_id=household_cm_id,
            status="active",
            member_person_cm_ids=[r.person_cm_id for r in own],
            answers=[_ask("60000").model_copy(update={"field": "total_gross_income"})],
            notes={"special_circumstances": ""},
            requests=[
                RequestOut(
                    id=r.id,
                    household_cm_id=r.household_cm_id,
                    person_cm_id=r.person_cm_id,
                    session_cm_id=r.session_cm_id,
                    program_key=r.program_key,
                    program_option_text=r.program_option_text,
                    session_resolution=r.session_resolution,
                    status=r.status,
                    duplicate_of="",
                    ask=_ask(str(r.ask)),
                    headcount_non_infant=0,
                    headcount_infant=0,
                    headcount_source="",
                    flags=[],
                    payer_share_status="complete",
                )
                for r in own
            ],
            flags=[],
        )


def _posting(txn: int, household: int, amount: float, **kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "transaction_cm_id": txn,
        "household_cm_id": household,
        "amount": -amount,
        "source_key": "camp financial assistance",
        "effective_source_key": "camp financial assistance",
        "source_family": "camp_fa",
        "funder_type": "camp",
        "counts_toward_budget": True,
        "post_date": "2027-03-09 17:00:00.000Z",
        "is_reversed": False,
        "reversal_date": "",
        "transaction_note": "",
        "attribution_level": "session",
        "attribution_method": "household_single_camper",
        "program_family": "summer",
        "attributed_person_cm_id": 0,
        "attributed_session_cm_id": 0,
        "candidate_program_families": [],
        "flags": [],
    }
    return SimpleNamespace(**{**base, **kw})


class _Ledger:
    def __init__(self) -> None:
        self.postings = [
            _posting(9101, JOHNSON, 750.0, post_date="2027-03-10 17:00:00.000Z"),
            _posting(9100, JOHNSON, 750.0, is_reversed=True, reversal_date="2027-03-10 17:00:00.000Z"),
            _posting(9102, OTHER, 900.0),
        ]
        self.posting_reads: list[frozenset[int]] = []
        self.name_reads: list[frozenset[str]] = []
        self.count_reads: list[frozenset[int]] = []

    async def fetch_postings(
        self, year: int, household_ids: Collection[int] | None = None, *, include_reversed: bool = False
    ) -> list[Any]:
        wanted = frozenset(household_ids or ())
        self.posting_reads.append(wanted)
        return [p for p in self.postings if p.household_cm_id in wanted and (include_reversed or not p.is_reversed)]

    async def fetch_dispositions(self, year: int) -> list[Any]:
        return []

    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        rows = [
            SimpleNamespace(
                cm_id=JOHNSON,
                mailing_title="The Johnson Family",
                greeting="",
                household_phone="555-0100",
                billing_city="Riverside",
                billing_state="CA",
                billing_postal_code="94612",
            ),
            SimpleNamespace(
                cm_id=GARCIA,
                mailing_title="The Garcia Family",
                greeting="",
                household_phone="",
                billing_city="",
                billing_state="",
                billing_postal_code="",
            ),
        ]
        return [h for h in rows if h.cm_id in cm_ids]

    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        people = [
            SimpleNamespace(
                cm_id=1000011,
                first_name="Emma",
                preferred_name="",
                last_name="Johnson",
                household_id=JOHNSON,
                primary_email="test@example.com",
                parent_names=[{"first": "Pat", "last": "Johnson"}, {"first": "Alex", "last": "Garcia"}],
            ),
        ]
        return [p for p in people if p.cm_id in cm_ids]

    async def fetch_session_counts(self, year: int, session_cm_ids: Collection[int]) -> dict[int, tuple[int, int]]:
        self.count_reads.append(frozenset(session_cm_ids))
        return {1000101: (180, 12)}

    async def fetch_capacities(self, year: int, session_cm_ids: Collection[int]) -> dict[int, Any]:
        return {1000101: SimpleNamespace(session_cm_id=1000101, capacity=190, note="Board figure")}

    async def fetch_user_names(self, emails: Collection[str]) -> dict[str, str]:
        self.name_reads.append(frozenset(emails))
        return {e.lower(): "Test User" for e in emails if e.lower() == ACTOR}

    async def fetch_links(self, year: int) -> list[Any]:
        return [
            SimpleNamespace(
                id="lnk000000000001",
                year=YEAR,
                household_cm_id=JOHNSON,
                family_key="fam-1",
                source="auto",
                excluded=False,
                note="",
                actor="system",
            ),
            SimpleNamespace(
                id="lnk000000000002",
                year=YEAR,
                household_cm_id=1000004,
                family_key="fam-1",
                source="auto",
                excluded=False,
                note="",
                actor="system",
            ),
            SimpleNamespace(
                id="lnk000000000003",
                year=YEAR,
                household_cm_id=OTHER,
                family_key="fam-9",
                source="auto",
                excluded=False,
                note="",
                actor="system",
            ),
        ]


class _History:
    def __init__(self) -> None:
        self.rows = [
            _log("log000000000001", "aid_requests", EMMA, "create", "system:intake", "2027-01-05 17:00:00.000Z"),
            _log(
                "log000000000002", "aid_payer_shares", f"{EMMA}:{GARCIA}", "update", ACTOR, "2027-01-06 17:00:00.000Z"
            ),
            _log("log000000000003", "aid_decisions", f"{EMMA}:1", "post", ACTOR, "2027-03-09 17:00:00.000Z"),
            _log(
                "log000000000004",
                "aid_applications",
                f"app{JOHNSON:012d}",
                "create",
                "system:intake",
                "2027-01-05 16:59:00.000Z",
            ),
            _log("log000000000005", "aid_requests", OLIVIA, "create", "system:intake", "2027-01-05 17:00:00.000Z"),
            _log(
                "log000000000006", "aid_household_links", "lnk000000000001", "create", ACTOR, "2027-01-07 17:00:00.000Z"
            ),
        ]
        self.calls: list[tuple[frozenset[str], frozenset[str]]] = []

    async def fetch_entity_log(self, year: int, *, exact: Collection[str], containing: Collection[str]) -> list[Any]:
        self.calls.append((frozenset(exact), frozenset(containing)))
        return sorted(
            (r for r in self.rows if r.entity_id in exact or any(c in r.entity_id for c in containing)),
            key=lambda r: (r.created, r.id),
        )


def _log(log_id: str, entity: str, entity_id: str, action: str, actor: str, created: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=log_id,
        year=YEAR,
        entity=entity,
        entity_id=entity_id,
        action=action,
        actor=actor,
        reason="",
        operation_id="op0000000000001",
        before=None,
        after='{"round": 1}' if entity == "aid_decisions" else None,
        created=created,
    )


def _family() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON, person=1000011)
    seed_request(store, LIAM, household=GARCIA, person=1000021)
    seed_request(store, OLIVIA, household=OTHER, person=1000031)
    store.shares = [s for s in store.shares if s.request_id != EMMA]
    store.shares += [share_row(EMMA, JOHNSON, "50"), share_row(EMMA, GARCIA, "50")]
    return store


def _page_service(
    store: FakeDecisionsStore,
    grants: _Grants | None = None,
    ledger: _Ledger | None = None,
    history: _History | None = None,
) -> HouseholdPageService:
    return HouseholdPageService(
        store=store,
        pricing=FakeRules(approved()),
        grants=grants or _Grants(),
        casework=_Casework(store),
        ledger=ledger or _Ledger(),
        history=history or _History(),
        clock=lambda: T0,
    )


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decision_schemas, "today", lambda: date(2027, 12, 31))


@pytest.mark.asyncio
async def test_the_page_shows_the_grids_own_rows_for_its_requests() -> None:
    store = _family()
    grants = _Grants()
    page = await _page_service(store, grants).read(YEAR, JOHNSON)

    async def register(year: int) -> list[RegisterRow]:
        return grants.rows

    grid = await FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0).grid(YEAR)
    by_id = {row.request_id: row for row in grid.rows}
    assert [card.row for card in page.requests] == [by_id[EMMA], by_id[LIAM]]
    assert grants.loads == 1


@pytest.mark.asyncio
async def test_the_page_scopes_households_cards_and_band_to_its_requests() -> None:
    page = await _page_service(_family()).read(YEAR, JOHNSON)
    assert (page.year, page.household_cm_id, page.rules_version) == (YEAR, JOHNSON, 1)
    assert [(h.household_cm_id, h.chip, h.family_name) for h in page.households] == [
        (JOHNSON, 1, "The Johnson Family"),
        (GARCIA, 2, "The Garcia Family"),
    ]
    johnson = page.households[0]
    assert (johnson.phone, johnson.emails, johnson.city, johnson.adults) == (
        "555-0100",
        ["test@example.com"],
        "Riverside, CA",
        ["Alex Garcia", "Pat Johnson"],
    )
    # Emma's Round 1 is 1,500 less the 200 grant the calculator subtracts: 1,300, half each.
    assert [h.money.decided for h in page.households] == [650.0, 2150.0]  # Garcia: half of Emma's, all of Liam's
    # The band, over both households' requests: cost 4,000 − decided 2,800 − grants 200 = family's share 1,000 (D77).
    assert (page.totals.cost, page.totals.decided, page.totals.grants, page.totals.family_share) == (
        4000.0,
        2800.0,
        200.0,
        1000.0,
    )
    card = page.requests[0]
    assert [(s.household_cm_id, s.chip) for s in card.shares] == [(JOHNSON, 1), (GARCIA, 2)]
    assert card.ask is not None
    assert card.ask.effective == "4000.0"


@pytest.mark.asyncio
async def test_the_page_lists_the_scopes_postings_grants_incomes_and_links_only() -> None:
    ledger = _Ledger()
    page = await _page_service(_family(), ledger=ledger).read(YEAR, JOHNSON)
    assert [p.transaction_cm_id for p in page.postings] == [9100, 9101]  # by post date; the reversed line stays
    assert ledger.posting_reads == [frozenset({JOHNSON, GARCIA})]
    assert [g.transaction_cm_id for g in page.grants] == [9001]
    assert [i.household_cm_id for i in page.incomes] == [JOHNSON, GARCIA]
    assert [ln.household_cm_id for ln in page.links] == [JOHNSON, 1000004]  # the whole linked family, D26 aside


@pytest.mark.asyncio
async def test_a_household_excluded_from_a_family_shows_its_own_row_but_not_that_familys_members() -> None:
    """The canonical family set takes its members from non-excluded rows only: excluding a household from
    family K must not surface K's other members as its links."""

    class _Excluded(_Ledger):
        async def fetch_links(self, year: int) -> list[Any]:
            rows = await super().fetch_links(year)
            rows[0].excluded = True  # Johnson is excluded from fam-1
            return rows

    page = await _page_service(_family(), ledger=_Excluded()).read(YEAR, JOHNSON)
    assert [(ln.household_cm_id, ln.excluded) for ln in page.links] == [(JOHNSON, True)]


@pytest.mark.asyncio
async def test_each_round_has_its_receipt_live_until_posted_then_the_lock_s_snapshot() -> None:
    """§4.7, D43, D52: a posted round's receipt is the snapshot stored at its lock, labelled with its rules version,
    lock day and who ticked it; an unposted round's is live."""
    store = _family()

    async def register(year: int) -> list[RegisterRow]:
        return []

    decisions = FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0)
    await decisions.tick_posted(YEAR, PostedIn(rows=[PostedRow(request_id=LIAM, round=1, amount=Decimal(1500))]), ACTOR)
    ledger = _Ledger()
    page = await _page_service(store, ledger=ledger).read(YEAR, GARCIA)
    liam = next(card for card in page.requests if card.row.request_id == LIAM)
    (locked,) = liam.receipts
    assert (locked.round, locked.label.kind, locked.label.season, locked.label.rules_version) == (1, "locked", YEAR, 1)
    assert (locked.label.locked_on, locked.label.lock_source, locked.label.ticked_by_name) == (
        date(2027, 3, 9),
        "tick",
        "Test User",
    )
    assert locked.trace
    assert ledger.name_reads == [frozenset({ACTOR})]
    emma = next(card for card in page.requests if card.row.request_id == EMMA)
    (live,) = emma.receipts
    assert (live.round, live.label.kind, live.label.locked_on, live.label.ticked_by_name) == (1, "live", None, None)
    assert {"r1"} <= {step.key for step in live.trace}


@pytest.mark.asyncio
async def test_a_household_with_no_aid_activity_is_not_found() -> None:
    with pytest.raises(HouseholdNotFoundError):
        await _page_service(_family()).read(YEAR, 1000009)


@pytest.mark.asyncio
async def test_a_household_with_only_a_grant_line_opens_a_page() -> None:
    """D8: an application, grants, or postings only."""
    grants = _Grants()
    grants.read_out = grants.read_out.model_copy(update={"grants": [_grant_out(1000009, None, 300.0, 9003)]})
    page = await _page_service(_family(), grants).read(YEAR, 1000009)
    assert (page.requests, [g.transaction_cm_id for g in page.grants]) == ([], [9003])
    assert (page.totals.grants, page.totals.family_share) == (None, None)


@pytest.mark.asyncio
async def test_the_timeline_is_the_familys_own_log_in_recorded_order() -> None:
    """§6.3 item 7: the requests' own log, intake's rows included; another family's rows never."""
    history = _History()
    page = await _page_service(_family(), history=history).read(YEAR, JOHNSON)
    assert [(h.entity, h.entity_id, h.request_id, h.actor) for h in page.history] == [
        ("aid_applications", f"app{JOHNSON:012d}", None, "system:intake"),
        ("aid_requests", EMMA, EMMA, "system:intake"),
        ("aid_payer_shares", f"{EMMA}:{GARCIA}", EMMA, ACTOR),
        ("aid_household_links", "lnk000000000001", None, ACTOR),
        ("aid_decisions", f"{EMMA}:1", EMMA, ACTOR),
    ]
    assert page.history[-1].after == {"round": 1}
    ((exact, containing),) = history.calls
    assert containing == {EMMA, LIAM}
    assert {f"app{JOHNSON:012d}", f"app{GARCIA:012d}", "lnk000000000001"} <= exact


# --- openable from the jump index, a malformed log row, actor case ----------------------------------------


@pytest.mark.asyncio
async def test_a_household_whose_only_request_is_withdrawn_still_opens_a_page() -> None:
    """The jump index lists a household with any aid activity, a withdrawn request included; its page must open."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, household=JOHNSON, person=1000011, status="withdrawn")
    page = await _page_service(store).read(YEAR, JOHNSON)
    assert [card.row.request_status for card in page.requests] == ["withdrawn"]
    assert page.totals.cost is None  # nothing included in the band


@pytest.mark.asyncio
@pytest.mark.parametrize("before", ["{not json", '["ab"]', "[[1, 2]]", "5", '"x"'])
async def test_a_malformed_or_non_object_log_detail_does_not_fail_the_page(before: str) -> None:
    history = _History()
    bad = _log("log000000000009", "aid_decisions", f"{EMMA}:2", "post", ACTOR, "2027-03-11 17:00:00.000Z")
    bad.before = before
    bad.after = "[1, 2]"
    history.rows.append(bad)
    page = await _page_service(_family(), history=history).read(YEAR, JOHNSON)
    entry = next(h for h in page.history if h.entity_id == f"{EMMA}:2")
    assert (entry.before, entry.after) == (None, None)
    assert len(page.history) == 6  # the rest of the timeline is intact


@pytest.mark.asyncio
async def test_a_log_row_with_no_created_time_is_left_out_of_the_timeline() -> None:
    history = _History()
    history.rows.append(_log("log000000000009", "aid_decisions", f"{EMMA}:2", "post", ACTOR, ""))
    page = await _page_service(_family(), history=history).read(YEAR, JOHNSON)
    assert len(page.history) == 5


@pytest.mark.asyncio
async def test_a_ticking_actors_name_is_found_whatever_the_case_of_their_email() -> None:
    store = _family()

    async def register(year: int) -> list[RegisterRow]:
        return []

    decisions = FinancialAidDecisionsService(store, FakeRules(approved()), register, clock=lambda: T0)
    shouting = ACTOR.upper()
    await decisions.tick_posted(
        YEAR, PostedIn(rows=[PostedRow(request_id=LIAM, round=1, amount=Decimal(1500))]), shouting
    )
    ledger = _Ledger()
    page = await _page_service(store, ledger=ledger).read(YEAR, GARCIA)
    liam = next(card for card in page.requests if card.row.request_id == LIAM)
    assert ledger.name_reads == [frozenset({ACTOR.upper()})]  # asked as recorded; the repository adds the lowercase
    assert liam.receipts[0].label.ticked_by_name == "Test User"


def test_a_refused_round_three_names_no_decider() -> None:
    from api.services.financial_aid_household_page import receipts

    state = RoundState(
        round=3,
        award=Decimal(500),
        approval="refused",
        decided_by=ACTOR,
        posted=True,
        posted_on=date(2027, 3, 9),
        posted_by=ACTOR,
        lock_source="tick",
        rules_version=1,
        snapshot={"result": {"trace": []}},
    )
    priced = SimpleNamespace(rounds=[SimpleNamespace(round=3)], result=None)
    (out,) = receipts(priced, {3: state}, year=YEAR, rules_version=1, names={ACTOR: "Test User"})  # type: ignore[arg-type]
    assert out.label.decided_by_name is None
    approved_state = replace(state, approval="approved")
    (named,) = receipts(priced, {3: approved_state}, year=YEAR, rules_version=1, names={ACTOR: "Test User"})  # type: ignore[arg-type]
    assert named.label.decided_by_name == "Test User"


def test_a_round_locked_by_the_ledger_names_no_one() -> None:
    from api.services.financial_aid_household_page import receipts
    from bunking.financial_aid.decisions import PricedRequest, RoundState  # noqa: F401

    state = RoundState(
        round=1,
        posted=True,
        posted_on=date(2027, 3, 9),
        posted_by="registrar@example.com",
        lock_source="ledger",
        rules_version=1,
        snapshot={"result": {"trace": []}},
    )
    priced = SimpleNamespace(rounds=[SimpleNamespace(round=1)], result=None)
    (out,) = receipts(priced, {1: state}, year=YEAR, rules_version=1, names={ACTOR: "Test User"})  # type: ignore[arg-type]
    assert (out.label.kind, out.label.lock_source, out.label.ticked_by_name) == ("locked", "ledger", None)


def test_the_band_counts_a_confirmed_split_request_under_its_short_share() -> None:
    """D59: confirmed overall, but one payer's share is short: the band agrees with Today and the cards."""
    row = _row(
        EMMA,
        JOHNSON,
        rounds=[_round(1, "posted", decided=1500.0, posted=1500.0, posted_on=date(2031, 3, 9))],
        total_posted=1500.0,
        confirmation=_confirmation(
            "confirmed",
            1500.0,
            1500.0,
            [
                ShareConfirmationOut(household_cm_id=JOHNSON, expected=900.0, in_campminder=1100.0, status="confirmed"),
                ShareConfirmationOut(household_cm_id=GARCIA, expected=600.0, in_campminder=400.0, status="short"),
            ],
        ),
    )
    out = totals([row], {})
    assert [(s.status, s.count, s.gap) for s in out.states] == [("confirmed", 1, 200.0), ("short", 1, -200.0)]


def test_a_round_ticked_by_a_placement_keeps_its_source_and_names_the_registrar() -> None:
    from api.services.financial_aid_household_page import receipts

    state = RoundState(
        round=1,
        posted=True,
        posted_on=date(2027, 3, 9),
        posted_by=ACTOR,
        lock_source="placement",
        rules_version=1,
        snapshot={"result": {"trace": []}},
    )
    priced = SimpleNamespace(rounds=[SimpleNamespace(round=1)], result=None)
    (out,) = receipts(priced, {1: state}, year=YEAR, rules_version=1, names={ACTOR: "Test User"})  # type: ignore[arg-type]
    assert (out.label.kind, out.label.lock_source, out.label.ticked_by_name) == ("locked", "placement", "Test User")


# --- grants applied (⚠38 (b), owner ruling 2026-10-01) ------------------------------------------------------


def test_the_band_shows_grants_applied_so_its_sum_adds_up_and_the_rest_is_beyond_what_was_owed() -> None:
    """Cost 2,000 − aid 1,500 − grants applied 500 = share 0; the grant's other 1,500 is beyond what Emma owed.
    The counted grants stay 2,000: the Grants table's money."""
    out = totals([_row(EMMA, JOHNSON)], {EMMA: Decimal(2000)})
    assert (out.cost, out.decided, out.grants, out.grants_applied, out.family_share, out.grants_beyond_owed) == (
        2000.0,
        1500.0,
        2000.0,
        500.0,
        0.0,
        1500.0,
    )
    assert out.cost is not None
    assert out.decided is not None
    assert out.grants_applied is not None
    assert out.cost - out.decided - out.grants_applied == out.family_share


def test_a_grant_within_what_was_owed_applies_whole() -> None:
    out = totals([_row(EMMA, JOHNSON), _row(LIAM, GARCIA)], {EMMA: Decimal(300)})
    assert (out.grants, out.grants_applied, out.grants_beyond_owed, out.family_share) == (300.0, 300.0, 0.0, 700.0)


def test_a_request_whose_aid_alone_passes_its_cost_applies_no_grant() -> None:
    """The per-request floor (owner ruling, #2924): aid 1,108 on a 1,000 cost owes nothing, so none of its 200 grant
    applies; never a negative 'applied' that would cancel a sibling's real grant."""
    parts = request_grants(_row(EMMA, JOHNSON, cost=1000.0, total_decided=1108.0), {EMMA: Decimal(200)})
    assert parts == (Decimal(200), Decimal(0), Decimal(200))


def test_grants_applied_wait_with_the_share_for_every_included_request_to_be_priced() -> None:
    """Decision 1 (⚠): while an included request has no decided total, the share reads "—", and so do grants
    applied and beyond; the counted grants still show."""
    rows = [_row(EMMA, JOHNSON), _row(LIAM, GARCIA, total_decided=None, rounds=[_round(1, "held")])]
    out = totals(rows, {EMMA: Decimal(300)})
    assert (out.grants, out.grants_applied, out.grants_beyond_owed, out.family_share) == (300.0, None, None, None)


def test_a_request_outside_the_band_carries_no_grants_applied() -> None:
    cancelled = CancellationOut(by="kindred", on=date(2031, 5, 1), reason="medical", note="")
    assert request_grants(_row(LIAM, GARCIA, cancellation=cancelled), {LIAM: Decimal(100)}) == (
        Decimal(100),
        None,
        None,
    )


def test_with_no_included_request_there_is_no_grants_applied() -> None:
    out = totals([], {})
    assert (out.grants_applied, out.grants_beyond_owed) == (None, None)


@pytest.mark.asyncio
async def test_each_request_card_carries_its_grants_and_what_of_them_applied() -> None:
    """_Grants holds a 200 grant on Emma; her cost is 2,000 and her decided award is at most 1,500."""
    page = await _page_service(_family()).read(YEAR, JOHNSON)
    emma = next(r for r in page.requests if r.row.request_id == EMMA)
    liam = next(r for r in page.requests if r.row.request_id == LIAM)
    assert (emma.grants, emma.grants_applied, emma.grants_beyond_owed) == (200.0, 200.0, 0.0)
    assert (liam.grants, liam.grants_applied, liam.grants_beyond_owed) == (0.0, 0.0, 0.0)
    assert (page.totals.grants, page.totals.grants_applied, page.totals.grants_beyond_owed) == (200.0, 200.0, 0.0)


# --- aid, decided so far (read 12; Decision 2) ------------------------------------------------------------------


@pytest.mark.parametrize("status", ["held", "not_decided", "pending_approval"])
def test_aid_decided_is_partial_while_an_included_round_is_undecided(status: str) -> None:
    """Decision 2 (⚠): a held round counts too: its amount is unknown, so the sum is partial."""
    posted = _round(1, "posted", decided=1500.0, posted=1500.0)
    rows = [_row(EMMA, JOHNSON), _row(LIAM, GARCIA, rounds=[posted, _round(3, status, ask=500.0)])]
    assert totals(rows, {}).decided_partial is True


def test_aid_decided_is_whole_once_every_included_round_is_decided_or_refused() -> None:
    rows = [
        _row(EMMA, JOHNSON),
        _row(LIAM, GARCIA, rounds=[_round(1, "needs_offer", decided=1500.0), _round(3, "refused")]),
    ]
    assert totals(rows, {}).decided_partial is False


def test_an_undecided_round_outside_the_band_leaves_it_whole() -> None:
    rows = [_row(EMMA, JOHNSON), _row(OLIVIA, OTHER, request_status="withdrawn", rounds=[_round(1, "held")])]
    assert totals(rows, {}).decided_partial is False


def test_a_mixed_household_adds_up_per_request_not_across_the_household() -> None:
    """Emma's 2,000 grant owes 500 of it, Liam's 300 applies whole: applied 800, beyond 1,500, and cost − aid − applied
    is the share (200) request by request. A household-level floor would read 0 (4,000 − 3,000 − 2,300)."""
    out = totals([_row(EMMA, JOHNSON), _row(LIAM, GARCIA)], {EMMA: Decimal(2000), LIAM: Decimal(300)})
    assert (out.grants, out.grants_applied, out.grants_beyond_owed, out.family_share) == (2300.0, 800.0, 1500.0, 200.0)
    assert out.cost is not None
    assert out.decided is not None
    assert out.grants_applied is not None
    assert out.cost - out.decided - out.grants_applied == out.family_share


def test_when_a_requests_aid_alone_passes_its_cost_the_band_falls_short_by_the_excess() -> None:
    """Pins today's behaviour (open owner item 1b): aid 1,108 on a 1,000 cost owes nothing (share 0) and no grant
    applies, so cost − aid − applied reads −108, not the share. The equation holds except for that excess."""
    out = totals([_row(EMMA, JOHNSON, cost=1000.0, total_decided=1108.0)], {EMMA: Decimal(200)})
    assert (out.family_share, out.grants_applied, out.grants_beyond_owed) == (0.0, 0.0, 200.0)
    assert out.cost is not None
    assert out.decided is not None
    assert out.cost - out.decided - (out.grants_applied or 0) == -108.0


@pytest.mark.asyncio
async def test_the_page_carries_the_seasons_reason_codes() -> None:
    """Decision 6: the cost-override and headcount forms offer the approved rules' cost.override_reasons."""
    page = await _page_service(_family()).read(YEAR, JOHNSON)
    assert page.override_reasons == [
        "headcount",
        "partial_session",
        "discount",
        "missing_catalog",
        "typed_household_total",
    ]


@pytest.mark.asyncio
async def test_a_round_3_request_shows_its_sessions_enrollment_waitlist_and_capacity() -> None:
    """§6.3 item 4 (context only): enrolled = attendees status 2, waitlisted = status 8, capacity as finance entered it."""
    store = _family()
    store.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=3,
            kind="ask",
            created=T0,
            amount=Decimal(500),
            effective_on=date(2027, 3, 1),
            statement_of_need="Lost a job this spring",
        )
    )
    ledger = _Ledger()
    page = await _page_service(store, ledger=ledger).read(YEAR, JOHNSON)
    emma = next(r for r in page.requests if r.row.request_id == EMMA)
    liam = next(r for r in page.requests if r.row.request_id == LIAM)
    assert emma.round3_context is not None
    assert emma.round3_context.model_dump() == {
        "session_cm_id": 1000101,
        "enrolled": 180,
        "waitlisted": 12,
        "capacity": 190,
        "capacity_note": "Board figure",
    }
    assert liam.round3_context is None
    assert ledger.count_reads == [frozenset({1000101})]


@pytest.mark.asyncio
async def test_a_page_with_no_round_3_reads_no_counts() -> None:
    ledger = _Ledger()
    await _page_service(_family(), ledger=ledger).read(YEAR, JOHNSON)
    assert ledger.count_reads == []


@pytest.mark.asyncio
async def test_a_household_card_names_its_county_from_the_billing_zip(monkeypatch: pytest.MonkeyPatch) -> None:
    import bunking.geo_normalizer.zip_counties as zip_counties

    monkeypatch.setattr(zip_counties, "_table", lambda: {"94612": "Alameda County"})
    page = await _page_service(_family()).read(YEAR, JOHNSON)
    assert [(c.household_cm_id, c.county) for c in page.households] == [(JOHNSON, "Alameda County"), (GARCIA, None)]


# --- each grant row says whether the band counted it ---------------------------------------------


def _flags(grants: list[GrantRowOut], rows: list[GridRowOut]) -> list[bool]:
    return [g.in_band for g in grant_rows_with_band_flag(grants, rows)]


def test_a_counted_outside_grant_on_a_live_request_is_in_the_band() -> None:
    rows = [_row(EMMA, JOHNSON)]
    grants = [_grant_out(JOHNSON, EMMA, 200.0, 9001)]
    assert _flags(grants, rows) == [True]
    assert totals(rows, band_grants_by_request([grant_row(EMMA, "200")])).grants == 200.0


@pytest.mark.parametrize("status", ["withdrawn", "duplicate"])
def test_the_same_grant_on_a_withdrawn_or_duplicate_request_is_not_in_the_band(status: str) -> None:
    rows = [_row(EMMA, JOHNSON, request_status=status), _row(LIAM, JOHNSON)]
    grants = [_grant_out(JOHNSON, EMMA, 200.0, 9001)]
    assert _flags(grants, rows) == [False]
    assert totals(rows, band_grants_by_request([grant_row(EMMA, "200")])).grants == 0.0


def test_a_grant_that_does_not_count_or_is_not_outside_is_not_in_the_band() -> None:
    rows = [_row(EMMA, JOHNSON)]
    uncounted = _grant_out(JOHNSON, EMMA, 200.0, 9001).model_copy(update={"counts": False})
    camp = _grant_out(JOHNSON, EMMA, 200.0, 9002).model_copy(update={"funder_type": "camp"})
    assert _flags([uncounted, camp], rows) == [False, False]


def test_the_bands_grant_figure_is_the_sum_over_the_rows_flagged_in_band() -> None:
    rows = [_row(EMMA, JOHNSON), _row(LIAM, JOHNSON, request_status="withdrawn")]
    grants = [
        _grant_out(JOHNSON, EMMA, 200.0, 9001),
        _grant_out(JOHNSON, LIAM, 300.0, 9002),
        _grant_out(JOHNSON, EMMA, 50.0, 9003).model_copy(update={"counts": False}),
    ]
    register = [grant_row(EMMA, "200"), grant_row(LIAM, "300")]
    live = {r.request_id for r in rows if r.request_status == "active"}
    flagged = grant_rows_with_band_flag(grants, rows)
    from_rows = sum(s.amount for g in flagged if g.in_band for s in g.requests if s.request_id in live)
    assert totals(rows, band_grants_by_request(register)).grants == from_rows == 200.0


def test_a_grant_split_over_a_live_and_a_withdrawn_request_is_in_the_band_for_its_live_share_only() -> None:
    """in_band is per grant and the band per request share: a grant with any share on an included request reads
    True, and the band takes that share alone, never the row's full amount."""
    rows = [_row(EMMA, JOHNSON), _row(LIAM, JOHNSON, request_status="withdrawn")]
    split = _grant_out(JOHNSON, EMMA, 300.0, 9001).model_copy(
        update={
            "requests": [RequestShareOut(request_id=EMMA, amount=100.0), RequestShareOut(request_id=LIAM, amount=200.0)]
        }
    )
    register = [
        replace(grant_row(EMMA, "300"), requests=(RequestShare(EMMA, Decimal(100)), RequestShare(LIAM, Decimal(200))))
    ]
    assert _flags([split], rows) == [True]
    assert totals(rows, band_grants_by_request(register)).grants == 100.0


def test_a_last_dollar_grant_is_in_the_band_as_the_band_counts_it() -> None:
    """Decision 7 (⚠): in_band follows band_grants_by_request's reading. The grant row carries no
    pays-after-camp-aid mark, so flipping Decision 7 is also grant_rows_with_band_flag and this test."""
    rows = [_row(EMMA, JOHNSON)]
    assert band_grants_by_request([grant_row(EMMA, "2000", pays_after_camp_aid=True)]) == {EMMA: Decimal(2000)}
    assert _flags([_grant_out(JOHNSON, EMMA, 2000.0, 9001)], rows) == [True]
