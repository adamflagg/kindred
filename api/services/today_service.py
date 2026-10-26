"""Analytics Today (#3207 PR 8): Session fill and Recent sign-ups.

Session fill lists this year's sessions in session order (ruling 1, B) and nothing else (ruling #14: a
session last year ran that this year does not is not drawn). Each row's beds, cabin groups and waitlist
come from the Availability page's own read (``SessionAvailabilityService``), its goal from the budget
config (Forecast's), and its comparison from its own match last year (ruling #15), read at the same
registration day all year (decision 7; PM-8 A: Today never switches to finals, ``same_day_point``):

- a session matches by ``match_session_in_year`` (CampMinder id, then alias group, then exact name), with
  its all-gender cabins riding along; teen programs (SCIT, TLI) match by program;
- the figure is ``prior_figure_for_session``: the matched session's own count, plus ruling #15's "embedded
  add" (PR 8b): a prior-year embedded session with no match this year is added to the prior-year main
  session whose dates contain it (``fold_embedded_sessions``), and the figure carries its breakdown for the
  tooltip (#50). Today folds by default; Metrics never does, except Velocity's pace card when
  asked (PR 12, ruling #97, reusing ``fold_embedded_sessions``). With one session picked, the headline's prior counts
  that session's and the folded sessions' campers once each (#51, ``headline_prior_campers``), and Pace's
  prior curve covers the same sessions the fill total compares (``build_pace_prior``).

Recent sign-ups (decisions 37, 40): enrollments whose Enrolled on day (``enrollment_date`` as a camp-time
day) falls in the last 7 days, one line per camper per day, newest first, at most 6 lines.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from api.schemas.session_availability import SessionAvailabilityResponse
from api.schemas.today import (
    RecentSignupLine,
    RecentSignupsResponse,
    TodayPacePoint,
    TodayPriorPart,
    TodaySessionPart,
    TodaySessionRow,
    TodaySessionsResponse,
)
from api.services.camp_calendar import CAMP_TZ, SEASON_WEEKS, get_camp_today
from api.services.extractors import is_new_camper
from api.services.reconstruction import attendees_at_cutoff, reconstruct_daily_multi, registered_day
from api.services.same_point import registration_anchor, same_day_point
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


def _session_day(session: Any, field: str) -> date | None:
    raw = str(getattr(session, field, "") or "").split("T")[0].split(" ")[0]
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def fold_embedded_sessions(prior_sessions: Mapping[int, Any], matched_prior_ids: set[int]) -> dict[int, list[int]]:
    """Ruling #15's embedded add: prior main session → the unmatched prior embedded sessions it contains.

    An embedded session folds when nothing this year matched it and a main session's dates contain it: its
    start and end fall within the main's, a shared start or end included. Pure dates, read each time. When
    more than one main contains it, the shortest one does (the tightest fit). Each host's list is in date
    order. A session missing a date never folds.
    """
    mains: list[tuple[int, date, date]] = []
    for sid, session in prior_sessions.items():
        start, end = _session_day(session, "start_date"), _session_day(session, "end_date")
        if getattr(session, "session_type", "") == "main" and start is not None and end is not None:
            mains.append((int(sid), start, end))

    folds: dict[int, list[tuple[date, int]]] = {}
    for sid, session in prior_sessions.items():
        if getattr(session, "session_type", "") != "embedded" or int(sid) in matched_prior_ids:
            continue
        start, end = _session_day(session, "start_date"), _session_day(session, "end_date")
        if start is None or end is None:
            continue
        hosts = [(m_end - m_start, m_sid) for m_sid, m_start, m_end in mains if m_start <= start and end <= m_end]
        if hosts:
            folds.setdefault(min(hosts)[1], []).append((start, int(sid)))
    return {host: [sid for _start, sid in sorted(items)] for host, items in folds.items()}


def _own_figure(
    cm_id: int,
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
    part: Literal["F", "M", "AG"] | None,
) -> int:
    """One prior session's figure: its own campers (of one gender for a part) and, with no part, its AG cabins."""
    ag = _ag_children(prior_sessions, cm_id)
    if part == "AG":
        return sum(_count(prior_counts, a) for a in ag)
    if part is not None:
        return _count(prior_counts, cm_id, part)
    return _count(prior_counts, cm_id) + sum(_count(prior_counts, a) for a in ag)


def prior_figure_for_session(
    prior_cm_id: int | None,
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
    part: Literal["F", "M", "AG"] | None = None,
    folded: Sequence[int] = (),
) -> int | None:
    """Last year's figure for one matched session (ruling #15): its own enrolled plus its AG cabins, plus
    the embedded sessions folded into it (``fold_embedded_sessions``), each with its own AG cabins.

    None when the session has no match last year. ``part`` reads one cabin group: "F" or "M" the
    campers of that gender, "AG" the all-gender cabins, in the session and in each folded one.
    """
    if prior_cm_id is None:
        return None
    return sum(_own_figure(sid, prior_sessions, prior_counts, part) for sid in (prior_cm_id, *folded))


def prior_breakdown(
    prior_cm_id: int | None,
    folded: Sequence[int],
    prior_sessions: Mapping[int, Any],
    prior_counts: Mapping[tuple[int, str], int],
    part: Literal["F", "M", "AG"] | None = None,
) -> list[TodayPriorPart] | None:
    """A folded figure's breakdown for its tooltip (#50): the main session first, then each folded session
    that adds to it. None when nothing folded adds anything, so the figure reads as a plain one."""
    if prior_cm_id is None:
        return None
    added = [(sid, n) for sid in folded if (n := _own_figure(sid, prior_sessions, prior_counts, part)) > 0]
    if not added:
        return None

    def name(sid: int) -> str:
        return str(getattr(prior_sessions.get(sid), "name", "") or "")

    own = _own_figure(prior_cm_id, prior_sessions, prior_counts, part)
    return [TodayPriorPart(name=name(prior_cm_id), prior=own)] + [
        TodayPriorPart(name=name(sid), prior=n) for sid, n in added
    ]


def _with_ag(prior_sessions: Mapping[int, Any], ids: Iterable[int]) -> set[int]:
    out: set[int] = set()
    for sid in ids:
        out.add(sid)
        out.update(_ag_children(prior_sessions, sid))
    return out


def headline_prior_campers(attendees: Iterable[Any], session_ids: set[int]) -> int:
    """#51: the campers enrolled in any of ``session_ids``, each counted once."""
    people: set[int] = set()
    for att in attendees:
        session = get_session_from_expand(att)
        sid = _as_int(getattr(session, "cm_id", None)) if session is not None else None
        if sid is None:
            sid = _as_int(getattr(att, "session_cm_id", None))
        pid = _as_int(getattr(att, "person_id", None))
        if sid in session_ids and pid is not None:
            people.add(pid)
    return len(people)


def build_pace_prior(attendees: Iterable[Any], anchor: date, session_ids: set[int]) -> list[TodayPacePoint]:
    """Last year's Pace curve over ``session_ids`` (the sessions the fill total compares).

    Velocity's rebuild (registered by the day and not cancelled by it), from a week before the anchor
    when anyone registered earlier, through the season's last day.
    """
    dated = [a for a in attendees if _as_int(getattr(get_session_from_expand(a), "cm_id", None)) in session_ids]
    week0 = any((day := registered_day(a)) is not None and day < anchor for a in dated)
    sessions = {sid: sid for sid in session_ids}
    daily, _per_session = reconstruct_daily_multi(
        attendees=dated,
        season_start=anchor,
        sessions=sessions,
        end_date=anchor + timedelta(days=SEASON_WEEKS * 7 - 1),
        week0=week0,
    )
    return [TodayPacePoint(day_offset=p.day_offset, enrolled=p.enrolled) for p in daily]


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
    """This year's Session fill rows, in session order, each with its own match last year and the
    unmatched embedded sessions folded into it (#15)."""
    matched = match_prior_sessions(current_sessions, prior_sessions)
    folds = fold_embedded_sessions(prior_sessions, set(matched.values()))

    def prior_of(prior_sid: int | None, part: Literal["F", "M", "AG"] | None = None) -> dict[str, Any]:
        folded = folds.get(prior_sid, []) if prior_sid is not None else []
        return {
            "prior": prior_figure_for_session(prior_sid, prior_sessions, prior_counts, part, folded),
            "prior_parts": prior_breakdown(prior_sid, folded, prior_sessions, prior_counts, part),
        }

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
                    **prior_of(prior_sid),
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
                    **prior_of(prior_sid, "F"),
                ),
                TodaySessionPart(
                    label="Boys",
                    enrolled=s.boys.enrolled,
                    waitlisted=s.boys.waitlisted,
                    beds=s.boys.capacity,
                    **prior_of(prior_sid, "M"),
                ),
            ]
            if ags:
                parts.append(
                    TodaySessionPart(
                        label="AG",
                        enrolled=sum(a.enrolled for a in ags),
                        waitlisted=sum(a.waitlisted for a in ags),
                        beds=_sum_beds(*(a.capacity for a in ags)),
                        **prior_of(prior_sid, "AG"),
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
                    **prior_of(prior_sid),
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


def compared_prior_ids(
    availability: SessionAvailabilityResponse,
    prior_sessions: Mapping[int, Any],
    matched: Mapping[int, int],
    folds: Mapping[int, list[int]],
) -> set[int]:
    """The prior-year sessions the fill total compares: each row's match with its AG cabins and the
    embedded sessions folded into it, and each teen program's sessions. Pace's prior reads the same."""
    ids: set[int] = set()
    for s in availability.sessions:
        prior_sid = matched.get(s.session_cm_id)
        if prior_sid is not None:
            ids |= _with_ag(prior_sessions, [prior_sid, *folds.get(prior_sid, [])])
    for teen in availability.teen_sessions:
        ids |= resolve_cohort_session_ids(dict(prior_sessions), [teen.session_type])
    return ids


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
            same_day_point(self.repo, year, today),
        )

        # PM-8 A: Today reads last year at the same registration day all year, never at its final. With
        # no anchor on either side there is no same day, so there is no comparison (PM-4 A: no substitute).
        anchor = await self._anchor(prior_year)
        cutoff = anchor + timedelta(days=point.prior_offset) if point is not None and anchor is not None else None
        if cutoff is None or anchor is None or point is None:
            return TodaySessionsResponse(
                year=year,
                prior_year=prior_year,
                rows=build_session_fill_rows(
                    availability=availability,
                    current_sessions=current_sessions,
                    goals=goals,
                    prior_sessions={},
                    prior_counts={},
                ),
                limited_threshold=availability.limited_threshold,
                prior_unavailable_reason="no_registration_anchor",
            )

        dated = list(await self.repo.fetch_attendees_with_dates(prior_year, expand_person=True))
        prior_enrolled, _left = attendees_at_cutoff(dated, cutoff)

        rows = build_session_fill_rows(
            availability=availability,
            current_sessions=current_sessions,
            goals=goals,
            prior_sessions=prior_sessions,
            prior_counts=count_prior_by_session(prior_enrolled),
        )

        matched = match_prior_sessions(current_sessions, prior_sessions)
        folds = fold_embedded_sessions(prior_sessions, set(matched.values()))
        headline_prior: int | None = None
        host = matched.get(session_cm_id) if session_cm_id is not None else None
        if host is not None and folds.get(host):
            # #51: one session picked, embedded sessions folded into it: its campers and theirs, once each
            headline_prior = headline_prior_campers(prior_enrolled, _with_ag(prior_sessions, [host, *folds[host]]))

        pace_prior = build_pace_prior(dated, anchor, compared_prior_ids(availability, prior_sessions, matched, folds))
        return TodaySessionsResponse(
            year=year,
            prior_year=prior_year,
            rows=rows,
            limited_threshold=availability.limited_threshold,
            prior_basis="same_point",
            day_offset=point.day_offset,
            prior_day_offset=point.prior_offset,
            as_of_date=cutoff.isoformat(),
            headline_prior=headline_prior,
            pace_prior=pace_prior,
        )

    async def _anchor(self, year: int) -> date | None:
        try:
            return registration_anchor(await self.repo.fetch_registration_dates(year))
        except Exception:
            logger.warning("Failed to read the %d registration dates: no comparison", year, exc_info=True)
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
