"""Name parsing and normalization utilities."""

from __future__ import annotations

import re
from typing import NamedTuple


class ParsedName(NamedTuple):
    """Parsed name components."""

    first: str
    last: str
    is_complete: bool


def parse_name(name: str) -> ParsedName:
    """Parse name into (first, last, is_complete). Handles middle names."""
    if not name:
        return ParsedName("", "", False)
    parts = name.strip().split()
    if len(parts) < 2:
        return ParsedName(parts[0] if parts else "", "", False)
    return ParsedName(parts[0], parts[-1], True)


def split_last_name_words(last_name: str) -> list[str]:
    """Split a last name into words on spaces and hyphens.

    Examples:
        "Zarlin" -> ["zarlin"]
        "Simons Zarlin" -> ["simons", "zarlin"]
        "Simon-Harris" -> ["simon", "harris"]
        "De La Cruz" -> ["de", "la", "cruz"]
    """
    return [w.lower() for w in re.split(r"[\s-]+", last_name.strip()) if w]


def last_name_matches(search_last: str, db_last: str) -> bool:
    """Check if a searched last name matches a database last name.

    Handles compound/hyphenated last names by checking if the searched
    words form a suffix of the database words.

    Examples:
        ("Zarlin", "Simons Zarlin") -> True (suffix match)
        ("Harris", "Simon-Harris") -> True (suffix match)
        ("Cruz", "De La Cruz") -> True (suffix match)
        ("La Cruz", "De La Cruz") -> True (suffix match)
        ("Smith", "Goldsmith") -> False (not word-based)
        ("Zarlin", "Zarlin") -> True (exact match)

    Args:
        search_last: The last name being searched for
        db_last: The last name from the database

    Returns:
        True if search_last matches db_last (exact or suffix)
    """
    search_words = split_last_name_words(search_last)
    db_words = split_last_name_words(db_last)

    if not search_words or not db_words:
        return False

    # Exact match (all words match)
    if search_words == db_words:
        return True

    # Suffix match: search words are the final words of db
    if len(search_words) <= len(db_words):
        suffix = db_words[-len(search_words) :]
        if search_words == suffix:
            return True

    return False


def normalize_name(name: str) -> str:
    """Normalize name for matching.

    1. Strip leading/trailing whitespace
    2. Convert to lowercase
    3. Collapse multiple whitespace into single spaces
    4. Remove common punctuation: . , ' " ( )

    Note: Hyphens are preserved (not in monolith's removal regex).

    Args:
        name: The name to normalize

    Returns:
        Normalized name string
    """
    # Collapse whitespace and lowercase (handles strip + split + join in one)
    name = " ".join(name.strip().lower().split())
    # Remove common punctuation: . , ' " ( )
    name = re.sub(r'[.,\'"()]', "", name)
    return name
