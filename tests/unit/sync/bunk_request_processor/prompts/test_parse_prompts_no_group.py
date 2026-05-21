"""Regression guard: parse prompts do not mention group-expansion vocabulary.

Parse prompts must not instruct the AI to emit group_kind / group_metadata
or reference the LAST_YEAR_BUNKMATES / SIBLING / classmates / congregation
placeholder vocabulary. Unresolved / unnamed inputs pass through Phase 2
+ Phase 3 and land as PENDING bunk_requests with a negative requested_cm_id
(see disposition_rules.py).
"""

from collections.abc import Generator

import pytest

from bunking.sync.bunk_request_processor.prompts.loader import (
    clear_cache,
    load_prompt,
)

FORBIDDEN_GROUP_TOKENS = (
    "group_kind",
    "group_metadata",
    "LAST_YEAR_BUNKMATES",
    "last_year_bunkmates",
    # Group-expansion category names that the AI was previously asked to emit
    # as an enum value. Lowercase-standalone "classmates" / "congregation" are
    # still legal English, so only the prompt-enum value tokens are forbidden.
    '"classmates"',
    '"congregation"',
)

PARSE_PROMPT_NAMES = (
    "parse_request",
    "parse_bunk_with",
    "parse_not_bunk_with",
    "parse_bunking_notes",
    "parse_internal_notes",
    "disambiguate",
)


@pytest.fixture(autouse=True)
def _reset_prompt_cache() -> Generator[None]:
    # Ensure every test reads the current on-disk prompt, not a cached copy
    # left behind by another test.
    clear_cache()
    yield
    clear_cache()


class TestParsePromptsNoGroupVocabulary:
    """Parse prompts must not mention group-expansion vocabulary."""

    @pytest.mark.parametrize("prompt_name", PARSE_PROMPT_NAMES)
    def test_prompt_has_no_group_kind_mentions(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        for token in FORBIDDEN_GROUP_TOKENS:
            assert token not in text, (
                f"Prompt '{prompt_name}.txt' still mentions '{token}'; the group-expansion vocabulary must be removed."
            )

    def test_output_field_rules_partial_has_no_group_kind(self) -> None:
        # The partial lives under _partials/; load directly via filesystem
        # to avoid relying on load_prompt name rules.
        from bunking.sync.bunk_request_processor.prompts.loader import PARTIALS_DIR

        path = PARTIALS_DIR / "output_field_rules.txt"
        assert path.exists(), "output_field_rules partial must exist"
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN_GROUP_TOKENS:
            assert token not in text, (
                f"output_field_rules.txt still mentions '{token}'; the group-expansion vocabulary must be removed."
            )
