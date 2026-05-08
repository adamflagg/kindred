"""Capture a snapshot of the solver_config collection at solver-run time.

The snapshot is stored alongside each solver_run's other tagging metadata
(git SHA, source label, etc.) so historical runs remain interpretable
weeks later — you can see exactly which knobs were set when the run executed.
"""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

logger = get_logger("api.services.config_snapshot")


async def snapshot_solver_config(pb: Any) -> dict[str, str]:
    """Return all solver_config rows as ``{config_key: config_value}``.

    Best-effort: returns ``{}`` if the fetch fails so a transient PB outage
    doesn't prevent solver runs from being persisted.
    """
    try:
        records = await pb.collection("solver_config").get_full_list()
        return {r.config_key: r.config_value for r in records}
    except Exception as e:
        logger.warning("solver_config snapshot failed: %s", e)
        return {}
