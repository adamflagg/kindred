"""Today's This week (spec 2026-10-10 §8): a read of its own, so the to-dos never wait on it or fail with it.

Figures run Monday through today against the same weekdays of last week. The feed is this week's latest six events
the caller may see; development's carries grant postings (funder and amount) and funder edits only, and no household id, family
name, camper name or request id (§9.4). Every datetime becomes camp time before it is read as a date."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Final, Literal

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_decisions import GridRowOut
from api.schemas.financial_aid_surfaces import (
    TodayWeekResponse,
    WeekFeedKind,
    WeekFeedOut,
    WeekFigureOut,
)
from api.services.aid_season_cache import AidSeasonCache
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import DecisionsStore, FinancialAidDecisionsService, PricingRules
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_grants_service import OneGrantsLoad
from api.services.financial_aid_household_page import HouseholdLabeler
from api.services.financial_aid_intake_types import RequestRecord
from api.services.financial_aid_rules_service import RulesNotFoundError, RulesVersion
from api.services.financial_aid_today import (
    WAITING_TOO_LONG_DAYS,
    GrantsReads,
    RulesDrafts,
    waiting_overdue_on,
    week_start,
)
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent
from bunking.financial_aid.reports.development import Awards
from bunking.financial_aid.scenarios.describe import CARD_TITLES

FEED_SIZE: Final = 6
AWARDS_TITLE: Final = (
    "Awards the season gained, counted the way the headline counts them: each camper and session once, the camp's "
    "aid and outside grants together (a grant on a session the camp already posted adds none)."
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


_UNDONE_BY: Final = {"post": "unpost", "accept": "unaccept"}


def _without_undone(events: Sequence[DecisionEvent]) -> list[DecisionEvent]:
    """The events minus every Posted or Accepted tick a later undo took back on the same round (owner, 2026-10-14: a
    tick made by mistake and undone is not this week's news, and a re-tick stands on its own). The undo events stay,
    so a reader that replays a round's standing (development's awards) sees the same history."""
    undos_later: set[tuple[str, int, str]] = set()  # (request, round, undo kind) seen after the current event
    undone: set[str] = set()
    for event in sorted(events, key=lambda e: (e.created, e.id), reverse=True):  # one pass, newest first
        undo = _UNDONE_BY.get(event.kind)
        if undo and (event.request_id, event.round, undo) in undos_later:
            undone.add(event.id)
        elif event.kind in _UNDONE_BY.values():
            undos_later.add((event.request_id, event.round, event.kind))
    return [e for e in events if e.id not in undone]


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


def _awards_by(
    until: date, events: Sequence[DecisionEvent], outside: Sequence[RegisterRow], requests: Mapping[str, RequestRecord]
) -> int:
    """The headline's Grants/Awards (reports.development.Awards: each attendee and session once, any aid) over what
    was known by the end of `until`: the posts standing then (a round's latest post or undo recorded by then), on
    their request's camper and session, and the outside grants recorded by then."""
    standing: dict[tuple[str, int], bool] = {}
    for event in sorted(events, key=lambda e: (e.created, e.id)):
        if event.kind in ("post", "unpost") and _day(event.created) <= until:
            standing[(event.request_id, event.round)] = event.kind == "post"
    awards = Awards()
    for (request_id, _), posted in standing.items():
        request = requests.get(request_id)
        if posted and request is not None:
            awards.add(None, request.person_cm_id, request.household_cm_id, request.session_cm_id)
    for row in outside:
        if _recorded_day(row) <= until:
            awards.add(None, row.person_cm_id, row.household_cm_id, row.session_cm_id)
    return awards.count()


def _development(
    windows: _Counted,
    events: Sequence[DecisionEvent],
    register: Sequence[RegisterRow],
    funder_log: Sequence[LogRow],
    requests: Mapping[str, RequestRecord],
) -> list[WeekFigureOut]:
    outside = [r for r in _live_grants(register) if r.funder_type == "outside"]
    now, before = windows.split(outside, _recorded_day)
    edits, edits_before = windows.split(funder_log, lambda r: _day(r.created))
    one_day = timedelta(days=1)

    def gained(start: date, end: date) -> int:
        """How many awards the season gained from `start` through `end` (final check S1): never negative, as an
        award only joins the count."""
        return _awards_by(end, events, outside, requests) - _awards_by(start - one_day, events, outside, requests)

    def dollars(rows: Sequence[RegisterRow]) -> float:
        return float(sum((r.amount for r in rows), Decimal(0)))

    return [
        _figure("outside_in", "Outside grants in", dollars(now), dollars(before), "dollars"),
        # Ruling 15: every award, camp aid and outside grants together, as the headline counts them.
        _figure(
            "awards",
            "Awards",
            gained(windows.this_start, windows.this_end),
            gained(windows.last_start, windows.last_end),
            title=AWARDS_TITLE,
        ),
        _figure(
            "funders_edited",
            "Funders edited",
            len({r.entity_id for r in edits}),
            len({r.entity_id for r in edits_before}),
        ),
    ]


def _overdue(rows: Sequence[GridRowOut], windows: _Counted, now: datetime) -> list[tuple[GridRowOut, datetime]]:
    """Final check S2: each request the Waiting on the family line counts over 14 days, stamped at camp midnight of the
    day the line first counts it (waiting_overdue_on: the CampMinder post day + 15, on the line's own population),
    when that falls in this week and is not later than now. An undated post (the 2026 reproduced load) is no item."""
    out: list[tuple[GridRowOut, datetime]] = []
    for row in rows:
        day = waiting_overdue_on(row)
        if day is None or not _in(day, windows.this_start, windows.this_end):
            continue
        at = datetime.combine(day, time.min, tzinfo=CAMP_TZ).astimezone(UTC)
        if at <= now:
            out.append((row, at))
    return out


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
    person: int = 0  # the camper a camper request's item names (ruling 18); 0 = a household-level item


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
        pricing: PricingRules,
        labels: HouseholdLabeler | None = None,
        rules: RulesDrafts | None = None,
        clock: Callable[[], datetime] | None = None,
        season_cache: AidSeasonCache | None = None,
    ) -> None:
        """`pricing`: the season's rules, so the waiting-14+-days items are the Waiting on the family line's own rows
        (final check S2). `labels`: the household page's label helper, naming a feed item's household as the grid does
        (audit R24); None: its family name. `rules`: the rules draft, for finance's section edits (spec §8.1 ✎)."""
        self._store = store
        self._grants = grants
        self._pricing = pricing
        self._labels = labels
        self._rules = rules
        self._clock = clock or (lambda: datetime.now(UTC))
        self._season_cache = season_cache  # the live-season cache staff reads share (layer 2)

    async def read(self, year: int, *, casework: bool, finance: bool, development: bool) -> TodayWeekResponse:
        now = self._clock()
        today = _day(now)
        windows = _Counted(today)
        families = casework or finance  # family-level data, and the names that come with it
        shared = OneGrantsLoad(self._grants, year)
        # Development reads the requests only to count awards by camper and session (S1); its feed names none (§9.4).
        # Only family callers price the season (S2's waiting rows).
        # season() must start BEFORE shared.read(): the season cache's stamp depends on that order.
        # (The waiting rows' season() starts here, ahead of the gather's shared.read().)
        waiting_read = asyncio.ensure_future(self._waiting_rows(year, shared) if families else _no_rows())
        (_, register), events, requests, funder_log, grantors, rules = await asyncio.gather(
            shared.read(),
            self._store.fetch_decision_events(year),
            self._store.fetch_requests(year) if families or development else _none(),
            self._store.fetch_change_log(year, AID_GRANTORS),
            self._grants.list_grantors(include_retired=True),
            self._latest_rules(year) if finance else _no_rules(),
        )
        waiting = await waiting_read
        request_household = {r.id: r.household_cm_id for r in requests}
        request_person = {r.id: r.person_cm_id for r in requests}
        grantor_names = {g.key: g.name for g in grantors.grantors}

        standing = _without_undone(events)
        kept = self._feed(
            windows,
            now,
            standing,
            register,
            funder_log,
            request_household,
            grantor_names,
            request_person=request_person,
            waiting=waiting,
            families=families,
            development=development,
            finance=finance,
            sections=_section_items(rules, windows),
        )
        households = {i.household for i in kept if i.household is not None}
        names = await self._names(year, kept) if families and households else _Names({}, {})
        feed = [_out(item, names) for item in kept]
        return TodayWeekResponse(
            year=year,
            week_of=windows.this_start,
            registrar=_registrar(windows, standing, register, request_household) if casework else None,
            finance=_finance(windows, standing, request_household) if finance else None,
            development=(
                _development(windows, events, register, funder_log, {r.id: r for r in requests})
                if development
                else None
            ),
            feed=feed,
        )

    async def _waiting_rows(self, year: int, shared: OneGrantsLoad) -> list[GridRowOut]:
        """The season priced as the Today read prices it, its rows as the grid builds them (no names: the kept items are
        named later), so Waiting on the family's population and clock are the line's own (S2)."""
        decisions = FinancialAidDecisionsService(
            self._store, self._pricing, shared.register, clock=self._clock, season_cache=self._season_cache
        )
        season = await decisions.season(year)
        return [decisions.row_of(season, ({}, {}), request_id) for request_id in season.priced]

    async def _latest_rules(self, year: int) -> RulesVersion | None:
        if self._rules is None:
            return None
        try:
            return await self._rules.load(year)
        except RulesNotFoundError:
            return None

    async def _names(self, year: int, kept: Sequence[_Item]) -> _Names:
        """The kept items' names, last names only (owner ruling 19, 1a), so a line fits one line: a camper request's
        item reads the camper's surname (CampMinder's last name); a household-level one the adults' surnames as the
        household labeler joins them (a shared one once, else "A & B"). Without a labeler, or for a camper or a
        household the reads do not name, the grid's name: the camper's full name, else the family name."""
        households = {i.household for i in kept if i.household is not None}
        persons = {i.person for i in kept if i.household is not None and i.person > 0}
        level = {i.household for i in kept if i.household is not None and i.person <= 0}
        (found, campers), legal = await asyncio.gather(
            self._store.fetch_names(year, households, persons),
            self._store.fetch_camper_names(year, persons) if persons else _no_campers(),
        )
        named = dict(found)
        if self._labels is not None and level:
            for household, label in (await self._labels(year, level)).items():
                named[household] = label.surnames or label.label or named.get(household, "")
        surnames = {p: last for p, (_, last) in legal.items() if last}
        return _Names(named, {**campers, **surnames})

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
        request_person: Mapping[str, int] | None = None,
        waiting: Sequence[GridRowOut] = (),
        families: bool,
        finance: bool,
        development: bool,
        sections: Sequence[_Item] = (),
    ) -> list[_Item]:
        """This week's latest six items (ruling W6: Monday 00:00 camp time through now, so nothing older and nothing
        future-dated), newest first, before their households are named (only the kept ones are)."""
        items: list[_Item] = list(sections) if finance else []
        persons = request_person or {}

        def at_home(request_id: str) -> tuple[int | None, HrefKind]:
            household = request_household.get(request_id)
            return household, "household" if household is not None else "none"

        def who(request_id: str) -> int:
            return persons.get(request_id, 0)

        if families:
            for event in events:
                household, href = at_home(event.request_id)
                round_, money = event.round, _money(_amount(event))
                if event.kind == "post":
                    items.append(
                        _Item(
                            "posted",
                            event.created,
                            _fmt("{n} · R{r} {m}", r=round_, m=money),
                            household,
                            href,
                            person=who(event.request_id),
                        )
                    )
                elif event.kind == "accept":
                    items.append(
                        _Item(
                            "accepted",
                            event.created,
                            _fmt("{n} accepted"),
                            household,
                            href,
                            person=who(event.request_id),
                        )
                    )
                elif event.kind == "approve" and finance:
                    items.append(
                        _Item(
                            "approved",
                            event.created,
                            _fmt("{n} · R{r} approved {m}", r=round_, m=money),
                            household,
                            href,
                            person=who(event.request_id),
                        )
                    )
            for late, at in _overdue(waiting, windows, now):
                items.append(
                    _Item(
                        "overdue",
                        at,
                        _fmt(f"{{n}} waiting {WAITING_TOO_LONG_DAYS}+ days"),
                        late.household_cm_id,
                        "household",
                        person=late.person_cm_id,
                    )
                )
        if families or development:  # a caller with no section sees no funder or grant item
            for row in _live_grants(register):
                grantor = grantor_names.get(row.grantor_key, UNMATCHED)
                at = row.recorded_at or now
                if families:
                    # Audit N4 / ruling W2: the name leads, so a narrow column never cuts it; ruling 19: short words.
                    items.append(
                        _Item(
                            "grant",
                            at,
                            _fmt("{n} · {g} grant", g=grantor),
                            row.household_cm_id,
                            "household",
                            person=row.person_cm_id,
                        )
                    )
                else:  # the mock: development's grant lines are plain, and name no family (§9.4)
                    items.append(_Item("grant", at, _fmt("{g} grant · {m} posted", g=grantor, m=_money(row.amount))))
            for log in funder_log:
                funder = _funder_name(log, grantor_names)
                items.append(_Item("funder", log.created, _fmt("{n} updated"), None, "funders", funder))
        this_week = [i for i in items if _day(i.at) >= windows.this_start and i.at <= now]
        this_week.sort(key=lambda i: i.at, reverse=True)
        return this_week[:FEED_SIZE]


@dataclass(frozen=True)
class _Names:
    households: Mapping[int, str]
    campers: Mapping[int, str]


def _out(item: _Item, names: _Names) -> WeekFeedOut:
    """The item's words, its household named (`names`, ruling 18), and the words that are its link."""
    name = item.name
    if item.household is not None:
        camper = names.campers.get(item.person, "") if item.person > 0 else ""
        name = camper or names.households.get(item.household, "") or "Unknown"
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


async def _no_rows() -> list[GridRowOut]:
    return []


async def _no_rules() -> RulesVersion | None:
    return None


async def _no_campers() -> dict[int, tuple[str, str]]:
    return {}
