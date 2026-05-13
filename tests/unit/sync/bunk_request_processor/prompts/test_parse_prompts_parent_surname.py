"""Static prompt-content guards for the PARENT-CONTEXT SURNAME EXTRACTION rule.

These tests verify the prompt FILES contain the rule and required examples.
AI behavior on real inputs is verified separately via production trace inspection
post-merge — this guard catches accidental rule deletion or example drift.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest

from bunking.sync.bunk_request_processor.prompts.loader import clear_cache, load_prompt


PROMPTS_WITH_PARENT_RULE = ["parse_bunk_with", "parse_bunking_notes", "parse_internal_notes"]

SECTION_HEADER = "PARENT-CONTEXT SURNAME EXTRACTION"
POSITIVE_EXAMPLE_MOTHER = "whose mother is Jane Garcia"
POSITIVE_EXAMPLE_POSSESSIVE = "Olivia Chen's son"
POSITIVE_EXAMPLE_BARE = "Olivia (Patel)"
NEGATIVE_EXAMPLE_RELATIONSHIP = "(Cousin)"


@pytest.fixture(autouse=True)
def _reset_prompt_cache() -> Generator[None]:
    clear_cache()
    yield
    clear_cache()


class TestParentSurnameRule:
    @pytest.mark.parametrize("prompt_name", PROMPTS_WITH_PARENT_RULE)
    def test_prompt_has_section_header(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        assert SECTION_HEADER in text, f"{prompt_name}.txt missing section header {SECTION_HEADER!r}"

    @pytest.mark.parametrize("prompt_name", PROMPTS_WITH_PARENT_RULE)
    def test_prompt_has_positive_mother_example(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        assert POSITIVE_EXAMPLE_MOTHER in text, f"{prompt_name}.txt missing 'whose mother is' positive example"

    @pytest.mark.parametrize("prompt_name", PROMPTS_WITH_PARENT_RULE)
    def test_prompt_has_positive_possessive_example(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        assert POSITIVE_EXAMPLE_POSSESSIVE in text, f"{prompt_name}.txt missing possessive 'X's son/daughter' example"

    @pytest.mark.parametrize("prompt_name", PROMPTS_WITH_PARENT_RULE)
    def test_prompt_has_positive_bare_surname_example(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        assert POSITIVE_EXAMPLE_BARE in text, f"{prompt_name}.txt missing bare-surname-in-parens example"

    @pytest.mark.parametrize("prompt_name", PROMPTS_WITH_PARENT_RULE)
    def test_prompt_has_negative_relationship_example(self, prompt_name: str) -> None:
        text = load_prompt(prompt_name)
        assert NEGATIVE_EXAMPLE_RELATIONSHIP in text, f"{prompt_name}.txt missing (Cousin) negative example"
