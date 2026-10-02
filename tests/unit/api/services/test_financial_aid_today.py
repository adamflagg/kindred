"""Today (clean spec §6.4, D24, D21): one dense line per waiting queue, counted from the same
memberships the Requests views list (financial_aid_queues), plus the grants and finance lines.
Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any

import pytest

from api.schemas.financial_aid import UnclassifiedSource
from api.schemas.financial_aid_decisions import ConfirmationOut, GridRowOut, RoundOut, ShareConfirmationOut
from api.schemas.financial_aid_grants import (
    GrantorOut,
    GrantorsResponse,
    GrantRowOut,
    GrantsResponse,
    NeedsCamperOut,
    RequestShareOut,
    UnmappedDescriptionOut,
    WaitingCommitmentOut,
)
from api.schemas.financial_aid_intake import IssueOut
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_service import never_true_fields, never_true_labels
from api.services.financial_aid_queues import row_queues
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from api.services.financial_aid_today import CASEWORK_LINES, FINANCE_LINES, TodayInputs, TodayService, build_today
from bunking.financial_aid.rules.lifecycle import SectionStatus
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, grant_row, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR, fa_row, intake_rules
from tests.unit.bunking.financial_aid.fixtures import with_levers

TODAY = date(2031, 4, 20)


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


def _row(request_id: str, household: int, *rounds: RoundOut, **over: Any) -> GridRowOut:
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
        "rounds": list(rounds),
        "total_decided": None,
        "total_posted": None,
        "holds": [],
        "released_holds": [],
        "notes": [],
    }
    row = GridRowOut(**{**base, **over})
    return row.model_copy(update={"queues": row_queues(row)})


def _hold(code: str) -> IssueOut:
    return IssueOut(code=code, severity="hold", message=code)


def _confirmation(status: str, gap: float) -> ConfirmationOut:
    return ConfirmationOut(
        status=status,
        locked=1500.0,
        in_campminder=1500.0 + gap,
        gap=gap,
        on=None,
        reconciled=False,
        family_unplaced=0.0,
        shares=[],
    )


def _grant(**over: Any) -> GrantRowOut:
    base: dict[str, Any] = {
        "kind": "ledger",
        "transaction_cm_id": 9001,
        "commitment_id": "",
        "household_cm_id": 1000001,
        "family_name": "Family 1000001",
        "person_cm_id": 1000011,
        "camper_name": "Emma Johnson",
        "camper_basis": "ledger",
        "session_cm_id": 1000101,
        "session_name": "Session 2",
        "program_family": "summer",
        "grantor_key": "regional_fund",
        "grantor_name": "Regional Fund",
        "description": "Regional Grant",
        "source_family": "other_outside",
        "funder_type": "outside",
        "amount": 2000.0,
        "recorded_on": "2031-04-02",
        "is_reversed": False,
        "reversal_date": "",
        "cancelled": False,
        "counts": True,
        "fulfils_commitment_id": "",
        "requests": [RequestShareOut(request_id="reqemma00000001", amount=2000.0)],
    }
    return GrantRowOut(**{**base, **over})


def _grantor(key: str, *, full: bool, after: bool = False) -> GrantorOut:
    return GrantorOut(
        key=key,
        name=key,
        aliases=[],
        full_coverage=full,
        covers_canteen="unknown",
        pays_after_camp_aid=after,
        eligibility="",
        contacts="",
        retired_at="",
        descriptions=[],
    )


def _grants(**over: Any) -> GrantsResponse:
    base: dict[str, Any] = {
        "year": 2031,
        "grants": [],
        "needs_camper": [],
        "unmapped": [],
        "waiting": [],
        "expected": [],
    }
    return GrantsResponse(**{**base, **over})


def _inputs(rows: list[GridRowOut], **over: Any) -> TodayInputs:
    base: dict[str, Any] = {
        "year": 2031,
        "rows": rows,
        "grants": _grants(),
        "register": [],
        "grantors": [],
        "draft_sections": None,
        "unclassified": [],
        "today": TODAY,
    }
    return TodayInputs(**{**base, **over})


def _line(lines: list[Any] | None, key: str) -> Any:
    assert lines is not None
    return next(line for line in lines if line.key == key)


def test_needs_an_offer_counts_families_and_requests_broken_down_by_round() -> None:
    rows = [
        _row("reqemma00000001", 1000001, _round(1, "needs_offer", decided=1500.0)),
        _row("reqsamu00000001", 1000001, _round(1, "needs_offer", decided=1500.0)),
        _row(
            "reqliam00000001",
            1000002,
            _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9)),
            _round(2, "needs_offer", ask=400.0, decided=300.0),
        ),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "needs_offer")
    assert (line.families, line.items, line.item_kind) == (2, 3, "requests")
    assert [(r.code, r.families, r.items) for r in line.reasons] == [("r1", 1, 2), ("r2", 1, 1)]


def test_holds_break_down_by_reason_largest_first() -> None:
    rows = [
        _row("reqemma00000001", 1000001, _round(1, "held"), holds=[_hold("household_income_conflict")]),
        _row("reqsamu00000001", 1000001, _round(1, "held"), holds=[_hold("household_income_conflict")]),
        _row("reqliam00000001", 1000002, _round(1, "held"), holds=[_hold("payer_shares_incomplete")]),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "holds")
    assert (line.families, line.items) == (2, 3)
    assert [(r.code, r.items) for r in line.reasons] == [
        ("household_income_conflict", 2),
        ("payer_shares_incomplete", 1),
    ]


def test_waiting_on_the_family_names_the_oldest_and_how_many_wait_over_14_days() -> None:
    rows = [
        _row("reqemma00000001", 1000001, _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9))),
        _row("reqliam00000001", 1000002, _round(1, "posted", posted=1500.0, posted_on=date(2031, 4, 15))),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "waiting_on_family")
    assert (line.items, line.oldest_days, line.over_14_days) == (2, 42, 1)


def test_not_reconciled_breaks_down_by_state_and_names_the_largest_gap() -> None:
    posted = _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9))
    rows = [
        _row("reqemma00000001", 1000001, posted, confirmation=_confirmation("short", -210.0)),
        _row("reqliam00000001", 1000002, posted, confirmation=_confirmation("over", 300.0)),
        _row("reqoliv00000001", 1000003, posted, confirmation=_confirmation("awaiting_sync", -1500.0)),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "not_reconciled")
    assert [(r.code, r.items) for r in line.reasons] == [("awaiting_sync", 1), ("over", 1), ("short", 1)]
    assert line.largest_gap == 300.0  # short and over only: awaiting tonight's sync is not a disagreement


def test_a_lock_campminder_does_not_hold_is_the_largest_gap_when_it_is_biggest() -> None:
    """Owner ruling 2026-10-01: not_in_campminder (a sync ran and CampMinder holds $0) is a disagreement, gap = the
    locked amount; awaiting_sync stays out."""
    posted = _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9))
    rows = [
        _row("reqemma00000001", 1000001, posted, confirmation=_confirmation("short", -210.0)),
        _row("reqliam00000001", 1000002, posted, confirmation=_confirmation("not_in_campminder", -1500.0)),
        _row("reqoliv00000001", 1000003, posted, confirmation=_confirmation("awaiting_sync", -2500.0)),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "not_reconciled")
    assert line.largest_gap == 1500.0


def test_a_payer_share_that_disagrees_is_counted_under_its_own_state() -> None:
    """D59: a request confirmed overall stays Not reconciled while a share is short; the share's state is the reason."""
    confirmation = ConfirmationOut(
        status="confirmed",
        locked=1500.0,
        in_campminder=1500.0,
        gap=0.0,
        on=None,
        reconciled=False,
        family_unplaced=0.0,
        shares=[
            ShareConfirmationOut(household_cm_id=1000001, expected=750.0, in_campminder=1000.0, status="over"),
            ShareConfirmationOut(household_cm_id=1000002, expected=750.0, in_campminder=500.0, status="short"),
        ],
    )
    posted = _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9))
    rows = [_row("reqemma00000001", 1000001, posted, confirmation=confirmation)]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "not_reconciled")
    assert [(r.code, r.items) for r in line.reasons] == [("over", 1), ("short", 1)]
    assert line.largest_gap == 250.0


def test_every_casework_line_is_present_even_at_zero() -> None:
    out = build_today(_inputs([]), casework=True, finance=False)
    assert out.casework is not None
    assert [line.key for line in out.casework] == list(CASEWORK_LINES)
    assert all(line.items == 0 for line in out.casework)
    assert out.finance is None


def test_grants_needing_attention_count_needs_a_camper_and_waiting_commitments() -> None:
    needs = NeedsCamperOut(grant=_grant(person_cm_id=0), household_applied=True, suggestion=None, candidates=[])
    waiting = WaitingCommitmentOut(
        grant=_grant(kind="commitment", transaction_cm_id=0, commitment_id="com000000000001", household_cm_id=1000002),
        days_waiting=30,
        reason="not_posted",
        transaction_cm_id=0,
    )
    grants = _grants(needs_camper=[needs], waiting=[waiting])
    line = _line(build_today(_inputs([], grants=grants), casework=True, finance=False).casework, "grants")
    assert (line.families, line.items, line.item_kind) == (2, 2, "grants")
    assert [(r.code, r.items) for r in line.reasons] == [("needs_camper", 1), ("not_posted", 1)]


def _known(grantor: str, day: date | None, *, txn: int = 9001, request: str = "reqemma00000001") -> RegisterRow:
    """A counted register row on `request`, known (D116: recorded_at) on `day` at noon camp time; None = undated."""
    at = datetime(day.year, day.month, day.day, 19, 0, tzinfo=UTC) if day is not None else None
    return replace(
        grant_row(request, "2000"),
        transaction_cm_id=txn,
        grantor_key=grantor,
        recorded_at=at,
        recorded_on=day.isoformat() if day is not None else "",
    )


def test_a_full_coverage_grant_known_after_the_round_was_posted_asks_to_contact_the_family() -> None:
    """Main spec §10.3: late full-coverage grants to discuss with the family. A last-dollar grantor (D143) pays
    after the award by design, so it is never late. The line lists the requests it counts (plan review I4)."""
    rows = [_row("reqemma00000001", 1000001, _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)))]
    register = [
        _known("full_fund", date(2031, 4, 2)),
        replace(_known("last_dollar_fund", date(2031, 4, 3), txn=9002), pays_after_camp_aid=True),
        _known("partial_fund", date(2031, 4, 4), txn=9003),
        _known("full_fund", date(2031, 3, 1), txn=9004),  # known before the lock
    ]
    grantors = [
        _grantor("full_fund", full=True),
        _grantor("last_dollar_fund", full=True, after=True),
        _grantor("partial_fund", full=False),
    ]
    out = build_today(_inputs(rows, register=register, grantors=grantors), casework=True, finance=False)
    line = _line(out.casework, "late_full_coverage")
    assert (line.families, line.items, line.request_ids) == (1, 1, ["reqemma00000001"])


def test_a_clawed_back_posted_round_is_not_late_full_coverage() -> None:
    """A round CampMinder reversed counts nowhere (D54), as `_waiting_since` and `_waiting_on_family` already
    treat it: a late full-coverage grant on a request whose only posted round is clawed back is not counted."""
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9), clawed_back=True),
        )
    ]
    out = build_today(
        _inputs(
            rows,
            register=[_known("full_fund", date(2031, 4, 2))],
            grantors=[_grantor("full_fund", full=True)],
        ),
        casework=True,
        finance=False,
    )
    assert _line(out.casework, "late_full_coverage").items == 0


def test_a_grant_committed_before_the_offer_and_posted_after_it_is_not_late() -> None:
    """Plan review I3, D116: a grant counts once known. A commitment entered before the lock was already in the
    award, so its later CampMinder line (recorded_on after the lock) is not late; recorded_at decides."""
    rows = [_row("reqemma00000001", 1000001, _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)))]
    committed_first = replace(_known("full_fund", date(2031, 3, 1)), recorded_on="2031-04-02")
    out = build_today(
        _inputs(rows, register=[committed_first], grantors=[_grantor("full_fund", full=True)]),
        casework=True,
        finance=False,
    )
    assert _line(out.casework, "late_full_coverage").items == 0


def test_a_grant_with_no_date_never_breaks_today() -> None:
    """Plan review I3: aid_postings.post_date is optional; an undated grant is skipped, never a 500."""
    rows = [_row("reqemma00000001", 1000001, _round(1, "posted", posted=1500.0, posted_on=date(2031, 3, 9)))]
    out = build_today(
        _inputs(rows, register=[_known("full_fund", None)], grantors=[_grantor("full_fund", full=True)]),
        casework=True,
        finance=False,
    )
    assert _line(out.casework, "late_full_coverage").items == 0


def test_finance_sees_pending_approval_with_its_amount_and_the_would_change_flags() -> None:
    posted = _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9))
    rows = [
        _row("reqemma00000001", 1000001, posted, _round(3, "pending_approval", pending_approval=900.0)),
        _row(
            "reqliam00000001",
            1000002,
            _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9), would_change_by=-200.0),
        ),
        _row(
            "reqoliv00000001",
            1000003,
            _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 3, 9), would_change_by=0.0),
        ),
    ]
    out = build_today(_inputs(rows), casework=False, finance=True)
    assert out.casework is None
    pending = _line(out.finance, "pending_approval")
    assert (pending.items, pending.amount) == (1, 900.0)
    would_change = _line(out.finance, "would_change")
    assert (would_change.items, would_change.request_ids) == (1, ["reqliam00000001"])  # a $0 change is no change


def test_finance_sees_draft_sections_and_new_descriptions() -> None:
    grants = _grants(
        unmapped=[
            UnmappedDescriptionOut(
                source_id="src000000000001",
                description_key="regional grant",
                description="Regional Grant",
                lines=3,
                amount=900.0,
            )
        ]
    )
    unclassified = [UnclassifiedSource(source_key="new aid line", description="New Aid Line", postings=2, amount=400.0)]
    out = build_today(
        _inputs([], grants=grants, unclassified=unclassified, draft_sections=["tiers", "award_tables"]),
        casework=False,
        finance=True,
    )
    sections = _line(out.finance, "rules_sections")
    assert (sections.items, sections.item_kind, sections.families) == (2, "sections", None)
    assert [r.code for r in sections.reasons] == ["award_tables", "tiers"]
    sources = _line(out.finance, "sources")
    assert (sources.items, sources.item_kind) == (2, "descriptions")
    assert [(r.code, r.items) for r in sources.reasons] == [("no_grantor", 1), ("unclassified", 1)]


def test_finance_sees_requests_waiting_for_approved_rules() -> None:
    rows = [_row("reqemma00000001", 1000001, _round(1, "held"), holds=[_hold("awaiting_approved_rules")])]
    line = _line(build_today(_inputs(rows), casework=False, finance=True).finance, "intake")
    assert line.request_ids == ["reqemma00000001"]
    assert [(r.code, r.items) for r in line.reasons] == [("awaiting_approved_rules", 1)]


def test_every_finance_line_is_present_even_at_zero() -> None:
    out = build_today(_inputs([]), casework=False, finance=True)
    assert out.finance is not None
    assert [line.key for line in out.finance] == list(FINANCE_LINES)


@pytest.mark.parametrize(("casework", "finance"), [(False, False), (True, True)])
def test_sections_follow_permissions(casework: bool, finance: bool) -> None:
    out = build_today(_inputs([]), casework=casework, finance=finance)
    assert (out.casework is not None, out.finance is not None) == (casework, finance)


# --- the service: one season read, one grants load ---------------------------------------------------


class _Grants:
    def __init__(self, grants: GrantsResponse) -> None:
        self.grants = grants
        self.loads = 0
        self.include_retired: bool | None = None

    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[Any]]:
        self.loads += 1
        return self.grants, []

    async def list_grantors(self, *, include_retired: bool = False) -> GrantorsResponse:
        self.include_retired = include_retired
        return GrantorsResponse(grantors=[])


class _Drafts:
    def __init__(self, version: RulesVersion | None) -> None:
        self.version = version

    async def load(self, year: int, version: int | None = None) -> RulesVersion:
        if self.version is None:
            raise RulesNotFoundError(f"No aid rules for {year}")
        return self.version


class _Ledger:
    def __init__(self, needs_group: list[str] | None = None) -> None:
        self.calls = 0
        self.needs_group = needs_group or []
        self.group_calls = 0

    async def unclassified_sources(self, year: int) -> list[UnclassifiedSource]:
        self.calls += 1
        return []

    async def needs_group_sources(self, year: int) -> list[str]:
        self.group_calls += 1
        return list(self.needs_group)


def _service(store: FakeDecisionsStore, grants: _Grants, drafts: _Drafts, ledger: _Ledger) -> TodayService:
    return TodayService(
        store=store, pricing=FakeRules(approved()), rules=drafts, grants=grants, ledger=ledger, clock=lambda: T0
    )


@pytest.mark.asyncio
async def test_today_prices_the_season_once_and_counts_its_queues() -> None:
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    seed_request(store, "reqliam00000001", household=1000002, person=1000021)
    grants = _Grants(_grants(year=YEAR))
    out = await _service(store, grants, _Drafts(None), _Ledger()).read(YEAR, casework=True, finance=False)
    assert out.year == YEAR
    needs_offer = _line(out.casework, "needs_offer")
    assert (needs_offer.families, needs_offer.items) == (2, 2)
    assert grants.loads == 1  # the register the season priced with and the grants lines: one load
    assert out.finance is None


@pytest.mark.asyncio
async def test_finance_reads_the_rules_draft_and_the_descriptions_only_for_finance() -> None:
    draft = approved().model_copy(
        update={"section_status": {**approved().section_status, "tiers": SectionStatus(state="draft")}}
    )
    ledger = _Ledger()
    service = _service(FakeDecisionsStore(), _Grants(_grants(year=YEAR)), _Drafts(draft), ledger)
    await service.read(YEAR, casework=True, finance=False)
    assert ledger.calls == 0
    out = await service.read(YEAR, casework=False, finance=True)
    assert [r.code for r in _line(out.finance, "rules_sections").reasons] == ["tiers"]
    assert ledger.calls == 1


@pytest.mark.asyncio
async def test_a_season_with_no_rules_yet_has_no_draft_sections() -> None:
    service = _service(FakeDecisionsStore(), _Grants(_grants(year=YEAR)), _Drafts(None), _Ledger())
    out = await service.read(YEAR, casework=False, finance=True)
    assert _line(out.finance, "rules_sections").items == 0


@pytest.mark.asyncio
async def test_a_user_with_neither_section_reads_nothing() -> None:
    grants = _Grants(_grants(year=YEAR))
    out = await _service(FakeDecisionsStore(), grants, _Drafts(None), _Ledger()).read(
        YEAR, casework=False, finance=False
    )
    assert (out.casework, out.finance, grants.loads) == (None, None, 0)


@pytest.mark.asyncio
async def test_today_reads_retired_grantors_too() -> None:
    """A retired grantor is hidden from pickers, not from history: Today resolves a grant's grantor through the
    whole directory, so a grantor retired later still answers for grants that named it."""
    grants = _Grants(_grants(year=YEAR))
    await _service(FakeDecisionsStore(), grants, _Drafts(None), _Ledger()).read(YEAR, casework=True, finance=False)
    assert grants.include_retired is True


def test_a_weighted_question_no_applicant_answered_yes_is_a_finance_line() -> None:
    """§6.4 Finance: "Intake health and season warnings, e.g. … equity_field_never_true (D69)"; one reason per field."""
    out = build_today(_inputs([], never_true=("unemployment", "gov_subsidies")), casework=False, finance=True)
    line = _line(out.finance, "equity_field_never_true")
    assert (line.families, line.items, line.item_kind) == (None, 2, "fields")
    assert sorted(r.code for r in line.reasons) == ["gov_subsidies", "unemployment"]


def test_with_every_question_answered_yes_somewhere_the_line_is_zero() -> None:
    line = _line(build_today(_inputs([]), casework=False, finance=True).finance, "equity_field_never_true")
    assert (line.items, line.reasons) == (0, [])


def _weighted_rules() -> Any:
    """The fixture rules with gov_subsidies weighted: intake_rules() alone weights no yes/no question."""
    return with_levers(intake_rules(), {"equity.weights.camp": {"bipoc": "0.5", "gov_subsidies": "1"}})


class _Intake:
    def __init__(self) -> None:
        self.reads = 0

    async def fetch_fa_rows(self, year: int) -> list[Any]:
        self.reads += 1
        return [fa_row(1000011)]

    async def load_equity_rules(self, year: int) -> Any:
        return _weighted_rules()


@pytest.mark.asyncio
async def test_today_reads_the_intake_warning_for_finance_only() -> None:
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    intake = _Intake()
    service = TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        intake=intake,
        clock=lambda: T0,
    )
    await service.read(YEAR, casework=True, finance=False)
    assert intake.reads == 0
    out = await service.read(YEAR, casework=False, finance=True)
    expected = never_true_fields(_weighted_rules(), [fa_row(1000011)])
    assert expected == ("gov_subsidies",)  # weighted, and nobody here answered yes
    assert sorted(r.code for r in _line(out.finance, "equity_field_never_true").reasons) == sorted(expected)


def _labelled_rules(*extra: dict[str, Any], weights: dict[str, str]) -> Any:
    """The fixture rules with `extra` household criteria appended (after the fixture's own) and `weights` on camp."""
    rules = intake_rules()
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    for key, field, label, also in (("hardship_a", "single_parent", "Single parent", ["unemployment"]),):
        criteria.append(
            {
                "key": key,
                "label": label,
                "source": "household",
                "field": field,
                "also_fields": also,
                "match": "equals_any",
                "values": ["yes"],
            }
        )
    criteria.extend(extra)
    return with_levers(rules, {"equity.criteria": criteria, "equity.weights.camp": {"bipoc": "0.5", **weights}})


def test_never_true_labels_pair_each_field_with_its_weighting_criterion() -> None:
    rules = _labelled_rules(weights={"gov_subsidies": "1"})
    assert never_true_labels(rules, [fa_row(1000011)]) == {"gov_subsidies": "Government subsidies"}


def test_a_field_reached_only_through_also_fields_gets_that_criterions_label() -> None:
    rules = _labelled_rules(weights={"hardship_a": "1"})
    labels = never_true_labels(rules, [fa_row(1000011)])
    assert labels["single_parent"] == "Single parent"
    assert labels["unemployment"] == "Single parent"  # unemployment is only an also_field of hardship_a here


def test_when_two_criteria_weight_a_field_the_first_in_rules_order_names_it() -> None:
    rules = _labelled_rules(weights={"hardship_a": "1", "unemployment": "1"})
    assert never_true_labels(rules, [fa_row(1000011)])["unemployment"] == "Unemployment"


def test_the_never_true_line_reasons_carry_labels_and_an_unmatched_field_gets_none() -> None:
    inputs = _inputs(
        [], never_true=("gov_subsidies", "orphan"), never_true_labels={"gov_subsidies": "Government subsidies"}
    )
    reasons = {
        r.code: r.label
        for r in _line(build_today(inputs, casework=False, finance=True).finance, "equity_field_never_true").reasons
    }
    assert reasons == {"gov_subsidies": "Government subsidies", "orphan": None}


def test_other_lines_reasons_have_no_label() -> None:
    out = build_today(_inputs([]), casework=True, finance=True)
    reasons = [r for line in [*(out.casework or []), *(out.finance or [])] for r in line.reasons]
    assert all(r.label is None for r in reasons)


@pytest.mark.asyncio
async def test_the_service_reads_labels_through_to_the_never_true_line() -> None:
    service = TodayService(
        store=FakeDecisionsStore(),
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        intake=_Intake(),
        clock=lambda: T0,
    )
    out = await service.read(YEAR, casework=False, finance=True)
    reasons = _line(out.finance, "equity_field_never_true").reasons
    assert [(r.code, r.label) for r in reasons] == [("gov_subsidies", "Government subsidies")]
