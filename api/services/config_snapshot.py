"""Capture a snapshot of the solver-relevant `config` rows at solver-run time.

The snapshot is stored alongside each solver_run's other tagging metadata
(git SHA, source label, etc.) so historical runs remain interpretable
weeks later — you can see exactly which knobs were set when the run executed.

Schema reference (per migration `1500000011_config.js`):
- collection name: ``config``
- relevant columns: ``category``, ``subcategory``, ``config_key``, ``value``
- the dot-notation key seen in the GUI is reconstructed from
  ``f"{category}.{subcategory + '.' if subcategory else ''}{config_key}"``
- solver-relevant categories are ``constraint``, ``objective``, ``soft``,
  ``solver`` — all other rows (ai/tour/spread/etc.) are out of scope here.
"""

from __future__ import annotations

import asyncio
from typing import Any

from bunking.logging_config import get_logger

logger = get_logger("api.services.config_snapshot")

# Categories whose rows constitute the "solver knobs" surface — mirrors the
# `getBusinessCategory` helper in the seed migration. Pinned here rather than
# fetched dynamically so a config-collection misconfiguration can't silently
# expand the snapshot scope.
_SOLVER_CATEGORIES: tuple[str, ...] = ("constraint", "objective", "soft", "solver")


def _build_filter() -> str:
    """PocketBase filter restricting the snapshot to solver-relevant rows."""
    # Spaces around operators per project convention (CLAUDE.md).
    return " || ".join(f'category = "{c}"' for c in _SOLVER_CATEGORIES)


def _dot_key(record: Any) -> str:
    """Reconstruct the dot-notation key the GUI/loader use from a config row."""
    category = getattr(record, "category", "") or ""
    subcategory = getattr(record, "subcategory", None) or ""
    config_key = getattr(record, "config_key", "") or ""
    parts = [category, *([subcategory] if subcategory else []), config_key]
    return ".".join(p for p in parts if p)


async def snapshot_solver_config(pb: Any) -> dict[str, str]:
    """Return solver-relevant config rows as ``{dot.key: str(value)}``.

    Best-effort: returns ``{}`` if the fetch fails so a transient PB outage
    doesn't prevent solver runs from being persisted. The PocketBase client
    used in this codebase is sync, so we offload the call to a thread.

    Values are coerced to ``str`` so historical rows don't drift across runs
    when the same JSON column happens to round-trip as int vs. float vs. bool.
    """
    try:
        records = await asyncio.to_thread(
            pb.collection("config").get_full_list,
            query_params={"filter": _build_filter()},
        )
        return {_dot_key(r): str(getattr(r, "value", "")) for r in records}
    except Exception as e:
        logger.warning("solver_config snapshot failed: %s", e)
        return {}
