"""Day 1 registration counting service.

Counts first-24h enrollments at each registration tier opening,
using 9am-9am PT windows for hour-accurate counting.
"""

from __future__ import annotations

import asyncio
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
        current, prior_1, prior_2 = await asyncio.gather(
            self._count_year(year),
            self._count_year(year - 1),
            self._count_year(year - 2),
        )
        prior_years = [
            Day1YearData(year=year - 1, tiers=prior_1),
            Day1YearData(year=year - 2, tiers=prior_2),
        ]
        return Day1Response(year=year, tiers=current, prior_years=prior_years)

    async def _count_year(self, year: int) -> list[Day1TierData]:
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

        # Pre-compute tier windows
        tier_windows: list[tuple[str, str, str, date, datetime, datetime]] = []
        for tier_key, date_key, tier_label in TIER_CONFIG:
            date_str = reg_dates.get(date_key)
            if not date_str:
                continue
            tier_date = date.fromisoformat(date_str.split("T")[0].split(" ")[0])
            window_start, window_end = day1_window(tier_date)
            tier_windows.append((tier_key, date_key, tier_label, tier_date, window_start, window_end))

        if not tier_windows:
            return []

        # Per-tier counters: tier_key -> {at_camp, quest, approximate}
        counts: dict[str, dict[str, int]] = {tw[0]: {"at_camp": 0, "quest": 0} for tw in tier_windows}
        approximate_flags: dict[str, bool] = {tw[0]: False for tw in tier_windows}

        # Pre-compute UTC windows once
        utc_windows = [
            (tw[0], tw[3], tw[4].astimezone(ZoneInfo("UTC")), tw[5].astimezone(ZoneInfo("UTC"))) for tw in tier_windows
        ]

        # Single pass over attendees
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

            if enroll_dt.tzinfo is None:
                enroll_dt = enroll_dt.replace(tzinfo=ZoneInfo("UTC"))

            is_midnight = enroll_dt.hour == 0 and enroll_dt.minute == 0 and enroll_dt.second == 0

            # Determine session type once per attendee
            expand = getattr(att, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            sid = int(session.cm_id) if session else 0
            stype = session_type_map.get(sid, "")

            for tier_key, tier_date, ws_utc, we_utc in utc_windows:
                if is_midnight:
                    eff_str = att.effective_date
                    if not eff_str:
                        continue
                    eff_date_str = eff_str.split("T")[0].split(" ")[0]
                    if eff_date_str != tier_date.isoformat():
                        continue
                    approximate_flags[tier_key] = True
                else:
                    if not (ws_utc <= enroll_dt < we_utc):
                        continue

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
