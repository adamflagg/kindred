"""Shared reconstruction module for enrollment history aggregation.

Extracts the core daily-aggregation logic from velocity service so both
velocity and forecast can reconstruct enrollment counts from attendee records.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository


async def reconstruct_enrollment_at_offset(
    repository: MetricsRepository,
    year: int,
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
) -> dict[int, int]:
    """Reconstruct net enrollment counts per session at a given day offset.

    Not yet implemented — stub for TDD red phase.
    """
    raise NotImplementedError("Implementation pending")
