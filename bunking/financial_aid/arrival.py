"""Last year's arrival curve, and the season projected on it (Scenarios addendum §S11.7; owner §S15 items 1-3).
Pure (it reads only camp_calendar's stdlib helpers).

The curve is how much of a season's applications had arrived by the end of each week, counted in whole weeks from
that season's approved application deadline, the way the registration metrics line years up by weeks from the
priority registration date (owner: "x weeks line up by deadline just like we do year over year for metrics based on
priority reg date"). The week arithmetic is camp_calendar.camp_week_offset, reused rather than copied: 0-based, floor
division, signed. The deadline's own week is 0 (the deadline day and the six after it); week −1 is the seven days
before. velocity_service._week_number is NOT used: it is 1-based and piles every pre-anchor day into one bucket,
and nearly all aid arrives before the deadline.

A year with no deadline lines up from Jan 1 and is stored as "calendar"; it is read against Jan 1 of the season
being modelled. A season with no approved deadline is never projected on a deadline-aligned curve: there is no
silent calendar switch (the service decides that).

Stored per season: the weeks, the cumulative shares, `counted`, the anchor, the alignment and the source. No family
data, no names, no row-level timestamps.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final, Literal

from api.services.camp_calendar import CAMP_TZ, camp_week_offset, get_camp_date
from bunking.financial_aid.money import ONE, ZERO
from bunking.financial_aid.scenarios import ScenarioResults

AlignedOn = Literal["application_deadline", "calendar"]
CurveSource = Literal["workbook", "received"]

_SHARE: Final = Decimal("0.0001")
_CENT: Final = Decimal("0.01")
_WEEK: Final = Decimal(7)


@dataclass(frozen=True)
class CurvePoint:
    week: int  # camp_week_offset from the anchor
    share: Decimal  # cumulative, at the week's end (anchor + 7 × week + 6 days), 4 decimals


@dataclass(frozen=True)
class ArrivalCurve:
    year: int  # the season whose applications made it
    aligned_on: AlignedOn
    anchor: date  # that season's approved deadline, or Jan 1 for "calendar"
    points: tuple[CurvePoint, ...]
    counted: int
    source: CurveSource  # "workbook" (a one-off load) or "received" (the dashboard's own received dates)


@dataclass(frozen=True)
class PoolProjection:
    pool: str
    remaining: Decimal | None  # the pool's Allocated − its committed ÷ the share; None with no allocation


@dataclass(frozen=True)
class Projection:
    share: Decimal  # last year's share in by this point
    through: date  # the day it was read for: the Price ▾ date, else the held pile's day
    basis_year: int
    aligned_on: AlignedOn
    requests: int
    round1: Decimal
    round1_and_2: Decimal
    remaining: Decimal | None  # Allocated (total) − (Round 1 + 2 + 3) ÷ the share
    pools: tuple[PoolProjection, ...]


def calendar_anchor(year: int) -> date:
    return date(year, 1, 1)


def camp_date_of(moment: datetime) -> date:
    """A moment's camp day (the 9 am Pacific boundary the registration metrics use). A naive moment, a workbook
    cell, is Pacific wall-clock time; an aware one, a log row's UTC, is converted. Both sources count a day alike."""
    aware = moment.replace(tzinfo=CAMP_TZ) if moment.tzinfo is None else moment
    return get_camp_date(aware.astimezone(UTC))


def curve_from_dates(
    dates: Iterable[date],
    anchor: date,
    *,
    year: int,
    source: CurveSource,
    aligned_on: AlignedOn = "application_deadline",
) -> ArrivalCurve:
    """Cumulative shares at each week's end, from the first week with an arrival to the last, every week between
    listed (a quiet week repeats the share before it)."""
    weeks = Counter(camp_week_offset(day, anchor) for day in dates)
    counted = sum(weeks.values())
    if counted == 0:
        raise ValueError("An arrival curve needs at least one dated application")
    points: list[CurvePoint] = []
    seen = 0
    for week in range(min(weeks), max(weeks) + 1):
        seen += weeks.get(week, 0)
        points.append(CurvePoint(week, (Decimal(seen) / Decimal(counted)).quantize(_SHARE, rounding=ROUND_HALF_UP)))
    return ArrivalCurve(year, aligned_on, anchor, tuple(points), counted, source)


def _by_end_of(curve: ArrivalCurve, week: int) -> Decimal:
    """The share in by the end of `week`: 0 before the first point, 1 after the last, else the newest point at or
    before it (a stored curve need not list every week)."""
    if not curve.points or week < curve.points[0].week:
        return ZERO
    if week > curve.points[-1].week:
        return ONE
    return next(point.share for point in reversed(curve.points) if point.week <= week)


def share_by(curve: ArrivalCurve, on: date, anchor: date) -> Decimal | None:
    """Last season's share in by the same point: week w = camp_week_offset(on, anchor), day d = its day in that
    week; the share between the end of week w−1 and the end of week w, (d + 1) ÷ 7 of the way. None at 0: nothing
    can be divided by it."""
    week = camp_week_offset(on, anchor)
    day = (on - anchor).days % 7
    before, after = _by_end_of(curve, week - 1), _by_end_of(curve, week)
    share = (before + (after - before) * Decimal(day + 1) / _WEEK).quantize(_SHARE, rounding=ROUND_HALF_UP)
    return share if share > 0 else None


def _cents(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def project(
    results: ScenarioResults, share: Decimal, *, through: date, basis_year: int, aligned_on: AlignedOn
) -> Projection:
    """Every figure ÷ the share, as if the rest arrive like last year's and are priced like those already in (§S11.7):
    cents half up, the request count to the nearest whole, half up. The same formulas run after the lock; the screen
    dims the line then."""

    def left(allocated: Decimal | None, spent: Decimal) -> Decimal | None:
        return None if allocated is None else _cents(allocated - spent / share)

    return Projection(
        share=share,
        through=through,
        basis_year=basis_year,
        aligned_on=aligned_on,
        requests=int((Decimal(results.requests) / share).quantize(ONE, rounding=ROUND_HALF_UP)),
        round1=_cents(results.round1 / share),
        round1_and_2=_cents((results.round1 + results.round2) / share),
        remaining=left(results.round1_allocated, results.round1 + results.round2 + results.round3),
        pools=tuple(
            PoolProjection(pool.pool, left(pool.round1_allocated, pool.round1 + pool.round2 + pool.round3))
            for pool in results.pools
        ),
    )


def points_json(curve: ArrivalCurve) -> list[dict[str, Any]]:
    return [{"week": point.week, "share": str(point.share)} for point in curve.points]


def points_from_json(raw: Any) -> tuple[CurvePoint, ...]:
    return tuple(CurvePoint(int(item["week"]), Decimal(str(item["share"]))) for item in raw or ())
