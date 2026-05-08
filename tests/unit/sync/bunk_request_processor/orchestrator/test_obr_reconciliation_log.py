"""Test top-level OBR->BR reconciliation summary log (issue #943).

TDD Red Phase: Verifies the reconciliation formatter produces a single log
line that allows an operator to reconcile the math from the log alone
without opening `debug_pipeline_traces`.
"""

from __future__ import annotations

import logging

import pytest

from bunking.sync.bunk_request_processor.orchestrator.reconciliation import (
    format_obr_reconciliation,
    log_obr_reconciliation,
)


class TestFormatObrReconciliation:
    """The pure formatter produces a predictable, grep-able reconciliation line."""

    def test_format_matches_proposed_shape_from_issue_943(self) -> None:
        """Counts from the issue body must render exactly as specified."""
        stats = {
            "obr_input": 1610,
            "skipped_empty_field": 3430,
            "no_preference_only": 57,
            "na_only": 1,
            "ai_parse_requests": 1016,
            "phase1_successful": 948,
            "phase1_failed": 68,
            "direct_mapped": 537,
            "pre_dedup_requests": 2397,
            "duplicates_removed": 94,
            "self_referential_filtered": 3,
            "requests_created": 2303,
            "status_resolved": 1909,
            "status_pending": 242,
            "status_declined": 152,
            "target_declined_count": 7,
            "target_declined_errors": 0,
        }

        line = format_obr_reconciliation(stats)

        expected = (
            "OBR reconciliation: 1610 input"
            " | 3430 empty-field + 57 no-preference + 1 NA-only skipped (pre-phase1)"
            " | 1016 AI-parsed (948 success, 68 permanent parse failures) + 537 direct-mapped"
            " | 2397 pre-dedup requests -> 94 dedup + 3 self-referential kept for review"
            " | 2303 BRs created (1909 resolved / 242 pending / 152 declined)"
            " | Phase C: 7 target-declined (0 errors)"
        )
        assert line == expected

    def test_format_handles_zeros_cleanly(self) -> None:
        """All-zeros stats still render without crashing (first-run / dry-run case)."""
        stats = dict.fromkeys(
            (
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
            ),
            0,
        )

        line = format_obr_reconciliation(stats)

        assert line.startswith("OBR reconciliation: 0 input")
        assert "0 BRs created (0 resolved / 0 pending / 0 declined)" in line

    def test_format_tolerates_missing_keys_as_zero(self) -> None:
        """Missing keys default to 0 so the log line can never crash the pipeline."""
        # Only provide the bare minimum
        stats = {"obr_input": 5, "requests_created": 2}

        line = format_obr_reconciliation(stats)

        assert "5 input" in line
        assert "2 BRs created" in line
        # Unspecified counts render as 0
        assert "0 empty-field" in line


class TestLogObrReconciliation:
    """The log emitter writes a single INFO line prefixed with the reconciliation tag."""

    def test_emits_single_info_log_line(self, caplog: pytest.LogCaptureFixture) -> None:
        stats = {
            "obr_input": 1610,
            "skipped_empty_field": 3430,
            "no_preference_only": 57,
            "na_only": 1,
            "ai_parse_requests": 1016,
            "phase1_successful": 948,
            "phase1_failed": 68,
            "direct_mapped": 537,
            "pre_dedup_requests": 2397,
            "duplicates_removed": 94,
            "self_referential_filtered": 3,
            "requests_created": 2303,
            "status_resolved": 1909,
            "status_pending": 242,
            "status_declined": 152,
        }

        with caplog.at_level(logging.INFO, logger="bunking.sync.bunk_request_processor.orchestrator.reconciliation"):
            log_obr_reconciliation(stats)

        reconciliation_logs = [r for r in caplog.records if r.message.startswith("OBR reconciliation:")]
        assert len(reconciliation_logs) == 1, (
            f"Expected exactly 1 reconciliation log line, got {len(reconciliation_logs)}"
        )
        assert reconciliation_logs[0].levelno == logging.INFO
        assert "1610 input" in reconciliation_logs[0].message
        assert "2303 BRs created" in reconciliation_logs[0].message
