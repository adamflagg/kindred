"""Day 1 registration counting service.

Counts first-24h enrollments at each registration tier opening,
using 9am-9am PT windows for hour-accurate counting.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from api.schemas.day1 import (
    Day1Category,
    Day1CategoryCounts,
    Day1Response,
    Day1TierData,
    Day1YearData,
)
from api.services.camp_calendar import day1_window
from api.services.metrics_repository import MetricsRepository
from api.services.reconstruction import ENROLLMENT_STATUSES

logger = logging.getLogger(__name__)

CAMP_TZ = ZoneInfo("America/Los_Angeles")
AT_CAMP_TYPES = {"main", "embedded", "ag"}
QUEST_TYPES = {"quest"}

TIER_CONFIG = [
    ("priority", "priority_reg_date", "Priority Registration"),
    ("early", "early_reg_date", "Early Registration"),
    ("open", "open_reg_date", "Open Registration"),
]


class Day1Service:
    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_day1(self, year: int) -> Day1Response:
        """Get Day 1 registration counts for current year + 2 prior years."""
        current = await self._count_year(year)
        prior_years = []
        for offset in [1, 2]:
            prior = await self._count_year(year - offset)
            prior_years.append(Day1YearData(year=year - offset, tiers=prior))
        return Day1Response(year=year, tiers=current, prior_years=prior_years)

    async def _count_year(self, year: int) -> list[Day1TierData]:
        """Count Day 1 registrations for a single year."""
        reg_dates = await self.repository.fetch_registration_dates(year)
        if not reg_dates:
            return []

        sessions = await self.repository.fetch_sessions(year)
        attendees = await self.repository.fetch_attendees_with_dates(year)

        # Build session type lookup
        session_type_map: dict[int, str] = {}
        for cm_id, session in sessions.items():
            session_type_map[cm_id] = session.session_type

        tiers: list[Day1TierData] = []
        for tier_key, date_key, tier_label in TIER_CONFIG:
            date_str = reg_dates.get(date_key)
            if not date_str:
                continue

            tier_date = date.fromisoformat(date_str.split("T")[0].split(" ")[0])
            window_start, window_end = day1_window(tier_date)
            window_start_utc = window_start.astimezone(ZoneInfo("UTC"))
            window_end_utc = window_end.astimezone(ZoneInfo("UTC"))

            at_camp_count = 0
            quest_count = 0
            approximate = False

            for att in attendees:
                if att.status_id not in ENROLLMENT_STATUSES:
                    continue

                enroll_str = att.enrollment_date
                if not enroll_str:
                    continue

                try:
                    enroll_dt = datetime.fromisoformat(enroll_str)
                except (ValueError, TypeError):
                    continue

                # Ensure timezone-aware (PocketBase stores UTC)
                if enroll_dt.tzinfo is None:
                    enroll_dt = enroll_dt.replace(tzinfo=ZoneInfo("UTC"))

                # Check if all timestamps are midnight (date-only precision)
                if enroll_dt.hour == 0 and enroll_dt.minute == 0 and enroll_dt.second == 0:
                    eff_str = att.effective_date
                    if eff_str:
                        eff_date_str = eff_str.split("T")[0].split(" ")[0]
                        if eff_date_str != tier_date.isoformat():
                            continue
                        approximate = True
                    else:
                        continue
                else:
                    if not (window_start_utc <= enroll_dt < window_end_utc):
                        continue

                # Categorize by session type
                stype = session_type_map.get(att.session_cm_id, "")
                if stype in AT_CAMP_TYPES:
                    at_camp_count += 1
                elif stype in QUEST_TYPES:
                    quest_count += 1

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
                    approximate=approximate,
                )
            )

        return tiers
