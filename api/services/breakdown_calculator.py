"""Generic breakdown calculator for metrics.

This module provides reusable functions for computing breakdown statistics,
eliminating the 26+ duplicate breakdown patterns in metrics.py.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BreakdownStats:
    """Statistics for a single breakdown category (used in retention metrics)."""

    base_count: int
    returned_count: int
    retention_rate: float


@dataclass(frozen=True)
class RegistrationBreakdownStats:
    """Statistics for a single breakdown category (used in registration metrics)."""

    count: int
    percentage: float


def safe_rate(numerator: int, denominator: int) -> float:
    """Calculate rate, handling division by zero.

    Args:
        numerator: The numerator value.
        denominator: The denominator value.

    Returns:
        The ratio, or 0.0 if denominator is zero.
    """
    return numerator / denominator if denominator > 0 else 0.0


def calculate_percentage(count: int, total: int) -> float:
    """Calculate percentage, handling division by zero.

    Args:
        count: The count to convert to percentage.
        total: The total to divide by.

    Returns:
        The percentage (0-100), or 0.0 if total is zero.
    """
    return (count / total * 100) if total > 0 else 0.0


def compute_breakdown[T](
    person_ids: set[int],
    returned_ids: set[int],
    persons: dict[int, Any],
    extractor: Callable[[Any], T],
) -> dict[T, BreakdownStats]:
    """Compute breakdown statistics for retention metrics.

    This generic function replaces 26+ duplicate patterns in metrics.py.
    It groups persons by a category (extracted via the extractor function)
    and computes base_count, returned_count, and retention_rate for each.

    Args:
        person_ids: Set of person IDs in the base year.
        returned_ids: Set of person IDs who returned (intersection of base and compare years).
        persons: Dictionary mapping person_id to person/record object.
        extractor: Function that extracts the category value from a person/record.

    Returns:
        Dictionary mapping category value to BreakdownStats.

    Example:
        >>> from api.services.extractors import extract_gender
        >>> result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)
        >>> result["M"].retention_rate
        0.75
    """
    stats: dict[Any, dict[str, int]] = {}

    for pid in person_ids:
        person = persons.get(pid)
        if not person:
            continue

        value = extractor(person)
        if value not in stats:
            stats[value] = {"base": 0, "returned": 0}
        stats[value]["base"] += 1
        if pid in returned_ids:
            stats[value]["returned"] += 1

    return {
        key: BreakdownStats(
            base_count=s["base"],
            returned_count=s["returned"],
            retention_rate=safe_rate(s["returned"], s["base"]),
        )
        for key, s in stats.items()
    }


def compute_registration_breakdown[T](
    person_ids: set[int],
    persons: dict[int, Any],
    extractor: Callable[[Any], T],
) -> dict[T, RegistrationBreakdownStats]:
    """Compute breakdown statistics for registration metrics (count-only).

    This variant is used for registration metrics where we only need counts
    and percentages, not retention rates.

    Args:
        person_ids: Set of person IDs to count.
        persons: Dictionary mapping person_id to person/record object.
        extractor: Function that extracts the category value from a person/record.

    Returns:
        Dictionary mapping category value to RegistrationBreakdownStats.

    Example:
        >>> from api.services.extractors import extract_gender
        >>> result = compute_registration_breakdown(person_ids, persons, extract_gender)
        >>> result["M"].percentage
        55.5
    """
    counts: dict[Any, int] = {}

    for pid in person_ids:
        person = persons.get(pid)
        if not person:
            continue

        value = extractor(person)
        counts[value] = counts.get(value, 0) + 1

    total = sum(counts.values())
    return {
        key: RegistrationBreakdownStats(
            count=count,
            percentage=calculate_percentage(count, total),
        )
        for key, count in counts.items()
    }
