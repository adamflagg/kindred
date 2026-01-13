"""Common nickname groups for name matching.

Provides centralized nickname mappings used across the system."""

from __future__ import annotations

from typing import Any

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


def get_nickname_groups(config_service: Any = None) -> list[set[str]]:
    """Get nickname groups, optionally from configuration.

    Args:
        config_service: Optional configuration service to get custom mappings

    Returns:
        List of sets containing interchangeable names
    """
    if config_service:
        try:
            ai_config = config_service.get_ai_config()
            custom_mappings = ai_config.get("name_matching", {}).get("common_nicknames", {})

            if custom_mappings:
                # Convert custom format to groups
                groups: list[set[str]] = []
                processed: set[str] = set()

                for full_name, nicknames in custom_mappings.items():
                    full_lower = full_name.lower()
                    if full_lower not in processed:
                        group: set[str] = {full_lower}
                        group.update(n.lower() for n in nicknames)
                        groups.append(group)
                        processed.update(group)

                return groups
        except Exception:
            # Fall back to defaults on any error
            pass

    return DEFAULT_NICKNAME_GROUPS


def find_nickname_variations(name: str, config_service: Any = None) -> list[str]:
    """Find all nickname variations for a given name.

    Args:
        name: Name to find variations for (case insensitive)
        config_service: Optional configuration service

    Returns:
        List of nickname variations (excluding the input name)
    """
    name_lower = name.lower()
    variations: list[str] = []

    # Check nickname groups
    groups = get_nickname_groups(config_service)
    for group in groups:
        if name_lower in group:
            variations.extend(n for n in group if n != name_lower)
            break

    # Check spelling variations
    if name_lower in SPELLING_VARIATIONS:
        variations.extend(SPELLING_VARIATIONS[name_lower])

    return list(set(variations))  # Remove duplicates


def names_match_via_nicknames(name1: str, name2: str, config_service: Any = None) -> bool:
    """Check if two names match exactly or via nickname groups.

    (_names_match_with_nicknames method).

    Args:
        name1: First name (case insensitive)
        name2: Second name (case insensitive)
        config_service: Optional configuration service

    Returns:
        True if names match exactly or are in the same nickname group
    """
    name1_lower = name1.lower().strip()
    name2_lower = name2.lower().strip()

    # Exact match
    if name1_lower == name2_lower:
        return True

    # Check if both names are in the same nickname group
    groups = get_nickname_groups(config_service)
    for group in groups:
        if name1_lower in group and name2_lower in group:
            return True

    # Check spelling variations (bidirectional)
    if name1_lower in SPELLING_VARIATIONS:
        if name2_lower in SPELLING_VARIATIONS[name1_lower]:
            return True
    if name2_lower in SPELLING_VARIATIONS:
        if name1_lower in SPELLING_VARIATIONS[name2_lower]:
            return True

    return False
