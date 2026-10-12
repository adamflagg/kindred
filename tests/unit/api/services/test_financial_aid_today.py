"""Today (clean spec §6.4, D24, D21): one dense line per waiting queue, counted from the same
memberships the Requests views list (financial_aid_queues), plus the grants and finance lines.
Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, get_args

import pytest

from api.schemas.financial_aid import UnclassifiedSource
from api.schemas.financial_aid_decisions import (
    CancellationOut,
    ConfirmationOut,
    GridRowOut,
    RoundOut,
    RowStageOut,
    ShareConfirmationOut,
)
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
from api.schemas.financial_aid_surfaces import TodayFlagsOut, TodayKey
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_service import never_true_fields, never_true_labels
from api.services.financial_aid_ledger_service import NamedSource
from api.services.financial_aid_queues import row_queues, row_stage
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from api.services.financial_aid_today import (
    BAR_SEGMENTS,
    BAR_STAGES,
    CASEWORK_LINES,
    DEVELOPMENT_LINES,
    FINANCE_LINES,
    FLAG_STAGES,
    NEXT_UP_CAP,
    TODAY_OVERDUE_DAYS,
    TodayInputs,
    TodayService,
    build_today,
    pending_since,
    week_start,
)
from bunking.financial_aid.decisions.budget import counted_part
from bunking.financial_aid.decisions.pricing import RoundView
from bunking.financial_aid.decisions.rounds import DecisionEvent
from bunking.financial_aid.rules.lifecycle import SectionStatus
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, grant_row, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR, fa_row, intake_rules
from tests.unit.api.services.test_camperships_frontend_mirrors import MIRRORS
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
        reconciled=status == "awaiting_sync",  # V1 (owner 10-03): Confirmation.reconciled's rule for these states
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
    # V1 (owner 10-03): a hand tick awaiting tonight's sync is no exception, so it is neither a reason nor an item
    assert (line.items, [(r.code, r.items) for r in line.reasons]) == (2, [("over", 1), ("short", 1)])
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


def test_today_has_no_cancel_reason_line() -> None:
    """Owner ruling B (2026-10-04): the cancel reason is optional, so Today never nags for a missing one."""
    assert "cancel_reason" not in CASEWORK_LINES
    assert "cancel_reason" not in get_args(TodayKey)


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


def test_finance_sees_pending_approval_with_its_amount_and_no_would_change_line() -> None:
    """Owner 2026-10-05: posted rounds are history, so Today has no "would change" line, whatever a row carries."""
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
    assert out.finance is not None
    assert "would_change" not in [line.key for line in out.finance]


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

    async def needs_group_descriptions(self, year: int) -> dict[str, NamedSource]:
        """Each description needing a group, by key, as CampMinder writes it, with its record id."""
        self.group_calls += 1
        return {key: NamedSource(f"{key.title()} (as written)", f"src-{key}") for key in self.needs_group}


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


def test_a_switched_off_criterion_raises_no_never_true_warning() -> None:
    """§8.6: a disabled criterion moves no one, so nobody answering its question yes is not news."""
    rules = _labelled_rules(weights={"gov_subsidies": "1", "hardship_a": "1"})
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    for criterion in criteria:
        if criterion["key"] == "hardship_a":
            criterion["enabled"] = False
    rules = with_levers(rules, {"equity.criteria": criteria})
    assert never_true_labels(rules, [fa_row(1000011)]) == {"gov_subsidies": "Government subsidies"}


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
    rows = [
        _row("reqemma00000001", 1000001, _round(1, "needs_offer", decided=1500.0)),
        _row("reqliam00000001", 1000002, _round(1, "held"), holds=[_hold("payer_shares_incomplete")]),
    ]
    out = build_today(_inputs(rows), casework=True, finance=True)
    reasons = [r for line in [*(out.casework or []), *(out.finance or [])] for r in line.reasons]
    assert {r.code for r in reasons} >= {"r1", "payer_shares_incomplete"}  # not vacuous: real reasons exist
    assert all(r.label is None for r in reasons)


def test_labels_walk_only_the_weighted_household_criteria_never_true_reads() -> None:
    camper = {
        "key": "camper_subsidy",
        "label": "Camper subsidy",
        "source": "camper",
        "field": "gov_subsidies",
        "match": "equals_any",
        "values": ["yes"],
    }
    dependents = {
        "key": "many_dependents",
        "label": "Many dependents",
        "source": "household",
        "field": "dependents",
        "also_fields": ["single_parent"],
        "match": "at_least",
        "min_value": "4",
    }
    rules = _labelled_rules(camper, dependents, weights={"camper_subsidy": "1", "many_dependents": "1"})
    assert never_true_labels(rules, [fa_row(1000011)]) == {}  # a camper or dependents criterion names no field


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


# --- Today home page (spec 2026-10-10 §5.2, §5.5): overdue and next up ---------------------------------------------


def test_overdue_thresholds_are_the_ruled_constants() -> None:
    assert dict(TODAY_OVERDUE_DAYS) == {"needs_offer": 10, "waiting_on_family": 14, "pending_approval": 3}


@pytest.mark.parametrize(("age", "overdue"), [(10, False), (11, True)])
def test_needs_an_offer_is_overdue_only_past_ten_days(age: int, overdue: bool) -> None:
    asked = date.fromordinal(TODAY.toordinal() - age)
    rows = [_row("reqemma00000001", 1000001, _round(1, "needs_offer", decided=1500.0, asked_on=asked))]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "needs_offer")
    assert (line.oldest_days, line.overdue) == (age, overdue)


@pytest.mark.parametrize(("age", "overdue"), [(14, False), (15, True)])
def test_waiting_on_the_family_is_overdue_only_past_fourteen_days(age: int, overdue: bool) -> None:
    posted = date.fromordinal(TODAY.toordinal() - age)
    rows = [_row("reqemma00000001", 1000001, _round(1, "posted", posted=1500.0, posted_on=posted))]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "waiting_on_family")
    assert (line.oldest_days, line.overdue) == (age, overdue)


@pytest.mark.parametrize(("age", "overdue"), [(3, False), (4, True)])
def test_pending_approval_is_overdue_only_past_three_days(age: int, overdue: bool) -> None:
    keyed = date.fromordinal(TODAY.toordinal() - age)
    rows = [_row("reqemma00000001", 1000001, _round(3, "pending_approval", pending_approval=300.0))]
    inputs = _inputs(rows, pending_since={("reqemma00000001", 3): keyed})
    line = _line(build_today(inputs, casework=False, finance=True).finance, "pending_approval")
    assert (line.oldest_days, line.overdue) == (age, overdue)


def test_a_line_with_no_threshold_is_never_overdue() -> None:
    rows = [_row("reqemma00000001", 1000001, _round(1, "held"), holds=[_hold("household_income_conflict")])]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "holds")
    assert line.overdue is False


def test_next_up_names_households_oldest_first_once_each() -> None:
    """Review focus 1: a household with two waiting requests is one chip, at its oldest."""
    old, mid, new = (date.fromordinal(TODAY.toordinal() - d) for d in (12, 9, 3))
    rows = [
        _row(
            "reqliam00000001",
            1000002,
            _round(1, "needs_offer", decided=900.0, asked_on=mid),
            family_name="Garcia",
            camper_name="Liam Garcia",
        ),
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "needs_offer", decided=1500.0, asked_on=new),
            family_name="Johnson",
            camper_name="Emma Johnson",
        ),
        _row(
            "reqsamu00000001",
            1000001,
            _round(1, "needs_offer", decided=1200.0, ask=1300.0, asked_on=old),
            family_name="Johnson",
            camper_name="Samuel Johnson",
        ),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "needs_offer")
    # Owner ruling 18: a camper request is named by the camper's full name, as the Requests grid names it.
    assert [(n.household_cm_id, n.label, n.days, n.camper_name, n.round, n.ask) for n in line.next_up] == [
        (1000001, "Samuel Johnson", 12, "Samuel Johnson", 1, 1300.0),
        (1000002, "Liam Garcia", 9, "Liam Garcia", 1, None),
    ]


def test_next_up_is_capped() -> None:
    asked = date.fromordinal(TODAY.toordinal() - 2)
    rows = [
        _row(f"req{i:012d}", 1000001 + i, _round(1, "needs_offer", decided=100.0, asked_on=asked))
        for i in range(NEXT_UP_CAP + 3)
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "needs_offer")
    assert len(line.next_up) == NEXT_UP_CAP == 8
    assert line.families == NEXT_UP_CAP + 3


def test_a_household_level_row_is_named_by_its_household_label() -> None:
    asked = date.fromordinal(TODAY.toordinal() - 1)
    rows = [
        _row(
            "reqfc0000000001",
            1000003,
            _round(1, "needs_offer", decided=800.0, asked_on=asked),
            family_name="Chen",
            household_label="Olivia & Wei Chen",
            household_label_tiebreak="FC2",
        )
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "needs_offer")
    assert (line.next_up[0].label, line.next_up[0].tiebreak) == ("Olivia & Wei Chen", "FC2")


def test_a_line_with_no_clock_names_households_without_days() -> None:
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "held", asked_on=date(2031, 4, 1)),
            holds=[_hold("household_income_conflict")],
            family_name="Johnson",
        ),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "holds")
    assert [(n.label, n.days) for n in line.next_up] == [("Johnson", None)]


def test_grants_and_count_only_lines_carry_no_next_up() -> None:
    lines = build_today(_inputs([]), casework=True, finance=True)
    for key in ("grants", "to_place", "late_full_coverage", "duplicates", "to_reverse", "session_not_settled"):
        assert _line(lines.casework, key).next_up == []
    for key in ("rules_sections", "sources", "intake", "equity_field_never_true"):
        assert _line(lines.finance, key).next_up == []


@pytest.mark.asyncio
async def test_finance_reads_when_each_pending_round_was_keyed() -> None:
    store = FakeDecisionsStore()
    request = seed_request(store, "reqemma00000001")
    # Round 3's award needs approval, keyed 2031-04-15 (TODAY is 2031-04-20)
    store.events.append(
        DecisionEvent(
            id="d1",
            request_id=request.id,
            round=3,
            kind="award",
            amount=Decimal(300),
            created=datetime(2031, 4, 15, 17, tzinfo=UTC),
            needs_approval=True,
        )
    )
    today = await _service(store, _Grants(_grants(year=YEAR)), _Drafts(None), _Ledger()).read(
        YEAR, casework=False, finance=True
    )
    assert (
        _line(today.finance, "pending_approval").oldest_days == (T0.astimezone(CAMP_TZ).date() - date(2031, 4, 15)).days
    )


def test_pending_since_keeps_the_latest_keyed_award_in_camp_time() -> None:
    early = DecisionEvent(
        id="d1",
        request_id="r1",
        round=3,
        kind="award",
        created=datetime(2031, 4, 10, 18, tzinfo=UTC),
        needs_approval=True,
    )
    late = DecisionEvent(
        id="d2",
        request_id="r1",
        round=3,
        kind="award",
        created=datetime(2031, 4, 16, 3, tzinfo=UTC),
        needs_approval=True,
    )  # 03:00 UTC is still the 15th in camp time (America/Los_Angeles)
    plain = DecisionEvent(id="d3", request_id="r2", round=1, kind="award", created=datetime(2031, 4, 1, tzinfo=UTC))
    assert pending_since([early, late, plain]) == {("r1", 3): date(2031, 4, 15)}


def _staged(request_id: str, household: int, code: str, *rounds: RoundOut) -> GridRowOut:
    row = _row(request_id, household, *rounds)
    return row.model_copy(update={"stage": RowStageOut(round=1, code=code, label=code)})


def test_week_starts_on_monday() -> None:
    assert week_start(date(2031, 4, 20)) == date(2031, 4, 14)  # TODAY, 2031-04-20, is a Sunday
    assert week_start(date(2031, 4, 14)) == date(2031, 4, 14)


def _real(request_id: str, household: int, *rounds: RoundOut, **over: Any) -> GridRowOut:
    """A grid row as the service builds it: its queues (row_queues, via _row) and its Stage column (row_stage)."""
    row = _row(request_id, household, *rounds, **over)
    return row.model_copy(update={"stage": row_stage(row)})


_CANCELLED = CancellationOut(by="kindred", on=date(2031, 4, 2), reason=None, note="")


def _linear() -> list[GridRowOut]:
    """The linear workflow (ruling 16), one request a stage, each on its own queue and nothing else: Needs an offer,
    Pending approval, Waiting on the family, Accepted."""
    posted_on = date(2031, 4, 10)
    return [
        _real("roffer", 1000001, _round(1, "needs_offer", decided=500.0, asked_on=posted_on)),
        _real("rpend", 1000002, _round(1, "pending_approval", pending_approval=300.0)),
        _real("rwait", 1000003, _round(1, "posted", posted=800.0, posted_on=posted_on)),
        _real("rdone", 1000004, _round(1, "posted", posted=900.0, posted_on=posted_on, accepted=True)),
    ]


def _flagged() -> list[GridRowOut]:
    """The linear rows plus a row per flag, and a cancelled one with nothing to reverse (on no segment, no chip)."""
    posted_on = date(2031, 4, 10)
    return [
        *_linear(),
        # Waiting on the family, and Not reconciled on top
        _real(
            "rwunr",
            1000005,
            _round(1, "posted", posted=800.0, posted_on=posted_on),
            confirmation=_confirmation("short", -100.0),
        ),
        # Latest round held: the bar's On hold (and the Holds view lists it)
        _real("rhold", 1000006, _round(1, "held"), holds=[_hold("household_income_conflict")]),
        # Accepted, with a hold issue on top: the Holds view lists it, the bar counts it Accepted
        _real(
            "racch",
            1000007,
            _round(1, "posted", posted=700.0, posted_on=posted_on, accepted=True),
            holds=[_hold("payer_shares_incomplete")],
        ),
        _real("rdupe", 1000008, _round(1, "not_decided"), request_status="duplicate_pending"),
        _real("rsess", 1000009, _round(1, "not_decided"), request_status="unmatched_session"),
        _real(
            "rrev",
            1000010,
            _round(1, "posted", posted=600.0, posted_on=posted_on, accepted=True),
            cancellation=_CANCELLED,
            to_reverse=True,
        ),
        _real("rgone", 1000011, _round(1, "not_decided"), cancellation=_CANCELLED),
    ]


def _bar(stages: Any) -> dict[str, int]:
    return {key: getattr(stages, key) for key in BAR_SEGMENTS}


def _members(rows: list[GridRowOut], queue: str) -> int:
    """What the strip counts for a stage: the rows whose `queues` name it (requests/views.ts filterRows, no filter)."""
    return sum(1 for r in rows if r.queues and queue in r.queues)


def test_the_bar_counts_each_live_request_once_by_its_stage_and_sums_to_the_live_season() -> None:
    """Ruling 17: Needs an offer · Pending approval · Waiting on the family · On hold · Accepted, by the row's own
    Stage (row_stage, the latest round). A cancelled request is not live and is on no segment."""
    rows = _flagged()
    stages = build_today(_inputs(rows), casework=True, finance=False).stages
    assert stages is not None
    assert _bar(stages) == {
        "needs_offer": 3,  # and the duplicate and unclear-session requests' undecided rounds (not_decided)
        "pending_approval": 1,
        "waiting_on_family": 2,
        "on_hold": 1,
        "accepted": 2,
    }
    assert sum(_bar(stages).values()) == stages.live == 9
    assert stages.offered == stages.pending_approval + stages.waiting_on_family + stages.accepted
    assert stages.families == 9


def test_each_segment_counts_its_own_stage_codes_with_distinct_counts() -> None:
    """Ruling 17, pinned segment by segment (a swap between segments fails): not_decided reads Needs an offer, held
    reads On hold, and a refused Round 3 appeal reads Accepted, because the family keeps the grant it accepted."""
    posted_on = date(2031, 4, 10)
    rows: list[GridRowOut] = [
        _real("p1", 1000001, _round(1, "pending_approval", pending_approval=300.0)),  # Pending approval: 1
        _real("w1", 1000002, _round(1, "posted", posted=800.0, posted_on=posted_on)),  # Waiting: 2
        _real("w2", 1000003, _round(1, "posted", posted=800.0, posted_on=posted_on)),
        _real("n1", 1000004, _round(1, "needs_offer", decided=500.0, asked_on=posted_on)),  # Needs an offer: 3
        _real("n2", 1000005, _round(1, "not_decided")),
        _real("n3", 1000006, _round(1, "not_decided")),
    ]
    rows += [_real(f"h{i}", 1000010 + i, _round(1, "held")) for i in range(4)]  # On hold: 4
    accepted = [
        _real(f"a{i}", 1000020 + i, _round(1, "posted", posted=700.0, posted_on=posted_on, accepted=True))
        for i in range(3)
    ]
    refused = [  # Round 1 accepted, Round 3 appeal refused by finance: the latest round reads refused
        _real(
            f"r{i}",
            1000030 + i,
            _round(1, "posted", posted=700.0, posted_on=posted_on, accepted=True),
            _round(3, "refused"),
        )
        for i in range(2)
    ]
    assert {r.stage.code for r in refused if r.stage} == {"refused"}
    rows += accepted + refused  # Accepted: 5
    stages = build_today(_inputs(rows), casework=True, finance=False).stages
    assert stages is not None
    assert _bar(stages) == {
        "needs_offer": 3,
        "pending_approval": 1,
        "waiting_on_family": 2,
        "on_hold": 4,
        "accepted": 5,
    }
    assert stages.live == 15
    assert stages.offered == 1 + 2 + 5


def test_d21_each_linear_segment_counts_what_its_strip_stage_lists() -> None:
    """Spec §12, D21, on the linear fixture: each segment that opens a strip stage counts that stage's list."""
    rows = _linear()
    stages = build_today(_inputs(rows), casework=True, finance=False).stages
    assert stages is not None
    for stage in BAR_STAGES:
        assert getattr(stages, stage) == _members(rows, stage), stage


def test_waiting_and_not_reconciled_counts_once_on_the_bar_and_once_in_the_chip() -> None:
    row = _real(
        "rwunr",
        1000005,
        _round(1, "posted", posted=800.0, posted_on=date(2031, 4, 10)),
        confirmation=_confirmation("short", -100.0),
    )
    assert row.queues is not None
    assert {"waiting_on_family", "not_reconciled"} <= set(row.queues)
    stages = build_today(_inputs([row]), casework=True, finance=False).stages
    assert stages is not None
    assert sum(_bar(stages).values()) == 1
    assert stages.waiting_on_family == 1
    assert stages.flags.not_reconciled == 1


def test_the_flags_are_only_the_four_chips_and_holds_is_not_one() -> None:
    assert FLAG_STAGES == ("not_reconciled", "duplicates", "session_not_settled", "to_reverse")
    assert set(TodayFlagsOut.model_fields) == set(FLAG_STAGES)


def test_each_chip_counts_its_queue_membership_exactly() -> None:
    """The flags are the strip's own counts: every row whose queues name it, whatever its stage, cancelled included."""
    rows = _flagged()
    stages = build_today(_inputs(rows), casework=True, finance=False).stages
    assert stages is not None
    assert stages.flags.model_dump() == {flag: _members(rows, flag) for flag in FLAG_STAGES}
    assert stages.flags.model_dump() == {
        "not_reconciled": 1,
        "duplicates": 1,
        "session_not_settled": 1,
        "to_reverse": 1,
    }


def test_the_bar_and_the_chips_together_are_the_strips_stages() -> None:
    # Holds is a strip stage that is neither a flag chip nor a queue-backed bar stage: On hold reads the Stage column.
    assert set(BAR_STAGES) | set(FLAG_STAGES) | {"holds"} == set(MIRRORS["strip_stages"])
    assert list(FLAG_STAGES) == [s for s in MIRRORS["strip_stages"] if s in FLAG_STAGES]
    assert BAR_STAGES == ("needs_offer", "pending_approval", "waiting_on_family")


def test_stages_are_sent_to_finance_and_registrar_alike() -> None:
    assert build_today(_inputs([]), casework=False, finance=True).stages is not None
    assert build_today(_inputs([]), casework=True, finance=False).stages is not None


def _named_grantor(key: str, name: str, *, contacts: str = "", eligibility: str = "", retired: str = "") -> GrantorOut:
    return _grantor(key, full=False).model_copy(
        update={"name": name, "contacts": contacts, "eligibility": eligibility, "retired_at": retired}
    )


def test_development_lines_are_funder_upkeep_in_the_fixed_order() -> None:
    lines = build_today(_inputs([]), casework=False, finance=False, development=True).development
    assert [line.key for line in lines or []] == list(DEVELOPMENT_LINES)


def test_funders_missing_a_contact_or_eligibility_are_named_and_retired_ones_are_not() -> None:
    grantors = [
        _named_grantor("riverbend", "Riverbend Community Foundation", contacts="", eligibility="need-based"),
        _named_grantor("northfield", "Northfield Family Foundation", contacts="grants@example.com", eligibility=""),
        _named_grantor("oldfund", "Old Fund", retired="2030-01-01"),
    ]
    dev = build_today(_inputs([], grantors=grantors), casework=False, finance=False, development=True).development
    assert (_line(dev, "no_contact").items, _line(dev, "no_contact").names) == (1, ["Riverbend Community Foundation"])
    assert (_line(dev, "no_eligibility").items, _line(dev, "no_eligibility").names) == (
        1,
        ["Northfield Family Foundation"],
    )
    assert _line(dev, "no_contact").item_kind == "funders"


def test_descriptions_needing_a_group_or_a_funder_are_named() -> None:
    grants = _grants(
        unmapped=[
            UnmappedDescriptionOut(
                source_id="src1",
                description_key="Outside award spring",
                description="Outside award spring",
                lines=2,
                amount=900.0,
            )
        ]
    )
    dev = build_today(
        _inputs([], grants=grants, needs_group=["Scholarship other"]), casework=False, finance=False, development=True
    ).development
    assert _line(dev, "needs_group").names == ["Scholarship other"]
    assert _line(dev, "no_grantor").names == ["Outside award spring"]


def test_the_development_section_carries_no_family_data() -> None:
    """Spec 2026-10-10 section 9.4, review focus 4: serialise the whole response and look for household data."""
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "needs_offer", decided=1500.0, asked_on=TODAY),
            family_name="Johnson",
            camper_name="Emma Johnson",
        )
    ]
    today = build_today(
        _inputs(rows, grantors=[_named_grantor("g", "Riverbend")]), casework=False, finance=False, development=True
    )
    body = today.model_dump_json()
    for leak in ("1000001", "Johnson", "Emma", "reqemma", "household_cm_id"):
        assert leak not in body, leak
    assert (today.stages, today.casework, today.finance) == (None, None, None)


# --- Committed by week: the series counts what the budget's Posted counts -----------------------------------


def _posted(n: int, amount: float, day: date, **over: Any) -> RoundOut:
    return _round(n, "posted", posted=amount, posted_on=day, accepted=True, **over)


def _series(rows: list[GridRowOut]) -> dict[date, float]:
    today = build_today(_inputs(rows), casework=False, finance=True)
    assert today.posted_by_week is not None
    return {p.week_of: p.posted for p in today.posted_by_week}


def test_a_clawed_back_posted_round_is_not_in_committed_by_week() -> None:
    rows = [
        _row("a", 1, _posted(1, 1000.0, date(2031, 4, 1))),
        _row("b", 2, _posted(1, 700.0, date(2031, 4, 2), clawed_back=True)),
    ]
    assert list(_series(rows).values())[-1] == 1000.0


def test_money_below_the_line_is_not_in_committed_by_week() -> None:
    rows = [_row("a", 1, _posted(1, 1000.0, date(2031, 4, 1), outside_budget=400.0, outside_label="Fund"))]
    assert list(_series(rows).values())[-1] == 600.0


def test_committed_by_week_is_cumulative_and_fills_the_empty_weeks() -> None:
    rows = [
        _row("a", 1, _posted(1, 1000.0, date(2031, 3, 25))),  # week of Mar 24
        _row("b", 2, _posted(1, 500.0, date(2031, 4, 9))),  # week of Apr 7; Mar 31 has no post
    ]
    assert _series(rows) == {
        date(2031, 3, 24): 1000.0,
        date(2031, 3, 31): 1000.0,
        date(2031, 4, 7): 1500.0,
        date(2031, 4, 14): 1500.0,  # TODAY's week
    }


def test_committed_by_week_runs_to_the_current_week() -> None:
    rows = [_row("a", 1, _posted(1, 1000.0, date(2031, 3, 25)))]
    assert max(_series(rows)) == week_start(TODAY)


def test_committed_by_week_is_empty_without_a_post_and_none_without_finance() -> None:
    rows = [_row("a", 1, _round(1, "needs_offer", decided=500.0))]
    assert build_today(_inputs(rows), casework=True, finance=True).posted_by_week == []
    assert build_today(_inputs(rows), casework=True, finance=False).posted_by_week is None


def test_the_last_point_equals_what_the_budget_counts_as_posted() -> None:
    posted_rounds = [
        (_posted(1, 1000.0, date(2031, 3, 25)), False),
        (_posted(1, 800.0, date(2031, 4, 2), outside_budget=300.0, outside_label="Fund"), True),
        (_posted(1, 700.0, date(2031, 4, 3), clawed_back=True), False),
        (_posted(2, 250.0, date(2031, 4, 10)), False),
    ]
    rows = [_row(f"r{i}", i + 1, rnd) for i, (rnd, _) in enumerate(posted_rounds)]
    # The budget's own split, on the same rounds: a clawed-back round counts nowhere; the rest keep only the camp's
    # part (counted_part), with the below-the-line money taken out.
    counted = Decimal(0)
    for rnd, split in posted_rounds:
        if rnd.clawed_back:
            continue
        view = RoundView(
            round=rnd.round,
            status="posted",
            ask=None,
            decided=None,
            locked=Decimal(str(rnd.posted)),
            accepted=True,
            pending=None,
            counts_toward_budget=not split,
            pool="camp",
            extra=Decimal(str(rnd.outside_budget or 0)),
            extra_outside=split,
        )
        counted += counted_part(view, Decimal(str(rnd.posted)))[0]
    assert list(_series(rows).values())[-1] == float(counted) == 1750.0


# --- Final review: Next up's clock, the round it names, and the undated ------------------------------------


def test_an_undated_waiting_household_has_no_days_and_comes_after_the_dated_ones() -> None:
    """A C1 round (cm_pending) waits on the family with no posted_on: its wait is unknown, never its first ask's age."""
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "needs_offer", decided=900.0, asked_on=date(2031, 3, 1), cm_pending=True),
            family_name="Johnson",
        ),
        _row(
            "reqliam00000001",
            1000002,
            _round(1, "posted", posted=800.0, posted_on=date(2031, 4, 10)),
            family_name="Garcia",
        ),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "waiting_on_family")
    assert [(n.label, n.days) for n in line.next_up] == [("Garcia", 10), ("Johnson", None)]


def test_an_unkeyed_pending_round_has_no_days_and_comes_after_the_keyed_ones() -> None:
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "pending_approval", pending_approval=300.0, asked_on=date(2031, 3, 1)),
            family_name="Johnson",
        ),
        _row("reqliam00000001", 1000002, _round(1, "pending_approval", pending_approval=400.0), family_name="Garcia"),
    ]
    inputs = _inputs(rows, pending_since={("reqliam00000001", 1): date(2031, 4, 18)})
    line = _line(build_today(inputs, casework=False, finance=True).finance, "pending_approval")
    assert [(n.label, n.days) for n in line.next_up] == [("Garcia", 2), ("Johnson", None)]


def test_each_next_up_names_the_round_that_set_its_clock() -> None:
    """Waiting names the waiting posted round, Pending the pending round, Needs an offer the offer round; a line with
    no clock names the newest round."""
    johnson = _row(
        "reqemma00000001",
        1000001,
        _round(1, "posted", ask=1000.0, posted=900.0, posted_on=date(2031, 4, 10)),
        _round(2, "needs_offer", ask=500.0, decided=400.0, asked_on=date(2031, 4, 12)),
        family_name="Johnson",
    )
    garcia = _row(
        "reqliam00000001",
        1000002,
        _round(1, "pending_approval", ask=300.0, pending_approval=250.0),
        _round(2, "needs_offer", ask=200.0, decided=150.0, asked_on=date(2031, 4, 13)),
        family_name="Garcia",
    )
    chen = _row(
        "reqoliv00000001",
        1000003,
        _round(1, "needs_offer", ask=700.0, decided=650.0, asked_on=date(2031, 4, 1)),
        _round(2, "held", ask=350.0),
        holds=[_hold("household_income_conflict")],
        family_name="Chen",
    )
    inputs = _inputs([johnson, garcia, chen], pending_since={("reqliam00000001", 1): date(2031, 4, 18)})
    today = build_today(inputs, casework=True, finance=True)

    def named(lines: list[Any] | None, key: str, household: int) -> tuple[int | None, float | None]:
        chip = next(n for n in _line(lines, key).next_up if n.household_cm_id == household)
        return chip.round, chip.ask

    assert named(today.casework, "waiting_on_family", 1000001) == (1, 1000.0)
    assert named(today.casework, "needs_offer", 1000001) == (2, 500.0)
    assert named(today.finance, "pending_approval", 1000002) == (1, 300.0)
    assert named(today.casework, "holds", 1000003) == (2, 350.0)


# --- Final review: This week's Posted in CM counts what the budget counts -----------------------------------


def test_posted_this_week_counts_the_budgets_posted_by_posted_on() -> None:
    """TODAY is Sunday 2031-04-20: this week is Apr 14-20, last week Apr 7-13. A clawed-back round counts nowhere and
    money below the line is left out, as the budget's Posted does."""
    rows = [
        _row("a", 1, _posted(1, 1000.0, date(2031, 4, 15))),
        _row("b", 2, _posted(1, 800.0, date(2031, 4, 16), outside_budget=300.0, outside_label="Fund")),
        _row("c", 3, _posted(1, 700.0, date(2031, 4, 17), clawed_back=True)),
        _row("d", 4, _posted(1, 600.0, date(2031, 4, 8))),
        _row("e", 5, _posted(1, 400.0, date(2031, 4, 1))),
    ]
    figure = build_today(_inputs(rows), casework=False, finance=True).posted_this_week
    assert figure is not None
    assert (figure.key, figure.label, figure.unit) == ("posted_cm", "Posted in CM", "dollars")
    assert (figure.value, figure.previous) == (1500.0, 600.0)


def test_posted_this_week_is_finance_only() -> None:
    rows = [_row("a", 1, _posted(1, 1000.0, date(2031, 4, 15)))]
    assert build_today(_inputs(rows), casework=True, finance=False).posted_this_week is None


# --- Final review: the view-only hero, and a development read that prices nothing ------------------------------


def test_a_view_only_caller_gets_the_registrar_hero() -> None:
    """Spec §2, §9.3: view only sees the registrar hero, read only."""
    out = build_today(_inputs([]), casework=False, finance=False, view=True)
    assert out.stages is not None
    assert (out.casework, out.finance, out.development) == (None, None, None)


def test_a_development_only_caller_gets_no_hero_stages() -> None:
    assert build_today(_inputs([]), casework=False, finance=False, development=True).stages is None


class _NoSeasonStore:
    """A store whose every read fails: a development-only Today must never price the season."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"a development-only read called the store's {name}")


@pytest.mark.asyncio
async def test_a_development_only_read_never_prices_the_season() -> None:
    service = TodayService(
        store=_NoSeasonStore(),
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(needs_group=["Scholarship other"]),
        clock=lambda: T0,
    )
    out = await service.read(YEAR, casework=False, finance=False, development=True)
    # Audit D8: named as CampMinder writes the description (the fake's "(as written)"), not by its key.
    assert _line(out.development, "needs_group").names == ["Scholarship Other (as written)"]
    assert (out.stages, out.casework, out.finance) == (None, None, None)


@pytest.mark.asyncio
async def test_a_view_only_read_prices_the_season_for_its_hero() -> None:
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    out = await _service(store, _Grants(_grants(year=YEAR)), _Drafts(None), _Ledger()).read(
        YEAR, casework=False, finance=False, view=True
    )
    assert out.stages is not None
    assert out.stages.families == 1
    assert (out.casework, out.finance, out.development) == (None, None, None)


# --- Final review: an undated post still counts, so the last point is the budget's Posted ---------------------


def test_an_undated_post_counts_in_the_current_week() -> None:
    rows = [
        _row("a", 1, _posted(1, 1000.0, date(2031, 3, 25))),
        _row("b", 2, _round(1, "posted", posted=500.0, posted_on=None, accepted=True)),
    ]
    series = _series(rows)
    assert series[week_start(TODAY)] == 1500.0
    assert series[date(2031, 3, 24)] == 1000.0


@pytest.mark.asyncio
async def test_the_last_point_is_the_budget_reads_own_posted() -> None:
    """The budget read (FinancialAidDecisionsService.budget, budget.py's season_budget) and Today's series, on one
    season: a dated post and an undated one."""
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    seed_request(store, "reqliam00000001", household=1000002, person=1000021)
    for request_id, effective_on in (("reqemma00000001", date(2027, 3, 2)), ("reqliam00000001", None)):
        store.events.append(
            DecisionEvent(
                id=f"ev{len(store.events):013d}",
                request_id=request_id,
                round=1,
                kind="post",
                amount=Decimal(1500),
                created=T0,
                effective_on=effective_on,
                lock_source="tick",
                rules_version=1,
                snapshot={"pool": "camp_pool", "counts_toward_budget": True},
            )
        )
    grants = _Grants(_grants(year=YEAR))
    today = await _service(store, grants, _Drafts(None), _Ledger()).read(YEAR, casework=False, finance=True)

    async def no_register(year: int) -> list[RegisterRow]:
        return []

    budget = await FinancialAidDecisionsService(store, FakeRules(approved()), no_register, clock=lambda: T0).budget(
        YEAR
    )
    assert today.posted_by_week
    assert today.posted_by_week[-1].posted == budget.total.total.posted == 3000.0


# --- Final review: each line's overdue threshold comes from the server -----------------------------------------


def test_the_three_clocked_lines_carry_their_overdue_threshold() -> None:
    today = build_today(_inputs([]), casework=True, finance=True)
    lines = [*(today.casework or []), *(today.finance or [])]
    assert {line.key: line.overdue_after_days for line in lines if line.overdue_after_days is not None} == dict(
        TODAY_OVERDUE_DAYS
    )


def test_posted_this_week_counts_an_undated_post_in_the_current_week() -> None:
    """Controller ruling: as Committed by week does, so the two never disagree about this week."""
    rows = [
        _row("a", 1, _posted(1, 1000.0, date(2031, 4, 15))),
        _row("b", 2, _round(1, "posted", posted=500.0, posted_on=None, accepted=True)),
        _row("c", 3, _posted(1, 200.0, date(2031, 4, 1))),
    ]
    today = build_today(_inputs(rows), casework=False, finance=True)
    assert today.posted_this_week is not None
    assert today.posted_by_week is not None
    assert today.posted_this_week.value == 1500.0
    current, previous = today.posted_by_week[-1].posted, today.posted_by_week[-2].posted
    assert today.posted_this_week.value == current - previous


# --- Visual fix wave (2026-10-11): names, clocks and the development chips ------------------------------------------


class _Labels:
    """The household page's label helper as the routes pass it: (year, households) -> each household's label."""

    def __init__(self, labels: dict[int, tuple[str, str]]) -> None:
        self.labels = labels
        self.asked: list[frozenset[int]] = []

    async def __call__(self, year: int, households: Any) -> dict[int, Any]:
        from api.services.financial_aid_household_page import HouseholdLabel

        self.asked.append(frozenset(households))
        return {h: HouseholdLabel(*self.labels[h]) for h in households if h in self.labels}


class _NoLabels:
    async def __call__(self, year: int, households: Any) -> dict[int, Any]:
        raise AssertionError("a development-only read asked for household labels")


def _labelled_service(store: FakeDecisionsStore, labels: Any) -> TodayService:
    return TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        labels=labels,
        clock=lambda: T0,
    )


@pytest.mark.asyncio
async def test_next_up_names_a_camper_request_by_its_camper_and_a_household_request_by_its_label() -> None:
    """Owner ruling 18 (audit N1): Today names a household exactly as the Requests grid does: the camper's full name
    for a camper request, the adults' label (household_labels, with its tie-break) only for a household-level (Family
    Camp) request. The label is read once, scoped to the household-level chips the response names."""
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    seed_request(store, "reqfc0000000001", household=1000002, person=0)
    labels = _Labels({1000001: ("Pat Johnson & Alex Garcia", ""), 1000002: ("Liam & Olivia Becker", "Oakland")})
    out = await _labelled_service(store, labels).read(YEAR, casework=True, finance=True)
    chips = {n.household_cm_id: (n.label, n.tiebreak) for n in _line(out.casework, "needs_offer").next_up}
    assert chips == {1000001: ("Camper 1000011", ""), 1000002: ("Liam & Olivia Becker", "Oakland")}
    assert labels.asked == [frozenset({1000002})]


@pytest.mark.asyncio
async def test_next_up_names_the_camper_so_the_drawer_can_say_who_is_asked_for() -> None:
    """Audit R3: the drawer needs the camper's name, so the season is read with names; with no labeler a camper
    chip still reads its camper (ruling 18), never "Household 1000001"."""
    store = FakeDecisionsStore()
    seed_request(store, "reqemma00000001")
    out = await _labelled_service(store, None).read(YEAR, casework=True, finance=False)
    chip = _line(out.casework, "needs_offer").next_up[0]
    assert chip.camper_name == "Camper 1000011"
    assert chip.label == "Camper 1000011"


@pytest.mark.asyncio
async def test_a_development_only_read_never_names_a_household() -> None:
    """Spec §9.4: development never receives family data, so it never asks for a household label either. The
    grants carry households that need a camper and waiting commitments (audit N11), so a leak through Grants
    needing attention's next-up would fail here."""
    needs = NeedsCamperOut(
        grant=_grant(person_cm_id=0, camper_name="", household_cm_id=1000003, family_name="Thornbury"),
        household_applied=True,
        suggestion=None,
        candidates=[],
    )
    waiting = WaitingCommitmentOut(
        grant=_grant(
            kind="commitment",
            transaction_cm_id=0,
            commitment_id="com000000000001",
            household_cm_id=1000002,
            family_name="Quillfeather",
            camper_name="Ivy Quillfeather",
        ),
        days_waiting=30,
        reason="not_posted",
        transaction_cm_id=0,
    )
    service = TodayService(
        store=_NoSeasonStore(),
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR, needs_camper=[needs], waiting=[waiting])),
        ledger=_Ledger(),
        labels=_NoLabels(),
        clock=lambda: T0,
    )
    body = (await service.read(YEAR, casework=False, finance=False, development=True)).model_dump_json()
    for leak in ("household", "Thornbury", "Quillfeather", "1000003", "1000002"):
        assert leak not in body


def test_grants_needing_attention_name_their_households_oldest_first() -> None:
    """Audit R12 (spec §9.2 lists Grants for next_up): needs-a-camper grants by days since recorded, waiting
    commitments by their own days waiting."""
    needs = NeedsCamperOut(
        grant=_grant(
            person_cm_id=0, camper_name="", household_cm_id=1000003, family_name="Chen", recorded_on="2031-04-17"
        ),
        household_applied=True,
        suggestion=None,
        candidates=[],
    )
    waiting = WaitingCommitmentOut(
        grant=_grant(
            kind="commitment",
            transaction_cm_id=0,
            commitment_id="com000000000001",
            household_cm_id=1000002,
            family_name="Garcia",
        ),
        days_waiting=30,
        reason="not_posted",
        transaction_cm_id=0,
    )
    grants = _grants(needs_camper=[needs], waiting=[waiting])
    line = _line(build_today(_inputs([], grants=grants), casework=True, finance=False).casework, "grants")
    # Ruling 18: the waiting commitment sits on a camper, so it reads the camper; the grant that needs one, the family.
    assert [(n.household_cm_id, n.label, n.days) for n in line.next_up] == [
        (1000002, "Emma Johnson", 30),
        (1000003, "Chen", 3),
    ]


def test_not_reconciled_households_carry_days_since_posting() -> None:
    """Audit R11 / ruling V12: Not reconciled's chips read "{name} {d}d", days since the round was posted; a row
    with no posted round (CampMinder money with no Posted tick) has no clock and comes after."""
    posted = _round(1, "posted", posted=1500.0, accepted=True, posted_on=date(2031, 4, 14))
    older = _round(1, "posted", posted=900.0, accepted=True, posted_on=date(2031, 4, 2))
    rows = [
        _row("reqemma00000001", 1000001, posted, confirmation=_confirmation("short", -210.0), family_name="Johnson"),
        _row("reqliam00000001", 1000002, older, confirmation=_confirmation("over", 300.0), family_name="Garcia"),
    ]
    line = _line(build_today(_inputs(rows), casework=True, finance=False).casework, "not_reconciled")
    assert [(n.label, n.days) for n in line.next_up] == [("Garcia", 18), ("Johnson", 6)]


def test_a_manual_hold_carries_days_since_it_was_placed_and_a_check_hold_has_none() -> None:
    """Ruling V12: a hold staff placed by hand has a date (when it was placed); a check the calculator raises has no
    date of its own, so its chip shows no day count."""
    rows = [
        _row(
            "reqemma00000001",
            1000001,
            _round(1, "held", asked_on=date(2031, 4, 1)),
            holds=[_hold("manual_hold")],
            family_name="Johnson",
        ),
        _row(
            "reqliam00000001",
            1000002,
            _round(1, "held", asked_on=date(2031, 3, 1)),
            holds=[_hold("household_income_conflict")],
            family_name="Garcia",
        ),
    ]
    inputs = _inputs(rows, hold_since={"reqemma00000001": date(2031, 4, 14)})
    line = _line(build_today(inputs, casework=True, finance=False).casework, "holds")
    assert [(n.label, n.days) for n in line.next_up] == [("Johnson", 6), ("Garcia", None)]


def test_development_descriptions_are_named_as_campminder_writes_them() -> None:
    """Audit D8: a description chip reads the description as CampMinder writes it, never its lowercase key."""
    grants = _grants(
        unmapped=[
            UnmappedDescriptionOut(
                source_id="src1",
                description_key="outside award spring",
                description="Outside Award – Spring",
                lines=2,
                amount=900.0,
            )
        ]
    )
    inputs = _inputs(
        [], grants=grants, needs_group=["scholarship other"], descriptions={"scholarship other": "Scholarship (other)"}
    )
    dev = build_today(inputs, casework=False, finance=False, development=True).development
    assert _line(dev, "needs_group").names == ["Scholarship (other)"]
    assert _line(dev, "no_grantor").names == ["Outside Award – Spring"]


@pytest.mark.asyncio
async def test_today_reads_the_descriptions_campminder_names_for_development() -> None:
    ledger = _Ledger(needs_group=["scholarship other"])
    service = TodayService(
        store=_NoSeasonStore(),
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=ledger,
        clock=lambda: T0,
    )
    out = await service.read(YEAR, casework=False, finance=False, development=True)
    assert _line(out.development, "needs_group").names == ["Scholarship Other (as written)"]


def test_development_chips_open_their_own_funders_row() -> None:
    """Audit X5 (spec §5.5: "Money › Funders filtered to that funder"): each name carries where it opens, a funder by
    its key and a description by its record, in the names' order."""
    grantors = [
        _named_grantor("riverbend", "Riverbend Community Foundation"),
        _named_grantor("alder", "Alder Trust"),
    ]
    grants = _grants(
        unmapped=[
            UnmappedDescriptionOut(
                source_id="src1", description_key="outside award", description="Outside Award", lines=1, amount=10.0
            )
        ]
    )
    inputs = _inputs(
        [],
        grantors=grantors,
        grants=grants,
        needs_group=["scholarship other"],
        descriptions={"scholarship other": "Scholarship (other)"},
        source_ids={"scholarship other": "src2"},
    )
    dev = build_today(inputs, casework=False, finance=False, development=True).development
    contact = _line(dev, "no_contact")
    assert list(zip(contact.names, contact.links, strict=True)) == [
        ("Alder Trust", "funder:alder"),
        ("Riverbend Community Foundation", "funder:riverbend"),
    ]
    assert _line(dev, "no_grantor").links == ["row:src1"]
    assert _line(dev, "needs_group").links == ["row:src2"]
