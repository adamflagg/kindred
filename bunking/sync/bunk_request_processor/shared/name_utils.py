"""Name parsing and normalization utilities."""

from __future__ import annotations

import re
from typing import NamedTuple

import jellyfish


class ParsedName(NamedTuple):
    """Parsed name components."""

    first: str
    last: str
    is_complete: bool


# Leading enumeration tokens that parents and the AI sometimes leave on names.
# Stripped before parsing so a numbered list ("1. Emma Wilson") resolves the
# same as a bare name.
#
# Matched forms:
#   - digit/letter + terminator + whitespace: `1.`, `2)`, `10.`, `a.`, `b)`
#   - bracketed enumeration: `(1)`, `[3]`, also half-bracket forms like `1]`
#   - bullet markers: `* `, `- `
#
# Known limitation: also matches single-letter+dot initials like `J. Smith`,
# stripping them to just "Smith". A 2026-04-27 scan of production target_name
# data found zero such inputs (out of 2633 bunk_requests), so this is theoretical
# only. If parents start submitting initial-style names, tighten the digit/letter
# branch to digits-only.
_ENUMERATION_PREFIX_RE = re.compile(r"^\s*(?:[\(\[]?[\dA-Za-z]+[\.\)\]]|[-*])\s+")


def parse_name(name: str) -> ParsedName:
    """Parse name into (first, last, is_complete). Handles middle names."""
    if not name:
        return ParsedName("", "", False)
    cleaned = _ENUMERATION_PREFIX_RE.sub("", name.strip())
    parts = cleaned.split()
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


def _normalize_last_name(name: str) -> str:
    """Normalize last name for fuzzy comparison.

    Collapses Mc/Mac prefix spacing, removes apostrophes, lowercases.
    """
    name = re.sub(r"\b(Mc|Mac)\s+", r"\1", name, flags=re.IGNORECASE)
    name = name.replace("'", "")
    return name.lower()


def last_name_jw_raw_score(search_last: str, db_last: str) -> float:
    """Compute best JW similarity between two last names.

    Applies normalization (Mc/Mac prefix, apostrophes, case) then JW, plus
    hyphen-split parts for compound names. Returns float in [0.0, 1.0].
    """
    norm_search = _normalize_last_name(search_last)
    norm_db = _normalize_last_name(db_last)

    best = jellyfish.jaro_winkler_similarity(norm_search, norm_db)

    for part in search_last.split("-"):
        if part:
            best = max(best, jellyfish.jaro_winkler_similarity(_normalize_last_name(part), norm_db))

    for part in db_last.split("-"):
        if part:
            best = max(best, jellyfish.jaro_winkler_similarity(norm_search, _normalize_last_name(part)))

    return best


def last_name_matches(search_last: str, db_last: str, threshold: float = 0.90) -> bool:
    """Check if a searched last name matches a database last name.

    Handles compound/hyphenated last names by checking if the searched
    words form a suffix of the database words, then falls back to
    Jaro-Winkler fuzzy matching for near-misses.

    Examples:
        ("Zarlin", "Simons Zarlin") -> True (suffix match)
        ("Harris", "Simon-Harris") -> True (suffix match)
        ("Cruz", "De La Cruz") -> True (suffix match)
        ("Kiefer", "Kieffer") -> True (Jaro-Winkler fuzzy)
        ("O'Brian", "O'Brien") -> True (normalized + Jaro-Winkler)
        ("Mc Cabe", "McCabe") -> True (normalized exact)
        ("Smith", "Goldsmith") -> False (not word-based)

    Args:
        search_last: The last name being searched for
        db_last: The last name from the database
        threshold: Jaro-Winkler similarity threshold (default 0.90)

    Returns:
        True if search_last matches db_last (exact, suffix, or fuzzy)
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

    # Normalized exact match (collapse prefixes, remove apostrophes)
    if _normalize_last_name(search_last) == _normalize_last_name(db_last):
        return True

    # Jaro-Winkler fuzzy match on normalized forms (including hyphen-split parts)
    return last_name_jw_raw_score(search_last, db_last) >= threshold


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
