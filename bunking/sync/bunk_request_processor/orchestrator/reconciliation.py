"""Top-level OBR->BR pipeline reconciliation summary (issue #943).

Emits a single INFO line at the end of the pipeline so operators can verify
the full math - how many original_bunk_requests went in, where they were
filtered out, and how many bunk_requests came out - without querying
`debug_pipeline_traces` in SQL.

The line is additive: it supplements (does not replace) the existing
"Processing complete:" summary and per-phase reconciliation logs.
"""

from typing import Any

from bunking.logging_config import get_logger

logger = get_logger(__name__)


# Keys consumed by the formatter. All default to 0 if absent from the stats
# dict, so the call can never crash the pipeline on a missing counter.
_RECONCILIATION_KEYS = (
    "obr_input",
    "skipped_empty_field",
    "no_preference_only",
    "na_only",
    "ai_parse_requests",
    "phase1_successful",
    "phase1_failed",
    "direct_mapped",
    "pre_dedup_requests",
    "duplicates_removed",
    "self_referential_filtered",
    "requests_created",
    "status_resolved",
    "status_pending",
    "status_declined",
    # Phase C bidirectional enrollment reconciliation (#1069, #1375)
    "target_declined_count",
    "target_reopened_count",
    "target_declined_errors",
)


def format_obr_reconciliation(stats: dict[str, Any]) -> str:
    """Build the reconciliation log line from pipeline stats.

    Pure function (no side effects) to keep it trivially unit-testable.
    Missing keys are treated as 0 so the formatter is safe to call even when
    a phase is skipped.

    Args:
        stats: Orchestrator `_stats`-shaped dict. See `_RECONCILIATION_KEYS`
            for the counters consumed.

    Returns:
        Single-line string prefixed with "OBR reconciliation:" and sectioned
        by "|" separators so it survives grep/tail on a single log line.
    """
    s = {k: stats.get(k, 0) for k in _RECONCILIATION_KEYS}

    return (
        f"OBR reconciliation: {s['obr_input']} input"
        f" | {s['skipped_empty_field']} empty-field"
        f" + {s['no_preference_only']} no-preference"
        f" + {s['na_only']} NA-only skipped (pre-phase1)"
        f" | {s['ai_parse_requests']} AI-parsed"
        f" ({s['phase1_successful']} success,"
        f" {s['phase1_failed']} permanent parse failures)"
        f" + {s['direct_mapped']} direct-mapped"
        f" | {s['pre_dedup_requests']} pre-dedup requests"
        f" -> {s['duplicates_removed']} dedup"
        f" + {s['self_referential_filtered']} self-referential kept for review"
        f" | {s['requests_created']} BRs created"
        f" ({s['status_resolved']} resolved"
        f" / {s['status_pending']} pending"
        f" / {s['status_declined']} declined)"
        f" | Phase C: {s['target_declined_count']} target-declined"
        f" / {s['target_reopened_count']} target-reopened"
        f" ({s['target_declined_errors']} errors)"
    )


def log_obr_reconciliation(stats: dict[str, Any]) -> None:
    """Emit the reconciliation line at INFO level."""
    logger.info(format_obr_reconciliation(stats))
