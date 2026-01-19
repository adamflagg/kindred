"""Tests for prompt loader with partial injection support.

Tests the ability to load shared prompt partials from _partials/ directory
and inject them into prompts via {partial_name} placeholders.
"""

from __future__ import annotations

import pytest

from bunking.sync.bunk_request_processor.prompts.loader import (
    PROMPTS_DIR,
    clear_cache,
    format_prompt,
    load_prompt,
)


class TestPromptLoaderBasics:
    """Test basic prompt loading functionality."""

    def test_load_prompt_returns_template_content(self):
        """Test that load_prompt returns the file content as a string."""
        # Clear cache to ensure fresh load
        clear_cache()

        # parse_bunk_with.txt should exist
        template = load_prompt("parse_bunk_with")

        assert isinstance(template, str)
        assert len(template) > 0
        # Should contain expected placeholder
        assert "{camp_name}" in template

    def test_format_prompt_substitutes_branding_vars(self):
        """Test that format_prompt substitutes branding variables."""
        clear_cache()

        # format_prompt should substitute {camp_name} and other branding vars
        formatted = format_prompt(
            "parse_bunk_with",
            requester_info="Test requester",
            request_text="Emma Wilson",
        )

        # Branding vars should be substituted (camp_name shouldn't appear as literal)
        assert "{camp_name}" not in formatted


class TestPromptLoaderPartials:
    """Tests for partial injection feature.

    This feature allows shared prompt snippets to be defined in
    config/prompts/_partials/*.txt and auto-injected into prompts
    using {filename} placeholders.
    """

    def test_format_prompt_injects_partials_from_partials_dir(self):
        """Test that partials from _partials dir are auto-injected.

        The feature should:
        1. Scan config/prompts/_partials/ for .txt files
        2. Make each file available as {filename_without_ext} placeholder
        3. Auto-inject these during format_prompt
        """
        clear_cache()

        partials_dir = PROMPTS_DIR / "_partials"

        # Skip if partials dir doesn't exist yet
        if not partials_dir.exists():
            pytest.skip("_partials directory doesn't exist - feature not yet implemented")

        # Check if output_field_rules.txt exists
        partial_file = partials_dir / "output_field_rules.txt"
        if not partial_file.exists():
            pytest.skip("output_field_rules.txt partial doesn't exist yet")

        # Format parse_not_bunk_with which uses {output_field_rules} placeholder
        formatted = format_prompt(
            "parse_not_bunk_with",
            requester_info="Test",
            request_text="Maya Anderson",
        )

        # Check that partial content was injected (contains content from partial file)
        assert "PARSE_NOTES RULE" in formatted, (
            "Partial content should be injected, replacing {output_field_rules} placeholder"
        )
        # Placeholder should be replaced
        assert "{output_field_rules}" not in formatted, (
            "Placeholder {output_field_rules} should be replaced with partial content"
        )

    def test_partials_are_loaded_alongside_branding_vars(self):
        """Test that both branding vars and partials can be used in same prompt."""
        clear_cache()

        partials_dir = PROMPTS_DIR / "_partials"
        if not partials_dir.exists():
            pytest.skip("_partials directory doesn't exist - feature not yet implemented")

        # Format a prompt - should have both branding and partials substituted
        try:
            formatted = format_prompt(
                "parse_not_bunk_with",
                requester_info="Test Info",
                request_text="Test Content",
            )

            # Branding vars should be substituted
            assert "{camp_name}" not in formatted

            # If output_field_rules partial exists and is referenced, it should be substituted
            if (partials_dir / "output_field_rules.txt").exists():
                assert "{output_field_rules}" not in formatted, (
                    "output_field_rules partial should be substituted if it exists"
                )
        except KeyError as e:
            # This is expected if partial isn't loaded but prompt references it
            if "output_field_rules" in str(e):
                pytest.fail(
                    f"Prompt references {{output_field_rules}} but partial not loaded: {e}. "
                    "Implement partial loading in loader.py"
                )
            raise


class TestPromptLoaderPartialEdgeCases:
    """Edge case tests for partial loading."""

    def test_partial_with_special_chars_in_name(self):
        """Test that partial filenames with underscores work correctly."""
        # output_field_rules.txt -> {output_field_rules}
        # The filename without .txt extension becomes the placeholder key
        clear_cache()

        partials_dir = PROMPTS_DIR / "_partials"
        if not partials_dir.exists():
            pytest.skip("_partials directory doesn't exist")

        # Check naming convention is correct
        for partial_file in partials_dir.glob("*.txt"):
            expected_key = partial_file.stem  # filename without extension
            assert "_" in expected_key or expected_key.isalnum(), (
                f"Partial key '{expected_key}' should be a valid Python identifier"
            )

    def test_missing_partials_dir_is_handled_gracefully(self):
        """Test that missing _partials directory doesn't break prompt loading."""
        clear_cache()

        # This should work even if _partials doesn't exist
        try:
            formatted = format_prompt(
                "parse_bunk_with",
                requester_info="Test",
                request_text="Test",
            )
            assert isinstance(formatted, str)
        except FileNotFoundError:
            pytest.fail("Missing _partials dir should not cause FileNotFoundError")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
