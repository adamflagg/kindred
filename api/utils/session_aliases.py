"""Session name aliases for YoY comparison.

When CampMinder creates new sessions (new cm_ids) that replace old ones,
name-based matching can't bridge them. This map lets the forecast and
retention logic treat renamed sessions as the same entity.

Keys: alternate session names -> Values: the alias group's key.

A group is an equivalence class: every name in it is the same session, in either
direction across years. The value is just the group's key, not necessarily the
current year's name (2027 returns to "Taste of Camp", keyed "Taste of Camp 1").
"""

SESSION_NAME_ALIASES: dict[str, str] = {
    "Taste of Camp": "Taste of Camp 1",
    "Session 2b": "Taste of Camp 2",
}

# Reverse map: canonical name -> old/alternate names
_REVERSE_ALIASES: dict[str, list[str]] = {}
for _old, _canonical in SESSION_NAME_ALIASES.items():
    _REVERSE_ALIASES.setdefault(_canonical, []).append(_old)


def resolve_session_alias(name: str) -> str:
    """Resolve a session name to its alias group's key (the name itself when it has none)."""
    return SESSION_NAME_ALIASES.get(name, name)


def get_alias_group(name: str) -> list[str]:
    """Get all names (canonical + aliases) that refer to the same session.

    Returns a list including the canonical name and any old/alternate names.
    If the name has no aliases, returns a single-element list.
    """
    canonical = resolve_session_alias(name)
    alternates = _REVERSE_ALIASES.get(canonical, [])
    return [canonical, *alternates]
