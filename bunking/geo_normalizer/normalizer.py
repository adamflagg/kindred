"""Main normalizer module using RapidFuzz for fuzzy matching.

Uses token_sort_ratio which:
- Handles word reordering ("Temple Beth Israel" vs "Beth Israel Temple")
- Handles case differences
- Provides similarity scores 0-100
"""

import json
import re
from importlib.resources import files
from typing import TypedDict

from rapidfuzz import fuzz, process


class NormalizedResult(TypedDict):
    """Result of normalizing a value."""

    canonical: str
    confidence: float


# Default fuzzy matching threshold (0-100)
DEFAULT_THRESHOLD = 90

# Threshold for city typo correction (slightly lower to catch typos)
CITY_FUZZY_THRESHOLD = 85

# Module-level cache for city lookup (loaded once on first use)
_CITY_LOOKUP: dict[str, str] | None = None


def _load_city_lookup() -> dict[str, str]:
    """Load the US cities lookup from the data file.

    Returns a dict mapping lowercase city names to their canonical spelling.
    The lookup is cached at module level for performance.
    """
    global _CITY_LOOKUP
    if _CITY_LOOKUP is not None:
        return _CITY_LOOKUP

    data_file = files("bunking.geo_normalizer.data").joinpath("us_cities.json")
    data = json.loads(data_file.read_text())
    lookup: dict[str, str] = data["lookup"]
    _CITY_LOOKUP = lookup
    return lookup


# City abbreviation aliases (SF -> San Francisco, etc.)
CITY_ALIASES: dict[str, str] = {
    "sf": "San Francisco",
    "la": "Los Angeles",
    "nyc": "New York",
    "ny": "New York",
    "dc": "Washington DC",
    "philly": "Philadelphia",
    "chi": "Chicago",
}

# State suffix pattern (", CA", ", CA 94102", etc.)
STATE_SUFFIX_PATTERN = re.compile(r",\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?$", re.IGNORECASE)


def preprocess_value(value: str) -> str:
    """Basic preprocessing: trim whitespace, normalize internal whitespace."""
    if not value:
        return ""

    # Trim whitespace
    value = value.strip()
    if not value:
        return ""

    # Check for N/A patterns
    lower = value.lower()
    if lower in ("n/a", "none", "null", "na", "---", "...", "-"):
        return ""

    # Normalize internal whitespace (collapse multiple spaces/tabs to single space)
    return " ".join(value.split())


def normalize_city_value(city: str) -> str:
    """Normalize a single city value.

    Uses a static list of US cities to correct typos. This ensures that
    typos like "San Francico" are corrected to "San Francisco" even when
    the typo appears in fewer records (preventing alphabetical sorting
    from making typos canonical).
    """
    city = preprocess_value(city)
    if not city:
        return ""

    # Check aliases first (case-insensitive)
    lower = city.lower()
    if lower in CITY_ALIASES:
        return CITY_ALIASES[lower]

    # Remove state suffix (", CA", ", CA 94102", etc.)
    city = STATE_SUFFIX_PATTERN.sub("", city)
    city = city.strip()

    if not city:
        return ""

    # Load city lookup and check for exact match (case-insensitive)
    lookup = _load_city_lookup()
    city_lower = city.lower()

    if city_lower in lookup:
        # Exact match - return canonical spelling
        return lookup[city_lower]

    # Fuzzy match against known cities for typo correction
    match = process.extractOne(
        city_lower,
        lookup.keys(),
        scorer=fuzz.ratio,
        score_cutoff=CITY_FUZZY_THRESHOLD,
    )

    if match:
        # Found a close match - return canonical spelling
        matched_key, score, _ = match
        return lookup[matched_key]

    # No match in lookup - fall back to title case
    return city.title()


def normalize_school_value(school: str) -> str:
    """Normalize a single school value (minimal - preserve original case)."""
    return preprocess_value(school)


def normalize_congregation_value(congregation: str) -> str:
    """Normalize a single congregation value (minimal - preserve original case)."""
    return preprocess_value(congregation)


def cluster_similar_values(
    values: list[str],
    threshold: int = DEFAULT_THRESHOLD,
) -> dict[str, NormalizedResult]:
    """Cluster similar values using RapidFuzz token_sort_ratio.

    token_sort_ratio handles:
    - Word reordering ("Temple Beth Israel" vs "Beth Israel Temple")
    - Case differences ("Oakland" vs "oakland")
    - Partial matches

    Args:
        values: List of values to cluster
        threshold: Minimum similarity score (0-100) to consider a match

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    # Count frequency of each value (for canonical selection)
    frequency: dict[str, int] = {}
    for v in values:
        if v:
            frequency[v] = frequency.get(v, 0) + 1

    # Deduplicate
    unique: list[str] = list(frequency.keys())

    if not unique:
        return {}

    # Sort by frequency descending, then alphabetically for ties
    # This ensures the most common spelling becomes canonical (not a rare typo)
    unique.sort(key=lambda x: (-frequency[x], x))

    # Build clusters: canonical -> list of members
    clusters: dict[str, list[tuple[str, float]]] = {}

    for value in unique:
        if not clusters:
            # First value becomes first canonical
            clusters[value] = [(value, 100.0)]
            continue

        # Find best matching cluster using token_sort_ratio
        match = process.extractOne(
            value,
            list(clusters.keys()),
            scorer=fuzz.token_sort_ratio,
        )

        if match and match[1] >= threshold:
            # Add to existing cluster
            canonical, score, _ = match
            clusters[canonical].append((value, score))
        else:
            # Create new cluster
            clusters[value] = [(value, 100.0)]

    # Build result: original -> {canonical, confidence}
    result: dict[str, NormalizedResult] = {}
    for canonical, members in clusters.items():
        for original, score in members:
            result[original] = NormalizedResult(
                canonical=canonical,
                confidence=score / 100.0,  # Convert to 0.0-1.0 scale
            )

    return result


def normalize_cities(values: list[str]) -> dict[str, NormalizedResult]:
    """Normalize a list of city values.

    1. Apply city-specific normalization (aliases, state suffix removal)
    2. Cluster similar values using fuzzy matching

    Args:
        values: List of city names

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    # Step 1: Normalize each value
    normalized_map: dict[str, str] = {}  # original -> normalized
    normalized_values: list[str] = []

    for original in values:
        normalized = normalize_city_value(original)
        if normalized:
            normalized_map[original] = normalized
            normalized_values.append(normalized)

    # Step 2: Cluster similar normalized values
    clusters = cluster_similar_values(normalized_values)

    # Step 3: Build final result mapping original -> canonical
    result: dict[str, NormalizedResult] = {}
    for original, normalized in normalized_map.items():
        if normalized in clusters:
            cluster_result = clusters[normalized]
            result[original] = NormalizedResult(
                canonical=cluster_result["canonical"],
                confidence=cluster_result["confidence"],
            )

    return result


def normalize_schools(values: list[str]) -> dict[str, NormalizedResult]:
    """Normalize a list of school values.

    Uses token_sort_ratio for fuzzy matching which handles:
    - Word reordering ("Elementary School Riverside" vs "Riverside Elementary School")
    - Abbreviations ("Elem" vs "Elementary") - via fuzzy match
    - Case differences

    Args:
        values: List of school names

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    # Step 1: Normalize each value (minimal preprocessing)
    normalized_map: dict[str, str] = {}
    normalized_values: list[str] = []

    for original in values:
        normalized = normalize_school_value(original)
        if normalized:
            normalized_map[original] = normalized
            normalized_values.append(normalized)

    # Step 2: Cluster with slightly lower threshold for schools
    # (to catch abbreviations like "Elem" vs "Elementary")
    clusters = cluster_similar_values(normalized_values, threshold=85)

    # Step 3: Build final result
    result: dict[str, NormalizedResult] = {}
    for original, normalized in normalized_map.items():
        if normalized in clusters:
            cluster_result = clusters[normalized]
            result[original] = NormalizedResult(
                canonical=cluster_result["canonical"],
                confidence=cluster_result["confidence"],
            )

    return result


def cluster_similar_values_token_set(
    values: list[str],
    threshold: int = DEFAULT_THRESHOLD,
) -> dict[str, NormalizedResult]:
    """Cluster using token_set_ratio which handles subset relationships.

    token_set_ratio treats tokens as sets, so:
    - "Congregation Beth Shalom" contains all tokens of "Beth Shalom" -> 100
    - Handles prefix/suffix variations well

    Args:
        values: List of values to cluster
        threshold: Minimum similarity score (0-100) to consider a match

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    # Remove empty strings and deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            unique.append(v)

    if not unique:
        return {}

    # Sort for deterministic clustering order (idempotency)
    unique.sort()

    # Build clusters using token_set_ratio
    clusters: dict[str, list[tuple[str, float]]] = {}

    for value in unique:
        if not clusters:
            clusters[value] = [(value, 100.0)]
            continue

        # Find best matching cluster using token_set_ratio
        match = process.extractOne(
            value,
            list(clusters.keys()),
            scorer=fuzz.token_set_ratio,
        )

        if match and match[1] >= threshold:
            canonical, score, _ = match
            clusters[canonical].append((value, score))
        else:
            clusters[value] = [(value, 100.0)]

    # Build result
    result: dict[str, NormalizedResult] = {}
    for canonical, members in clusters.items():
        for original, score in members:
            result[original] = NormalizedResult(
                canonical=canonical,
                confidence=score / 100.0,
            )

    return result


def normalize_congregations(values: list[str]) -> dict[str, NormalizedResult]:
    """Normalize a list of congregation values.

    Uses token_set_ratio for fuzzy matching which handles:
    - Word reordering ("Temple Beth Israel" vs "Beth Israel Temple")
    - Prefix variations ("Congregation Beth Shalom" vs "Beth Shalom")
    - Case differences

    token_set_ratio treats tokens as sets, so "Congregation Beth Shalom"
    contains all tokens of "Beth Shalom" -> matches at 100%.

    Args:
        values: List of congregation names

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    # Step 1: Normalize each value (minimal preprocessing)
    normalized_map: dict[str, str] = {}
    normalized_values: list[str] = []

    for original in values:
        normalized = normalize_congregation_value(original)
        if normalized:
            normalized_map[original] = normalized
            normalized_values.append(normalized)

    # Step 2: Cluster using token_set_ratio for better prefix handling
    clusters = cluster_similar_values_token_set(normalized_values, threshold=90)

    # Step 3: Build final result
    result: dict[str, NormalizedResult] = {}
    for original, normalized in normalized_map.items():
        if normalized in clusters:
            cluster_result = clusters[normalized]
            result[original] = NormalizedResult(
                canonical=cluster_result["canonical"],
                confidence=cluster_result["confidence"],
            )

    return result


def normalize_values(
    category: str,
    values: list[str],
) -> dict[str, NormalizedResult]:
    """Normalize values based on category.

    Args:
        category: One of "city", "school", "congregation"
        values: List of values to normalize

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if category == "city":
        return normalize_cities(values)
    elif category == "school":
        return normalize_schools(values)
    elif category == "congregation":
        return normalize_congregations(values)
    else:
        raise ValueError(f"Unknown category: {category}")
