"""Payer shares: who pays the family's part of a request (spec 5, 9.2; owner rulings 2026-09-25).

A share is a CampMinder household and a PERCENTAGE of the request, nothing else. The
award is priced once, on the application the request belongs to; shares only decide who
is posted what. Dollars are never stored: split_award computes them from the current
award wherever a share is shown, so an appeal or a top-up recomputes them while the
percentages stay. Sub-projects 10 and 11 reuse split_award for decisions and posting lines.

* A request's shares must add to exactly 100%, or it holds ("incomplete").
* Setting one household's % beside exactly one other share sets that share to the
  remainder (fill_remainder). With three or more, staff balance them.
* Shares are entered as a % only (owner ruling 2026-10-02); there is no dollar entry.

Percentages carry up to four decimals, so split_award's dollars are stable to the cent.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Final, Literal, Protocol

MAX_SHARES: Final = 10
HUNDRED: Final = Decimal(100)
PCT_PLACES: Final = Decimal("0.0001")
_CENT: Final = Decimal("0.01")
_DOLLAR: Final = Decimal(1)

ShareStatus = Literal["complete", "incomplete"]


class PayerShareError(ValueError):
    """Shares that cannot be stored or split; the message is safe to show staff."""


class _Share(Protocol):
    @property
    def household_cm_id(self) -> int: ...

    @property
    def share_pct(self) -> Decimal: ...


@dataclass(frozen=True)
class ShareSpec:
    household_cm_id: int
    share_pct: Decimal


def _check_pct(pct: Decimal) -> None:
    if not (0 < pct <= HUNDRED) or pct != pct.quantize(PCT_PLACES):
        raise PayerShareError("a share is above 0% and at most 100%, with at most four decimals")


def validate_shares(shares: Sequence[ShareSpec]) -> None:
    if not shares:
        raise PayerShareError("a request needs at least one payer share")
    if len(shares) > MAX_SHARES:
        raise PayerShareError(f"at most {MAX_SHARES} payer shares")
    households = [s.household_cm_id for s in shares]
    if len(set(households)) != len(households):
        raise PayerShareError("each household may hold only one share of a request")
    for share in shares:
        if share.household_cm_id <= 0:
            raise PayerShareError("a share names a CampMinder household")
        _check_pct(share.share_pct)


def share_status(shares: Sequence[_Share]) -> ShareStatus:
    total = sum((s.share_pct for s in shares), Decimal(0))
    return "complete" if shares and total == HUNDRED else "incomplete"


def fill_remainder(existing: Sequence[_Share], household_cm_id: int, pct: Decimal) -> list[ShareSpec]:
    """Set one household's share. With exactly one other share, that one becomes the
    remainder (and is dropped at 0). With none, the household stands alone. With two or
    more others, they are left as they are: staff balance them, and the request holds
    until they add to 100%."""
    _check_pct(pct)
    others = [ShareSpec(s.household_cm_id, s.share_pct) for s in existing if s.household_cm_id != household_cm_id]
    if len(others) == 1:
        remainder = HUNDRED - pct
        others = [ShareSpec(others[0].household_cm_id, remainder)] if remainder > 0 else []
    return sorted([*others, ShareSpec(household_cm_id, pct)], key=lambda s: s.household_cm_id)


def split_award(award: Decimal, shares: Sequence[_Share], application_household_cm_id: int) -> dict[int, Decimal]:
    """Whole dollars per household, adding up exactly to `award` (awards are whole dollars).

    Every share but one gets its exact part rounded to the cent, then down to the dollar.
    The application's own household takes the rest, so any remainder dollar is theirs;
    if it holds no share, the largest share does (ties: the lowest household id)."""
    if share_status(shares) != "complete":
        raise PayerShareError("the payer shares do not add up to 100%")
    if any(s.household_cm_id == application_household_cm_id for s in shares):
        taker = application_household_cm_id
    else:
        taker = max(shares, key=lambda s: (s.share_pct, -s.household_cm_id)).household_cm_id
    amounts: dict[int, Decimal] = {}
    for share in shares:
        if share.household_cm_id != taker:
            exact = (award * share.share_pct / HUNDRED).quantize(_CENT, rounding=ROUND_HALF_UP)
            amounts[share.household_cm_id] = exact.quantize(_DOLLAR, rounding=ROUND_FLOOR)
    amounts[taker] = award - sum(amounts.values(), Decimal(0))
    return amounts
