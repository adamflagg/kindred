"""Day 1 registration counting service.

Counts first-24h enrollments at each registration tier opening
by matching attendee effective_date against tier opening dates.
"""

import asyncio
from datetime import date, datetime

from api.schemas.day1 import (
    Day1Category,
    Day1CategoryCounts,
    Day1Response,
    Day1TierData,
    Day1YearData,
)
from api.services.camp_calendar import REGISTRATION_TIERS, day1_window
from api.services.metrics_repository import MetricsRepository
from api.services.reconstruction import ENROLLMENT_STATUSES, parse_date_only
from api.utils.session_metrics import filter_attendees_by_session, get_session_from_expand
from bunking.logging_config import get_logger

logger = get_logger(__name__)

AT_CAMP_TYPES = {"main", "embedded", "ag"}
QUEST_TYPES = {"quest"}


class Day1Service:
    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_day1(self, year: int, session_types: list[str] | None = None) -> Day1Response:
        """Get Day 1 registration counts for current year + 2 prior years.

        Args:
            year: The camp year to compute counts for.
            session_types: Optional list of session types to include
                (e.g. ``["main", "quest"]``). ``None`` preserves existing
                behaviour and counts all attendees regardless of session type.
        """
        current, prior_1, prior_2 = await asyncio.gather(
            self._count_year(year, session_types),
            self._count_year(year - 1, session_types),
            self._count_year(year - 2, session_types),
        )
        prior_years = [
            Day1YearData(year=year - 1, tiers=prior_1),
            Day1YearData(year=year - 2, tiers=prior_2),
        ]
        return Day1Response(year=year, tiers=current, prior_years=prior_years)

    async def _count_year(self, year: int, session_types: list[str] | None = None) -> list[Day1TierData]:
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

        # Apply session type filter when specified
        if session_types is not None:
            attendees = filter_attendees_by_session(attendees, session_types)

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

        # Per-tier counters: tier_key -> {at_camp, quest, approximate}
        counts: dict[str, dict[str, int]] = {tw[0]: {"at_camp": 0, "quest": 0} for tw in tier_windows}
        approximate_flags: dict[str, bool] = {tw[0]: False for tw in tier_windows}

        # Build tier date lookup for simple date comparison
        tier_dates: list[tuple[str, date]] = [(tw[0], tw[3]) for tw in tier_windows]

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

            for tier_key, tier_date in tier_dates:
                if eff_date_str != tier_date.isoformat():
                    continue
                approximate_flags[tier_key] = True

                if stype in AT_CAMP_TYPES:
                    counts[tier_key]["at_camp"] += 1
                elif stype in QUEST_TYPES:
                    counts[tier_key]["quest"] += 1

        # Build response
        tiers: list[Day1TierData] = []
        for tier_key, _date_key, tier_label, tier_date, window_start, window_end in tier_windows:
            at_camp_count = counts[tier_key]["at_camp"]
            quest_count = counts[tier_key]["quest"]
            total = at_camp_count + quest_count
            categories = [
                Day1Category(category="at_camp", label="At Camp", count=at_camp_count),
                Day1Category(category="quest", label="Quest", count=quest_count),
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
