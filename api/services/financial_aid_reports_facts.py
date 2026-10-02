"""A priced season as every finance report reads it (Reports back end, Part A; clean spec §5.6, §9.2; D72, D80,
D129, D131): `report_requests` turns the decisions service's Season into bunking.financial_aid.reports.facts'
ReportRequests. No I/O: the reports service loads the change log and the corrections it needs.

Which requests are RECEIVED (D72): every intake request except a refused duplicate, and except a withdrawn request
that an edited answer replaced (intake withdraws the old key and creates a new one, bunking.financial_aid.received's
`edit_predecessors`): that is one application, counted once, at its first date. A withdrawn request nothing replaced
(the family removed the answer) was still received.

Where each field comes from:
  standing      cancelled when the season lists a cancellation (10b-2; on a past read the season lists the ones made by
                that day, whether CampMinder's or Kindred's, so a request cancelled on or before `as_of` IS cancelled
                then and one cancelled after is not); live (active, unmatched) and not cancelled;
                otherwise closed (a pending duplicate, a withdrawn answer). This is the request's STANDING, not the
                Include override (a staff exclusion from a family's sums); see OWNER ITEM 53 below.
  program       the priced program, else the rules program the request's session belongs to (a request that is
                not live is not priced, so its program comes from its session).
  rounds        each round that exists (Round 1 always): the priced view where there is one (a live request's
                every round; a request that is not live keeps only its posted rounds), else the round's own state.
  ask           the view's (Round 1: the request's ask as corrected); else Round 1's corrected ask, or the state's.
  locked        a posted round that counts toward the budget: the amount its lock stored.
  tier          a posted round's tier at its lock (its snapshot, D43), else the request's final tier (now, or as
                priced on a past read); None when neither is known.
  grants        the counting outside grants on the request (the budget's below-the-line money, D125, D143).
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from datetime import datetime
from decimal import Decimal

from api.services.financial_aid_calc_inputs import effective_ask, rules_program_key
from api.services.financial_aid_decisions_service import Season
from api.services.financial_aid_grants_register import outside_grants_by_request
from api.services.financial_aid_intake_types import (
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    CorrectionRecord,
    RequestRecord,
)
from bunking.financial_aid.decisions import PricedRequest, RoundState, RoundView, round_exists
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.received import edit_predecessors
from bunking.financial_aid.reports.facts import REPORT_ROUNDS, ReportRequest, RoundFacts, Standing
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.scenarios.results import round1_table, round2_table

_LIVE = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})


def received_ids(requests: Mapping[str, RequestRecord]) -> frozenset[str]:
    """D72's received requests: not a refused duplicate, and not a withdrawn answer an edit replaced."""
    replaced: set[str] = set()
    for request_id, before in edit_predecessors(requests.values()).items():
        if requests[request_id].status != STATUS_WITHDRAWN:
            replaced |= before
    return frozenset(rid for rid, r in requests.items() if r.status != STATUS_DUPLICATE and rid not in replaced)


def _standing(request: RequestRecord, cancelled: bool) -> Standing:
    # OWNER ITEM (a) NOT RULED: a posted lock on a withdrawn request is dropped (closed). Flip deliberately.
    # A withdrawn request is "closed": not awarded, not cancelled, not in recipients-who-cancelled, so Reports reads
    # $0 where the budget still shows the lock as Posted.
    if cancelled:
        return "cancelled"
    return "live" if request.status in _LIVE else "closed"


def _snapshot_tier(state: RoundState | None) -> int | None:
    snapshot = state.snapshot if state is not None and state.snapshot is not None else {}
    result = snapshot.get("result")
    tier = result.get("final_tier") if isinstance(result, Mapping) else None
    return tier if isinstance(tier, int) else None


def _program(
    request: RequestRecord, priced: PricedRequest | None, season: Season, document: AidRules | None
) -> str | None:
    if priced is not None and priced.program_key is not None:
        return priced.program_key
    if document is None or request.session_cm_id <= 0:
        return None
    return rules_program_key(request, season.sessions, document)


def _r1_ask(request: RequestRecord, corrections: Sequence[CorrectionRecord]) -> Decimal | None:
    ask = effective_ask(request, corrections)
    return Decimal(ask.effective) if ask.effective != "" else None


def _round(
    n: int,
    view: RoundView | None,
    state: RoundState | None,
    *,
    r1_ask: Decimal | None,
    tier_now: int | None,
    home_pool: str | None,
) -> RoundFacts:
    posted = view is not None and view.status == "posted"
    counts = posted and view is not None and view.counts_toward_budget
    ask: Decimal | None
    if view is not None:
        ask = view.ask
    else:
        ask = r1_ask if n == 1 else (state.ask if state is not None else None)
    tier = _snapshot_tier(state) if posted else None
    # OWNER ITEM (c) NOT RULED: a round outside the budget (D121's outside funder's full-cost type) is never awarded
    # here (`locked` None), yet its ask stays in `ask`, so it still sits in % of ask's denominator at $0 awarded.
    return RoundFacts(
        round=n,
        ask=ask,
        locked=view.locked if counts and view is not None else None,
        clawed_back=bool(view is not None and view.clawed_back),
        decided=view.decided if view is not None and view.status == "needs_offer" else None,
        accepted=bool(view is not None and posted and view.accepted),
        posted_on=state.posted_on if posted and state is not None else None,
        tier=tier if tier is not None else tier_now,
        pool=view.pool if view is not None and view.pool is not None else home_pool,
    )


def report_requests(
    season: Season,
    *,
    received: Mapping[str, datetime | None],
    corrections: Sequence[CorrectionRecord],
    keep: Collection[str] | None = None,
) -> tuple[ReportRequest, ...]:
    """Every received request of `season` (D72), as reports read it. `received` holds each request's first-recorded
    moment (bunking.financial_aid.received; empty before the first season it means anything); `keep`, when given, is
    a reporting control's request set (D138): only those requests."""
    document = season.rules.document if season.rules is not None else None
    grants = outside_grants_by_request(season.register)
    out: list[ReportRequest] = []
    for request_id in sorted(received_ids(season.requests)):
        if keep is not None and request_id not in keep:
            continue
        request = season.requests[request_id]
        # OWNER ITEM 53 NOT RULED: Reports ignore the Include override (default). Flip deliberately.
        # `season.exclusions` (financial_aid_request_overrides.exclusion) is the Include override, which staff set to
        # leave a request out of a family's sums; Reports never read it, so an excluded request still counts in apps,
        # asks and awarded. It is NOT the report's own standing == "live" (received and live, below), a
        # different concept with the same word. To honour it, filter on `request_id in season.exclusions` here.
        priced = season.priced.get(request_id)
        states = season.rounds.get(request_id, {})
        program = _program(request, priced, season, document)
        profile = document.programs.get(program) if document is not None and program is not None else None
        home_pool = (priced.pool if priced is not None else None) or (
            profile.budget_pool if profile is not None else None
        )
        tier_now = priced.result.final_tier if priced is not None and priced.result is not None else None
        if tier_now is None:
            # A cancelled request prices as not live (no result): its tier comes from pricing it live (tier only).
            tier_now = season.live_tiers.get(request_id)
        r1_ask = _r1_ask(request, corrections)
        rounds: list[RoundFacts] = []
        for n in REPORT_ROUNDS:
            view = priced.view(n) if priced is not None else None
            state = states.get(n)
            if n > 1 and view is None and (state is None or not round_exists(state)):
                continue
            rounds.append(_round(n, view, state, r1_ask=r1_ask, tier_now=tier_now, home_pool=home_pool))
        cancellation = season.cancellations.get(request_id)
        out.append(
            ReportRequest(
                request_id=request_id,
                household_cm_id=request.household_cm_id,
                person_cm_id=request.person_cm_id,
                program_key=program,
                session_cm_id=request.session_cm_id,
                pool=home_pool,
                table=round1_table(document, program) if document is not None else "",
                round2_table=round2_table(document, program) if document is not None else "",
                standing=_standing(request, cancellation is not None),
                cancel_reason=cancellation.reason if cancellation is not None else None,
                received_at=received.get(request_id),
                rounds=tuple(rounds),
                grants=grants.get(request_id, ZERO),
            )
        )
    return tuple(out)
