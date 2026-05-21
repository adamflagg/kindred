"""Retention policy for pipeline debug data.

Dual policy (whichever triggers first):
- Time-based: delete runs older than MAX_AGE_DAYS
- Count-based: delete oldest runs when total exceeds MAX_RUNS
- Pinned runs exempt from both
- Atomic: deleting a run also deletes its traces and summaries
  (summaries cascade-delete via trace relation, but traces need explicit deletion)
"""

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
    cutoff = datetime.now(UTC) - timedelta(days=MAX_AGE_DAYS)
    cutoff_iso = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    to_delete: list[Any] = []

    # Time-based: fetch unpinned runs older than cutoff directly via PB filter
    expired_runs = pb.collection("debug_pipeline_runs").get_full_list(
        query_params={"filter": f'pinned = false && created < "{cutoff_iso}"', "sort": "-created"}
    )
    to_delete.extend(expired_runs)
    expired_ids = {r.id for r in expired_runs}

    # Count-based: fetch all unpinned runs (sorted newest-first) and trim excess
    unpinned = pb.collection("debug_pipeline_runs").get_full_list(
        query_params={"filter": "pinned = false", "sort": "-created"}
    )
    pinned_count = 0
    if unpinned:
        # Estimate pinned count from the difference to avoid an extra query
        total_check = pb.collection("debug_pipeline_runs").get_list(1, 1)
        pinned_count = total_check.total_items - len(unpinned)

    remaining_unpinned = [r for r in unpinned if r.id not in expired_ids]
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
