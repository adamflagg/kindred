"""Analytics Today (#3207 PR 8): Session fill and Recent sign-ups.

Session fill lists this year's sessions in session order (ruling 1, B) and nothing else (ruling #14: a
session last year ran that this year does not is not drawn). Each row's beds, cabin groups and waitlist
come from the Availability page's own read (``SessionAvailabilityService``), its goal from the budget
config (Forecast's), and its comparison from its own match last year (ruling #15), read at the same
registration day while the season is live (decision 7):

- a session matches by ``match_session_in_year`` (CampMinder id, then alias group, then exact name), with
  its all-gender cabins riding along; teen programs (SCIT, TLI) match by program;
- the figure is ``prior_figure_for_session``: the matched session's own count, never anything folded in.
  Ruling #15's "embedded add" (a prior embedded session with no match folded into the main session whose
  dates contain it) is PR 8b and slots in there.

Recent sign-ups (decisions 37, 40): enrollments whose Enrolled on day (``enrollment_date`` as a camp-time
day) falls in the last 7 days, one line per camper per day, newest first, at most 6 lines.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from api.schemas.session_availability import SessionAvailabilityResponse
from api.schemas.today import (
    RecentSignupLine,
    RecentSignupsResponse,
    TodaySessionPart,
    TodaySessionRow,
    TodaySessionsResponse,
)
from api.services.camp_calendar import CAMP_TZ, get_camp_today
from api.services.extractors import is_new_camper
from api.services.reconstruction import attendees_at_cutoff
from api.services.same_point import live_same_point, registration_anchor
from api.services.session_availability_service import SessionAvailabilityService
from api.utils.session_metrics import (
    DISPLAY_SESSION_TYPES,
    SUMMER_TEEN_TYPES,
    get_person_from_expand,
    get_session_from_expand,
    match_session_in_year,
    resolve_cohort_session_ids,
    resolve_scope_ids,
    teen_config_key,
)
from bunking.logging_config import get_logger
from bunking.session_order import session_rank

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = get_logger(__name__)

RECENT_DAYS = 7
RECENT_LINES = 6

# A prior count's gender key: the two cabin genders, or "" for anyone else.
_GENDERS = {"F": "F", "M": "M"}


# ---------------------------------------------------------------------------
# Matching and the prior-year figure
# ---------------------------------------------------------------------------


def _is_row_session(session: Any) -> bool:
    """A session that is its own Session fill row: summer, not an AG cabin, not a teen program."""
    stype = getattr(session, "session_type", "")
    return stype in DISPLAY_SESSION_TYPES and stype != "ag" and stype not in SUMMER_TEEN_TYPES


def match_prior_sessions(current: Mapping[int, Any], prior_all: Mapping[int, Any]) -> dict[int, int]:
    """This year's row sessions → their match last year (ruling #15), one to one.

    ``match_session_in_year`` decides each match. When two of this year's sessions land on one prior
    session, the one that kept its CampMinder id keeps it (as Velocity's mapping does) and the other has
    no match. AG cabins ride with their parent and teens match by program, so neither is listed here.
    """
    taken: dict[int, int] = {}
    for sid, session in sorted(current.items()):
        if not _is_row_session(session):
            continue
        prior_sid = match_session_in_year(prior_all, sid, getattr(session, "name", None))
        if prior_sid is None:
            continue
        holder = taken.get(prior_sid)
        if holder is None or (prior_sid == sid and holder != sid):
            taken[prior_sid] = sid
    return {current_sid: prior_sid for prior_sid, current_sid in taken.items()}


def _ag_children(sessions: Mapping[int, Any], parent_cm_id: int) -> list[int]:
    return [
        int(sid)
        for sid, s in sessions.items()
        if getattr(s, "session_type", "") == "ag" and _as_int(getattr(s, "parent_id", None)) == parent_cm_id
    ]


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except TypeError, ValueError:
        return None


def _count(counts: Mapping[tuple[int, str], int], sid: int, gender: str | None = None) -> int:
    if gender is not None:
        return counts.get((sid, gender), 0)
    return sum(n for (s, _g), n in counts.items() if s == sid)


def prior_figure_for_session(
    prior_cm_id: int | None,
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
    part: Literal["F", "M", "AG"] | None = None,
) -> int | None:
    """Last year's figure for one matched session (ruling #15): its own enrolled plus its AG cabins.

    None when the session has no match last year. ``part`` reads one cabin group: "F" or "M" the
    session's own campers of that gender, "AG" its all-gender cabins. Nothing else is folded in:
    PR 8b's embedded add belongs here.
    """
    if prior_cm_id is None:
        return None
    ag = _ag_children(prior_sessions, prior_cm_id)
    if part == "AG":
        return sum(_count(prior_counts, a) for a in ag)
    if part is not None:
        return _count(prior_counts, prior_cm_id, part)
    return _count(prior_counts, prior_cm_id) + sum(_count(prior_counts, a) for a in ag)


def prior_figure_for_program(
    teen_type: str,
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
) -> int | None:
    """Last year's figure for a teen program (SCIT, TLI), matched by program: every summer session of
    that type last year. None when last year ran none."""
    ids = resolve_cohort_session_ids(dict(prior_sessions), [teen_type])
    if not ids:
        return None
    return sum(_count(prior_counts, sid) for sid in ids)


def count_prior_by_session(attendees: Iterable[Any]) -> dict[tuple[int, str], int]:
    """Enrolled camper-sessions by (session CampMinder id, gender): "F", "M", or "" for anyone else."""
    counts: dict[tuple[int, str], int] = {}
    for att in attendees:
        session = get_session_from_expand(att)
        sid = _as_int(getattr(session, "cm_id", None)) if session is not None else None
        if sid is None:
            sid = _as_int(getattr(att, "session_cm_id", None))
        if sid is None:
            continue
        person = get_person_from_expand(att)
        gender = _GENDERS.get(str(getattr(person, "gender", "") or "").upper(), "") if person is not None else ""
        key = (sid, gender)
        counts[key] = counts.get(key, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Session fill rows
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Orderable:
    """What ``bunking.session_order`` reads, for a session or a teen program row."""

    cm_id: int
    name: str
    session_type: str
    start_date: str
    end_date: str
    parent_cm_id: int


def _orderable(session: Any) -> _Orderable:
    return _Orderable(
        cm_id=int(getattr(session, "cm_id", 0) or 0),
        name=str(getattr(session, "name", "") or ""),
        session_type=str(getattr(session, "session_type", "") or ""),
        start_date=str(getattr(session, "start_date", "") or ""),
        end_date=str(getattr(session, "end_date", "") or ""),
        parent_cm_id=_as_int(getattr(session, "parent_id", None)) or 0,
    )


def _sum_beds(*beds: int | None) -> int | None:
    known = [b for b in beds if b is not None]
    return sum(known) if known else None


def _goal(goals: Mapping[Any, Mapping[str, Any]], key: Any) -> int | None:
    value = (goals.get(key) or {}).get("participant_goal")
    return int(value) if value else None


def build_session_fill_rows(
    *,
    availability: SessionAvailabilityResponse,
    current_sessions: Mapping[int, Any],
    goals: Mapping[Any, Mapping[str, Any]],
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
) -> list[TodaySessionRow]:
    """This year's Session fill rows, in session order, each with its own match last year."""
    matched = match_prior_sessions(current_sessions, prior_sessions)
    ag_by_parent: dict[int, list[Any]] = {}
    for ag in availability.ag_sessions:
        parent = _as_int(getattr(current_sessions.get(ag.session_cm_id), "parent_id", None))
        if parent is not None:
            ag_by_parent.setdefault(parent, []).append(ag)

    rows: list[tuple[_Orderable, TodaySessionRow]] = []
    for s in availability.sessions:
        prior_sid = matched.get(s.session_cm_id)
        session = current_sessions.get(s.session_cm_id)
        if s.session_type == "quest":
            parts = [
                TodaySessionPart(
                    label="",
                    enrolled=s.girls.enrolled + s.boys.enrolled,
                    waitlisted=s.girls.waitlisted + s.boys.waitlisted,
                    beds=_sum_beds(s.girls.capacity, s.boys.capacity),
                    prior=prior_figure_for_session(prior_sid, prior_sessions, prior_counts),
                )
            ]
        else:
            ags = ag_by_parent.get(s.session_cm_id, [])
            parts = [
                TodaySessionPart(
                    label="Girls",
                    enrolled=s.girls.enrolled,
                    waitlisted=s.girls.waitlisted,
                    beds=s.girls.capacity,
                    prior=prior_figure_for_session(prior_sid, prior_sessions, prior_counts, part="F"),
                ),
                TodaySessionPart(
                    label="Boys",
                    enrolled=s.boys.enrolled,
                    waitlisted=s.boys.waitlisted,
                    beds=s.boys.capacity,
                    prior=prior_figure_for_session(prior_sid, prior_sessions, prior_counts, part="M"),
                ),
            ]
            if ags:
                parts.append(
                    TodaySessionPart(
                        label="AG",
                        enrolled=sum(a.enrolled for a in ags),
                        waitlisted=sum(a.waitlisted for a in ags),
                        beds=_sum_beds(*(a.capacity for a in ags)),
                        prior=prior_figure_for_session(prior_sid, prior_sessions, prior_counts, part="AG"),
                    )
                )
        order = (
            _orderable(session)
            if session is not None
            else _Orderable(s.session_cm_id, s.session_name, s.session_type, "", "", 0)
        )
        rows.append(
            (
                order,
                TodaySessionRow(
                    session_cm_id=s.session_cm_id,
                    session_name=s.session_name,
                    session_type=s.session_type,
                    enrolled=sum(p.enrolled for p in parts),
                    waitlisted=sum(p.waitlisted for p in parts),
                    beds=_sum_beds(*(p.beds for p in parts)),
                    goal=_goal(goals, s.session_cm_id),
                    prior=prior_figure_for_session(prior_sid, prior_sessions, prior_counts),
                    parts=parts,
                ),
            )
        )

    for i, teen in enumerate(availability.teen_sessions):
        prior = prior_figure_for_program(teen.session_type, prior_sessions, prior_counts)
        starts = sorted(
            str(getattr(x, "start_date", "") or "")
            for x in current_sessions.values()
            if getattr(x, "session_type", "") == teen.session_type
        )
        order = _Orderable(-(i + 1), teen.session_name, teen.session_type, starts[0] if starts else "", "", 0)
        rows.append(
            (
                order,
                TodaySessionRow(
                    session_cm_id=0,
                    session_name=teen.session_name,
                    session_type=teen.session_type,
                    enrolled=teen.enrolled,
                    waitlisted=teen.waitlisted,
                    beds=teen.capacity,
                    goal=_goal(goals, teen_config_key(teen.session_type)),
                    prior=prior,
                    parts=[
                        TodaySessionPart(
                            label="",
                            enrolled=teen.enrolled,
                            waitlisted=teen.waitlisted,
                            beds=teen.capacity,
                            prior=prior,
                        )
                    ],
                ),
            )
        )

    rank = session_rank(order for order, _row in rows)
    return [row for order, row in sorted(rows, key=lambda pair: rank.get(pair[0].cm_id, len(rank)))]


# ---------------------------------------------------------------------------
# Recent sign-ups
# ---------------------------------------------------------------------------


def _parse_instant(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        at = datetime.fromisoformat(text.replace(" ", "T"))
    except ValueError:
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=UTC)


def _camp_day(at: datetime) -> date:
    """The camp-time calendar day of an instant (the drill-down's Enrolled on reads the same)."""
    return at.astimezone(CAMP_TZ).date()


def build_recent_lines(
    attendees: Iterable[Any],
    sessions: Mapping[int, Any],
    today: date,
    *,
    in_scope: set[int] | None = None,
) -> tuple[list[RecentSignupLine], int]:
    """Recent sign-ups' lines (at most 6, newest first) and the window's enrollment count.

    ``attendees`` are this season's enrolled summer records (every scope, so "2nd" can see a camper's
    earlier sessions); ``in_scope`` limits what is listed and counted to the page's scope.
    """
    since = today - timedelta(days=RECENT_DAYS - 1)
    rank = session_rank(_orderable(s) for s in sessions.values())
    earliest_day: dict[int, date] = {}
    groups: dict[tuple[int, date], list[tuple[datetime, Any, Any]]] = {}
    enrollments = 0
    for att in attendees:
        at = _parse_instant(str(getattr(att, "enrollment_date", "") or ""))
        session = get_session_from_expand(att)
        sid = _as_int(getattr(session, "cm_id", None)) if session is not None else None
        pid = _as_int(getattr(att, "person_id", None))
        if at is None or sid is None or pid is None:
            continue
        day = _camp_day(at)
        if pid not in earliest_day or day < earliest_day[pid]:
            earliest_day[pid] = day
        if day < since or day > today or (in_scope is not None and sid not in in_scope):
            continue
        enrollments += 1
        groups.setdefault((pid, day), []).append((at, att, sessions.get(sid, session)))

    lines: list[tuple[datetime, str, RecentSignupLine]] = []
    for (pid, day), items in groups.items():
        items.sort(key=lambda item: rank.get(int(getattr(item[2], "cm_id", 0) or 0), len(rank)))
        person = get_person_from_expand(items[0][1])
        first = str(getattr(person, "first_name", "") or "") if person is not None else ""
        last = str(getattr(person, "last_name", "") or "") if person is not None else ""
        preferred = getattr(person, "preferred_name", None) if person is not None else None
        latest = max(item[0] for item in items)
        lines.append(
            (
                latest,
                f"{last} {first}".lower(),
                RecentSignupLine(
                    person_id=pid,
                    first_name=first,
                    last_name=last,
                    preferred_name=str(preferred) if preferred else None,
                    day=day.isoformat(),
                    sessions=[str(getattr(item[2], "name", "") or "") for item in items],
                    is_new=bool(person is not None and is_new_camper(getattr(person, "years_at_camp", None))),
                    is_second=earliest_day.get(pid, day) < day,
                ),
            )
        )
    # Newest first; a tie reads in name order (last name, then first).
    lines.sort(key=lambda entry: entry[1])
    lines.sort(key=lambda entry: entry[0], reverse=True)
    return [line for _at, _name, line in lines[:RECENT_LINES]], enrollments


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------


class TodayService:
    def __init__(self, repository: MetricsRepository) -> None:
        self.repo = repository

    async def _availability(
        self, year: int, session_types: list[str] | None, session_cm_id: int | None, duration: str | None
    ) -> SessionAvailabilityResponse:
        return await SessionAvailabilityService(self.repo).calculate_availability(
            year=year, session_types=session_types, session_cm_id=session_cm_id, duration=duration
        )

    async def session_fill(
        self,
        year: int,
        session_types: list[str] | None,
        session_cm_id: int | None = None,
        duration: str | None = None,
        today: date | None = None,
    ) -> TodaySessionsResponse:
        prior_year = year - 1
        availability, current_sessions, prior_sessions, goals, point = await asyncio.gather(
            self._availability(year, session_types, session_cm_id, duration),
            self.repo.fetch_sessions(year, None),
            self.repo.fetch_sessions(prior_year, None),
            self.repo.fetch_budget_config(year),
            live_same_point(self.repo, year, today),
        )

        cutoff: date | None = None
        if point is not None:
            anchor = await self._anchor(prior_year)
            if anchor is not None:
                cutoff = anchor + timedelta(days=point.prior_offset)

        if cutoff is not None:
            dated = await self.repo.fetch_attendees_with_dates(prior_year, expand_person=True)
            prior_enrolled, _left = attendees_at_cutoff(list(dated), cutoff)
        else:
            prior_enrolled = await self.repo.fetch_attendees(prior_year, "enrolled", expand_person=True)

        rows = build_session_fill_rows(
            availability=availability,
            current_sessions=current_sessions,
            goals=goals,
            prior_sessions=prior_sessions,
            prior_counts=count_prior_by_session(prior_enrolled),
        )
        return TodaySessionsResponse(
            year=year,
            prior_year=prior_year,
            rows=rows,
            limited_threshold=availability.limited_threshold,
            prior_basis="same_point" if cutoff is not None else "final",
            day_offset=point.day_offset if cutoff is not None and point is not None else None,
            prior_day_offset=point.prior_offset if cutoff is not None and point is not None else None,
            as_of_date=cutoff.isoformat() if cutoff is not None else None,
        )

    async def _anchor(self, year: int) -> date | None:
        try:
            return registration_anchor(await self.repo.fetch_registration_dates(year))
        except Exception:
            logger.warning("Failed to read the %d registration dates, comparing with its final", year, exc_info=True)
            return None

    async def recent_signups(
        self,
        year: int,
        session_types: list[str] | None,
        session_cm_id: int | None = None,
        duration: str | None = None,
        today: date | None = None,
    ) -> RecentSignupsResponse:
        camp_today = today if today is not None else get_camp_today()
        sessions, attendees = await asyncio.gather(
            self.repo.fetch_sessions(year, None),
            self.repo.fetch_attendees_with_persons(year, status_filter="enrolled"),
        )
        reference_name = getattr(sessions.get(session_cm_id), "name", None) if session_cm_id is not None else None
        scope = resolve_scope_ids(sessions, session_types, session_cm_id, duration, reference_name)
        summer = resolve_scope_ids(sessions, None)
        summer_attendees = [
            a for a in attendees if _as_int(getattr(get_session_from_expand(a), "cm_id", None)) in summer
        ]
        lines, enrollments = build_recent_lines(summer_attendees, sessions, camp_today, in_scope=scope)
        return RecentSignupsResponse(
            year=year,
            since=(camp_today - timedelta(days=RECENT_DAYS - 1)).isoformat(),
            today=camp_today.isoformat(),
            lines=lines,
            enrollments=enrollments,
        )
