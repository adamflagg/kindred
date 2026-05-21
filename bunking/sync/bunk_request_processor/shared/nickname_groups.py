"""Common nickname groups for name matching.

Provides centralized nickname mappings used across the system."""

import json
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

try:
    from nicknames import NickNamer

    _nicknamer: NickNamer | None = NickNamer()
except ImportError:
    _nicknamer: NickNamer | None = None  # type: ignore[no-redef]

_OVERRIDE_PATH = Path(__file__).parent.parent.parent.parent.parent / "config" / "nicknames_override.json"

# Default nickname groups
# Each set contains interchangeable names (full name and common nicknames)
DEFAULT_NICKNAME_GROUPS: list[set[str]] = [
    {"mike", "michael"},
    {"matt", "matthew"},
    {"ben", "benjamin"},
    {"sam", "samuel"},
    {"kate", "katie", "katherine", "kathryn", "catherine"},
    {"liz", "elizabeth", "beth", "lizzie"},
    {"alex", "alexander", "alexandra"},
    {"chris", "christopher", "christina", "christine"},
    {"dan", "daniel", "danny"},
    {"rob", "robert", "robbie", "bobby", "bob"},
    {"nick", "nicholas", "nicky"},
    {"tom", "thomas", "tommy"},
    {"will", "william", "willy", "billy", "bill"},
    {"dave", "david", "davey"},
    {"john", "johnny", "jack"},
    {"joe", "joseph", "joey"},
    {"steve", "steven", "stephen"},
    {"andy", "andrew", "drew"},
    {"jim", "james", "jimmy", "jamie"},
    {"tim", "timothy", "timmy"},
    {"pete", "peter"},
    {"greg", "gregory"},
    {"josh", "joshua"},
    {"zach", "zachary", "zack"},
    {"jake", "jacob"},
    {"maddie", "madison", "madeline", "madeleine"},
    {"abby", "abigail", "abbey"},
    {"becca", "rebecca", "becky", "rebekah"},
    {"jess", "jessica", "jessie"},
    {"jen", "jennifer", "jenny"},
    {"sara", "sarah"},
    {"rachael", "rachel"},
    {"rick", "richard", "ricky", "dick"},
    {"chuck", "charles", "charlie"},
    {"ted", "theodore", "teddy"},
    {"ed", "edward", "eddie"},
    {"frank", "francis"},
    {"hank", "henry"},
    {"jerry", "jerome", "gerald"},
    {"larry", "lawrence"},
    {"pat", "patrick", "patricia"},
    {"ron", "ronald", "ronnie"},
    {"terry", "terence", "teresa"},
    {"tony", "anthony"},
    {"vince", "vincent", "vinny"},
]

# Common spelling variations that aren't necessarily nicknames
SPELLING_VARIATIONS = {
    "blooma": ["bluma", "blouma"],
    "bluma": ["blooma", "blouma"],
    "chloe": ["chloey", "khloe"],
    "zoe": ["zoey", "zooey", "zoie"],
    "sarah": ["sara"],
    "sara": ["sarah"],
    "rachel": ["rachael"],
    "rachael": ["rachel"],
    "rebecca": ["rebekah", "becca"],
    "rebekah": ["rebecca"],
    "katherine": ["kathryn", "catherine"],
    "kathryn": ["katherine", "catherine"],
    "catherine": ["katherine", "kathryn"],
    "stephen": ["steven"],
    "steven": ["stephen"],
    "jeffrey": ["geoffrey"],
    "geoffrey": ["jeffrey"],
    "philip": ["phillip"],
    "phillip": ["philip"],
    "bryan": ["brian"],
    "brian": ["bryan"],
    "shaun": ["shawn", "sean"],
    "shawn": ["shaun", "sean"],
    "sean": ["shaun", "shawn"],
}


def get_nickname_groups() -> list[set[str]]:
    """Get nickname groups.

    Returns:
        List of sets containing interchangeable names
    """
    return DEFAULT_NICKNAME_GROUPS


@lru_cache(maxsize=1)
def _load_overrides() -> dict[str, list[str]]:
    """Load camp-specific nickname overrides from config file."""
    if _OVERRIDE_PATH.exists():
        with open(_OVERRIDE_PATH) as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if not k.startswith("_")}
    return {}


def _get_library_variations(name_lower: str) -> set[str]:
    """Get nickname variations from the nicknames PyPI library (bidirectional)."""
    if _nicknamer is None:
        return set()
    results: set[str] = set()
    # Forward: full name → nicknames
    for n in _nicknamer.nicknames_of(name_lower):
        results.add(n.lower())
    # Reverse: nickname → canonical/full names
    for n in _nicknamer.canonicals_of(name_lower):
        results.add(n.lower())
    results.discard(name_lower)
    return results


def _get_override_variations(name_lower: str) -> set[str]:
    """Get nickname variations from camp-specific override file (bidirectional)."""
    overrides = _load_overrides()
    results: set[str] = set()
    # Forward: key → values
    if name_lower in overrides:
        results.update(v.lower() for v in overrides[name_lower])
    # Reverse: value → key
    for key, values in overrides.items():
        if name_lower in [v.lower() for v in values]:
            results.add(key.lower())
    results.discard(name_lower)
    return results


def find_nickname_variations(name: str) -> list[str]:
    """Find all nickname variations for a given name.

    Consults three sources in priority order:
    1. Built-in nickname groups (DEFAULT_NICKNAME_GROUPS)
    2. Camp-specific override file (config/nicknames_override.json)
    3. nicknames PyPI library (broadest coverage)

    Args:
        name: Name to find variations for (case insensitive)

    Returns:
        List of nickname variations (excluding the input name)
    """
    name_lower = name.lower()
    variations: list[str] = []
    seen: set[str] = set()

    def _add(values: Iterable[str]) -> None:
        for v in values:
            if v not in seen:
                seen.add(v)
                variations.append(v)

    # 1. Check built-in nickname groups (highest priority)
    for group in DEFAULT_NICKNAME_GROUPS:
        if name_lower in group:
            _add(n for n in group if n != name_lower)
            break

    # 2. Check spelling variations
    if name_lower in SPELLING_VARIATIONS:
        _add(SPELLING_VARIATIONS[name_lower])

    # 3. Check camp-specific overrides
    _add(_get_override_variations(name_lower))

    # 4. Check nicknames library (broadest coverage, lowest priority)
    _add(_get_library_variations(name_lower))

    return sorted(variations)


def names_match_via_nicknames(name1: str, name2: str) -> bool:
    """Check if two names match exactly or via nickname groups.

    Consults the same sources as find_nickname_variations:
    built-in groups, spelling variations, camp overrides, and nicknames library.

    Args:
        name1: First name (case insensitive)
        name2: Second name (case insensitive)

    Returns:
        True if names match exactly or are in the same nickname group
    """
    name1_lower = name1.lower().strip()
    name2_lower = name2.lower().strip()

    # Exact match
    if name1_lower == name2_lower:
        return True

    # Check all variation sources: name2 in name1's variations
    return name2_lower in find_nickname_variations(name1)
