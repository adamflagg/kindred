"""Main normalizer module using RapidFuzz for fuzzy matching.

Uses token_sort_ratio which:
- Handles word reordering ("Temple Beth Israel" vs "Beth Israel Temple")
- Handles case differences
- Provides similarity scores 0-100
"""

import json
import re
from collections.abc import Sequence
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

# Threshold for school fuzzy match (with token overlap filter, 85 prevents
# false positives while still catching abbreviations like "Elem" vs "Elementary")
SCHOOL_FUZZY_THRESHOLD = 85

# Threshold for congregation fuzzy match
CONGREGATION_FUZZY_THRESHOLD = 80

# Module-level caches for city lookup (loaded once on first use)
_CITY_LOOKUP_MULTI: dict[str, list[str]] | None = None
_CITY_LOCATION: dict[str, dict[str, str]] | None = None

# Module-level caches for school lookup + coords (loaded once on first use)
_SCHOOL_LOOKUP: dict[str, str] | None = None
_SCHOOL_COORDS: dict[str, list[float]] | None = None

# Module-level caches for congregation lookup + coords (loaded once on first use)
_CONGREGATION_LOOKUP: dict[str, str] | None = None
_CONGREGATION_COORDS: dict[str, list[float]] | None = None


def _load_city_lookup_multi() -> dict[str, list[str]]:
    """Load multi-variant city lookup. Returns lowercase_name -> ["City, ST", ...]."""
    global _CITY_LOOKUP_MULTI
    if _CITY_LOOKUP_MULTI is not None:
        return _CITY_LOOKUP_MULTI

    data_file = files("bunking.geo_normalizer.data").joinpath("us_cities.json")
    data = json.loads(data_file.read_text())
    raw_lookup = data.get("lookup", {})

    multi: dict[str, list[str]] = {}
    for key, value in raw_lookup.items():
        if isinstance(value, list):
            multi[key] = value
        else:
            multi[key] = [value]  # old schema compat

    _CITY_LOOKUP_MULTI = multi
    return multi


def _load_city_location() -> dict[str, dict[str, str]]:
    """Load city location metadata. Returns canonical_name -> {state}."""
    global _CITY_LOCATION
    if _CITY_LOCATION is not None:
        return _CITY_LOCATION

    data_file = files("bunking.geo_normalizer.data").joinpath("us_cities.json")
    data = json.loads(data_file.read_text())
    _CITY_LOCATION = data.get("location", {})
    return _CITY_LOCATION


def _load_school_lookup() -> tuple[dict[str, str], dict[str, list[float]]]:
    """Load the schools lookup and coords from the data file.

    Returns a tuple of (lookup dict, coords dict).
    The lookup maps lowercase school names to their canonical spelling.
    The coords maps canonical names to [lat, lng] pairs.
    Both are cached at module level for performance.
    """
    global _SCHOOL_LOOKUP, _SCHOOL_COORDS
    if _SCHOOL_LOOKUP is not None and _SCHOOL_COORDS is not None:
        return _SCHOOL_LOOKUP, _SCHOOL_COORDS

    data_file = files("bunking.geo_normalizer.data").joinpath("schools.json")
    data = json.loads(data_file.read_text())
    lookup: dict[str, str] = data["lookup"]
    coords: dict[str, list[float]] = data.get("coords", {})
    _SCHOOL_LOOKUP = lookup
    _SCHOOL_COORDS = coords
    return lookup, coords


def _load_congregation_lookup() -> tuple[dict[str, str], dict[str, list[float]]]:
    """Load the congregations lookup and coords from the data file.

    Returns a tuple of (lookup dict, coords dict).
    The lookup maps lowercase congregation names to their canonical spelling.
    The coords maps canonical names to [lat, lng] pairs.
    Both are cached at module level for performance.
    """
    global _CONGREGATION_LOOKUP, _CONGREGATION_COORDS
    if _CONGREGATION_LOOKUP is not None and _CONGREGATION_COORDS is not None:
        return _CONGREGATION_LOOKUP, _CONGREGATION_COORDS

    data_file = files("bunking.geo_normalizer.data").joinpath("congregations.json")
    data = json.loads(data_file.read_text())
    lookup: dict[str, str] = data["lookup"]
    coords: dict[str, list[float]] = data.get("coords", {})
    _CONGREGATION_LOOKUP = lookup
    _CONGREGATION_COORDS = coords
    return lookup, coords


# City abbreviation aliases (SF -> San Francisco, CA, etc.)
CITY_ALIASES: dict[str, str] = {
    "sf": "San Francisco, CA",
    "la": "Los Angeles, CA",
    "nyc": "New York, NY",
    "ny": "New York, NY",
    "dc": "Washington, DC",
    "philly": "Philadelphia, PA",
    "chi": "Chicago, IL",
    "millbrae blvd": "Millbrae, CA",
    "la canada flt": "La Canada Flintridge, CA",
    "west menlo park": "Menlo Park, CA",
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


def normalize_city_value(city: str, state: str = "") -> tuple[str, float]:
    """Normalize a city value with state-aware disambiguation.

    Returns (canonical_name, confidence) where canonical is "City, ST" format.
    """
    city = preprocess_value(city)
    if not city:
        return "", 0.0

    lower = city.lower()
    if lower in CITY_ALIASES:
        return CITY_ALIASES[lower], 1.0

    # Extract state from suffix if present, use as fallback
    suffix_match = STATE_SUFFIX_PATTERN.search(city)
    extracted_state = ""
    if suffix_match:
        state_match = re.search(r"[A-Z]{2}", suffix_match.group(0), re.IGNORECASE)
        if state_match:
            extracted_state = state_match.group(0).upper()
        city = STATE_SUFFIX_PATTERN.sub("", city).strip()

    if not city:
        return "", 0.0

    effective_state = state.upper() if state else extracted_state

    multi_lookup = _load_city_lookup_multi()
    location = _load_city_location()
    city_lower = city.lower()

    # Exact match
    if city_lower in multi_lookup:
        canonical, state_matched = _pick_variant(multi_lookup[city_lower], effective_state, location)
        if state_matched:
            return canonical, 1.0
        elif effective_state:
            return canonical, 0.7  # state mismatch fallback
        else:
            return canonical, 0.9  # no state context

    # Fuzzy match against bare city names
    match = process.extractOne(
        city_lower,
        list(multi_lookup.keys()),
        scorer=fuzz.ratio,
        score_cutoff=CITY_FUZZY_THRESHOLD,
    )
    if match:
        matched_key, _score, _ = match
        canonical, state_matched = _pick_variant(multi_lookup[matched_key], effective_state, location)
        if state_matched:
            return canonical, 0.85
        elif effective_state:
            return canonical, 0.65  # fuzzy + state mismatch
        else:
            return canonical, 0.8  # fuzzy, no state context

    # No match - unknown city
    title = city.title()
    if effective_state:
        return f"{title}, {effective_state}", 0.5
    # No state context: very low confidence (unknown city, can't determine region)
    return title, 0.3


def _pick_variant(variants: list[str], state: str, location: dict[str, dict[str, str]]) -> tuple[str, bool]:
    """Pick best variant. Returns (canonical, state_matched)."""
    if len(variants) == 1:
        if state:
            loc = location.get(variants[0], {})
            return variants[0], loc.get("state", "").upper() == state.upper()
        return variants[0], False

    if state:
        for v in variants:
            loc = location.get(v, {})
            if loc.get("state", "").upper() == state.upper():
                return v, True

    return variants[0], False


_SCHOOL_GRADE_PAREN_PATTERN = re.compile(
    r"\s*\((?:"
    r"\d{1,2}(?:st|nd|rd|th)(?:\s+grade)?"  # ordinals: 1st, 2nd, 3rd, 4th...12th
    r"|K(?:indergarten)?"  # K or Kindergarten
    r"|Pre-K|TK"  # Pre-K, TK
    r"|(?:\d{1,2}(?:st|nd|rd|th)|K)-(?:\d{1,2}(?:st|nd|rd|th)|\d)"  # ranges: K-5, 3rd-5th
    r")\)$"
)

_SCHOOL_GRADE_SUFFIX_PATTERN = re.compile(r"^(.+\S)\s+\d{1,2}(?:st|nd|rd|th)(?:\s+grade)?$")


def strip_school_grade_annotation(school: str) -> str:
    """Strip grade annotations from school names.

    Handles parenthesized forms like "(2nd)", "(3rd grade)", "(K)", "(Pre-K)",
    "(K-5)", "(3rd-5th)" and suffix forms like "2nd grade", "2nd".
    Preserves names where the ordinal is part of the actual name
    (e.g., "2nd Street Elementary").
    """
    # Strip parenthesized grade annotations
    school = _SCHOOL_GRADE_PAREN_PATTERN.sub("", school)
    school = school.strip()

    # Strip suffix grade annotations (only when preceded by non-ordinal content)
    m = _SCHOOL_GRADE_SUFFIX_PATTERN.match(school)
    if m:
        school = m.group(1)

    return school


def _school_match_has_token_overlap(query: str, candidate: str) -> bool:
    """Check that a fuzzy match shares at least one exact token.

    Prevents false positives like "Highland" matching "Leland High"
    where token_sort_ratio gives a high score but the names share
    no actual words.
    """
    query_tokens = set(query.lower().split())
    candidate_tokens = set(candidate.lower().split())
    return bool(query_tokens & candidate_tokens)


def normalize_school_value(school: str) -> str:
    """Normalize a single school value using canonical lookup.

    Uses a static list of California schools (from NCES data) to resolve
    names to canonical spelling. Falls back to the original value for
    unknown schools. Uses token_sort_ratio with threshold 85 to accommodate
    common variations like "Elem" vs "Elementary".

    Grade annotations like "(2nd)" are stripped before matching to prevent
    false positives (e.g., "Highland (2nd)" matching "Leland High").
    """
    school = preprocess_value(school)
    if not school:
        return ""

    # Strip grade annotations before matching
    stripped = strip_school_grade_annotation(school)
    if not stripped:
        return ""

    lookup, _ = _load_school_lookup()
    lower = stripped.lower()

    # Exact match (case-insensitive)
    if lower in lookup:
        return lookup[lower]

    # Fuzzy match with lower threshold for school name variations
    match = process.extractOne(
        lower,
        lookup.keys(),
        scorer=fuzz.token_sort_ratio,
        score_cutoff=SCHOOL_FUZZY_THRESHOLD,
    )

    if match:
        matched_key, _score, _ = match
        # Validate that the match shares meaningful tokens to prevent
        # false positives like "Highland" -> "Leland High"
        if _school_match_has_token_overlap(stripped, lookup[matched_key]):
            return lookup[matched_key]

    # No match - return stripped value (preserves unknown schools)
    return stripped


def normalize_congregation_value(congregation: str) -> str:
    """Normalize a single congregation value using canonical lookup.

    Uses a curated list of Bay Area congregations to resolve names to
    canonical spelling. Uses token_set_ratio to handle prefix variations
    like "Congregation Beth Shalom" vs "Beth Shalom".
    """
    congregation = preprocess_value(congregation)
    if not congregation:
        return ""

    lookup, _ = _load_congregation_lookup()
    lower = congregation.lower()

    # Exact match (case-insensitive)
    if lower in lookup:
        return lookup[lower]

    # Fuzzy match using token_set_ratio for prefix handling
    match = process.extractOne(
        lower,
        lookup.keys(),
        scorer=fuzz.token_set_ratio,
        score_cutoff=CONGREGATION_FUZZY_THRESHOLD,
    )

    if match:
        matched_key, _score, _ = match
        return lookup[matched_key]

    # No match - return original (preserves unknown congregations)
    return congregation


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


def normalize_cities(
    values: list[str] | list[dict[str, str]],
) -> dict[str, NormalizedResult]:
    """Normalize city values with optional state context.

    Args:
        values: List of city names (strings) or dicts with {value, state}.
    """
    if not values:
        return {}

    items: list[tuple[str, str]] = []
    for v in values:
        if isinstance(v, str):
            items.append((v, ""))
        else:
            items.append((v["value"], v.get("state", "")))

    multi_lookup = _load_city_lookup_multi()
    normalized_map: dict[str, tuple[str, float]] = {}  # original -> (canonical, confidence)
    canonical_values: set[str] = set()
    unknown_values: list[str] = []

    for original, item_state in items:
        canonical, confidence = normalize_city_value(original, state=item_state)
        if canonical:
            normalized_map[original] = (canonical, confidence)
            # Check if from canonical lookup (exact or fuzzy against known cities)
            bare = preprocess_value(original)
            bare = STATE_SUFFIX_PATTERN.sub("", bare).strip().lower()
            if bare in multi_lookup:
                canonical_values.add(canonical)
            else:
                # Check fuzzy match against known cities
                match = process.extractOne(
                    bare,
                    list(multi_lookup.keys()),
                    scorer=fuzz.ratio,
                    score_cutoff=CITY_FUZZY_THRESHOLD,
                )
                if match:
                    canonical_values.add(canonical)
                else:
                    unknown_values.append(canonical)

    # Only cluster unknown values
    unknown_clusters = cluster_similar_values(unknown_values)

    result: dict[str, NormalizedResult] = {}
    for original, (canonical, confidence) in normalized_map.items():
        if canonical in canonical_values:
            result[original] = NormalizedResult(canonical=canonical, confidence=confidence)
        elif canonical in unknown_clusters:
            cluster_result = unknown_clusters[canonical]
            result[original] = NormalizedResult(
                canonical=cluster_result["canonical"],
                confidence=cluster_result["confidence"],
            )
        else:
            result[original] = NormalizedResult(canonical=canonical, confidence=confidence)

    return result


def normalize_schools(
    values: list[str] | list[dict[str, str]],
) -> dict[str, NormalizedResult]:
    """Normalize a list of school values with optional state context.

    Uses token_sort_ratio for fuzzy matching which handles:
    - Word reordering ("Elementary School Riverside" vs "Riverside Elementary School")
    - Abbreviations ("Elem" vs "Elementary") - via fuzzy match
    - Case differences

    To prevent re-merging canonically distinct schools (e.g. "Park Day School"
    and "Mark Day School" which have token_sort_ratio ~85.7), values that matched
    distinct canonical entries in the lookup are kept separate from clustering.
    Only unknown values (no canonical match) are clustered.

    Args:
        values: List of school names (strings) or dicts with {value, state}.

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    items: list[tuple[str, str]] = []
    for v in values:
        if isinstance(v, str):
            items.append((v, ""))
        else:
            items.append((v["value"], v.get("state", "")))

    lookup, _ = _load_school_lookup()

    # Step 1: Normalize each value and track which came from canonical lookup
    normalized_map: dict[str, str] = {}  # original -> normalized
    canonical_values: dict[str, str] = {}  # normalized -> canonical (from lookup)
    unknown_values: list[str] = []  # values not in canonical lookup

    for original, _state in items:
        normalized = normalize_school_value(original)
        if not normalized:
            continue
        normalized_map[original] = normalized

        # Check if this normalized value came from a canonical lookup match
        # (normalize_school_value returns the canonical name for matched schools)
        if normalized.lower() in lookup or _is_canonical_match(normalized, lookup):
            canonical_values[normalized] = normalized
        else:
            unknown_values.append(normalized)

    # Step 2: Only cluster unknown values (not in canonical lookup)
    unknown_clusters = cluster_similar_values(unknown_values, threshold=85)

    # Step 3: Build final result
    result: dict[str, NormalizedResult] = {}
    for original, normalized in normalized_map.items():
        if normalized in canonical_values:
            # Canonical match - use directly, skip clustering
            result[original] = NormalizedResult(
                canonical=normalized,
                confidence=1.0,
            )
        elif normalized in unknown_clusters:
            # Unknown value - use clustering result
            cluster_result = unknown_clusters[normalized]
            result[original] = NormalizedResult(
                canonical=cluster_result["canonical"],
                confidence=cluster_result["confidence"],
            )

    return result


def _is_canonical_match(value: str, lookup: dict[str, str]) -> bool:
    """Check if a value is a canonical name (i.e. appears as a lookup value)."""
    return value in lookup.values()


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


def normalize_congregations(
    values: list[str] | list[dict[str, str]],
) -> dict[str, NormalizedResult]:
    """Normalize a list of congregation values with optional state context.

    Uses token_set_ratio for fuzzy matching which handles:
    - Word reordering ("Temple Beth Israel" vs "Beth Israel Temple")
    - Prefix variations ("Congregation Beth Shalom" vs "Beth Shalom")
    - Case differences

    token_set_ratio treats tokens as sets, so "Congregation Beth Shalom"
    contains all tokens of "Beth Shalom" -> matches at 100%.

    Args:
        values: List of congregation names (strings) or dicts with {value, state}.

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    if not values:
        return {}

    items: list[tuple[str, str]] = []
    for v in values:
        if isinstance(v, str):
            items.append((v, ""))
        else:
            items.append((v["value"], v.get("state", "")))

    # Step 1: Normalize each value (minimal preprocessing)
    normalized_map: dict[str, str] = {}
    normalized_values: list[str] = []

    for original, _state in items:
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
    values: Sequence[str | dict[str, str]],
) -> dict[str, NormalizedResult]:
    """Normalize values based on category.

    Args:
        category: One of "city", "school", "congregation"
        values: List of values to normalize. Each can be:
            - A plain string (backwards compatible, treated as US)
            - A dict with keys: value, state, country

    Returns:
        Dict mapping original values to {canonical, confidence}
    """
    # Normalize input format
    normalized_input: list[dict[str, str]] = []
    for v in values:
        if isinstance(v, str):
            normalized_input.append({"value": v, "state": "", "country": ""})
        else:
            normalized_input.append(v)

    # Split into US and non-US
    us_items: list[dict[str, str]] = []
    intl_items: list[dict[str, str]] = []
    for item in normalized_input:
        country = item.get("country", "").strip().upper()
        if country and country not in ("US", "USA", "UNITED STATES"):
            intl_items.append(item)
        else:
            us_items.append(item)

    result: dict[str, NormalizedResult] = {}

    # International items pass through as-is (no US fuzzy matching)
    for item in intl_items:
        result[item["value"]] = NormalizedResult(canonical=item["value"], confidence=1.0)

    # Validate category early
    if category not in ("city", "school", "congregation"):
        raise ValueError(f"Unknown category: {category}")

    # US items go through normal category-specific matching (pass full dicts for state context)
    if us_items:
        if category == "city":
            us_result = normalize_cities(us_items)
        elif category == "school":
            us_result = normalize_schools(us_items)
        else:  # congregation
            us_result = normalize_congregations(us_items)
        result.update(us_result)

    return result
