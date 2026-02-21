"""Session name aliases for YoY comparison.

When CampMinder creates new sessions (new cm_ids) that replace old ones,
name-based matching can't bridge them. This map lets the forecast logic
treat renamed sessions as the same row.

Keys: old/alternate session names -> Values: canonical (current year) name.
"""

SESSION_NAME_ALIASES: dict[str, str] = {
    "Taste of Camp": "Taste of Camp 1",
    "Session 2b": "Taste of Camp 2",
}


def resolve_session_alias(name: str) -> str:
    """Resolve a session name to its canonical form."""
    return SESSION_NAME_ALIASES.get(name, name)
