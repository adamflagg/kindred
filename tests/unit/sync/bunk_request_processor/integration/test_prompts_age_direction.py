"""#1401 regression guard: prompt files use the structured age_direction field.

Each of the 4 prompts that can emit age_preference requests must:
  (a) mention the `age_direction` field, AND
  (b) NOT contain old-shape phrases (target_name = "older"/"younger"/"unclear" or
      age_preference "older"/"younger") that would re-introduce the
      target_name-overload bug class.

`parse_not_bunk_with.txt` is excluded — it forbids age_preference output entirely.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
PROMPTS_DIR = REPO_ROOT / "config" / "prompts"

AGE_PREF_PROMPTS = [
    "parse_bunk_with.txt",
    "parse_request.txt",
    "parse_bunking_notes.txt",
    "parse_internal_notes.txt",
]

OLD_SHAPE_PATTERNS = [
    re.compile(r'target_name\s*=\s*"older"'),
    re.compile(r'target_name\s*=\s*"younger"'),
    re.compile(r'target_name\s*=\s*"unclear"'),
    re.compile(r'age_preference\s+"older"'),
    re.compile(r'age_preference\s+"younger"'),
]


@pytest.mark.parametrize("prompt_name", AGE_PREF_PROMPTS)
def test_prompt_mentions_age_direction(prompt_name: str) -> None:
    """Each age_preference-emitting prompt must instruct the AI on the age_direction field."""
    path = PROMPTS_DIR / prompt_name
    text = path.read_text()
    assert "age_direction" in text, (
        f"{prompt_name} must mention the age_direction field — otherwise the AI will "
        f"fall back to overloading target_name with direction values."
    )


@pytest.mark.parametrize("prompt_name", AGE_PREF_PROMPTS)
def test_prompt_does_not_contain_old_shape(prompt_name: str) -> None:
    """No prompt may carry the legacy target_name='older'/'younger'/'unclear' overload."""
    path = PROMPTS_DIR / prompt_name
    text = path.read_text()
    for pattern in OLD_SHAPE_PATTERNS:
        match = pattern.search(text)
        assert match is None, (
            f"{prompt_name} contains deprecated old-shape phrase {match.group()!r} — "
            f"this was the bug class age_direction was introduced to eliminate (#1401)."
        )
