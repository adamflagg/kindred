#!/usr/bin/env python3
"""Parser for sync script output to extract structured results."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class SyncResult:
    """Structured result from a sync operation."""

    status: str  # "success" or "failed"
    created: int = 0
    updated: int = 0
    skipped: int = 0
    locked: int = 0  # For assignments sync
    orphaned: int = 0  # For assignments sync
    errors: int = 0
    duration_seconds: float = 0.0
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON storage."""
        return {
            "status": self.status,
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "locked": self.locked,
            "orphaned": self.orphaned,
            "errors": self.errors,
            "duration_seconds": self.duration_seconds,
            "message": self.message,
        }


class SyncResultParser:
    """Parser for sync script log output."""

    def parse(self, log_output: str) -> SyncResult:
        """Parse sync log output and extract structured results.

        Args:
            log_output: Raw log output from sync script

        Returns:
            SyncResult with parsed data
        """
        if not log_output.strip():
            return SyncResult(status="failed", message="No sync output to parse")

        result = SyncResult(status="success", message="Sync completed successfully")

        # Extract counts using regex patterns
        patterns = {
            "created": r"[Cc]reated:\s*(\d+)",
            "updated": r"[Uu]pdated:\s*(\d+)",
            "skipped": r"[Ss]kipped:\s*(\d+)",
            "locked": r"[Ll]ocked:\s*(\d+)",
            "orphaned": r"[Oo]rphaned:\s*(\d+)",  # May include "(removed)" text
            "errors": r"[Ee]rrors?:\s*(\d+)",
        }

        for field, pattern in patterns.items():
            match = re.search(pattern, log_output)
            if match:
                setattr(result, field, int(match.group(1)))

        # Check for rate limit errors specifically
        if "rate limit exceeded (429)" in log_output.lower() or "429" in log_output:
            result.status = "failed"
            result.message = "Sync failed due to API rate limiting (HTTP 429). Please wait and try again later."
            result.errors = max(result.errors, 1)
        # Determine status based on errors and completion
        elif result.errors > 0:
            result.status = "failed"
            result.message = f"Sync completed with {result.errors} errors occurred"
        elif "SYNC COMPLETE" in log_output.upper():
            result.status = "success"
        elif "Critical error" in log_output or "ERROR" in log_output:
            result.status = "failed"
            result.errors = max(result.errors, 1)  # Ensure at least 1 error

            # Try to extract error message
            error_match = re.search(r"ERROR\s*-\s*(.+?)(?:\n|$)", log_output)
            if error_match:
                error_msg = error_match.group(1).strip()
                if "Critical error" in error_msg:
                    result.message = error_msg
                else:
                    result.message = f"Sync failed: {error_msg}"
            else:
                result.message = "Sync incomplete or failed"

        # Calculate duration from timestamps
        result.duration_seconds = self._calculate_duration(log_output)

        return result

    def _calculate_duration(self, log_output: str) -> float:
        """Calculate duration from start and end timestamps in logs.

        Args:
            log_output: Raw log output

        Returns:
            Duration in seconds, or 0.0 if cannot be determined
        """
        # Pattern to match timestamp at beginning of log lines
        timestamp_pattern = r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})"

        timestamps = re.findall(timestamp_pattern, log_output)
        if len(timestamps) >= 2:
            try:
                # Parse first and last timestamps
                start_time = datetime.strptime(timestamps[0], "%Y-%m-%d %H:%M:%S,%f")
                end_time = datetime.strptime(timestamps[-1], "%Y-%m-%d %H:%M:%S,%f")

                # Calculate difference in seconds
                duration = (end_time - start_time).total_seconds()
                return round(duration, 3)
            except ValueError:
                pass

        # Try to extract duration from "Processing complete" message
        duration_match = re.search(r"in\s+(\d+(?:\.\d+)?)\s*s(?:econds?)?", log_output)
        if duration_match:
            return float(duration_match.group(1))

        return 0.0
