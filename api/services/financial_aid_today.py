"""Today (clean spec §6.4; D24: one dense line per queue; D21: counts come from the same server query
as the lists). The casework lines count the queue memberships the Requests grid carries on each row
(financial_aid_queues), so "Open ›" shows exactly the rows counted. The grants lines read the grants
register's needs-attention groups; the finance lines read the same rows plus the rules draft and the
season's descriptions. Counts of work carry no basis word and no definition (D20).

To place (SP11): Money › To place's open lines, counted by To place's own code over the season Today priced.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Final, Protocol

from api.schemas.financial_aid import UnclassifiedSource
from api.schemas.financial_aid_decisions import GridRowOut, QueueOut, RoundOut
from api.schemas.financial_aid_grants import GrantorOut, GrantorsResponse, GrantRowOut, GrantsResponse
from api.schemas.financial_aid_surfaces import (
    TodayFlagsOut,
    TodayItemKind,
    TodayKey,
    TodayLineOut,
    TodayNextUpOut,
    TodayReasonOut,
    TodayResponse,
    TodayStagesOut,
    WeekFigureOut,
    WeekPointOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import (
    DecisionsStore,
    FinancialAidDecisionsService,
    Names,
    PricingRules,
    Season,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import GrantsLoader, OneGrantsLoad
from api.services.financial_aid_household_page import HouseholdLabeler
from api.services.financial_aid_intake_service import never_true_labels
from api.services.financial_aid_intake_types import FLAG_AWAITING_RULES, FaRow
from api.services.financial_aid_ledger_service import NamedSource, money
from api.services.financial_aid_queues import UNRECONCILED, UNTICKED_LABELS, offer_rounds
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from api.services.financial_aid_to_place_service import NO_OPEN_LINES, OpenToPlace, ToPlaceCounts, open_to_place
from bunking.financial_aid.decisions.pricing import NO_APPROVED_RULES
from bunking.financial_aid.decisions.rounds import DecisionEvent
from bunking.financial_aid.rules.schema import AidRules

CASEWORK_LINES: Final[tuple[TodayKey, ...]] = (
    "needs_offer",
    "holds",
    "waiting_on_family",
    "not_reconciled",
    "to_reverse",
    "session_not_settled",
    "duplicates",
    "to_place",
    "grants",
    "late_full_coverage",
)
FINANCE_LINES: Final[tuple[TodayKey, ...]] = (
    "pending_approval",
    "rules_sections",
    "sources",
    "intake",
    "equity_field_never_true",
)
DEVELOPMENT_LINES: Final[tuple[TodayKey, ...]] = ("no_contact", "no_eligibility", "needs_group", "no_grantor")
WAITING_TOO_LONG_DAYS: Final = 14  # §6.4: "how many over 14 days"
# Spec 2026-10-10 §5.2 (owner ruling 11, "fixed val"): a line past its threshold jumps to the top of Today. Code, not
# settings: a change is a small PR.
TODAY_OVERDUE_DAYS: Final[Mapping[TodayKey, int]] = {
    "needs_offer": 10,
    "waiting_on_family": WAITING_TOO_LONG_DAYS,
    "pending_approval": 3,
}
NEXT_UP_CAP: Final = 8  # enough households to fill a wide Next up cell; the client shows only whole chips (§5.5)


@dataclass(frozen=True)
class TodayInputs:
    year: int
    rows: Sequence[GridRowOut]
    grants: GrantsResponse
    register: Sequence[RegisterRow]  # the rows the season was priced with (OneGrantsLoad): each grant's recorded_at
    grantors: Sequence[GrantorOut]
    draft_sections: Sequence[str] | None  # the rules draft's sections not yet approved; None: no rules yet
    unclassified: Sequence[UnclassifiedSource]
    today: date
    never_true: Sequence[str] = ()  # weighted yes/no fields no applicant answered yes (finance only)
    never_true_labels: Mapping[str, str] = field(default_factory=dict)  # each such field's equity criterion label
    to_place: OpenToPlace | None = None  # casework: Money › To place's open lines; None: not read
    needs_group: Sequence[str] = ()  # finance: descriptions with a live line this season that need a group (D100)
    pending_since: Mapping[tuple[str, int], date] = field(
        default_factory=dict
    )  # finance: (request, round) -> the day its award was keyed for approval
    # Holds' clock (ruling V12, 2026-10-11): request -> the day staff placed its manual hold. A check the calculator
    # raises has no date of its own, so its household has no day count.
    hold_since: Mapping[str, date] = field(default_factory=dict)
    # Development's chips (audit D8): each description key -> the description as CampMinder writes it.
    descriptions: Mapping[str, str] = field(default_factory=dict)
    source_ids: Mapping[str, str] = field(default_factory=dict)  # each description key -> its aid_sources record id


def _families(rows: Iterable[GridRowOut]) -> int:
    return len({row.household_cm_id for row in rows})


def _reasons(pairs: Iterable[tuple[str, int]], labels: Mapping[str, str] | None = None) -> list[TodayReasonOut]:
    """(code, household) pairs, one per item, into reasons: largest first, then by code.
    `labels` names a code where it has a label (the never-true line, and Not reconciled's direction (b) reasons,
    D162); the rest stay None."""
    items: dict[str, int] = defaultdict(int)
    households: dict[str, set[int]] = defaultdict(set)
    for code, household in pairs:
        items[code] += 1
        households[code].add(household)
    return [
        TodayReasonOut(
            code=code,
            families=len(households[code]) if households[code] - {0} else None,
            items=n,
            label=(labels or {}).get(code),
        )
        for code, n in sorted(items.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _line(
    key: TodayKey,
    rows: Sequence[GridRowOut],
    *,
    reasons: list[TodayReasonOut] | None = None,
    amount: float | None = None,
    oldest_days: int | None = None,
    over_14_days: int | None = None,
    largest_gap: float | None = None,
    listed: bool = False,
    overdue: bool = False,
    next_up: list[TodayNextUpOut] | None = None,
) -> TodayLineOut:
    """A line counting grid rows: families and requests. `listed` lines that are no Requests view name their
    request ids, so Open › shows exactly what was counted (D21; plan review I4)."""
    return TodayLineOut(
        key=key,
        families=_families(rows),
        items=len(rows),
        item_kind="requests",
        reasons=reasons or [],
        amount=amount,
        oldest_days=oldest_days,
        over_14_days=over_14_days,
        largest_gap=largest_gap,
        request_ids=[row.request_id for row in rows] if listed else [],
        overdue=overdue,
        overdue_after_days=TODAY_OVERDUE_DAYS.get(key),
        next_up=next_up or [],
    )


def _in(rows: Sequence[GridRowOut], queue: QueueOut) -> list[GridRowOut]:
    return [row for row in rows if row.queues and queue in row.queues]


Clock = Callable[[GridRowOut], tuple[date | None, RoundOut | None]]
"""A line's clock on one row: (when it started, the round that started it). The date is None when no round on the line
is dated (a C1 `cm_pending` round waiting on the family, a pending round with no keyed award); the round is still the
line's own when it has one."""


def _clocked(
    rounds: Iterable[RoundOut], when: Callable[[RoundOut], date | None]
) -> tuple[date | None, RoundOut | None]:
    """The round that sets a line's clock: its oldest dated round (ties by round), else its first undated one."""
    listed = list(rounds)
    dated = [(day, r) for r in listed if (day := when(r)) is not None]
    if dated:
        return min(dated, key=lambda pair: (pair[0], pair[1].round))
    return None, (listed[0] if listed else None)


def _waiting_clock(row: GridRowOut) -> tuple[date | None, RoundOut | None]:
    """Waiting on the family's clock: the oldest post among the rounds waiting (a C1 round waits too, undated)."""
    waiting = [r for r in row.rounds if (r.status == "posted" or r.cm_pending) and not r.accepted and not r.clawed_back]
    return _clocked(waiting, lambda r: r.posted_on if r.status == "posted" else None)


def _waiting_since(row: GridRowOut) -> date | None:
    return _waiting_clock(row)[0]


def _asked_clock(row: GridRowOut) -> tuple[date | None, RoundOut | None]:
    """Needs an offer's clock: the oldest ask among the rounds the queue holds."""
    return _clocked(offer_rounds(row), lambda r: r.asked_on)


def _asked_since(row: GridRowOut) -> date | None:
    return _asked_clock(row)[0]


def _pending_clock(row: GridRowOut, keyed: Mapping[tuple[str, int], date]) -> tuple[date | None, RoundOut | None]:
    """Pending approval's clock: when the oldest of the row's pending rounds was keyed for approval."""
    pending = [r for r in row.rounds if r.status == "pending_approval"]
    return _clocked(pending, lambda r: keyed.get((row.request_id, r.round)))


def _pending_since(row: GridRowOut, keyed: Mapping[tuple[str, int], date]) -> date | None:
    return _pending_clock(row, keyed)[0]


def _posted_clock(row: GridRowOut) -> tuple[date | None, RoundOut | None]:
    """Not reconciled's clock (ruling V12): the oldest post among its posted rounds. Money CampMinder holds with no
    Posted tick (D162) has no post, so such a row is undated."""
    posted = [r for r in row.rounds if r.status == "posted" and not r.clawed_back]
    return _clocked(posted, lambda r: r.posted_on)


def _hold_clock(since: Mapping[str, date]) -> Clock:
    """Holds' clock (ruling V12): the day staff placed the row's manual hold; a check hold is undated."""

    def clock(row: GridRowOut) -> tuple[date | None, RoundOut | None]:
        held = [r for r in row.rounds if r.status == "held"]
        return since.get(row.request_id), (held[-1] if held else None)

    return clock


def _first_ask(row: GridRowOut) -> date:
    """A line with no clock orders its households by the request's first ask (date.max when none is dated)."""
    return min((r.asked_on for r in row.rounds if r.asked_on is not None), default=date.max)


def _newest_round(row: GridRowOut) -> RoundOut | None:
    return max(row.rounds, key=lambda r: r.round) if row.rounds else None


def _grid_name(camper_name: str, household: str) -> str:
    """Owner ruling 18: a household is named as the Requests grid names it: the camper's full name for a camper
    request, the household's own label only for a household-level (Family Camp) request, which has no camper."""
    return camper_name or household


def _next_up(rows: Sequence[GridRowOut], today: date, clock: Clock | None) -> list[TodayNextUpOut]:
    """Each household once, at its oldest request, oldest first (ties by household id), capped. On a clocked line the
    dated households come first, by their clock, and the undated after them (by first ask) with `days` None; the
    round and ask named are the round that set the clock. With no clock the order is the first ask, `days` is None and
    the round is the newest."""
    best: dict[int, tuple[tuple[bool, date], date | None, RoundOut | None, GridRowOut]] = {}
    for row in rows:
        when, rnd = clock(row) if clock is not None else (None, None)
        order = (when is None, when or _first_ask(row))
        held = best.get(row.household_cm_id)
        if held is None or order < held[0]:
            best[row.household_cm_id] = (order, when, rnd or _newest_round(row), row)
    ordered = sorted(best.values(), key=lambda entry: (entry[0], entry[3].household_cm_id))[:NEXT_UP_CAP]
    out: list[TodayNextUpOut] = []
    for _, when, rnd, row in ordered:
        out.append(
            TodayNextUpOut(
                household_cm_id=row.household_cm_id,
                label=_grid_name(row.camper_name, row.household_label or row.family_name),
                tiebreak="" if row.camper_name else row.household_label_tiebreak,
                days=(today - when).days if when is not None else None,
                camper_name=row.camper_name,
                session_name=row.session_name,
                session_type=row.session_type,
                round=rnd.round if rnd is not None else None,
                ask=rnd.ask if rnd is not None else None,
            )
        )
    return out


def _overdue(key: TodayKey, oldest_days: int | None) -> bool:
    limit = TODAY_OVERDUE_DAYS.get(key)
    return limit is not None and oldest_days is not None and oldest_days > limit


def _unreconciled(row: GridRowOut) -> set[str]:
    """Why a row is Not reconciled: (a) the request's state, or, when it is confirmed, its shares' (D59); and (b) why
    CampMinder's money for a round has no Posted tick (D162)."""
    unticked: set[str] = {u.code for u in row.unticked or []}
    c = row.confirmation
    if c is None:
        return unticked
    if c.status in UNRECONCILED:
        return {c.status} | unticked
    return {s.status for s in c.shares if s.status in UNRECONCILED} | unticked


DISAGREEING: Final = frozenset({"short", "over", "not_in_campminder"})


def _disagreements(row: GridRowOut) -> list[float]:
    """The dollar size of each disagreement on the row: the request's, else its shares'. Short, over and
    not_in_campminder (a lock CampMinder holds $0 against: its gap is the locked amount) count; awaiting_sync
    is not a disagreement (owner ruling 2026-10-01)."""
    c = row.confirmation
    if c is None:
        return []
    if c.status in DISAGREEING:
        return [abs(c.gap)]
    return [
        money(abs(Decimal(str(s.in_campminder)) - Decimal(str(s.expected))))
        for s in c.shares
        if s.status in DISAGREEING
    ]


def _late_full_coverage(inputs: TodayInputs) -> list[GridRowOut]:
    """Main spec §10.3: a counted grant from a full-coverage grantor that became known (D116: the register row's
    recorded_at, a commitment's entry or the line's post, whichever came first) after a round of its request was
    posted, so the posted award was set without it (D43: never lowered; talk to the family). A last-dollar grantor
    (pays_after_camp_aid, D143) pays after the award by design and is never late. A grant with no date is skipped."""
    full = {g.key for g in inputs.grantors if g.full_coverage and not g.pays_after_camp_aid}
    by_id = {row.request_id: row for row in inputs.rows}
    late: dict[str, GridRowOut] = {}
    for grant in inputs.register:
        if (
            not grant.counts
            or grant.is_reversed
            or grant.funder_type != "outside"
            or grant.pays_after_camp_aid
            or grant.grantor_key not in full
            or grant.recorded_at is None
        ):
            continue
        known = grant.recorded_at.astimezone(CAMP_TZ).date()
        for share in grant.requests:
            row = by_id.get(share.request_id)
            if row is not None and any(
                r.status == "posted" and not r.clawed_back and r.posted_on is not None and r.posted_on < known
                for r in row.rounds
            ):
                late[row.request_id] = row
    return [late[rid] for rid in sorted(late)]


def _to_place_line(found: OpenToPlace | None) -> TodayLineOut:
    """§6.4's To place: Money › To place's open lines, exactly its open_count and open_total, and the households
    CampMinder posted them to. Lines left at family level or awaiting a reclassification are not counted (SP11).
    Before the first ticked season the line is empty and says why (`skipped`, SP11 Decision 12)."""
    found = found or NO_OPEN_LINES
    return TodayLineOut(
        key="to_place",
        families=found.households,
        items=found.lines,
        item_kind="lines",
        amount=money(found.total),
        skipped=found.skipped,
    )


def _casework(inputs: TodayInputs) -> list[TodayLineOut]:
    rows = inputs.rows
    needs_offer = _in(rows, "needs_offer")
    holds = _in(rows, "holds")
    waiting = _in(rows, "waiting_on_family")
    since = [d for d in (_waiting_since(row) for row in waiting) if d is not None]
    asked = [d for d in (_asked_since(row) for row in needs_offer) if d is not None]
    offer_oldest = (inputs.today - min(asked)).days if asked else None
    waiting_oldest = (inputs.today - min(since)).days if since else None
    unreconciled = _in(rows, "not_reconciled")
    gaps = [gap for row in unreconciled for gap in _disagreements(row)]
    needs_camper = inputs.grants.needs_camper
    waiting_grants = inputs.grants.waiting
    grant_households = {n.grant.household_cm_id for n in needs_camper} | {
        w.grant.household_cm_id for w in waiting_grants
    }
    lines = {
        "needs_offer": _line(
            "needs_offer",
            needs_offer,
            reasons=_reasons((f"r{r.round}", row.household_cm_id) for row in needs_offer for r in offer_rounds(row)),
            oldest_days=offer_oldest,
            overdue=_overdue("needs_offer", offer_oldest),
            next_up=_next_up(needs_offer, inputs.today, _asked_clock),
        ),
        "holds": _line(
            "holds",
            holds,
            reasons=_reasons((h.code, row.household_cm_id) for row in holds for h in row.holds),
            next_up=_next_up(holds, inputs.today, _hold_clock(inputs.hold_since)),
        ),
        "waiting_on_family": _line(
            "waiting_on_family",
            waiting,
            oldest_days=waiting_oldest,
            over_14_days=sum(1 for d in since if (inputs.today - d).days > WAITING_TOO_LONG_DAYS),
            overdue=_overdue("waiting_on_family", waiting_oldest),
            next_up=_next_up(waiting, inputs.today, _waiting_clock),
        ),
        "not_reconciled": _line(
            "not_reconciled",
            unreconciled,
            reasons=_reasons(
                ((code, row.household_cm_id) for row in unreconciled for code in _unreconciled(row)),
                {str(code): label for code, label in UNTICKED_LABELS.items()},
            ),
            # D150, unchanged by D162: the largest disagreement between a Posted figure and CampMinder. Direction (b)'s
            # money has no Posted figure to disagree with, so it adds no gap.
            largest_gap=max(gaps) if gaps else None,
            next_up=_next_up(unreconciled, inputs.today, _posted_clock),
        ),
        "to_reverse": _line("to_reverse", _in(rows, "to_reverse")),
        "session_not_settled": _line("session_not_settled", _in(rows, "session_not_settled")),
        "duplicates": _line("duplicates", _in(rows, "duplicates")),
        "grants": TodayLineOut(
            key="grants",
            families=len(grant_households),
            items=len(needs_camper) + len(waiting_grants),
            item_kind="grants",
            reasons=_reasons(
                [("needs_camper", n.grant.household_cm_id) for n in needs_camper]
                + [(w.reason, w.grant.household_cm_id) for w in waiting_grants]
            ),
            next_up=_grant_next_up(inputs),
        ),
        "late_full_coverage": _line("late_full_coverage", _late_full_coverage(inputs), listed=True),
        "to_place": _to_place_line(inputs.to_place),
    }
    return [lines[key] for key in CASEWORK_LINES]


def _grant_next_up(inputs: TodayInputs) -> list[TodayNextUpOut]:
    """Grants needing attention's households (audit R12, spec §9.2): each once, at its oldest grant, oldest first. A
    grant that needs a camper is aged from the day it was recorded; a waiting commitment by its own days waiting."""
    best: dict[int, tuple[int, GrantRowOut]] = {}

    def seen(grant: GrantRowOut, days: int | None) -> None:
        if grant.household_cm_id <= 0:
            return
        age = days if days is not None else -1
        held = best.get(grant.household_cm_id)
        if held is None or age > held[0]:
            best[grant.household_cm_id] = (age, grant)

    for needs in inputs.grants.needs_camper:
        recorded = _iso_day(needs.grant.recorded_on)
        seen(needs.grant, (inputs.today - recorded).days if recorded is not None else None)
    for waiting in inputs.grants.waiting:
        seen(waiting.grant, waiting.days_waiting)
    ordered = sorted(best.items(), key=lambda kv: (-kv[1][0], kv[0]))[:NEXT_UP_CAP]
    return [
        TodayNextUpOut(
            household_cm_id=household,
            label=_grid_name(grant.camper_name, grant.family_name),
            days=age if age >= 0 else None,
            camper_name=grant.camper_name,
            session_name=grant.session_name,
            session_type=grant.session_type,
        )
        for household, (age, grant) in ordered
    ]


def _iso_day(text: str) -> date | None:
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _sources_line(inputs: TodayInputs) -> TodayLineOut:
    """§6.4, §8.1: the descriptions finance must act on: unmapped (no grantor), unclassified, and outside sources
    that need a reporting group (D100). Items count each description once; a description with two reasons is under
    each (TodayLineOut: reasons need not sum to items)."""
    unmapped = [u.description_key for u in inputs.grants.unmapped]
    unclassified = [u.source_key for u in inputs.unclassified]
    return TodayLineOut(
        key="sources",
        families=None,
        items=len({*unmapped, *unclassified, *inputs.needs_group}),
        item_kind="descriptions",
        reasons=_reasons(
            [("no_grantor", 0) for _ in unmapped]
            + [("unclassified", 0) for _ in unclassified]
            + [("needs_group", 0) for _ in inputs.needs_group]
        ),
    )


def _finance(inputs: TodayInputs) -> list[TodayLineOut]:
    rows = inputs.rows
    pending = _in(rows, "pending_approval")
    pending_amount = sum(
        (Decimal(str(r.pending_approval)) for row in pending for r in row.rounds if r.pending_approval is not None),
        Decimal(0),
    )
    keyed = [d for d in (_pending_since(row, inputs.pending_since) for row in pending) if d is not None]
    pending_oldest = (inputs.today - min(keyed)).days if keyed else None
    intake_codes = (FLAG_AWAITING_RULES, NO_APPROVED_RULES)
    intake = [row for row in rows if any(h.code in intake_codes for h in row.holds)]
    sections = sorted(inputs.draft_sections or [])
    lines = {
        "pending_approval": _line(
            "pending_approval",
            pending,
            amount=money(pending_amount),
            oldest_days=pending_oldest,
            overdue=_overdue("pending_approval", pending_oldest),
            next_up=_next_up(pending, inputs.today, lambda row: _pending_clock(row, inputs.pending_since)),
        ),
        "rules_sections": TodayLineOut(
            key="rules_sections",
            families=None,
            items=len(sections),
            item_kind="sections",
            reasons=_reasons((name, 0) for name in sections),
        ),
        "sources": _sources_line(inputs),
        "intake": _line(
            "intake",
            intake,
            reasons=_reasons(
                (h.code, row.household_cm_id) for row in intake for h in row.holds if h.code in intake_codes
            ),
            listed=True,
        ),
        "equity_field_never_true": TodayLineOut(
            key="equity_field_never_true",
            families=None,
            items=len(inputs.never_true),
            item_kind="fields",
            reasons=_reasons(((f, 0) for f in inputs.never_true), inputs.never_true_labels),
        ),
    }
    return [lines[key] for key in FINANCE_LINES]


def _named(key: TodayKey, named: Iterable[tuple[str, str]], kind: TodayItemKind) -> TodayLineOut:
    """`named`: (name, where it opens in Money › Funders: "funder:<key>" or "row:<source id>"), each name once."""
    listed = sorted(dict(named).items(), key=lambda pair: pair[0].casefold())
    return TodayLineOut(
        key=key,
        families=None,
        items=len(listed),
        item_kind=kind,
        names=[name for name, _ in listed],
        links=[link for _, link in listed],
    )


def _development(inputs: TodayInputs) -> list[TodayLineOut]:
    """Spec 2026-10-10 §5.1/§7.3: funder upkeep. Funders by name (not families), descriptions as CampMinder writes
    them (audit D8). A retired funder is history and needs no upkeep."""
    live = [g for g in inputs.grantors if not g.retired_at]
    lines = {
        "no_contact": _named(
            "no_contact", ((g.name, f"funder:{g.key}") for g in live if not g.contacts.strip()), "funders"
        ),
        "no_eligibility": _named(
            "no_eligibility", ((g.name, f"funder:{g.key}") for g in live if not g.eligibility.strip()), "funders"
        ),
        "needs_group": _named(
            "needs_group",
            (
                (inputs.descriptions.get(key, key), f"row:{inputs.source_ids[key]}" if key in inputs.source_ids else "")
                for key in inputs.needs_group
            ),
            "descriptions",
        ),
        "no_grantor": _named(
            "no_grantor",
            ((u.description or u.description_key, f"row:{u.source_id}") for u in inputs.grants.unmapped),
            "descriptions",
        ),
    }
    return [lines[key] for key in DEVELOPMENT_LINES]


def pending_since(events: Iterable[DecisionEvent]) -> dict[tuple[str, int], date]:
    """(request, round) -> the camp-time day of the latest award keyed for approval (D79's needs_approval)."""
    out: dict[tuple[str, int], datetime] = {}
    for e in events:
        if e.kind == "award" and e.needs_approval:
            key = (e.request_id, e.round)
            if key not in out or e.created > out[key]:
                out[key] = e.created
    return {key: when.astimezone(CAMP_TZ).date() for key, when in out.items()}


# The Requests stage strip's stages, in the strip's order (frontend requests/strip.ts: PIPELINE_STAGES, then
# EXCEPTION_BADGES; tests/fixtures/camperships_frontend_mirrors.json pins the two together).
STRIP_STAGES: Final[tuple[QueueOut, ...]] = (
    "pending_approval",
    "needs_offer",
    "not_reconciled",
    "waiting_on_family",
    "holds",
    "duplicates",
    "session_not_settled",
    "to_reverse",
)
# Ruling 17: the bar is five stages. Needs an offer, Pending approval and Waiting on the family are strip stages whose
# queues the segments mirror for requests moving through the normal stages; On hold reads the Stage column (latest round
# held), so the strip's Holds list can show more (it also lists holds raised after an offer). The other strip stages are
# flags that sit on top of any stage: chips with the strip's own count.
BAR_STAGES: Final[tuple[QueueOut, ...]] = ("needs_offer", "pending_approval", "waiting_on_family")
FLAG_STAGES: Final[tuple[QueueOut, ...]] = tuple(q for q in STRIP_STAGES if q not in (*BAR_STAGES, "holds"))
BAR_SEGMENTS: Final[tuple[str, ...]] = ("needs_offer", "pending_approval", "waiting_on_family", "on_hold", "accepted")
# Each live Stage code (row_stage) on its one segment. not_decided is a Round 3 ask with no amount keyed yet (Needs an
# offer); refused is finance refusing the Round 3 appeal, and the family keeps the grant it already accepted (Accepted).
_SEGMENT_OF_STAGE: Final[Mapping[str, str]] = {
    "needs_offer": "needs_offer",
    "not_decided": "needs_offer",
    "pending_approval": "pending_approval",
    "posted": "waiting_on_family",
    "held": "on_hold",
    "accepted": "accepted",
    "refused": "accepted",
}
_OFFERED: Final = frozenset({"pending_approval", "waiting_on_family", "accepted"})


def week_start(day: date) -> date:
    """Monday of the camp week `day` falls in (This week and the hero's "+n")."""
    return date.fromordinal(day.toordinal() - day.weekday())


def _stages(inputs: TodayInputs) -> TodayStagesOut:
    """The bar: each live request once, by its own Stage. The chips: each flag's queue membership, every row the strip
    counts for it (D21)."""
    segments: dict[str, int] = dict.fromkeys(BAR_SEGMENTS, 0)
    flags: dict[str, int] = dict.fromkeys(FLAG_STAGES, 0)
    households: set[int] = set()
    for row in inputs.rows:
        for flag in FLAG_STAGES:
            flags[flag] += bool(row.queues and flag in row.queues)
        segment = _SEGMENT_OF_STAGE.get(row.stage.code) if row.stage is not None else None
        if segment is None:  # cancelled, or no round yet: not live
            continue
        segments[segment] += 1
        households.add(row.household_cm_id)
    return TodayStagesOut(
        needs_offer=segments["needs_offer"],
        pending_approval=segments["pending_approval"],
        waiting_on_family=segments["waiting_on_family"],
        on_hold=segments["on_hold"],
        accepted=segments["accepted"],
        flags=TodayFlagsOut(
            not_reconciled=flags["not_reconciled"],
            duplicates=flags["duplicates"],
            session_not_settled=flags["session_not_settled"],
            to_reverse=flags["to_reverse"],
        ),
        families=len(households),
        live=sum(segments.values()),
        offered=sum(segments[s] for s in _OFFERED),
    )


def _posted_parts(rows: Iterable[GridRowOut]) -> Iterable[tuple[date | None, Decimal]]:
    """Each posted round's money as budget.py's `_tally_round` counts it in Posted, with its `posted_on`: nothing when
    clawed back (D54), and otherwise only its inside part, the round's amount less the money below the line
    (`outside_budget`, the grid's tag of counted_part's second half)."""
    for row in rows:
        for r in row.rounds:
            if r.status == "posted" and not r.clawed_back:
                yield r.posted_on, Decimal(str(r.posted or 0)) - Decimal(str(r.outside_budget or 0))


def _posted_by_week(inputs: TodayInputs) -> list[WeekPointOut]:
    """Committed by week: the budget's Posted (`_posted_parts`), week by week, dated by `posted_on`, accumulated, with
    empty weeks filled, from the first week with a post through the current one. A post with no `posted_on` counts in
    the current week, so the last point is always the budget's Posted."""
    current = week_start(inputs.today)
    per_week: dict[date, Decimal] = defaultdict(Decimal)
    for posted_on, part in _posted_parts(inputs.rows):
        per_week[week_start(posted_on) if posted_on is not None else current] += part
    if not per_week:
        return []
    points: list[WeekPointOut] = []
    running = Decimal(0)
    cursor, last = min(per_week), max(max(per_week), current)
    while cursor <= last:
        running += per_week.get(cursor, Decimal(0))
        points.append(WeekPointOut(week_of=cursor, posted=float(running)))
        cursor += timedelta(days=7)
    return points


def _posted_this_week(inputs: TodayInputs) -> WeekFigureOut:
    """This week's "Posted in CM" (spec §7.2): the budget's Posted (`_posted_parts`) by `posted_on`, Monday through
    today against the same weekdays of last week, as the week read's windows run. An undated post counts this week, as
    `_posted_by_week` counts it in the current week, so the two never disagree."""
    this_start = week_start(inputs.today)
    last_start = this_start - timedelta(days=7)
    last_end = last_start + (inputs.today - this_start)
    now = before = Decimal(0)
    for posted_on, part in _posted_parts(inputs.rows):
        if posted_on is None or this_start <= posted_on <= inputs.today:
            now += part
        elif last_start <= posted_on <= last_end:
            before += part
    return WeekFigureOut(
        key="posted_cm", label="Posted in CM", value=float(now), previous=float(before), unit="dollars"
    )


def build_today(
    inputs: TodayInputs, *, casework: bool, finance: bool, development: bool = False, view: bool = False
) -> TodayResponse:
    """`view`: the caller holds financial_aid.view, so a view-only page still draws the registrar hero (spec §2, §9.3).
    A development-only caller gets no stages."""
    return TodayResponse(
        year=inputs.year,
        casework=_casework(inputs) if casework else None,
        finance=_finance(inputs) if finance else None,
        stages=_stages(inputs) if casework or finance or view else None,
        development=_development(inputs) if development else None,
        posted_by_week=_posted_by_week(inputs) if finance else None,
        posted_this_week=_posted_this_week(inputs) if finance else None,
    )


class GrantsReads(GrantsLoader, Protocol):
    async def list_grantors(self, *, include_retired: bool = False) -> GrantorsResponse: ...


class RulesDrafts(Protocol):
    async def load(self, year: int, version: int | None = None) -> RulesVersion: ...


class LedgerReads(Protocol):
    async def unclassified_sources(self, year: int) -> list[UnclassifiedSource]: ...
    async def needs_group_descriptions(self, year: int) -> dict[str, NamedSource]: ...


async def _draft_sections(rules: RulesDrafts, year: int) -> list[str] | None:
    """The rules draft's sections awaiting approval (D39): the latest version's sections still in draft."""
    try:
        latest = await rules.load(year)
    except RulesNotFoundError:
        return None
    return [name for name, status in latest.section_status.items() if status.state == "draft"]


class IntakeWarningReads(Protocol):
    async def fetch_fa_rows(self, year: int) -> list[FaRow]: ...
    async def load_equity_rules(self, year: int) -> AidRules | None: ...


async def _never_true(intake: IntakeWarningReads, year: int) -> dict[str, str]:
    rows, rules = await asyncio.gather(intake.fetch_fa_rows(year), intake.load_equity_rules(year))
    return never_true_labels(rules, rows)


async def _no_fields() -> dict[str, str]:
    return {}


class TodayService:
    """Today's one aggregate read (D21): the live season priced once, with the grants register it was
    priced with (OneGrantsLoad), and only for finance the rules draft and the season's descriptions."""

    def __init__(
        self,
        *,
        store: DecisionsStore,
        pricing: PricingRules,
        rules: RulesDrafts,
        grants: GrantsReads,
        ledger: LedgerReads,
        intake: IntakeWarningReads | None = None,
        to_place: ToPlaceCounts | None = None,
        labels: HouseholdLabeler | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        """`labels`: the household page's label helper (household_labels), naming every next-up household as the grid
        names a household-level row. None: the family name."""
        self._store = store
        self._pricing = pricing
        self._rules = rules
        self._grants = grants
        self._ledger = ledger
        self._intake = intake
        self._to_place = to_place
        self._labels = labels
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def read(
        self, year: int, *, casework: bool, finance: bool, development: bool = False, view: bool = False
    ) -> TodayResponse:
        if not (casework or finance or development or view):
            return TodayResponse(year=year, casework=None, finance=None)
        # A development-only caller gets funder upkeep alone: no family line and no hero stages, so the season is
        # never priced for it. View needs the season for the registrar hero (spec §2, §9.3).
        priced = casework or finance or view
        named = casework or finance  # the lines that name households (and their campers, for the drawer)
        shared = OneGrantsLoad(self._grants, year)
        decisions = FinancialAidDecisionsService(self._store, self._pricing, shared.register, clock=self._clock)
        # asyncio.gather types six awaitables at most, so the events ride a task of their own.
        events_read = asyncio.ensure_future(self._store.fetch_decision_events(year) if finance else _no_events())
        (
            season,
            (grants, register),
            grantors,
            draft,
            (unclassified, named_sources),
            never_labels,
        ) = await asyncio.gather(
            decisions.named_season(year) if named else _season_only(decisions, year) if priced else _none(),
            shared.read(),
            # Retired grantors too: hidden from pickers, never from the grants that named them.
            self._grants.list_grantors(include_retired=True) if casework or development else _no_grantors(),
            _draft_sections(self._rules, year) if finance else _none(),
            _descriptions(self._ledger, year) if finance or development else _no_descriptions(),
            _never_true(self._intake, year) if finance and self._intake is not None else _no_fields(),
        )
        events = await events_read
        rows: list[GridRowOut] = []
        open_lines: OpenToPlace | None = None
        hold_since: dict[str, date] = {}
        if season is not None:
            live, names = season
            live = await decisions.with_unticked(live)
            rows = [decisions.row_of(live, names, request_id) for request_id in live.priced]
            hold_since = {
                rid: state.manual.placed_at.astimezone(CAMP_TZ).date()
                for rid, state in live.holds.items()
                if state.manual is not None
            }
            if casework and self._to_place is not None:
                open_lines = await open_to_place(live, self._to_place)
        inputs = TodayInputs(
            year=year,
            rows=rows,
            grants=grants,
            register=register,
            grantors=grantors.grantors,
            draft_sections=draft,
            unclassified=unclassified,
            today=self._clock().astimezone(CAMP_TZ).date(),
            never_true=tuple(never_labels),
            never_true_labels=never_labels,
            to_place=open_lines,
            needs_group=sorted(named_sources),
            pending_since=pending_since(events),
            hold_since=hold_since,
            descriptions={key: named.description for key, named in named_sources.items()},
            source_ids={key: named.source_id for key, named in named_sources.items()},
        )
        out = build_today(inputs, casework=casework, finance=finance, development=development, view=view)
        return await self._labelled(year, out) if named else out

    async def _labelled(self, year: int, out: TodayResponse) -> TodayResponse:
        """Every household-level next-up chip named by its household label (audit R2, owner ruling 18: as the grid
        names a household-level row), the tie-break scoped to the household-level chips this response names. A camper
        chip keeps its camper's name. Without a labeler, or for a household the helper does not name, the chip keeps
        its family name."""
        lines = [*(out.casework or []), *(out.finance or [])]
        households = {n.household_cm_id for line in lines for n in line.next_up if not n.camper_name}
        if self._labels is None or not households:
            return out
        named = await self._labels(year, households)

        def relabel(section: list[TodayLineOut] | None) -> list[TodayLineOut] | None:
            if section is None:
                return None
            return [
                line.model_copy(
                    update={
                        "next_up": [
                            n.model_copy(update={"label": label.label or n.label, "tiebreak": label.tiebreak})
                            if not n.camper_name and (label := named.get(n.household_cm_id)) is not None
                            else n
                            for n in line.next_up
                        ]
                    }
                )
                for line in section
            ]

        return out.model_copy(update={"casework": relabel(out.casework), "finance": relabel(out.finance)})


async def _no_events() -> list[DecisionEvent]:
    return []


async def _no_grantors() -> GrantorsResponse:
    return GrantorsResponse(grantors=[])


async def _none() -> None:
    return None


async def _descriptions(ledger: LedgerReads, year: int) -> tuple[list[UnclassifiedSource], dict[str, NamedSource]]:
    """Finance's two description reads: the unclassified ones, and those that need a group (D100), by key with the
    description as CampMinder writes it."""
    unclassified, needs_group = await asyncio.gather(
        ledger.unclassified_sources(year), ledger.needs_group_descriptions(year)
    )
    return unclassified, needs_group


async def _no_descriptions() -> tuple[list[UnclassifiedSource], dict[str, NamedSource]]:
    return [], {}


async def _season_only(decisions: FinancialAidDecisionsService, year: int) -> tuple[Season, Names]:
    """A view-only caller's season: the hero's stages need no family or camper name, so none is read."""
    return await decisions.season(year), ({}, {})
