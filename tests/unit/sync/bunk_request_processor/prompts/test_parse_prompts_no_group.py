"""Tests that parse prompts no longer mention the group-expansion feature
and that they encode the new staff-review fallback rules.

After the group-expansion deletion (see
docs/plans/workstream-b-remove-group-expansion.md), the parse prompts
must:

1. No longer instruct the AI to emit group_kind / group_metadata.
2. No longer reference the LAST_YEAR_BUNKMATES / SIBLING / classmates /
   congregation placeholder vocabulary.
3. Contain explicit guidance telling the AI to emit a single PENDING
   staff-review record when:
   - A BUNK_APART (not_bunk_with) input is a demographic or trait
     exclusion rather than a named individual (e.g. "no trans campers",
     "not with loud kids").
   - A BUNK_WITH input references an unnamed group (e.g. "last year's
     bunkmates", "kids from her school").

These tests are written TDD-style: they fail against the current prompts
and pass only after the prompt sweep is complete.
"""

from __future__ import annotations

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
    "classmates",
    "congregation",
    "Group references",
    "group reference",
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
def _reset_prompt_cache() -> None:
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
                f"Prompt '{prompt_name}.txt' still mentions '{token}'; "
                "the group-expansion vocabulary must be removed."
            )

    def test_output_field_rules_partial_has_no_group_kind(self) -> None:
        text = load_prompt("_partials/output_field_rules") if False else None
        # The partial lives under _partials/; load directly via filesystem
        # to avoid relying on load_prompt name rules.
        from bunking.sync.bunk_request_processor.prompts.loader import PARTIALS_DIR

        path = PARTIALS_DIR / "output_field_rules.txt"
        assert path.exists(), "output_field_rules partial must exist"
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN_GROUP_TOKENS:
            assert token not in text, (
                f"output_field_rules.txt still mentions '{token}'; "
                "the group-expansion vocabulary must be removed."
            )


class TestBunkApartStaffReviewFallback:
    """parse_not_bunk_with must require a specific target name OR emit one
    PENDING staff-review record for demographic / trait exclusions."""

    def test_prompt_requires_named_individual_rule(self) -> None:
        text = load_prompt("parse_not_bunk_with")
        # The rule must be explicit: target name required OR fallback record.
        # We assert on key phrases that the prompt should contain after the
        # sweep. These are intentionally loose so small wording tweaks do not
        # thrash the test.
        assert "specific individual" in text.lower() or "specific person" in text.lower(), (
            "parse_not_bunk_with must state that BUNK_APART needs a specific individual."
        )

    def test_prompt_has_demographic_fallback_guidance(self) -> None:
        text = load_prompt("parse_not_bunk_with").lower()
        # Must mention at least one of the demographic/trait examples
        # (trans / loud kids / similar) AND the staff-review / PENDING concept.
        has_demographic_example = any(
            token in text
            for token in (
                "no trans",
                "demographic",
                "trait",
                "loud kids",
                "certain kids",
            )
        )
        has_pending_or_review = any(
            token in text
            for token in (
                "pending",
                "staff review",
                "staff-review",
                "flag for staff",
                "needs_clarification",
                "ambiguity_reason",
            )
        )
        assert has_demographic_example, (
            "parse_not_bunk_with must give an example of a demographic/trait exclusion "
            "(e.g. 'no trans campers', 'loud kids') that cannot be turned into "
            "individual BUNK_APART records."
        )
        assert has_pending_or_review, (
            "parse_not_bunk_with must instruct the AI to emit a PENDING staff-review "
            "record (needs_clarification / ambiguity_reason) for demographic/trait "
            "exclusions, so no input is silently dropped."
        )


class TestBunkWithUnnamedGroupFallback:
    """parse_bunk_with must emit a single PENDING staff-review record when
    the input references an unnamed group rather than individual names."""

    def test_prompt_has_unnamed_group_fallback_guidance(self) -> None:
        text = load_prompt("parse_bunk_with").lower()
        has_unnamed_group_example = any(
            token in text
            for token in (
                "last year's bunkmates",
                "last year bunkmates",
                "unnamed group",
                "kids from her school",
                "kids from his school",
                "group reference",
            )
        )
        has_pending_or_review = any(
            token in text
            for token in (
                "pending",
                "staff review",
                "staff-review",
                "needs_clarification",
                "ambiguity_reason",
            )
        )
        assert has_unnamed_group_example, (
            "parse_bunk_with must give an example of an unnamed group reference "
            "(e.g. 'last year's bunkmates', 'kids from her school') so the AI "
            "knows how to recognize the pattern."
        )
        assert has_pending_or_review, (
            "parse_bunk_with must instruct the AI to emit a PENDING staff-review "
            "record for unnamed group references, so no input is silently dropped."
        )
