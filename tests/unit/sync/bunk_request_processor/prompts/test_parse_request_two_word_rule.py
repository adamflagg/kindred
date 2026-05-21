"""Regression guard for #896: parse_request prompt must teach the AI to prefer
treating a two-word space-separated target as a single "FirstName LastName"
rather than splitting into two separate first-name requests.

Without this rule, input like "Riley Sam" parses as two bunk_with requests
("Riley" → unresolved, "Sam" → fuzzy-matches anyone with preferred_name
"Sam"). The combined-name interpretation is the safer default: a no-match
falls through to normal disambiguation instead of silently mis-assigning.
"""

from collections.abc import Generator

import pytest

from bunking.sync.bunk_request_processor.prompts.loader import (
    clear_cache,
    load_prompt,
)


@pytest.fixture(autouse=True)
def _reset_prompt_cache() -> Generator[None]:
    clear_cache()
    yield
    clear_cache()


class TestParseRequestTwoWordRule:
    """parse_request.txt must instruct the AI on two-word target handling."""

    def test_prompt_has_two_word_section(self) -> None:
        text = load_prompt("parse_request")
        # Section header — the AI's attention is cued by the === block convention.
        assert "TWO-WORD TARGET" in text.upper(), (
            "parse_request.txt must include a TWO-WORD TARGETS section teaching "
            "'FirstName LastName' as the default interpretation (#896)."
        )

    def test_prompt_teaches_firstname_lastname_preference(self) -> None:
        text = load_prompt("parse_request").lower()
        # The rule must reference both the combined interpretation and the
        # conditions under which splitting is allowed.
        assert "firstname" in text, "parse_request.txt must mention 'FirstName' (#896)."
        assert "lastname" in text, "parse_request.txt must mention 'LastName' (#896)."

    def test_prompt_references_comma_or_conjunction_as_split_signal(self) -> None:
        text = load_prompt("parse_request").lower()
        # Splitting should be gated on explicit delimiters, not default behavior.
        assert "comma" in text or '","' in text, (
            "parse_request.txt must tell the AI to split only on explicit delimiters (#896)."
        )
