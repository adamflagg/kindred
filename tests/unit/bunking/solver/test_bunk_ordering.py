"""Tests for centralized bunk ranking.

TDD: These tests define the expected behavior for bunk ordering.
The implementation must satisfy these tests.
"""

from __future__ import annotations

from bunking.solver.bunk_ordering import compare_bunks, get_bunk_rank


def assert_rank_less(bunk1: str, bunk2: str) -> None:
    """Assert that bunk1 has a lower rank than bunk2."""
    rank1 = get_bunk_rank(bunk1)
    rank2 = get_bunk_rank(bunk2)
    assert rank1 is not None, f"{bunk1} should have a valid rank"
    assert rank2 is not None, f"{bunk2} should have a valid rank"
    assert rank1 < rank2, f"{bunk1} ({rank1}) should be < {bunk2} ({rank2})"


def assert_rank_equal(bunk1: str, bunk2: str) -> None:
    """Assert that bunk1 has the same rank as bunk2."""
    rank1 = get_bunk_rank(bunk1)
    rank2 = get_bunk_rank(bunk2)
    assert rank1 is not None, f"{bunk1} should have a valid rank"
    assert rank2 is not None, f"{bunk2} should have a valid rank"
    assert rank1 == rank2, f"{bunk1} ({rank1}) should equal {bunk2} ({rank2})"


def safe_bunk_rank(bunk: str) -> tuple[int, int]:
    """Get bunk rank, raising if None (for use in sorted())."""
    rank = get_bunk_rank(bunk)
    assert rank is not None, f"{bunk} should have a valid rank"
    return rank


class TestGetBunkRank:
    """Tests for the get_bunk_rank function."""

    def test_basic_numeric_levels(self):
        """Numeric levels should be ordered 1 < 2 < 3 etc."""
        assert_rank_less("B-1", "B-2")
        assert_rank_less("G-3", "G-4")
        assert_rank_less("B-5", "B-6")

    def test_hebrew_levels(self):
        """Hebrew levels (Aleph, Bet) should come before numeric."""
        assert_rank_less("B-Aleph", "B-Bet")
        assert_rank_less("G-Aleph", "G-1")
        assert_rank_less("G-Bet", "G-1")

    def test_letter_suffixes_same_level(self):
        """Letter suffixes within same level: 6A < 6B < 6C."""
        # Critical: G-6A < G-6B (this is the main bug fix)
        assert_rank_less("G-6A", "G-6B")
        assert_rank_less("B-6A", "B-6B")
        # Three letter variants
        assert_rank_less("G-3A", "G-3B")
        assert_rank_less("G-3B", "G-3C")

    def test_letter_suffix_vs_next_level(self):
        """Letter suffixed bunks should be less than next level: 6B < 7."""
        assert_rank_less("G-6B", "G-7")
        assert_rank_less("B-6A", "B-7")
        assert_rank_less("G-5B", "G-6")

    def test_no_suffix_equals_suffix_a_minus_one(self):
        """A level without suffix should be < same level with A suffix."""
        # G-6 (no suffix) should be less than G-6A
        # Because no suffix = suffix order 0, A = suffix order 1
        assert_rank_less("G-6", "G-6A")

    def test_full_ordering_girls(self):
        """Test full ordering of girls bunks."""
        bunks = ["G-7", "G-6B", "G-6A", "G-5", "G-4", "G-3", "G-Bet", "G-Aleph"]
        sorted_bunks = sorted(bunks, key=safe_bunk_rank)
        assert sorted_bunks == [
            "G-Aleph",
            "G-Bet",
            "G-3",
            "G-4",
            "G-5",
            "G-6A",
            "G-6B",
            "G-7",
        ]

    def test_full_ordering_boys(self):
        """Test full ordering of boys bunks."""
        bunks = ["B-9", "B-8", "B-7", "B-6B", "B-6A", "B-5", "B-4", "B-Aleph"]
        sorted_bunks = sorted(bunks, key=safe_bunk_rank)
        assert sorted_bunks == [
            "B-Aleph",
            "B-4",
            "B-5",
            "B-6A",
            "B-6B",
            "B-7",
            "B-8",
            "B-9",
        ]

    def test_ag_bunks_return_none(self):
        """AG bunks should return None (no ranking)."""
        assert get_bunk_rank("AG-8") is None
        assert get_bunk_rank("AG-10") is None
        assert get_bunk_rank("AG-Aleph") is None

    def test_invalid_bunks_return_none(self):
        """Invalid bunk names should return None."""
        assert get_bunk_rank("") is None
        assert get_bunk_rank("InvalidBunk") is None
        assert get_bunk_rank("X-5") is None  # Not B or G prefix

    def test_mixed_gender_same_level(self):
        """Boys and Girls bunks at same level should have same rank tuple."""
        # Same level, same suffix = same rank (gender doesn't affect rank)
        assert_rank_equal("B-6A", "G-6A")
        assert_rank_equal("B-Aleph", "G-Aleph")


class TestCompareBunks:
    """Tests for the compare_bunks function."""

    def test_same_level_different_suffix(self):
        """G-6A is 'lower' than G-6B (younger campers)."""
        assert compare_bunks("G-6A", "G-6B") < 0
        assert compare_bunks("G-6B", "G-6A") > 0

    def test_different_levels(self):
        """Different levels should compare correctly."""
        assert compare_bunks("G-5", "G-6A") < 0
        assert compare_bunks("G-6B", "G-7") < 0
        assert compare_bunks("B-Aleph", "B-1") < 0

    def test_same_bunk_returns_zero(self):
        """Same bunk should return 0."""
        assert compare_bunks("G-6A", "G-6A") == 0
        assert compare_bunks("B-Aleph", "B-Aleph") == 0

    def test_ag_bunks_return_zero(self):
        """AG bunks should return 0 (can't compare)."""
        assert compare_bunks("AG-8", "AG-10") == 0
        assert compare_bunks("AG-8", "G-5") == 0
        assert compare_bunks("G-5", "AG-8") == 0

    def test_cross_gender_comparison(self):
        """Cross-gender comparison should work (same level = same rank)."""
        assert compare_bunks("B-6A", "G-6B") < 0  # 6A < 6B regardless of gender
        assert compare_bunks("G-5", "B-6") < 0  # 5 < 6 regardless of gender


class TestBunkOrderingEdgeCases:
    """Edge case tests for bunk ordering."""

    def test_high_numbered_levels(self):
        """High numbered levels (9, 10, etc.) should work."""
        assert_rank_less("B-9", "B-10")
        assert get_bunk_rank("G-10") is not None

    def test_level_with_multiple_digits_and_suffix(self):
        """Multi-digit levels with suffix should work."""
        assert get_bunk_rank("B-10A") is not None
        assert get_bunk_rank("B-10B") is not None
        assert_rank_less("B-10A", "B-10B")
        assert_rank_less("B-10B", "B-11")

    def test_lowercase_suffix(self):
        """Lowercase suffixes should work (case insensitive)."""
        # Note: Real data uses uppercase, but we should handle both
        # Both should be valid and equal
        assert get_bunk_rank("G-6A") is not None
        assert get_bunk_rank("G-6a") is not None
        assert_rank_equal("G-6A", "G-6a")
