"""Multi-stage normalization for geographic data.

This module provides normalization utilities for city names, school names,
and congregation/synagogue names to reduce data sprawl and improve matching.

Stages:
1. Preprocessing: Whitespace normalization, N/A detection
2. Domain-specific: City name standardization (state suffix removal)
3. Fuzzy clustering: RapidFuzz-based similarity matching
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

# N/A pattern - matches common "not applicable" representations
NA_PATTERN = re.compile(
    r"^(n\/?a|none|null|na|-+|\.+|\s*)$",
    re.IGNORECASE,
)

# State suffix pattern - matches ", CA", ", CA 94102", ", CA 94102-1234"
STATE_SUFFIX_PATTERN = re.compile(
    r",\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?$",
    re.IGNORECASE,
)


def preprocess(value: str | None) -> str:
    """Stage 1: Basic preprocessing of input values.

    - Returns empty string for None or empty values
    - Returns empty string for N/A variants (n/a, none, null, -, ...)
    - Normalizes whitespace (collapses multiple spaces)
    - Trims leading/trailing whitespace

    Args:
        value: The input string to preprocess.

    Returns:
        Preprocessed string, or empty string for invalid/N/A values.
    """
    if value is None:
        return ""

    # Trim and check for empty
    value = value.strip()
    if not value:
        return ""

    # Check for N/A patterns
    if NA_PATTERN.match(value):
        return ""

    # Normalize internal whitespace (collapse multiple spaces/tabs to single space)
    value = " ".join(value.split())

    return value


def normalize_city(city: str | None) -> str:
    """Normalize city names for consistent matching.

    Applies:
    1. Basic preprocessing (N/A filtering, whitespace)
    2. State suffix removal (", CA", ", CA 94102")
    3. Title case standardization

    Args:
        city: Raw city name from data source.

    Returns:
        Normalized city name, or empty string for invalid values.
    """
    city = preprocess(city)
    if not city:
        return ""

    # Remove state suffix (", CA", ", CA 94102", ", CA 94102-1234")
    city = STATE_SUFFIX_PATTERN.sub("", city)

    # Standardize to title case
    city = city.strip().title()

    return city


def normalize_congregation(congregation: str | None) -> str:
    """Normalize congregation/synagogue names for consistent matching.

    Applies:
    1. Basic preprocessing (N/A filtering, whitespace)
    2. Whitespace normalization only (no case changes)

    Note: Unlike cities, congregation names are more sensitive to case
    variations and should preserve the original casing where possible.

    Args:
        congregation: Raw congregation name from data source.

    Returns:
        Normalized congregation name, or empty string for invalid values.
    """
    congregation = preprocess(congregation)
    if not congregation:
        return ""

    # For congregations, just normalize whitespace - preserve original case intent
    # but clean up extra spaces
    return congregation


def cluster_similar_values(
    values: list[str],
    threshold: int = 90,
) -> dict[str, str]:
    """Cluster similar values using fuzzy matching.

    Groups similar strings together and maps each to a canonical form.
    The canonical form is the first value encountered in each cluster.

    Uses RapidFuzz for efficient similarity scoring with token-based
    matching to handle word order differences.

    Args:
        values: List of values to cluster.
        threshold: Minimum similarity score (0-100) to consider values as same.
                   Default 90 provides good balance of precision/recall.

    Returns:
        Dictionary mapping each original value to its canonical form.
    """
    from rapidfuzz import fuzz, process

    if not values:
        return {}

    # Deduplicate while preserving order
    unique_values = list(dict.fromkeys(v for v in values if v))
    if not unique_values:
        return {}

    # Build clusters
    clusters: dict[str, list[str]] = {}
    canonical_map: dict[str, str] = {}

    for value in unique_values:
        if not value:
            continue

        # Find best match in existing cluster representatives
        if clusters:
            match = process.extractOne(
                value,
                list(clusters.keys()),
                scorer=fuzz.token_sort_ratio,
            )
            if match and match[1] >= threshold:
                # Add to existing cluster
                canonical = match[0]
                clusters[canonical].append(value)
                canonical_map[value] = canonical
                continue

        # No match found - create new cluster with this value as canonical
        clusters[value] = [value]
        canonical_map[value] = value

    return canonical_map
