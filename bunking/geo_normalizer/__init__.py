"""Geographic value normalization using RapidFuzz for token-aware fuzzy matching.

This module provides normalization functions for cities, schools, and congregations
using RapidFuzz's token_sort_ratio which handles word reordering.

The Go sync calls this via CLI:
    uv run python -m bunking.geo_normalizer --category city --values '["SF", "San Francisco"]'

Output is JSON:
    {"SF": {"canonical": "San Francisco", "confidence": 0.95}, ...}
"""

from bunking.geo_normalizer.normalizer import (
    normalize_cities,
    normalize_congregations,
    normalize_schools,
    normalize_values,
)

__all__ = [
    "normalize_cities",
    "normalize_schools",
    "normalize_congregations",
    "normalize_values",
]
