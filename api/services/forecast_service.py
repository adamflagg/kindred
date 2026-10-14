"""Forecast service - budget goals and revenue projections.

Computes per-session enrollment vs budget goals, prior year comparison,
and revenue projections.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timedelta
from functools import cmp_to_key
from typing import TYPE_CHECKING, Any, Literal

from api.schemas.forecast import ForecastPriorTotals, ForecastResponse, SessionForecast, WeekOption
from api.services.camp_calendar import (
    REGISTRATION_TIERS,
    SEASON_WEEKS,
    format_week_date_range,
    get_camp_today,
    same_point_offset,
)
from api.services.reconstruction import (
    parse_date_only,
    reconstruct_enrollment_at_offset,
    reconstruct_enrollment_with_gender,
)
from api.utils.session_aliases import resolve_session_alias
from api.utils.session_metrics import (
    SUMMER_TEEN_TYPES,
    build_ag_parent_map,
    get_person_from_expand,
    get_session_from_expand,
    get_summer_window,
    is_summer_teen_session,
    resolve_duration_sessions,
    resolve_scope_ids,
    teen_config_key,
    teen_display_name,
)
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = get_logger(__name__)

_SESSION_NUMBER = re.compile(r"session\s+(\d+)([a-z])?", re.IGNORECASE)


def _parse_session_name(name: str) -> tuple[int, str]:
    """Port of the frontend's sessionUtils.parseSessionName: (number, letter suffix)."""
    match = _SESSION_NUMBER.search(name)
    if match:
        return int(match.group(1)), (match.group(2) or "").lower()
    return 0, name.lower()


def _page_row_compare(a: Any, b: Any) -> int:
    """Port of the frontend's sessionUtils.compareByDateThenName, which orders Forecast rows.

    Start date first (only when both have one), then the session number and its
    letter suffix. AG cabins under one parent share the date and the "Session N", so
    they tie here and the page keeps the order the API sent them in.
    """
    date_a = str(getattr(a, "start_date", "") or "")
    date_b = str(getattr(b, "start_date", "") or "")
    if date_a and date_b and date_a != date_b:
        return -1 if date_a < date_b else 1
    num_a, suffix_a = _parse_session_name(str(getattr(a, "name", "") or ""))
    num_b, suffix_b = _parse_session_name(str(getattr(b, "name", "") or ""))
    if num_a != num_b:
        return num_a - num_b
    return (suffix_a > suffix_b) - (suffix_a < suffix_b)


# Session type -> the forecast section its whole-scope prior total belongs to.
_SECTION_BY_TYPE: dict[str, str] = {
    "main": "camp",
    "embedded": "camp",
    "ag": "camp",
    "quest": "quest",
    "scit": "teen",
    "tli": "teen",
}


class ForecastService:
    """Compute session enrollment forecasts with budget and revenue projections."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_week_options(self, year: int, today: date | None = None) -> list[WeekOption]:
        """Generate week-relative options from registration anchor through today.

        Returns a descending list (newest first) of week options with 1-based numbering,
        date ranges, and registration tier suffixes:
        - First entry: Today with exact day_offset, tier suffix if applicable
        - Then each completed week from most recent down to Week 1
        - Weeks get tier suffixes (Priority Reg, Early Reg, Open Reg) based on reg dates
        - If today falls on an exact week boundary, no duplicate is created
        - Past seasons (today > anchor + SEASON_WEEKS) cap at SEASON_WEEKS with no Today entry

        Args:
            year: The camp year to look up registration dates for.
            today: Override for current date (for testing). Defaults to get_camp_today().

        Returns:
            List of WeekOption, empty if no anchor date or today < anchor.
        """
        if today is None:
            today = get_camp_today()

        reg_dates = await self.repository.fetch_registration_dates(year)

        # Find anchor: priority_reg_date preferred, fall back to early_reg_date
        anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date")
        if not anchor_str:
            return []
        anchor_str = parse_date_only(anchor_str)
        anchor = date.fromisoformat(anchor_str)

        if today < anchor:
            return []

        # Cap past seasons at the season end boundary (inclusive last day of
        # final week — contrast with velocity_service._season_end which uses
        # exclusive boundary for datetime filtering)
        season_end_date = anchor + timedelta(days=SEASON_WEEKS * 7 - 1)
        is_past_season = today > season_end_date
        effective_today = season_end_date if is_past_season else today

        total_days = (effective_today - anchor).days
        last_week = min(total_days // 7 + 1, SEASON_WEEKS)  # 1-based, capped

        # Build tier suffix map: week_number -> suffix label
        tier_suffixes: dict[int, str] = {}
        for _phase, key, full_label in REGISTRATION_TIERS:
            tier_str = reg_dates.get(key)
            if tier_str:
                tier_str = parse_date_only(tier_str)
                tier_date = date.fromisoformat(tier_str)
                if tier_date >= anchor:
                    tier_week = (tier_date - anchor).days // 7 + 1  # 1-based
                    tier_suffixes[tier_week] = full_label.replace("Registration", "Reg")

        options: list[WeekOption] = []

        if not is_past_season:
            # Current season: Today entry (always first)
            today_suffixes = ["Today"]
            tier_suffix = tier_suffixes.get(last_week)
            if tier_suffix:
                today_suffixes.insert(0, tier_suffix)
            today_suffix_str = " · ".join(today_suffixes)
            today_date_range = format_week_date_range(anchor, last_week)
            today_label = f"Week {last_week} · {today_date_range} ({today_suffix_str})"
            options.append(
                WeekOption(
                    week_number=last_week,
                    day_offset=total_days,
                    label=today_label,
                    is_today=True,
                )
            )

        # Build completed week entries
        if is_past_season:
            # Past season: all weeks from SEASON_WEEKS down to 1
            weeks_to_show = set(range(1, last_week + 1))
        else:
            # Current season: completed weeks below today
            weeks_to_show = set(range(1, last_week))

        for week in sorted(weeks_to_show, reverse=True):
            date_range = format_week_date_range(anchor, week)
            label = f"Week {week} · {date_range}"
            suffix = tier_suffixes.get(week)
            if suffix:
                label += f" ({suffix})"
            options.append(
                WeekOption(
                    week_number=week,
                    day_offset=week * 7 - 1,
                    label=label,
                    is_today=False,
                )
            )

        # Week 0: pre-anchor enrollments (appended at bottom = oldest)
        anchor_date_str = anchor.isoformat()
        has_pre_anchor = await self.repository.has_pre_anchor_enrollments(year, anchor_date_str)
        if has_pre_anchor:
            week0_range = format_week_date_range(anchor, 0)
            options.append(
                WeekOption(
                    week_number=0,
                    day_offset=-1,
                    label=f"Week 0 · {week0_range} (Pre-Reg)",
                    is_today=False,
                )
            )

        return options

    async def calculate_forecast(
        self,
        year: int = 2026,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        day_offset: int | None = None,
        duration: str | None = None,
        today: date | None = None,
    ) -> ForecastResponse:
        """Calculate forecast for the given year.

        Args:
            year: The year to forecast.
            session_types: Session types to include (default: main, embedded, ag, quest).
            session_cm_id: Filter to a specific session (AG children included).
            day_offset: Days since registration anchor. When set, compute enrollment
                at that offset using snapshots (preferred) or reconstruction.
                For prior years, always reconstructs at the same offset.
                When None, uses live attendee data (existing behavior).
            today: Override for the current date (for testing). Defaults to get_camp_today().
                Only live mode reads it: while the season is live, prior years are
                compared at the same registration day, not at their final.

        Returns:
            ForecastResponse with per-session and grand total data.
        """
        if session_types is None:
            session_types = ["main", "embedded", "ag", "quest"]

        # Fetch current year sessions
        sessions = await self.repository.fetch_sessions(year, session_types)

        # Window-gate teen sessions: scit/tli must overlap the year's main-camp
        # window (excludes fall Family-Camp CIT, year-round Teen Interns, Feb LA Trip).
        if any(getattr(s, "session_type", "") in SUMMER_TEEN_TYPES for s in sessions.values()):
            window = get_summer_window(sessions)
            if window is None:
                # Requested scope had no main sessions (e.g. teens-only) — fetch mains.
                window = get_summer_window(await self.repository.fetch_sessions(year, ["main"]))
            sessions = {
                sid: s
                for sid, s in sessions.items()
                if getattr(s, "session_type", "") not in SUMMER_TEEN_TYPES or is_summer_teen_session(s, window)
            }

        # Filter sessions by duration category
        if duration:
            duration_session_ids = resolve_duration_sessions(sessions, duration)
            sessions = {sid: s for sid, s in sessions.items() if sid in duration_session_ids}

        # How prior years are counted: at the same registration day ("same_point") or
        # at their final. Week mode is always same-point; live mode is same-point
        # while this year's season is live (including before the anchor).
        prior_offset: int | None = day_offset
        week0_window = True
        prior_basis: Literal["same_point", "final"] = "same_point" if day_offset is not None else "final"
        if day_offset is None:
            try:
                live_anchor = await self._fetch_anchor(year)
            except Exception:
                # Live mode reads the anchor only to pick the basis: fail soft to "final"
                logger.warning(
                    "Failed to read the %d registration anchor, comparing with prior finals",
                    year,
                    exc_info=True,
                )
                live_anchor = None
            if live_anchor is not None:
                camp_today = today if today is not None else get_camp_today()
                if camp_today <= live_anchor + timedelta(days=SEASON_WEEKS * 7 - 1):
                    prior_offset = (camp_today - live_anchor).days
                    # Negative N is a real "N days before the anchor": no Week-0 lower bound
                    week0_window = False
                    prior_basis = "same_point"

        # Historical day_offset mode: use reconstruction for enrollment counts
        reconstruction: dict[int, dict[str, int | None]] | None = None
        if day_offset is not None:
            reg_dates = await self.repository.fetch_registration_dates(year)
            anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date") or ""
            if not anchor_str:
                raise ValueError(f"No registration anchor configured for {year}")
            anchor_date = date.fromisoformat(parse_date_only(anchor_str))
            season_start = datetime(anchor_date.year, anchor_date.month, anchor_date.day)  # noqa: DTZ001

            # Reconstruct from attendee records — precise to actual enrollment timestamps
            reconstruction = await reconstruct_enrollment_with_gender(
                self.repository, year, sessions, day_offset, season_start
            )

            enrolled_attendees: list[Any] = []
            waitlisted_attendees: list[Any] = []
            budget_config = await self.repository.fetch_budget_config(year)
        else:
            # Live mode: fetch all current-year data in parallel
            (
                enrolled_attendees,
                waitlisted_attendees,
                budget_config,
            ) = await asyncio.gather(
                self.repository.fetch_attendees(year, expand_person=True),
                self.repository.fetch_attendees(year, status_filter="waitlisted"),
                self.repository.fetch_budget_config(year),
            )

        # Decision 45: prior registrations are dated the NEXT day, so the priority day (offset 0)
        # reads the prior years through their second day too. Current-year side and buckets stay.
        if prior_offset is not None:
            prior_offset = same_point_offset(prior_offset)

        # Fetch prior year comparison data
        prior_counts, two_year_counts = await self._fetch_prior_year_counts(
            year, session_types, prior_offset, duration, week0_window
        )

        # Whole-scope prior totals by type (resolved with last year's own scope)
        reference_name = None
        if session_cm_id is not None:
            picked = sessions.get(session_cm_id)
            reference_name = getattr(picked, "name", None) if picked is not None else None
        prior_by_type = await self._fetch_scope_prior_by_type(
            year, session_types, session_cm_id, duration, reference_name, prior_offset, week0_window
        )
        section_priors = self._build_section_priors(session_types, prior_by_type)

        # Build AG parent map for session_cm_id filtering
        ag_parent_map = build_ag_parent_map(sessions)

        # AG priors resolve per parent, not per row (decision 43)
        ag_priors = self._resolve_ag_priors(prior_counts, sessions)
        ag_two_year_priors = self._resolve_ag_priors(two_year_counts, sessions)

        # Build per-session forecasts (AG sessions as separate rows)
        session_forecasts: list[SessionForecast] = []
        for sid, session in sessions.items():
            session_type = getattr(session, "session_type", "")
            if session_type in SUMMER_TEEN_TYPES:
                continue  # teens are aggregated into merged SCIT/TLI rows below

            # If filtering to specific session, include it + its AG children
            if session_cm_id is not None:
                if session_type == "ag":
                    parent_id = ag_parent_map.get(sid)
                    if parent_id != session_cm_id:
                        continue
                elif sid != session_cm_id:
                    continue

            # Each session counts only its own attendees (no AG merging)
            if reconstruction is not None:
                rc = reconstruction.get(sid, {})
                enrolled = rc.get("enrolled") or 0
                waitlisted = rc.get("waitlisted")  # None: a past waitlist cannot be rebuilt
                enrolled_boys = rc.get("enrolled_boys")
                enrolled_girls = rc.get("enrolled_girls")
            else:
                enrolled, enrolled_boys, enrolled_girls = self._count_attendees_with_gender_for_session(
                    enrolled_attendees, sid, set()
                )
                waitlisted = self._count_attendees_for_session(waitlisted_attendees, sid, set())

            # Budget config
            budget = budget_config.get(sid, {})
            participant_goal = budget.get("participant_goal")
            session_fee = budget.get("session_fee")

            # Derived fields
            pct_of_goal = None
            if participant_goal and participant_goal > 0:
                pct_of_goal = round(enrolled / participant_goal * 100, 1)

            budget_revenue = None
            actual_revenue = None
            revenue_pct = None
            revenue_delta = None
            if participant_goal is not None and session_fee is not None:
                budget_revenue = participant_goal * session_fee
                actual_revenue = enrolled * session_fee
                revenue_delta = actual_revenue - budget_revenue
                if budget_revenue > 0:
                    revenue_pct = round(actual_revenue / budget_revenue * 100, 1)

            participants_vs_budget = enrolled - participant_goal if participant_goal is not None else None

            session_name = getattr(session, "name", "")
            if session_type == "ag":
                prior_year_count = ag_priors.get(sid)
                two_year_prior_count = ag_two_year_priors.get(sid)
            else:
                canonical_name = resolve_session_alias(session_name)
                prior_year_count = prior_counts.get(canonical_name)
                two_year_prior_count = two_year_counts.get(canonical_name)
            participants_vs_prior_year = enrolled - prior_year_count if prior_year_count is not None else None

            session_forecasts.append(
                SessionForecast(
                    session_cm_id=sid,
                    session_name=session_name,
                    session_type=session_type,
                    participant_goal=participant_goal,
                    session_fee=session_fee,
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    pct_of_goal=pct_of_goal,
                    prior_year_count=prior_year_count,
                    two_year_prior_count=two_year_prior_count,
                    participants_vs_budget=participants_vs_budget,
                    participants_vs_prior_year=participants_vs_prior_year,
                    budget_revenue=budget_revenue,
                    actual_revenue=actual_revenue,
                    revenue_delta=revenue_delta,
                    revenue_pct=revenue_pct,
                    enrolled_boys=enrolled_boys,
                    enrolled_girls=enrolled_girls,
                )
            )

        # Aggregated teen rows (SCIT = CIT+SIT summed; TLI), in live and week mode, but
        # not for single-session drill-downs (teens have no AG children / drill target).
        if session_cm_id is None:
            session_forecasts.extend(
                self._build_teen_forecast_rows(
                    sessions,
                    enrolled_attendees,
                    waitlisted_attendees,
                    budget_config,
                    reconstruction=reconstruction,
                    prior_by_type=prior_by_type[0],
                    two_year_by_type=prior_by_type[1],
                )
            )

        # Grand total over everything displayed — teen rows included (they're a
        # shown cohort, so the total reflects them).
        grand_total = self._compute_grand_total(session_forecasts, section_priors)

        return ForecastResponse(
            year=year,
            sessions=session_forecasts,
            grand_total=grand_total,
            week_number=(day_offset // 7) + 1 if day_offset is not None else None,
            day_offset=day_offset,
            prior_basis=prior_basis,
            section_priors=section_priors,
        )

    async def _fetch_anchor(self, year: int) -> date | None:
        """The year's registration anchor (priority, else early), or None when unset."""
        reg_dates = await self.repository.fetch_registration_dates(year)
        anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date")
        if not anchor_str:
            return None
        return date.fromisoformat(parse_date_only(anchor_str))

    async def _fetch_scope_prior_by_type(
        self,
        year: int,
        session_types: list[str],
        session_cm_id: int | None,
        duration: str | None,
        reference_name: str | None,
        offset: int | None,
        week0_window: bool,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Last year's and two years ago's whole-scope enrolled counts, by session type.

        The prior scope is resolved the way this year's is (``resolve_scope_ids``):
        summer types only, teens window-gated, AG cabins as members, retired
        sessions included. A type with no in-scope session is absent (no
        comparison), a type with sessions but no attendees is 0. Failures leave
        that year empty so the forecast still returns.
        """
        results: list[dict[str, int]] = []
        for offset_years in (1, 2):
            try:
                results.append(
                    await self._count_scope_by_type(
                        year - offset_years,
                        session_types,
                        session_cm_id,
                        duration,
                        reference_name,
                        offset,
                        week0_window,
                    )
                )
            except Exception:
                logger.warning(
                    "Failed to compute %d-year-prior scope total, continuing without comparison",
                    offset_years,
                    exc_info=True,
                )
                results.append({})
        return results[0], results[1]

    async def _count_scope_by_type(
        self,
        prior_year: int,
        session_types: list[str],
        session_cm_id: int | None,
        duration: str | None,
        reference_name: str | None,
        offset: int | None,
        week0_window: bool,
    ) -> dict[str, int]:
        # The resolver needs the year's mains to define the teen summer window.
        fetch_types = list(dict.fromkeys([*session_types, "main"]))
        all_sessions = await self.repository.fetch_sessions(prior_year, fetch_types)
        if not all_sessions:
            return {}
        scope_ids = resolve_scope_ids(all_sessions, session_types, session_cm_id, duration, reference_name)
        scope = {sid: all_sessions[sid] for sid in scope_ids if sid in all_sessions}
        if not scope:
            return {}

        counts: dict[int, int]
        if offset is None:
            counts = {}
            for a in await self.repository.fetch_attendees(prior_year):
                att_session = get_session_from_expand(a)
                att_cm_id = getattr(att_session, "cm_id", None) if att_session else None
                if att_cm_id in scope:
                    counts[att_cm_id] = counts.get(att_cm_id, 0) + 1
        else:
            prior_anchor = await self._fetch_anchor(prior_year)
            if prior_anchor is None:
                return {}
            counts = await reconstruct_enrollment_at_offset(
                self.repository,
                prior_year,
                scope,
                offset,
                datetime(prior_anchor.year, prior_anchor.month, prior_anchor.day),  # noqa: DTZ001
                week0_window=week0_window,
            )

        by_type: dict[str, int] = {}
        for sid, sess in scope.items():
            stype = getattr(sess, "session_type", "")
            by_type[stype] = by_type.get(stype, 0) + counts.get(sid, 0)
        return by_type

    @staticmethod
    def _build_section_priors(
        session_types: list[str],
        prior_by_type: tuple[dict[str, int], dict[str, int]],
    ) -> dict[str, ForecastPriorTotals]:
        """Fold per-type prior counts into the camp / quest / teen section totals."""
        sections = list(dict.fromkeys(_SECTION_BY_TYPE[t] for t in session_types if t in _SECTION_BY_TYPE))

        def total(by_type: dict[str, int], section: str) -> int | None:
            present = [c for t, c in by_type.items() if _SECTION_BY_TYPE.get(t) == section]
            return sum(present) if present else None

        return {
            section: ForecastPriorTotals(
                prior_year_count=total(prior_by_type[0], section),
                two_year_prior_count=total(prior_by_type[1], section),
            )
            for section in sections
        }

    def _count_attendees_for_session(
        self,
        attendees: list[Any],
        session_cm_id: int,
        ag_children: set[int],
    ) -> int:
        """Count attendees for a session including AG children."""
        count, _, _ = self._count_attendees_with_gender_for_session(attendees, session_cm_id, ag_children)
        return count

    def _count_attendees_with_gender_for_session(
        self,
        attendees: list[Any],
        session_cm_id: int,
        ag_children: set[int],
    ) -> tuple[int, int | None, int | None]:
        """Count attendees for a session with gender breakdown.

        Returns (count, boys, girls). Boys/girls are None if no attendees
        have gender data; otherwise integer counts (may be 0).
        """
        count = 0
        boys = 0
        girls = 0
        has_gender = False
        for a in attendees:
            session = get_session_from_expand(a)
            if not session:
                continue
            att_cm_id = getattr(session, "cm_id", None)
            if att_cm_id == session_cm_id or att_cm_id in ag_children:
                count += 1
                person = get_person_from_expand(a)
                gender = getattr(person, "gender", None) if person else None
                if gender is not None:
                    has_gender = True
                    if gender == "M":
                        boys += 1
                    elif gender == "F":
                        girls += 1
        return count, (boys if has_gender else None), (girls if has_gender else None)

    async def _fetch_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        day_offset: int | None,
        duration: str | None = None,
        week0_window: bool = True,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Fetch prior year and two-year-prior enrollment counts by canonical session name.

        When day_offset is set, uses reconstruction at the same offset relative to
        each prior year's own registration anchor. When None, uses live attendee data.

        Args:
            year: Current year.
            session_types: Session types to include.
            day_offset: Days since registration anchor, or None for live data.
            duration: Duration category filter (e.g., '1-week'). When set, only
                prior-year sessions matching this duration are included.

        Returns:
            Tuple of (prior_year_counts, two_year_prior_counts), each mapping
            canonical session name to enrolled count. Empty dicts on failure.
        """
        try:
            if day_offset is not None:
                return await self._reconstruct_prior_year_counts(
                    year, session_types, day_offset, duration, week0_window
                )
            else:
                return await self._fetch_live_prior_year_counts(year, session_types, duration)
        except Exception:
            logger.warning(
                "Failed to fetch prior year data, continuing without comparison",
                exc_info=True,
            )
            return {}, {}

    async def _fetch_live_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        duration: str | None = None,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Fetch prior year counts from live attendee data (existing behavior)."""
        prior_sessions, prior_attendees, two_year_sessions, two_year_attendees = await asyncio.gather(
            self.repository.fetch_sessions(year - 1, session_types),
            self.repository.fetch_attendees(year - 1),
            self.repository.fetch_sessions(year - 2, session_types),
            self.repository.fetch_attendees(year - 2),
        )

        # Filter prior-year sessions by duration category
        if duration:
            prior_duration_ids = resolve_duration_sessions(prior_sessions, duration)
            prior_sessions = {sid: s for sid, s in prior_sessions.items() if sid in prior_duration_ids}
            two_year_duration_ids = resolve_duration_sessions(two_year_sessions, duration)
            two_year_sessions = {sid: s for sid, s in two_year_sessions.items() if sid in two_year_duration_ids}

        prior_counts = self._count_by_session_name(prior_sessions, prior_attendees)
        two_year_counts = self._count_by_session_name(two_year_sessions, two_year_attendees)
        return prior_counts, two_year_counts

    async def _reconstruct_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        day_offset: int,
        duration: str | None = None,
        week0_window: bool = True,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Reconstruct prior year counts at the same day_offset using each year's anchor."""
        prior_counts: dict[str, int] = {}
        two_year_counts: dict[str, int] = {}

        for offset_years, target_counts in [(1, prior_counts), (2, two_year_counts)]:
            prior_year = year - offset_years
            try:
                prior_sessions = await self.repository.fetch_sessions(prior_year, session_types)
                if not prior_sessions:
                    continue

                # Filter prior-year sessions by duration category
                if duration:
                    dur_ids = resolve_duration_sessions(prior_sessions, duration)
                    prior_sessions = {sid: s for sid, s in prior_sessions.items() if sid in dur_ids}
                    if not prior_sessions:
                        continue

                prior_reg_dates = await self.repository.fetch_registration_dates(prior_year)
                prior_anchor_str = prior_reg_dates.get("priority_reg_date") or prior_reg_dates.get("early_reg_date")
                if not prior_anchor_str:
                    continue

                prior_season_start = datetime.strptime(parse_date_only(prior_anchor_str), "%Y-%m-%d")

                reconstructed = await reconstruct_enrollment_at_offset(
                    self.repository,
                    prior_year,
                    prior_sessions,
                    day_offset,
                    prior_season_start,
                    ag_parent_map=None,
                    week0_window=week0_window,
                )

                # Convert cm_id → prior-count keys (canonical name; AG also cm_id/parent)
                for cm_id, count in reconstructed.items():
                    session_obj = prior_sessions.get(cm_id)
                    if session_obj:
                        for key in self._prior_count_keys(cm_id, session_obj, prior_sessions):
                            target_counts[key] = target_counts.get(key, 0) + count
            except Exception:
                logger.warning(
                    "Failed to reconstruct %d-year-prior data, skipping",
                    offset_years,
                    exc_info=True,
                )

        return prior_counts, two_year_counts

    def _count_by_session_name(
        self,
        sessions: dict[int, Any],
        attendees: list[Any],
    ) -> dict[str, int]:
        """Count enrolled attendees by session name (each session uses its own name)."""
        cm_id_to_keys: dict[int, list[str]] = {
            sid: self._prior_count_keys(sid, session, sessions) for sid, session in sessions.items()
        }

        counts: dict[str, int] = {}
        for a in attendees:
            session = get_session_from_expand(a)
            if not session:
                continue
            att_cm_id: int | None = getattr(session, "cm_id", None)
            keys = cm_id_to_keys.get(att_cm_id, []) if att_cm_id is not None else []
            for key in keys:
                counts[key] = counts.get(key, 0) + 1
        return counts

    @staticmethod
    def _ag_parent_key(session: Any, sessions: dict[int, Any]) -> str | None:
        """Prior-count key for an AG session's PARENT (None when the parent is unknown).

        AG cabin names carry a grade band that changes most years, so AG rows are
        matched across years by the alias-canonical name of their parent session.
        """
        parent_id = getattr(session, "parent_id", None)
        parent = sessions.get(int(parent_id)) if parent_id else None
        if parent is None:
            return None
        parent_name = resolve_session_alias(getattr(parent, "name", ""))
        return f"ag-parent:{parent_name}" if parent_name else None

    def _prior_count_keys(self, cm_id: int, session: Any, sessions: dict[int, Any]) -> list[str]:
        """Keys under which a prior-year session's enrolled count is accumulated.

        Non-AG: the alias-canonical name (unchanged). AG: cm_id, exact (canonical)
        name, and the parent key, so the current row can pick the right match.
        """
        canonical = resolve_session_alias(getattr(session, "name", ""))
        if getattr(session, "session_type", "") != "ag":
            return [canonical] if canonical else []
        keys = [f"ag-cm:{cm_id}"]
        if canonical:
            keys.append(f"ag-name:{canonical}")
        parent_key = self._ag_parent_key(session, sessions)
        if parent_key:
            keys.append(parent_key)
        return keys

    def _resolve_ag_priors(self, counts: dict[str, int], sessions: dict[int, Any]) -> dict[int, int | None]:
        """Prior count for every current-year AG row, resolved per PARENT (decision 43).

        A lone AG row under its parent takes the SUM of the prior year's AG cabins
        under the matching parent. With several AG rows under one parent each keeps
        its own cm_id, then exact-name, match. The remainder (the parent-level sum
        minus the matched cabins) goes to the FIRST unmatched sibling in the order the
        page shows them (see _page_row_compare), so the rows add up to the section
        prior; further unmatched siblings stay None ("new"). Nothing is attributed
        when every sibling matched or the remainder is not positive, so a retired
        cabin is never double counted.
        """
        by_parent: dict[Any, list[int]] = {}
        for sid, session in sessions.items():
            if getattr(session, "session_type", "") == "ag":
                by_parent.setdefault(getattr(session, "parent_id", None), []).append(sid)

        def own_match(session: Any) -> int | None:
            cm_id = getattr(session, "cm_id", None)
            if cm_id is not None and f"ag-cm:{cm_id}" in counts:
                return counts[f"ag-cm:{cm_id}"]
            canonical = resolve_session_alias(getattr(session, "name", ""))
            return counts.get(f"ag-name:{canonical}") if canonical else None

        def page_order(a: int, b: int) -> int:
            return _page_row_compare(sessions[a], sessions[b])

        resolved: dict[int, int | None] = {}
        for unordered_ids in by_parent.values():
            # A stable sort over the API row order (sessions order), as the page's toSorted is
            sibling_ids = sorted(unordered_ids, key=cmp_to_key(page_order))
            parent_key = self._ag_parent_key(sessions[sibling_ids[0]], sessions)
            parent_sum = counts.get(parent_key) if parent_key else None
            if len(sibling_ids) == 1 and parent_sum is not None:
                resolved[sibling_ids[0]] = parent_sum
                continue
            matched = {sid: own_match(sessions[sid]) for sid in sibling_ids}
            resolved.update(matched)
            unmatched = [sid for sid in sibling_ids if matched[sid] is None]
            if parent_sum is not None and unmatched:
                remainder = parent_sum - sum(v for v in matched.values() if v is not None)
                if remainder > 0:
                    resolved[unmatched[0]] = remainder
        return resolved

    def _compute_grand_total(
        self,
        session_forecasts: list[SessionForecast],
        section_priors: dict[str, ForecastPriorTotals],
    ) -> SessionForecast:
        """Compute grand total across all sessions.

        Enrolled, goals and revenue sum the displayed rows. The prior-year
        comparison is last year's WHOLE-SCOPE total (sum of the section priors),
        not the sum of the rows that happened to match a current session.
        """
        total_enrolled = sum(s.enrolled for s in session_forecasts)
        # Unknown (None) when no row has a waitlist figure, e.g. week mode
        has_waitlist = any(s.waitlisted is not None for s in session_forecasts)
        total_waitlisted = sum(s.waitlisted or 0 for s in session_forecasts)
        total_goal = sum(s.participant_goal or 0 for s in session_forecasts)
        priors = [p.prior_year_count for p in section_priors.values() if p.prior_year_count is not None]
        two_year_priors = [
            p.two_year_prior_count for p in section_priors.values() if p.two_year_prior_count is not None
        ]
        total_prior = sum(priors)
        total_two_year = sum(two_year_priors)

        has_goal = any(s.participant_goal is not None for s in session_forecasts)
        has_prior = bool(priors)
        has_two_year = bool(two_year_priors)

        pct_of_goal = None
        if has_goal and total_goal > 0:
            pct_of_goal = round(total_enrolled / total_goal * 100, 1)

        # Delta fields from totals
        participants_vs_budget = total_enrolled - total_goal if has_goal else None
        participants_vs_prior_year = total_enrolled - total_prior if has_prior else None

        total_budget_rev = sum(s.budget_revenue or 0 for s in session_forecasts)
        total_actual_rev = sum(s.actual_revenue or 0 for s in session_forecasts)
        has_revenue = any(s.budget_revenue is not None for s in session_forecasts)
        revenue_delta = total_actual_rev - total_budget_rev if has_revenue else None
        revenue_pct = None
        if has_revenue and total_budget_rev > 0:
            revenue_pct = round(total_actual_rev / total_budget_rev * 100, 1)

        # Gender totals (null-aware)
        total_boys = sum(s.enrolled_boys or 0 for s in session_forecasts)
        total_girls = sum(s.enrolled_girls or 0 for s in session_forecasts)
        has_gender = any(s.enrolled_boys is not None for s in session_forecasts)

        return SessionForecast(
            session_cm_id=0,
            session_name="Grand Total",
            session_type="total",
            participant_goal=total_goal if has_goal else None,
            session_fee=None,
            enrolled=total_enrolled,
            waitlisted=total_waitlisted if has_waitlist else None,
            pct_of_goal=pct_of_goal,
            prior_year_count=total_prior if has_prior else None,
            two_year_prior_count=total_two_year if has_two_year else None,
            participants_vs_budget=participants_vs_budget,
            participants_vs_prior_year=participants_vs_prior_year,
            budget_revenue=total_budget_rev if has_revenue else None,
            actual_revenue=total_actual_rev if has_revenue else None,
            revenue_delta=revenue_delta,
            revenue_pct=revenue_pct,
            enrolled_boys=total_boys if has_gender else None,
            enrolled_girls=total_girls if has_gender else None,
        )

    def _build_teen_forecast_rows(
        self,
        sessions: dict[int, Any],
        enrolled_attendees: list[Any],
        waitlisted_attendees: list[Any],
        budget_config: dict[int | str, dict[str, Any]],
        *,
        reconstruction: dict[int, dict[str, int | None]] | None = None,
        prior_by_type: dict[str, int] | None = None,
        two_year_by_type: dict[str, int] | None = None,
    ) -> list[SessionForecast]:
        """Aggregate window-gated teen sessions into one row per teen session_type.

        SCIT merges CIT + SIT; TLI is its own row. Budget/goal come from the
        per-type config key 'type:<name>'. Emitted in SUMMER_TEEN_TYPES order
        (scit, then tli). Counts come from live attendees, or from the
        reconstruction in week mode (where the waitlist is unknown, None). Both
        modes carry the gender split. Prior-year counts are by TYPE: the sum of
        last year's in-scope sessions of that type, on the same basis.
        """
        prior_by_type = prior_by_type or {}
        two_year_by_type = two_year_by_type or {}
        teen_cm_ids_by_type: dict[str, list[int]] = {}
        for sid, s in sessions.items():
            stype = getattr(s, "session_type", "")
            if stype in SUMMER_TEEN_TYPES:
                teen_cm_ids_by_type.setdefault(stype, []).append(sid)

        rows: list[SessionForecast] = []
        for teen_type in SUMMER_TEEN_TYPES:  # deterministic order: scit, then tli
            cm_ids = teen_cm_ids_by_type.get(teen_type)
            if not cm_ids:
                continue

            waitlisted: int | None
            if reconstruction is not None:
                rcs = [reconstruction.get(sid, {}) for sid in cm_ids]
                enrolled = sum(rc.get("enrolled") or 0 for rc in rcs)
                waitlisted = None
                boys_parts = [b for rc in rcs if (b := rc.get("enrolled_boys")) is not None]
                girls_parts = [g for rc in rcs if (g := rc.get("enrolled_girls")) is not None]
                enrolled_boys = sum(boys_parts) if boys_parts else None
                enrolled_girls = sum(girls_parts) if girls_parts else None
            else:
                triples = [
                    self._count_attendees_with_gender_for_session(enrolled_attendees, sid, set()) for sid in cm_ids
                ]
                enrolled = sum(t[0] for t in triples)
                live_boys = [t[1] for t in triples if t[1] is not None]
                live_girls = [t[2] for t in triples if t[2] is not None]
                enrolled_boys = sum(live_boys) if live_boys else None
                enrolled_girls = sum(live_girls) if live_girls else None
                waitlisted = sum(self._count_attendees_for_session(waitlisted_attendees, sid, set()) for sid in cm_ids)

            cfg = budget_config.get(teen_config_key(teen_type), {}) or {}
            participant_goal = cfg.get("participant_goal")
            session_fee = cfg.get("session_fee")

            pct_of_goal = None
            if participant_goal and participant_goal > 0:
                pct_of_goal = round(enrolled / participant_goal * 100, 1)

            budget_revenue = actual_revenue = revenue_delta = revenue_pct = None
            if participant_goal is not None and session_fee is not None:
                budget_revenue = participant_goal * session_fee
                actual_revenue = enrolled * session_fee
                revenue_delta = actual_revenue - budget_revenue
                if budget_revenue > 0:
                    revenue_pct = round(actual_revenue / budget_revenue * 100, 1)

            participants_vs_budget = enrolled - participant_goal if participant_goal is not None else None
            prior_year_count = prior_by_type.get(teen_type)
            two_year_prior_count = two_year_by_type.get(teen_type)
            participants_vs_prior_year = enrolled - prior_year_count if prior_year_count is not None else None

            rows.append(
                SessionForecast(
                    session_cm_id=0,
                    session_name=teen_display_name(teen_type),
                    session_type=teen_type,
                    participant_goal=participant_goal,
                    session_fee=session_fee,
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    pct_of_goal=pct_of_goal,
                    prior_year_count=prior_year_count,
                    two_year_prior_count=two_year_prior_count,
                    participants_vs_budget=participants_vs_budget,
                    participants_vs_prior_year=participants_vs_prior_year,
                    budget_revenue=budget_revenue,
                    actual_revenue=actual_revenue,
                    revenue_delta=revenue_delta,
                    revenue_pct=revenue_pct,
                    enrolled_boys=enrolled_boys,
                    enrolled_girls=enrolled_girls,
                )
            )
        return rows
