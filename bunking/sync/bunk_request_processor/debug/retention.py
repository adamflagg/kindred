"""Retention policy for pipeline debug data.

Dual policy (whichever triggers first):
- Time-based: delete runs older than MAX_AGE_DAYS
- Count-based: delete oldest runs when total exceeds MAX_RUNS
- Pinned runs exempt from both
- Atomic: deleting a run also deletes its traces and summaries
  (summaries cascade-delete via trace relation, but traces need explicit deletion)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from bunking.logging_config import get_logger

logger = get_logger(__name__)

MAX_RUNS = 50
MAX_AGE_DAYS = 30


def cleanup_old_runs(pb: Any) -> int:
    """Delete old debug pipeline runs based on retention policy.

    Returns number of runs deleted.
    """
    all_runs = pb.collection("debug_pipeline_runs").get_full_list(query_params={"sort": "-created"})

    if not all_runs:
        return 0

    cutoff = datetime.now(UTC) - timedelta(days=MAX_AGE_DAYS)
    to_delete: list[Any] = []

    # Separate pinned and unpinned
    unpinned = [r for r in all_runs if not getattr(r, "pinned", False)]
    pinned_count = len(all_runs) - len(unpinned)

    # Time-based: delete unpinned runs older than cutoff
    for run in unpinned:
        created_str = getattr(run, "created", "")
        if not created_str:
            continue
        try:
            created = datetime.fromisoformat(str(created_str))
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            if created < cutoff:
                to_delete.append(run)
        except (ValueError, TypeError):
            continue

    # Count-based: if unpinned count exceeds MAX_RUNS, delete oldest
    remaining_unpinned = [r for r in unpinned if r not in to_delete]
    if len(remaining_unpinned) > MAX_RUNS:
        # remaining_unpinned is sorted -created, so tail is oldest
        excess = remaining_unpinned[MAX_RUNS:]
        to_delete.extend(excess)

    # Deduplicate
    seen_ids: set[str] = set()
    unique_to_delete: list[Any] = []
    for run in to_delete:
        if run.id not in seen_ids:
            seen_ids.add(run.id)
            unique_to_delete.append(run)

    # Atomic delete: traces first (summaries cascade from trace relation), then run
    deleted = 0
    for run in unique_to_delete:
        run_id = getattr(run, "run_id", "")
        try:
            # Delete traces for this run (summaries cascade-delete via trace relation)
            traces = pb.collection("debug_pipeline_traces").get_full_list(
                query_params={"filter": f'run_id = "{run_id}"'}
            )
            for trace in traces:
                pb.collection("debug_pipeline_traces").delete(trace.id)

            # Delete the run record
            pb.collection("debug_pipeline_runs").delete(run.id)
            deleted += 1
        except Exception as e:
            logger.warning("Failed to delete run %s: %s", run_id, e)

    if deleted > 0:
        logger.info("Retention cleanup: deleted %d runs (pinned: %d exempt)", deleted, pinned_count)

    return deleted
