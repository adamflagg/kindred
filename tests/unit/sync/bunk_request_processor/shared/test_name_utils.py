"""Tests for name_utils module - last_name_matches with Jaro-Winkler fuzzy matching."""

from bunking.sync.bunk_request_processor.shared.name_utils import last_name_jw_raw_score, last_name_matches


class TestLastNameMatchesExisting:
    """Verify existing exact/suffix matching behavior is preserved."""

    def test_exact_match(self):
        assert last_name_matches("Garcia", "Garcia") is True

    def test_case_insensitive(self):
        assert last_name_matches("garcia", "Garcia") is True

    def test_suffix_match_compound(self):
        assert last_name_matches("Zarlin", "Simons Zarlin") is True

    def test_suffix_match_hyphenated(self):
        assert last_name_matches("Harris", "Simon-Harris") is True

    def test_suffix_match_multi_word(self):
        assert last_name_matches("Cruz", "De La Cruz") is True

    def test_not_substring(self):
        assert last_name_matches("Smith", "Goldsmith") is False

    def test_empty_strings(self):
        assert last_name_matches("", "Garcia") is False
        assert last_name_matches("Garcia", "") is False


class TestLastNameMatchesJaroWinkler:
    """Tests for fuzzy last name matching via Jaro-Winkler."""

    def test_single_char_variation(self):
        """Kiefer/Kieffer should match (single-char difference)."""
        assert last_name_matches("Kiefer", "Kieffer") is True

    def test_prefix_spacing(self):
        """Mc Cabe/McCabe should match (prefix spacing)."""
        assert last_name_matches("Mc Cabe", "McCabe") is True

    def test_apostrophe_variant(self):
        """O'Brian/O'Brien should match (apostrophe + variant)."""
        assert last_name_matches("O'Brian", "O'Brien") is True

    def test_hyphen_split_matches_part(self):
        """Rivera should match Rivera-Santos (hyphen-split)."""
        assert last_name_matches("Rivera", "Rivera-Santos") is True

    def test_reverse_hyphen_split(self):
        """Rivera-Santos search should match plain Rivera."""
        assert last_name_matches("Rivera-Santos", "Rivera") is True

    def test_unrelated_names_rejected(self):
        """Completely different names should not match."""
        assert last_name_matches("Smith", "Jones") is False

    def test_short_unrelated_rejected(self):
        """Short dissimilar names should not match."""
        assert last_name_matches("Lee", "Liu") is False

    def test_existing_suffix_still_works(self):
        """Suffix matching should still work alongside JW."""
        assert last_name_matches("Cruz", "De La Cruz") is True

    def test_mccabe_variants(self):
        """McCabe/MacCabe should match."""
        assert last_name_matches("MacCabe", "McCabe") is True

    def test_threshold_parameter(self):
        """Custom threshold should be respected."""
        # Very strict threshold should reject minor variations
        assert last_name_matches("Kiefer", "Kieffer", threshold=0.99) is False
        # Loose threshold should accept more
        assert last_name_matches("Kiefer", "Kieffer", threshold=0.80) is True


class TestLastNameJwRawScore:
    """last_name_jw_raw_score is a public API (no leading underscore)."""

    def test_identical_names_score_one(self):
        assert last_name_jw_raw_score("Smith", "Smith") == 1.0

    def test_similar_names_high_score(self):
        score = last_name_jw_raw_score("Kiefer", "Kieffer")
        assert score > 0.9

    def test_unrelated_names_low_score(self):
        score = last_name_jw_raw_score("Smith", "Jones")
        assert score < 0.8

    def test_returns_float_in_unit_interval(self):
        score = last_name_jw_raw_score("Garcia", "Garza")
        assert 0.0 <= score <= 1.0
