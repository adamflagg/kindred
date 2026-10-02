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
                (D130), on the live read only.

Only RECEIVED requests become ReportRequests (D72: every intake request except refused duplicates; an edited
answer is the same application, so the request it replaced is not counted again). The service decides that.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO

Standing = Literal["live", "cancelled", "closed"]
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
    (None: not decided, posted, or a past read). `tier` is the round's tier: at its lock, else the request's now
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

    @property
    def posted(self) -> Decimal | None:
        """The round's Posted money net of clawback (D54); None when not posted or outside the budget."""
        return None if self.locked is None or self.clawed_back else self.locked


@dataclass(frozen=True)
class ReportRequest:
    """One received request, as every finance report reads it. `table` / `round2_table` are its program's award
    and Round 2 tables under the season's rules ("" when none); `pool` its home pool (None when unknown);
    `grants` the counting outside grants placed on it (the grants register, D55, D116)."""

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

    def asked(self, rounds: Iterable[int] = REPORT_ROUNDS) -> Decimal | None:
        """The asks as keyed on the rounds named, summed (D80's "asked $"); None when none of them has one."""
        asks = [facts.ask for n in rounds if (facts := self.round(n)) is not None and facts.ask is not None]
        return sum(asks, ZERO) if asks else None


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
    return [r for r in requests if any((f := r.round(n)) is not None and f.ask is not None for n in (2, 3))]
