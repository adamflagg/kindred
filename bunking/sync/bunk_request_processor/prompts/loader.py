"""Load and format AI prompts from config/prompts/ directory.

Prompts are stored as plain text files with {variable} placeholders
that are filled using Python's str.format().

Branding variables ({camp_name}, {camp_description}, etc.) are automatically
injected from the branding configuration.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from bunking.branding import get_branding

# Navigate from this file to config/prompts/
# bunking/sync/bunk_request_processor/prompts/loader.py -> config/prompts/
PROMPTS_DIR = Path(__file__).parent.parent.parent.parent.parent / "config" / "prompts"


def _get_branding_vars() -> dict[str, str]:
    """Get branding variables for prompt substitution."""
    branding = get_branding()
    return {
        "camp_name": branding.get("camp_name", "Summer Camp"),
        "camp_name_short": branding.get("camp_name_short", "Camp"),
        "camp_description": branding.get("camp_description", "a residential summer camp"),
        "camp_tagline": branding.get("camp_tagline", "summers at camp"),
    }


@lru_cache(maxsize=10)
def load_prompt(name: str) -> str:
    """Load a prompt template from config/prompts/.

    Args:
        name: Prompt name without extension (e.g., "parse_request")

    Returns:
        The prompt template as a string.

    Raises:
        FileNotFoundError: If the prompt file doesn't exist.
    """
    path = PROMPTS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")
    return path.read_text(encoding="utf-8")


def format_prompt(name: str, **kwargs: str) -> str:
    """Load and format a prompt with variable substitution.

    Branding variables ({camp_name}, {camp_description}, etc.) are
    automatically included. Additional variables can be passed via kwargs.

    Args:
        name: Prompt name without extension (e.g., "parse_request")
        **kwargs: Additional variables to substitute in the prompt template.

    Returns:
        The formatted prompt string.

    Raises:
        FileNotFoundError: If the prompt file doesn't exist.
        KeyError: If a required variable is missing from kwargs.
    """
    template = load_prompt(name)
    # Merge branding vars with kwargs (kwargs take precedence)
    all_vars = {**_get_branding_vars(), **kwargs}
    return template.format(**all_vars)


def clear_cache() -> None:
    """Clear the prompt cache. Useful for testing or hot-reloading."""
    load_prompt.cache_clear()
