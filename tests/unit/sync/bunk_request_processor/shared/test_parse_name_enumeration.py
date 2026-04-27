"""Regression test for #51: parse_name should strip leading enumeration prefixes.

Bug surfaced 2026-04-27 in production: a parent CSV contained:

    1. Liam Garcia
    2. Olivia Chen
    3. Riley Sam

The AI parser (Phase 1) extracted three target_name values verbatim,
including the enumeration prefix ("1. Liam Garcia", etc.). Phase 2's
exact_match strategy then called parse_name(), which treats "1." as
the first name and "Garcia" as the last name. find_by_name("1.", "Garcia")
returns no candidates, fuzzy and phonetic strategies also fail (no first
name in the DB looks like "1."), and the secondary candidate-generation
in phase2_resolution_service.py:426 (`first_name = target.split()[0]`)
also gets "1." and bails silently — leaving the request at status=pending,
confidence_score=0, resolution_method='unknown' for an otherwise
unambiguous same-session name.

The right fix is defense in depth: the AI prompt should drop enumeration
prefixes before emitting target_name (parse_bunk_with.txt example 2 is
ambiguous on this point), AND parse_name should be tolerant of
enumeration prefixes that slip through.

This test pins down the parse_name half of the fix.
"""

from bunking.sync.bunk_request_processor.shared.name_utils import parse_name


class TestParseNameStripsEnumerationPrefixes:
    """Leading enumeration tokens (1., 2), a., *, -, (1)) are NOT first names."""

    def test_numbered_dot(self):
        """`1. Liam Garcia` must parse as Liam Garcia, not 1./Garcia."""
        p = parse_name("1. Liam Garcia")
        assert p.first == "Liam"
        assert p.last == "Garcia"
        assert p.is_complete is True

    def test_numbered_paren(self):
        """`2) Olivia Chen` must parse as Olivia Chen."""
        p = parse_name("2) Olivia Chen")
        assert p.first == "Olivia"
        assert p.last == "Chen"
        assert p.is_complete is True

    def test_letter_enumeration(self):
        """`a. Emma Johnson` must parse as Emma Johnson."""
        p = parse_name("a. Emma Johnson")
        assert p.first == "Emma"
        assert p.last == "Johnson"

    def test_asterisk_bullet(self):
        """`* Riley Sam` must parse as Riley Sam."""
        p = parse_name("* Riley Sam")
        assert p.first == "Riley"
        assert p.last == "Sam"

    def test_dash_bullet(self):
        """`- Samuel Johnson` must parse as Samuel Johnson."""
        p = parse_name("- Samuel Johnson")
        assert p.first == "Samuel"
        assert p.last == "Johnson"

    def test_paren_wrapped_number(self):
        """`(1) Liam Garcia` must parse as Liam Garcia."""
        p = parse_name("(1) Liam Garcia")
        assert p.first == "Liam"
        assert p.last == "Garcia"

    def test_plain_name_unaffected(self):
        """Regression guard: plain names must still parse normally."""
        p = parse_name("Liam Garcia")
        assert p.first == "Liam"
        assert p.last == "Garcia"

    def test_two_digit_enumeration(self):
        """`10. Liam Garcia` must parse as Liam Garcia."""
        p = parse_name("10. Liam Garcia")
        assert p.first == "Liam"
        assert p.last == "Garcia"
