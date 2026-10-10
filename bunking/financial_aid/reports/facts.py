"""What a finance report reads of one request (Reports back end, Part A; clean spec §5.6, §9.2, §9.3, §9.7; D72,
D80, D129, D131). Pure: no I/O.

A report never reads the budget's Posted (D129, D131). It reads each request's own rounds and its standing:

  standing      "live"       received and live (active or unmatched): it can be awarded;
                "cancelled"  received, then cancelled (CampMinder or Kindred, 10b-2): in the apps, out of the
                             awarded figures at once, even while the budget's Posted still holds its money (D54);
                "closed"     received but not live and not cancelled (a pending duplicate, a withdrawn answer
                             nothing replaced): in the apps, never awarded.
  awarded       a round's Posted lock (D80: awarded = offered = Posted) on a live request, counted toward the
                budget (the camp's own money, D106), net of clawback (D54). A wholly-outside decision type's round
                (an outside funder's full-cost type, D121) is not the camp's money, so it is never awarded here.
  decided       a round decided and not yet offered (§5.3's Needs an offer): the "Decided (not yet offered)" basis
                (D130); a past date prices it as of the day (A6c), except a request 3c-2 can't price.

Only RECEIVED requests become ReportRequests (D72: every intake request except refused duplicates; an edited
answer is the same application, so the request it replaced is not counted again). The service decides that. The one
exception is a CONFIRMED duplicate holding a posted award (owner ruling, queue 4): it carries `counts_as_received`
False, reads as "cancelled", and only its money (As offered, the recipients-who-cancelled line) is counted.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO

Standing = Literal["live", "cancelled", "closed"]

# D155: a received-through figure's Round 1 asks are as they stood at the end of its day ("as_of_cutoff"), or, when
# that can't be rebuilt for every request in it, as they stand now ("now"), and the figure says so.
AsksBasis = Literal["as_of_cutoff", "now"]
REPORT_ROUNDS: Final[tuple[int, ...]] = (1, 2, 3)
_CENT: Final = Decimal("0.01")


def average(total: Decimal, count: int) -> Decimal | None:
    """total ÷ count to the cent (the committee compares' rule, §9.7); None when nothing is counted."""
    return (total / count).quantize(_CENT, rounding=ROUND_HALF_UP) if count else None


@dataclass(frozen=True)
class RoundFacts:
    """One round of one received request.

    `ask` is the round's ask as keyed (Round 1: the request's ask, as corrected). `locked` is the Posted lock of a
    round that counts toward the budget, whatever happened after it (None: not posted, or outside the budget);
    `clawed_back` says CampMinder's reversal has posted since (D54). `decided` is decided and not yet offered
    (None: not decided, posted, outside the budget, or a request 3c-2 can't price as of the day). `tier` is the round's tier: at its lock, else the request's now
    (None: unknown, e.g. a past read of an unposted round). `pool` is where the round's money counts: a posted
    round's lock pool, else the request's home pool."""

    round: int
    ask: Decimal | None
    locked: Decimal | None
    clawed_back: bool
    decided: Decimal | None
    accepted: bool
    posted_on: date | None
    tier: int | None
    pool: str | None
    outside_budget: bool = False  # paid wholly outside the budget (D121), posted or not: never awarded, out of % of ask
    outside_posted: Decimal | None = None  # an outside-budget round's Posted lock: the outside funder's money
    outside_decided: Decimal | None = None  # an outside-budget round's decided amount while it needs an offer

    @property
    def posted(self) -> Decimal | None:
        """The round's Posted money net of clawback (D54); None when not posted or outside the budget."""
        return None if self.locked is None or self.clawed_back else self.locked


@dataclass(frozen=True)
class ReportRequest:
    """One received request (or a posted confirmed duplicate, `counts_as_received` False), as every finance report
    reads it. `table` / `round2_table` are its program's award and Round 2 tables under the season's rules ("" when
    none); `pool` its home pool (None when unknown); `grants` the counting outside grants placed on it (the grants
    register, D55, D116)."""

    request_id: str
    household_cm_id: int
    person_cm_id: int
    program_key: str | None
    session_cm_id: int
    pool: str | None
    table: str
    round2_table: str
    standing: Standing
    cancel_reason: str | None
    received_at: datetime | None
    rounds: tuple[RoundFacts, ...]
    grants: Decimal = ZERO
    # False only for a CONFIRMED duplicate holding a posted award (owner ruling, queue 4): it is not an application
    # (D72), so it stays out of Apps, Asked, "# asks", r1_apps and every received count; only its money counts.
    counts_as_received: bool = True
    # The request's session cost as priced (the rules' price, an AG session's parent's, or a staff cost override; None
    # when nothing could price it: a request that isn't live, no rules, or a program with no price). Development counts
    # a request whose asks add up to more at the cost (Rule M). The service fills it
    # (financial_aid_reports_facts.session_cost).
    cost: Decimal | None = None

    @property
    def live(self) -> bool:
        return self.standing == "live"

    def round(self, n: int) -> RoundFacts | None:
        return next((r for r in self.rounds if r.round == n), None)

    def awarded(self, rounds: Iterable[int] = REPORT_ROUNDS, *, decided: bool = False) -> Decimal:
        """The camp's awarded money on the rounds named (D80), plus decided and not yet offered when `decided`
        (D130). Always 0 on a request that is not live (D129, D131)."""
        if not self.live:
            return ZERO
        total = ZERO
        for n in rounds:
            facts = self.round(n)
            if facts is None:
                continue
            total += facts.posted or ZERO
            if decided:
                total += facts.decided or ZERO
        return total

    def outside_funded(self, rounds: Iterable[int] = REPORT_ROUNDS, *, decided: bool = False) -> Decimal:
        """An outside funder's money on the rounds named: each outside-budget round's Posted lock net of clawback, plus
        its decided amount while it needs an offer when `decided`. Never the camp's (so never in `awarded`), it counts
        as grants (owner A1, RULED 2026-10-02: "grants means anything that isn't internal camp money"). Always 0 on a
        request that is not live, as the camp's money is (D129, D131)."""
        if not self.live:
            return ZERO
        total = ZERO
        for n in rounds:
            facts = self.round(n)
            if facts is None:
                continue
            if facts.outside_posted is not None and not facts.clawed_back:
                total += facts.outside_posted
            if decided:
                total += facts.outside_decided or ZERO
        return total

    def offered(self, rounds: Iterable[int] = REPORT_ROUNDS) -> Decimal:
        """The money as offered on the rounds named: each round's Posted lock, whatever happened after it (owner N2 = C,
        RULED 2026-10-02). A later cancellation, withdrawal or clawback never reduces it, so it counts on a request
        that is no longer live; a round outside the budget (D121, `locked` None) is not in it."""
        return sum((facts.locked or ZERO for n in rounds if (facts := self.round(n)) is not None), ZERO)

    def asked_in_budget(self, rounds: Iterable[int] = REPORT_ROUNDS) -> Decimal | None:
        """`asked`, less any round outside the budget (owner (c), RULED 2026-10-02): % of ask's denominator. A round
        paid wholly by an outside funder is never awarded, so dividing by its ask would read as a shortfall."""
        asks = [
            facts.ask
            for n in rounds
            if (facts := self.round(n)) is not None and facts.ask is not None and not facts.outside_budget
        ]
        return sum(asks, ZERO) if asks else None

    def asked(self, rounds: Iterable[int] = REPORT_ROUNDS) -> Decimal | None:
        """The asks as keyed on the rounds named, summed (D80's "asked $"); None when none of them has one."""
        asks = [facts.ask for n in rounds if (facts := self.round(n)) is not None and facts.ask is not None]
        return sum(asks, ZERO) if asks else None

    def asked_capped(self, rounds: Iterable[int] = REPORT_ROUNDS) -> Decimal | None:
        """`asked`, counted at most at the session cost (Rule M, owner 10-09: Statistics' Asked, as Development)."""
        ask = self.asked(rounds)
        return None if ask is None else capped_at_cost(ask, self.cost)

    def is_ask_capped(self, rounds: Iterable[int] = REPORT_ROUNDS) -> bool:
        """The asks on the rounds named add up to more than the priced session cost: "counted at the cost"."""
        ask = self.asked(rounds)
        return ask is not None and self.cost is not None and ask > self.cost


def capped_at_cost(amount: Decimal, cost: Decimal | None) -> Decimal:
    """Rule M (owner 10-08, per request): `amount` counts at most the request's priced session cost. No cost known
    (a request that isn't live, no rules, a program with no price): as typed. One rule for Development's need and
    Statistics' Asked."""
    return amount if cost is None else min(amount, cost)


def in_table(requests: Iterable[ReportRequest], table: str | None) -> list[ReportRequest]:
    """The requests whose program uses award table `table` (None: every table, the All chip)."""
    return [r for r in requests if table is None or r.table == table]


def in_round(request: ReportRequest, n: int | None) -> bool:
    """Whether a received request is in round `n`'s population: Round 1 (and None, all rounds) holds every one;
    Round 2 and Round 3 hold those with that round's ask, or its lock (a Round 3 can be posted with no ask)."""
    if n is None or n == 1:
        return True
    facts = request.round(n)
    return facts is not None and (facts.ask is not None or facts.locked is not None)


def appeals(requests: Sequence[ReportRequest]) -> list[ReportRequest]:
    """Requests with any Round 2 or later ask (RPT-8's appeals, finance's version): cancelled ones included."""
    # Owner ruling (RULED 2026-10-02, appeals and cancellations): the rate divides by applications, which include cancellations
    # (D131), so the numerator keeps them; RPT-23's outcomes and the Season screen's Round 2 asks exclude them.
    return [r for r in requests if any((f := r.round(n)) is not None and f.ask is not None for n in (2, 3))]
