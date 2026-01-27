"""
Branding configuration loader.

Loads camp branding from JSON files with local override support.
Default branding is generic; camp-specific branding is loaded from gitignored local files.

Usage:
    from bunking.branding import get_branding, get_camp_name

    branding = get_branding()
    camp_name = get_camp_name()  # "Summer Camp" or local override
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Config file paths relative to project root
CONFIG_DIR = Path(__file__).parent.parent / "config"
DEFAULT_BRANDING_FILE = CONFIG_DIR / "branding.json"
LOCAL_BRANDING_FILE = CONFIG_DIR / "branding.local.json"


@lru_cache(maxsize=1)
def get_branding() -> dict[str, Any]:
    """
    Load branding configuration with local override support.

    Loads default branding from config/branding.json, then merges
    any overrides from config/branding.local.json (gitignored).

    Returns:
        Dict containing branding configuration.
    """
    branding: dict[str, Any] = {}

    # Load default branding
    if DEFAULT_BRANDING_FILE.exists():
        with open(DEFAULT_BRANDING_FILE) as f:
            branding = json.load(f)
        logger.debug(f"Loaded default branding from {DEFAULT_BRANDING_FILE}")
    else:
        logger.warning(f"Default branding file not found: {DEFAULT_BRANDING_FILE}")

    # Merge local overrides if present
    if LOCAL_BRANDING_FILE.exists():
        try:
            with open(LOCAL_BRANDING_FILE) as f:
                local_branding = json.load(f)
            branding = _deep_merge(branding, local_branding)
            logger.debug(f"Merged local branding from {LOCAL_BRANDING_FILE}")
        except (OSError, json.JSONDecodeError) as e:
            # File may be git-crypt encrypted (binary) or corrupted
            logger.debug(f"Skipping local branding (unreadable): {e}")

    return branding


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Deep merge two dicts, with override taking precedence."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def get_camp_name() -> str:
    """Get full camp name (e.g., 'Summer Camp' or local override)."""
    result: str = get_branding().get("camp_name", "Summer Camp")
    return result


def get_camp_name_short() -> str:
    """Get short camp name (e.g., 'Camp' or local override)."""
    result: str = get_branding().get("camp_name_short", "Camp")
    return result


def get_camp_description() -> str:
    """Get camp description for prompts."""
    result: str = get_branding().get(
        "camp_description",
        "a residential summer camp where campers live in overnight cabins",
    )
    return result


def get_camp_tagline() -> str:
    """Get camp tagline (e.g., 'summers at camp')."""
    result: str = get_branding().get("camp_tagline", "summers at camp")
    return result


def get_sso_display_name() -> str:
    """Get SSO provider display name."""
    result: str = get_branding().get("sso_display_name", "Staff SSO")
    return result


def get_logo_path(size: str = "large") -> str | None:
    """
    Get logo path for the specified size.

    Args:
        size: 'large' or 'nav'

    Returns:
        Logo path or None if not configured.
    """
    logos: dict[str, str | None] = get_branding().get("logo", {})
    return logos.get(size)


def clear_cache() -> None:
    """Clear the branding cache. Useful for testing or reloading config."""
    get_branding.cache_clear()
