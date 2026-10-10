"""Today's This week (spec 2026-10-10 §8): a read of its own, so the to-dos never wait on it or fail with it.

Figures run Monday through today against the same weekdays of last week. The feed is the latest six events the caller
may see; development's carries grant postings (funder and amount) and funder edits only, and no household id, family
name, camper name or request id (§9.4). Every datetime becomes camp time before it is read as a date."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Final

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_surfaces import (
    TodayWeekResponse,
    WeekFeedOut,
    WeekFigureOut,
    WeekPointOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import DecisionsStore
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import OneGrantsLoad
from api.services.financial_aid_intake_types import RequestRecord
from api.services.financial_aid_today import WAITING_TOO_LONG_DAYS, GrantsReads, week_start
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent

FEED_SIZE: Final = 6


def _day(moment: datetime) -> date:
    return moment.astimezone(CAMP_TZ).date()


def _money(amount: Decimal | float) -> str:
    value = Decimal(str(amount))
    return f"${value:,.0f}" if value == value.to_integral_value() else f"${value:,.2f}"


def _in(day: date, start: date, end: date) -> bool:
    return start <= day <= end


def _window(today: date) -> tuple[date, date, date, date]:
    """(this week's start, its end, last week's start, last week's end): the same weekdays, so a Wednesday compares
    Monday through Wednesday with Monday through Wednesday."""
    this_start = week_start(today)
    last_start = this_start - timedelta(days=7)
    return this_start, today, last_start, last_start + (today - this_start)


def _figure(key: str, label: str, value: float, previous: float, unit: str = "count") -> WeekFigureOut:
    return WeekFigureOut(key=key, label=label, value=value, previous=previous, unit=unit)


class _Counted:
    """The two windows over one list of dated items."""

    def __init__(self, today: date) -> None:
        self.this_start, self.this_end, self.last_start, self.last_end = _window(today)

    def split[T](self, items: Iterable[T], when: Callable[[T], date]) -> tuple[list[T], list[T]]:
        items = list(items)
        return (
            [i for i in items if _in(when(i), self.this_start, self.this_end)],
            [i for i in items if _in(when(i), self.last_start, self.last_end)],
        )


def _amount(event: DecisionEvent) -> Decimal:
    return event.amount or Decimal(0)


def _live_grants(register: Iterable[RegisterRow]) -> list[RegisterRow]:
    return [r for r in register if r.counts and not r.is_reversed and r.recorded_at is not None]


def _recorded_day(row: RegisterRow) -> date:
    # _live_grants keeps only dated rows
    return _day(row.recorded_at) if row.recorded_at is not None else date.min


def _registrar(
    windows: _Counted,
    events: Sequence[DecisionEvent],
    register: Sequence[RegisterRow],
    request_household: Mapping[str, int],
) -> list[WeekFigureOut]:
    def by_kind(*kinds: str) -> tuple[list[DecisionEvent], list[DecisionEvent]]:
        return windows.split((e for e in events if e.kind in kinds), lambda e: _day(e.created))

    posted, posted_before = by_kind("post")
    accepted, accepted_before = by_kind("accept")
    cleared, cleared_before = by_kind("post", "approve", "refuse")
    grants, grants_before = windows.split(_live_grants(register), _recorded_day)

    def households(items: Sequence[DecisionEvent]) -> int:
        return len({request_household.get(e.request_id, e.request_id) for e in items})

    return [
        _figure("posted", "Offers posted", len(posted), len(posted_before)),
        _figure("answered", "Families answered", households(accepted), households(accepted_before)),
        _figure("grants", "Grants entered", len(grants), len(grants_before)),
        _figure("cleared", "Queue cleared", len(cleared), len(cleared_before)),
    ]


def _posted_dollars(events: Iterable[DecisionEvent]) -> Decimal:
    return sum(
        (_amount(e) if e.kind == "post" else -_amount(e) for e in events if e.kind in ("post", "unpost")), Decimal(0)
    )


def _finance(
    windows: _Counted, events: Sequence[DecisionEvent], request_household: Mapping[str, int]
) -> list[WeekFigureOut]:
    def of(kind: str) -> tuple[list[DecisionEvent], list[DecisionEvent]]:
        return windows.split((e for e in events if e.kind == kind), lambda e: _day(e.created))

    approved, approved_before = of("approve")
    posts, posts_before = of("post")
    moved, moved_before = windows.split((e for e in events if e.kind in ("post", "unpost")), lambda e: _day(e.created))

    def average(items: Sequence[DecisionEvent]) -> float:
        return float(sum((_amount(e) for e in items), Decimal(0)) / len(items)) if items else 0.0

    def helped(until: date) -> int:
        return len(
            {
                request_household.get(e.request_id, e.request_id)
                for e in events
                if e.kind == "post" and _day(e.created) <= until
            }
        )

    return [
        _figure(
            "approved",
            "You approved",
            float(sum((_amount(e) for e in approved), Decimal(0))),
            float(sum((_amount(e) for e in approved_before), Decimal(0))),
            "dollars",
        ),
        _figure(
            "posted_cm", "Posted in CM", float(_posted_dollars(moved)), float(_posted_dollars(moved_before)), "dollars"
        ),
        _figure("avg", "Avg award", average(posts), average(posts_before), "dollars"),
        _figure("helped", "Families helped", helped(windows.this_end), helped(windows.last_end)),
    ]


def _development(
    windows: _Counted, events: Sequence[DecisionEvent], register: Sequence[RegisterRow], funder_log: Sequence[LogRow]
) -> list[WeekFigureOut]:
    outside = [r for r in _live_grants(register) if r.funder_type == "outside"]
    now, before = windows.split(outside, _recorded_day)
    posts, posts_before = windows.split((e for e in events if e.kind == "post"), lambda e: _day(e.created))
    edits, edits_before = windows.split(funder_log, lambda r: _day(r.created))

    def dollars(rows: Sequence[RegisterRow]) -> float:
        return float(sum((r.amount for r in rows), Decimal(0)))

    return [
        _figure("outside_in", "Outside grants in", dollars(now), dollars(before), "dollars"),
        _figure("awards", "Awards", len(posts), len(posts_before)),
        _figure(
            "funders_edited",
            "Funders edited",
            len({r.entity_id for r in edits}),
            len({r.entity_id for r in edits_before}),
        ),
    ]


def _posted_by_week(events: Sequence[DecisionEvent], today: date) -> list[WeekPointOut]:
    """Cumulative posted camp money at the end of each week, from the first week with any post through this one."""
    per_week: dict[date, Decimal] = defaultdict(Decimal)
    for event in events:
        if event.kind in ("post", "unpost"):
            sign = 1 if event.kind == "post" else -1
            per_week[week_start(_day(event.created))] += sign * _amount(event)
    if not any(e.kind == "post" for e in events):
        return []
    cursor, last = min(per_week), week_start(today)
    points: list[WeekPointOut] = []
    running = Decimal(0)
    while cursor <= last:
        running += per_week.get(cursor, Decimal(0))
        points.append(WeekPointOut(week_of=cursor, posted=float(running)))
        cursor += timedelta(days=7)
    return points


def _overdue(events: Sequence[DecisionEvent], windows: _Counted) -> list[tuple[DecisionEvent, datetime]]:
    """Posts with no later accept or unpost for the same request and round, whose 14th day falls in this week."""
    ordered = sorted(events, key=lambda e: e.created)
    last_post: dict[tuple[str, int], DecisionEvent] = {}
    for event in ordered:
        key = (event.request_id, event.round)
        if event.kind == "post":
            last_post[key] = event
        elif event.kind in ("accept", "unpost"):
            last_post.pop(key, None)
    due = [(e, e.created + timedelta(days=WAITING_TOO_LONG_DAYS)) for e in last_post.values()]
    return [(e, at) for e, at in due if _in(_day(at), windows.this_start, windows.this_end)]


def _funder_name(row: LogRow, names: Mapping[str, str]) -> str:
    for side in (row.after, row.before):
        if side and side.get("name"):
            return str(side["name"])
    return names.get(row.entity_id, "A funder")


class TodayWeekService:
    def __init__(
        self, *, store: DecisionsStore, grants: GrantsReads, clock: Callable[[], datetime] | None = None
    ) -> None:
        self._store = store
        self._grants = grants
        self._clock = clock or (lambda: datetime.now(UTC))

    async def read(self, year: int, *, casework: bool, finance: bool, development: bool) -> TodayWeekResponse:
        today = _day(self._clock())
        windows = _Counted(today)
        families = casework or finance  # family-level data, and the names that come with it
        shared = OneGrantsLoad(self._grants, year)
        (_, register), events, requests, funder_log, grantors = await asyncio.gather(
            shared.read(),
            self._store.fetch_decision_events(year),
            self._store.fetch_requests(year) if families else _none(),
            self._store.fetch_change_log(year, AID_GRANTORS),
            self._grants.list_grantors(include_retired=True),
        )
        request_household = {r.id: r.household_cm_id for r in requests}
        names: Mapping[int, str] = {}
        if families:
            names, _ = await self._store.fetch_names(
                year, set(request_household.values()) | {r.household_cm_id for r in register}, set()
            )
        grantor_names = {g.key: g.name for g in grantors.grantors}

        feed = self._feed(
            windows,
            events,
            register,
            funder_log,
            request_household,
            names,
            grantor_names,
            families=families,
            finance=finance,
        )
        return TodayWeekResponse(
            year=year,
            week_of=windows.this_start,
            registrar=_registrar(windows, events, register, request_household) if casework else None,
            finance=_finance(windows, events, request_household) if finance else None,
            development=_development(windows, events, register, funder_log) if development else None,
            feed=feed,
            posted_by_week=_posted_by_week(events, today) if finance else None,
        )

    @staticmethod
    def _feed(
        windows: _Counted,
        events: Sequence[DecisionEvent],
        register: Sequence[RegisterRow],
        funder_log: Sequence[LogRow],
        request_household: Mapping[str, int],
        names: Mapping[int, str],
        grantor_names: Mapping[str, str],
        *,
        families: bool,
        finance: bool,
    ) -> list[WeekFeedOut]:
        items: list[WeekFeedOut] = []

        def family(request_id: str) -> tuple[int | None, str]:
            household = request_household.get(request_id)
            return household, names.get(household, "Unknown") if household is not None else "Unknown"

        if families:
            for event in events:
                household, name = family(event.request_id)
                if event.kind == "post":
                    words = f"{name} household · R{event.round} posted · {_money(_amount(event))}"
                    items.append(
                        WeekFeedOut(
                            kind="posted",
                            at=event.created,
                            words=words,
                            household_cm_id=household,
                            href_kind="household",
                        )
                    )
                elif event.kind == "accept":
                    items.append(
                        WeekFeedOut(
                            kind="accepted",
                            at=event.created,
                            words=f"{name} household accepted the offer",
                            household_cm_id=household,
                            href_kind="household",
                        )
                    )
                elif event.kind == "approve" and finance:
                    words = f"Approved {name} household · R{event.round} · {_money(_amount(event))}"
                    items.append(
                        WeekFeedOut(
                            kind="approved",
                            at=event.created,
                            words=words,
                            household_cm_id=household,
                            href_kind="household",
                        )
                    )
            for event, at in _overdue(events, windows):
                household, name = family(event.request_id)
                items.append(
                    WeekFeedOut(
                        kind="overdue",
                        at=at,
                        words=f"{name} household passed {WAITING_TOO_LONG_DAYS} days waiting",
                        household_cm_id=household,
                        href_kind="household",
                    )
                )
        for row in _live_grants(register):
            grantor = grantor_names.get(row.grantor_key, "A funder")
            if families:
                name = names.get(row.household_cm_id, "Unknown")
                items.append(
                    WeekFeedOut(
                        kind="grant",
                        at=row.recorded_at,
                        words=f"{grantor} grant entered for {name} household",
                        household_cm_id=row.household_cm_id,
                        href_kind="household",
                    )
                )
            else:
                items.append(
                    WeekFeedOut(
                        kind="grant",
                        at=row.recorded_at,
                        words=f"{grantor} grant · {_money(row.amount)} posted",
                        href_kind="funders",
                    )
                )
        items.extend(
            WeekFeedOut(
                kind="funder",
                at=log.created,
                words=f"{_funder_name(log, grantor_names)} updated",
                href_kind="funders",
            )
            for log in funder_log
        )
        items.sort(key=lambda i: i.at, reverse=True)
        return items[:FEED_SIZE]


async def _none() -> list[RequestRecord]:
    return []
