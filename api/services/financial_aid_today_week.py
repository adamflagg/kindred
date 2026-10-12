"""Today's This week (spec 2026-10-10 §8): a read of its own, so the to-dos never wait on it or fail with it.

Figures run Monday through today against the same weekdays of last week. The feed is the latest six events the caller
may see; development's carries grant postings (funder and amount) and funder edits only, and no household id, family
name, camper name or request id (§9.4). Every datetime becomes camp time before it is read as a date."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Final, Literal

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_surfaces import (
    TodayWeekResponse,
    WeekFeedKind,
    WeekFeedOut,
    WeekFigureOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import DecisionsStore
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import OneGrantsLoad
from api.services.financial_aid_household_page import HouseholdLabeler
from api.services.financial_aid_intake_types import RequestRecord
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from api.services.financial_aid_today import WAITING_TOO_LONG_DAYS, GrantsReads, RulesDrafts, week_start
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent
from bunking.financial_aid.scenarios.describe import CARD_TITLES

FEED_SIZE: Final = 6
AWARDS_TITLE: Final = (
    "Camp offers posted plus outside grants recorded, counted together the way the headline counts awards."
)


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


def _figure(
    key: str, label: str, value: float, previous: float, unit: str = "count", title: str = "", note: str = ""
) -> WeekFigureOut:
    return WeekFigureOut(key=key, label=label, value=value, previous=previous, unit=unit, title=title, note=note)


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


def _finance(
    windows: _Counted, events: Sequence[DecisionEvent], request_household: Mapping[str, int]
) -> list[WeekFigureOut]:
    """You approved, Avg award and Families helped. "Posted in CM" is not here: it is the budget's Posted by week, so it
    is counted from the budget's own rows in the Today read (TodayResponse.posted_this_week)."""

    def of(kind: str) -> tuple[list[DecisionEvent], list[DecisionEvent]]:
        return windows.split((e for e in events if e.kind == kind), lambda e: _day(e.created))

    approved, approved_before = of("approve")
    posts, posts_before = of("post")

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
            # spec §7.2: "with {n} req"; nothing approved yet this week says nothing
            note=f"{n} req" if (n := len({e.request_id for e in approved})) else "",
        ),
        _figure("avg", "Avg award", average(posts), average(posts_before), "dollars"),
        _figure("helped", "Families helped so far", helped(windows.this_end), helped(windows.last_end)),
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
        # Ruling 15: every award, camp aid and outside grants together, as the headline counts them.
        _figure(
            "awards",
            "Awards",
            len(posts) + len(now),
            len(posts_before) + len(before),
            title=AWARDS_TITLE,
        ),
        _figure(
            "funders_edited",
            "Funders edited",
            len({r.entity_id for r in edits}),
            len({r.entity_id for r in edits_before}),
        ),
    ]


# The Waiting line is overdue past WAITING_TOO_LONG_DAYS (`> 14`), so the item is stamped on the day after the 14th.
OVERDUE_STAMP: Final = timedelta(days=WAITING_TOO_LONG_DAYS + 1)


def _overdue(events: Sequence[DecisionEvent], windows: _Counted, now: datetime) -> list[tuple[DecisionEvent, datetime]]:
    """Posts with no later accept or unpost for the same request and round, stamped when the Waiting line counts them
    overdue (post + 15 days), whose stamp falls in this week and is not later than now."""
    ordered = sorted(events, key=lambda e: e.created)
    last_post: dict[tuple[str, int], DecisionEvent] = {}
    for event in ordered:
        key = (event.request_id, event.round)
        if event.kind == "post":
            last_post[key] = event
        elif event.kind in ("accept", "unpost"):
            last_post.pop(key, None)
    due = [(e, e.created + OVERDUE_STAMP) for e in last_post.values()]
    return [(e, at) for e, at in due if at <= now and _in(_day(at), windows.this_start, windows.this_end)]


def _funder_name(row: LogRow, names: Mapping[str, str]) -> str:
    for side in (row.after, row.before):
        if side and side.get("name"):
            return str(side["name"])
    return names.get(row.entity_id, "A funder")


UNMATCHED: Final = "Unmatched"  # a grant whose description names no funder yet (audit R25: never "A funder")
HrefKind = Literal["household", "funders", "rules", "none"]


@dataclass(frozen=True)
class _Item:
    """A feed item before its household is named: `words` makes the line from the household's name (or from nothing,
    for an item with no household), and the name is the item's link (`linked`)."""

    kind: WeekFeedKind
    at: datetime
    words: Callable[[str], str]
    household: int | None = None
    href_kind: HrefKind = "none"
    name: str = ""  # the link's words when they do not come from a household (a funder, a rules section)


def _fmt(template: str, **fixed: str | int) -> Callable[[str], str]:
    """An item's words with its name (`{n}`) still to come: the household is named only once the item is kept."""
    return lambda name: template.format(n=name, **fixed)


def _section_items(version: RulesVersion | None, windows: _Counted) -> list[_Item]:
    """Spec §8.1 ✎: each rules section saved as a draft, or approved, this week, named as the Rules tab names it."""
    if version is None:
        return []
    items: list[_Item] = []
    for section, status in version.section_status.items():
        title = CARD_TITLES.get(section, section)
        for at, verb in ((status.edited_at, "saved as a draft"), (status.approved_at, "approved")):
            if at is not None and _in(_day(at), windows.this_start, windows.this_end):
                items.append(_Item("section", at, _fmt("{n} section {v}", v=verb), href_kind="rules", name=title))
    return items


class TodayWeekService:
    def __init__(
        self,
        *,
        store: DecisionsStore,
        grants: GrantsReads,
        labels: HouseholdLabeler | None = None,
        rules: RulesDrafts | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        """`labels`: the household page's label helper, naming a feed item's household as the grid does (audit R24);
        None: its family name. `rules`: the rules draft, for finance's section edits (spec §8.1 ✎)."""
        self._store = store
        self._grants = grants
        self._labels = labels
        self._rules = rules
        self._clock = clock or (lambda: datetime.now(UTC))

    async def read(self, year: int, *, casework: bool, finance: bool, development: bool) -> TodayWeekResponse:
        now = self._clock()
        today = _day(now)
        windows = _Counted(today)
        families = casework or finance  # family-level data, and the names that come with it
        shared = OneGrantsLoad(self._grants, year)
        (_, register), events, requests, funder_log, grantors, rules = await asyncio.gather(
            shared.read(),
            self._store.fetch_decision_events(year),
            self._store.fetch_requests(year) if families else _none(),
            self._store.fetch_change_log(year, AID_GRANTORS),
            self._grants.list_grantors(include_retired=True),
            self._latest_rules(year) if finance else _no_rules(),
        )
        request_household = {r.id: r.household_cm_id for r in requests}
        grantor_names = {g.key: g.name for g in grantors.grantors}

        kept = self._feed(
            windows,
            now,
            events,
            register,
            funder_log,
            request_household,
            grantor_names,
            families=families,
            development=development,
            finance=finance,
            sections=_section_items(rules, windows),
        )
        households = {i.household for i in kept if i.household is not None}
        names = await self._names(year, households) if families and households else {}
        feed = [_out(item, names) for item in kept]
        return TodayWeekResponse(
            year=year,
            week_of=windows.this_start,
            registrar=_registrar(windows, events, register, request_household) if casework else None,
            finance=_finance(windows, events, request_household) if finance else None,
            development=_development(windows, events, register, funder_log) if development else None,
            feed=feed,
        )

    async def _latest_rules(self, year: int) -> RulesVersion | None:
        if self._rules is None:
            return None
        try:
            return await self._rules.load(year)
        except RulesNotFoundError:
            return None

    async def _names(self, year: int, households: set[int]) -> dict[int, str]:
        """The households the kept items name, as the grid names them (household_labels, the tie-break scoped to
        them); without a labeler, or for a household the helper does not name, the family name."""
        found, _ = await self._store.fetch_names(year, households, set())
        named = dict(found)
        if self._labels is not None:
            for household, label in (await self._labels(year, households)).items():
                text = f"{label.label} ({label.tiebreak})" if label.tiebreak else label.label
                named[household] = text or named.get(household, "")
        return named

    @staticmethod
    def _feed(
        windows: _Counted,
        now: datetime,
        events: Sequence[DecisionEvent],
        register: Sequence[RegisterRow],
        funder_log: Sequence[LogRow],
        request_household: Mapping[str, int],
        grantor_names: Mapping[str, str],
        *,
        families: bool,
        finance: bool,
        development: bool,
        sections: Sequence[_Item] = (),
    ) -> list[_Item]:
        """The latest six items, newest first, before their households are named (only the kept ones are)."""
        items: list[_Item] = list(sections) if finance else []

        def at_home(request_id: str) -> tuple[int | None, HrefKind]:
            household = request_household.get(request_id)
            return household, "household" if household is not None else "none"

        if families:
            for event in events:
                household, href = at_home(event.request_id)
                round_, money = event.round, _money(_amount(event))
                if event.kind == "post":
                    items.append(
                        _Item(
                            "posted", event.created, _fmt("{n} · R{r} posted · {m}", r=round_, m=money), household, href
                        )
                    )
                elif event.kind == "accept":
                    items.append(_Item("accepted", event.created, _fmt("{n} accepted the offer"), household, href))
                elif event.kind == "approve" and finance:
                    items.append(
                        _Item(
                            "approved",
                            event.created,
                            _fmt("Approved {n} · R{r} · {m}", r=round_, m=money),
                            household,
                            href,
                        )
                    )
            for event, at in _overdue(events, windows, now):
                household, href = at_home(event.request_id)
                items.append(
                    _Item("overdue", at, _fmt(f"{{n}} passed {WAITING_TOO_LONG_DAYS} days waiting"), household, href)
                )
        if families or development:  # a caller with no section sees no funder or grant item
            for row in _live_grants(register):
                grantor = grantor_names.get(row.grantor_key, UNMATCHED)
                at = row.recorded_at or now
                if families:
                    items.append(
                        _Item(
                            "grant", at, _fmt("{g} grant entered for {n}", g=grantor), row.household_cm_id, "household"
                        )
                    )
                else:  # the mock: development's grant lines are plain, and name no family (§9.4)
                    items.append(_Item("grant", at, _fmt("{g} grant · {m} posted", g=grantor, m=_money(row.amount))))
            for log in funder_log:
                funder = _funder_name(log, grantor_names)
                items.append(_Item("funder", log.created, _fmt("{n} updated"), None, "funders", funder))
        items.sort(key=lambda i: i.at, reverse=True)
        return items[:FEED_SIZE]


def _out(item: _Item, names: Mapping[int, str]) -> WeekFeedOut:
    """The item's words, its household named (`names`), and the words that are its link."""
    name = item.name
    if item.household is not None:
        name = names.get(item.household, "") or "Unknown"
    elif item.kind in {"posted", "accepted", "approved", "overdue"}:
        name = "Unknown"
    words = item.words(name)
    linked = name if item.href_kind != "none" else ""
    return WeekFeedOut(
        kind=item.kind,
        at=item.at,
        words=words,
        name=linked,
        household_cm_id=item.household,
        href_kind=item.href_kind,
    )


async def _none() -> list[RequestRecord]:
    return []


async def _no_rules() -> RulesVersion | None:
    return None
