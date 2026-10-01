"""Each payer's whole-dollar part of a request's money (main spec §5, §11; D81; ⚠39, owner ruling 2026-10-01).
The Requests grid's split rows and the household page's share table both split here, so a share reads the same
on both. Dollars are never stored: they come from the request's figures and the payer percentages
(financial_aid_payer_shares.split_award)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Final

from api.schemas.financial_aid_decisions import GridRowOut, GridShareOut, RoundOut
from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_payer_shares import PayerShareError, split_award

_ZERO: Final = Decimal(0)


def dollars(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def payers(request_id: str, applicant: int, shares: Sequence[PayerShareRecord]) -> Sequence[PayerShareRecord]:
    """The request's payer shares; with no share row, the applying household pays it all (request_scope's reading)."""
    if shares:
        return shares
    implied = PayerShareRecord(
        id="",
        year=0,
        request_id=request_id,
        household_cm_id=applicant,
        share_pct=Decimal(100),
        source="implied",
        actor="",
    )
    return (implied,)


def split(total: Decimal | None, shares: Sequence[PayerShareRecord], applicant: int) -> dict[int, Decimal]:
    """Each payer's whole-dollar part of `total` (split_award); nothing while there is no total or the shares don't
    add up to 100%."""
    if total is None:
        return {}
    try:
        return split_award(total, shares, applicant)
    except PayerShareError:
        return {}


def _open_rounds(row: GridRowOut) -> list[RoundOut]:
    """The rounds that need an offer. Whether there are any is a question about rounds, never about money: a $0 round
    is a real zero (D74) and still needs its offer."""
    return [r for r in row.rounds if r.status == "needs_offer" and r.decided is not None]


def grid_shares(row: GridRowOut, shares: Sequence[PayerShareRecord], families: Mapping[int, str]) -> list[GridShareOut]:
    """One line per payer when two or more households pay the request, the applicant first, then by household; []
    for one payer. A payer's Needs an offer part is its share of the decided total less its share of the total before
    the open rounds (Decision 3): what its CampMinder total moves by when they post, which is what reconciliation then
    expects of it, and the parts add up to the rounds' amount exactly."""
    if len(shares) < 2:
        return []
    applicant = row.household_cm_id
    total = dollars(row.total_decided)
    open_rounds = _open_rounds(row)
    has_open = any(r.status == "needs_offer" for r in open_rounds)  # a question about rounds, not money (D74)
    open_money = sum((Decimal(str(r.decided)) for r in open_rounds), _ZERO)
    after = split(total, shares, applicant)
    # Decision 3: "before" is total_decided less the open rounds, the posted total only while no round was clawed back.
    before = split(total - open_money, shares, applicant) if total is not None and has_open else {}
    posted = split(dollars(row.total_posted), shares, applicant)
    out: list[GridShareOut] = []
    for share in sorted(shares, key=lambda s: (s.household_cm_id != applicant, s.household_cm_id)):
        h = share.household_cm_id
        mine = after.get(h)
        part = mine - before[h] if mine is not None and h in before else None
        held = posted.get(h)
        out.append(
            GridShareOut(
                household_cm_id=h,
                family_name=families.get(h, f"Household {h}"),
                share_pct=float(share.share_pct),
                decided=money(mine) if mine is not None else None,
                posted=money(held) if held is not None else None,
                needs_offer=money(part) if part is not None else None,
            )
        )
    return out
