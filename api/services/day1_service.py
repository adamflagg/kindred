"""Day 1 registration counting service.

Counts first-two-day enrollments at each registration tier opening by matching
attendee effective_date against the tier opening date and the following day
(decision 45: in 2023 and 2025 CampMinder dated most opening-day sign-ups the
following day).
"""

import asyncio
from datetime import date, datetime, timedelta

from api.schemas.day1 import (
    Day1Category,
    Day1CategoryCounts,
    Day1Response,
    Day1TierData,
    Day1YearData,
)
from api.services.camp_calendar import PRIORITY_DAY_DAYS, REGISTRATION_TIERS, day1_window, get_camp_today
from api.services.metrics_repository import MetricsRepository
from api.services.reconstruction import ENROLLMENT_STATUSES, parse_date_only
from api.utils.session_metrics import (
    SUMMER_TEEN_TYPES,
    get_session_from_expand,
    resolve_scope_ids,
)
from bunking.logging_config import get_logger

logger = get_logger(__name__)

AT_CAMP_TYPES = {"main", "embedded", "ag"}
QUEST_TYPES = {"quest"}
TEEN_TYPES = set(SUMMER_TEEN_TYPES)


class Day1Service:
    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_day1(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
        today: date | None = None,
    ) -> Day1Response:
        """Get Day 1 registration counts for current year + 2 prior years.

        Args:
            year: The camp year to compute counts for.
            session_types: Optional list of session types to include
                (e.g. ``["main", "quest"]``). ``None`` preserves the existing
                summer behaviour (At Camp + Quest); teens (scit/tli) are counted
                whenever the request is scoped (``session_types``, a single
                session, or a duration).
            session_cm_id: Optional single session (with its AG cabins). Prior
                years match it with the session resolver (cm_id, alias group,
                exact name), so renamed sessions line up; no match counts 0.
            duration: Optional duration category ("1-week", ...).
            today: Override for the current camp date (for testing). Defaults to get_camp_today().
        """
        reference_name: str | None = None
        if session_cm_id is not None:
            picked = (await self.repository.fetch_sessions(year)).get(session_cm_id)
            reference_name = getattr(picked, "name", None) or None

        current, prior_1, prior_2 = await asyncio.gather(
            self._count_year(year, session_types, session_cm_id, duration, reference_name),
            self._count_year(year - 1, session_types, session_cm_id, duration, reference_name),
            self._count_year(year - 2, session_types, session_cm_id, duration, reference_name),
        )
        # Ruling 4 (owner, 2026-10-14): on a phase's opening date (day 0 only) this year holds just
        # that day until the next morning's sync, while every prior year holds both days. Only the
        # current year is flagged; the page reads "updates tomorrow" in place of the comparison.
        camp_today = (today or get_camp_today()).isoformat()
        for tier in current:
            tier.opening_day = tier.date == camp_today
        prior_years = [
            Day1YearData(year=year - 1, tiers=prior_1),
            Day1YearData(year=year - 2, tiers=prior_2),
        ]
        return Day1Response(year=year, tiers=current, prior_years=prior_years)

    async def _count_year(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
        reference_name: str | None = None,
    ) -> list[Day1TierData]:
        """Count Day 1 registrations for a single year.

        Single-pass: iterates attendees once, bucketing each into matching tier windows.
        """
        reg_dates = await self.repository.fetch_registration_dates(year)
        if not reg_dates:
            return []

        sessions = await self.repository.fetch_sessions(year)
        attendees = await self.repository.fetch_attendees_with_dates(year)

        # Build session type lookup
        session_type_map: dict[int, str] = {}
        for cm_id, session in sessions.items():
            session_type_map[cm_id] = session.session_type

        # Scope through the shared session resolver whenever the caller narrows
        # anything (types, one session, a duration): summer types only, teen types
        # gated to the summer window, a pick matched in THIS year and its AG cabins
        # folded in. The param-less path keeps the historical At Camp + Quest scope.
        # Teens count whenever the resolver scopes the request, because its scope
        # includes them: only the param-less path keeps teens out.
        scoped = session_types is not None or session_cm_id is not None or bool(duration)
        count_teens = scoped
        if scoped:
            scope = resolve_scope_ids(sessions, session_types, session_cm_id, duration, reference_name)
            attendees = [
                att
                for att in attendees
                if (sess := get_session_from_expand(att)) is not None and int(sess.cm_id) in scope
            ]

        # Pre-compute tier windows
        tier_windows: list[tuple[str, str, str, date, datetime, datetime]] = []
        for tier_key, date_key, tier_label in REGISTRATION_TIERS:
            date_str = reg_dates.get(date_key)
            if not date_str:
                continue
            tier_date = date.fromisoformat(parse_date_only(date_str))
            window_start, window_end = day1_window(tier_date)
            tier_windows.append((tier_key, date_key, tier_label, tier_date, window_start, window_end))

        if not tier_windows:
            return []

        # Per-tier counters: tier_key -> {at_camp, quest, teen}
        counts: dict[str, dict[str, int]] = {tw[0]: {"at_camp": 0, "quest": 0, "teen": 0} for tw in tier_windows}
        approximate_flags: dict[str, bool] = {tw[0]: False for tw in tier_windows}

        # Each tier counts the ISO dates of its first PRIORITY_DAY_DAYS days (decision 45).
        tier_dates: list[tuple[str, frozenset[str]]] = [
            (tw[0], frozenset((tw[3] + timedelta(days=d)).isoformat() for d in range(PRIORITY_DAY_DAYS)))
            for tw in tier_windows
        ]

        # Single pass over attendees
        for att in attendees:
            if att.status_id not in ENROLLMENT_STATUSES:
                continue

            # Use effective_date (actual enrollment date from CampMinder)
            eff_str = getattr(att, "effective_date", "") or ""
            if not eff_str:
                continue

            eff_date_str = parse_date_only(eff_str)

            # Determine session type once per attendee
            session = get_session_from_expand(att)
            sid = int(session.cm_id) if session else 0
            stype = session_type_map.get(sid, "")

            for tier_key, day_strs in tier_dates:
                if eff_date_str not in day_strs:
                    continue
                approximate_flags[tier_key] = True

                if stype in AT_CAMP_TYPES:
                    counts[tier_key]["at_camp"] += 1
                elif stype in QUEST_TYPES:
                    counts[tier_key]["quest"] += 1
                elif count_teens and stype in TEEN_TYPES:
                    counts[tier_key]["teen"] += 1

        # Build response
        tiers: list[Day1TierData] = []
        for tier_key, _date_key, tier_label, tier_date, window_start, window_end in tier_windows:
            at_camp_count = counts[tier_key]["at_camp"]
            quest_count = counts[tier_key]["quest"]
            teen_count = counts[tier_key]["teen"]
            total = at_camp_count + quest_count + teen_count
            categories = [
                Day1Category(category="at_camp", label="At Camp", count=at_camp_count),
                Day1Category(category="quest", label="Quest", count=quest_count),
                Day1Category(category="teen", label="Teens", count=teen_count),
            ]
            tiers.append(
                Day1TierData(
                    tier=tier_key,
                    tier_label=tier_label,
                    date=tier_date.isoformat(),
                    window_start=window_start.isoformat(),
                    window_end=window_end.isoformat(),
                    categories=categories,
                    total=Day1CategoryCounts(count=total),
                    approximate=approximate_flags[tier_key],
                )
            )

        return tiers
