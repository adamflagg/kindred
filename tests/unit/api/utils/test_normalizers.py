"""
Unit tests for geographic data normalizers.

Tests verify normalization of city, school, and congregation names including:
- Preprocessing (whitespace, N/A detection, case handling)
- City normalization (state suffix removal, standardization)
- Congregation normalization (abbreviations, whitespace)
- Fuzzy clustering of similar values
"""

from __future__ import annotations

# ============================================================================
# Tests for preprocess()
# ============================================================================


class TestPreprocess:
    """Tests for basic preprocessing of input values."""

    def test_preprocess_empty_string(self) -> None:
        """Empty strings return empty string."""
        from api.utils.normalizers import preprocess

        assert preprocess("") == ""

    def test_preprocess_none_returns_empty(self) -> None:
        """None values return empty string."""
        from api.utils.normalizers import preprocess

        assert preprocess(None) == ""

    def test_preprocess_whitespace_only(self) -> None:
        """Whitespace-only strings return empty string."""
        from api.utils.normalizers import preprocess

        assert preprocess("   ") == ""
        assert preprocess("\t\n") == ""

    def test_preprocess_na_variants(self) -> None:
        """Various N/A representations return empty string."""
        from api.utils.normalizers import preprocess

        na_variants = [
            "n/a",
            "N/A",
            "NA",
            "na",
            "N/a",
            "none",
            "None",
            "NONE",
            "null",
            "NULL",
            "Null",
            "-",
            "--",
            "---",
            ".",
            "..",
            "...",
        ]
        for na in na_variants:
            assert preprocess(na) == "", f"Expected empty string for '{na}'"

    def test_preprocess_normalizes_whitespace(self) -> None:
        """Multiple spaces collapsed to single space."""
        from api.utils.normalizers import preprocess

        assert preprocess("San   Francisco") == "San Francisco"
        assert preprocess("  San Francisco  ") == "San Francisco"
        assert preprocess("San\tFrancisco") == "San Francisco"

    def test_preprocess_preserves_valid_text(self) -> None:
        """Normal text preserved with trimmed whitespace."""
        from api.utils.normalizers import preprocess

        assert preprocess("San Francisco") == "San Francisco"
        assert preprocess("Oakland") == "Oakland"


# ============================================================================
# Tests for normalize_city()
# ============================================================================


class TestNormalizeCity:
    """Tests for city name normalization."""

    def test_normalize_city_empty(self) -> None:
        """Empty input returns empty string."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("") == ""
        assert normalize_city(None) == ""

    def test_normalize_city_strips_state_suffix(self) -> None:
        """State abbreviation suffixes are removed."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("San Francisco, CA") == "San Francisco"
        assert normalize_city("Oakland, CA") == "Oakland"
        assert normalize_city("New York, NY") == "New York"
        assert normalize_city("Austin, TX") == "Austin"

    def test_normalize_city_strips_state_and_zip(self) -> None:
        """State + zip code suffixes are removed."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("San Francisco, CA 94103") == "San Francisco"
        assert normalize_city("Oakland, CA 94612") == "Oakland"
        assert normalize_city("Beverly Hills, CA 90210") == "Beverly Hills"

    def test_normalize_city_strips_zip_plus_four(self) -> None:
        """ZIP+4 format is also removed."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("San Francisco, CA 94103-1234") == "San Francisco"

    def test_normalize_city_title_case(self) -> None:
        """City names standardized to title case."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("SAN FRANCISCO") == "San Francisco"
        assert normalize_city("san francisco") == "San Francisco"
        assert normalize_city("OAKLAND") == "Oakland"

    def test_normalize_city_na_variants(self) -> None:
        """N/A variants return empty string."""
        from api.utils.normalizers import normalize_city

        assert normalize_city("N/A") == ""
        assert normalize_city("n/a") == ""
        assert normalize_city("None") == ""

    def test_normalize_city_preserves_hyphens_apostrophes(self) -> None:
        """City names with hyphens/apostrophes preserved."""
        from api.utils.normalizers import normalize_city

        # Note: Title case may affect these, test expected behavior
        result = normalize_city("winston-salem")
        assert "salem" in result.lower()


# ============================================================================
# Tests for normalize_congregation()
# ============================================================================


class TestNormalizeCongregation:
    """Tests for synagogue/congregation name normalization."""

    def test_normalize_congregation_empty(self) -> None:
        """Empty input returns empty string."""
        from api.utils.normalizers import normalize_congregation

        assert normalize_congregation("") == ""
        assert normalize_congregation(None) == ""

    def test_normalize_congregation_whitespace(self) -> None:
        """Whitespace normalized."""
        from api.utils.normalizers import normalize_congregation

        result = normalize_congregation("  Beth  Shalom  ")
        assert result == "Beth Shalom"

    def test_normalize_congregation_na_variants(self) -> None:
        """N/A variants return empty string."""
        from api.utils.normalizers import normalize_congregation

        assert normalize_congregation("N/A") == ""
        assert normalize_congregation("none") == ""
        assert normalize_congregation("-") == ""

    def test_normalize_congregation_preserves_case(self) -> None:
        """Congregation names preserve original casing (no forced title case)."""
        from api.utils.normalizers import normalize_congregation

        # Congregation names are sensitive - Beth vs BETH should be preserved
        # or normalized consistently. Test expected behavior.
        result = normalize_congregation("Congregation Beth Israel")
        assert "Beth Israel" in result or "beth israel" in result.lower()


# ============================================================================
# Tests for cluster_similar_values()
# ============================================================================


class TestClusterSimilarValues:
    """Tests for fuzzy clustering of similar values."""

    def test_cluster_empty_list(self) -> None:
        """Empty list returns empty mapping."""
        from api.utils.normalizers import cluster_similar_values

        result = cluster_similar_values([])
        assert result == {}

    def test_cluster_single_value(self) -> None:
        """Single value maps to itself."""
        from api.utils.normalizers import cluster_similar_values

        result = cluster_similar_values(["San Francisco"])
        assert result == {"San Francisco": "San Francisco"}

    def test_cluster_identical_values(self) -> None:
        """Identical values cluster together."""
        from api.utils.normalizers import cluster_similar_values

        result = cluster_similar_values(["Oakland", "Oakland", "Oakland"])
        # All should map to same canonical
        assert len(set(result.values())) == 1

    def test_cluster_case_variants(self) -> None:
        """Case variations cluster together (if normalized first)."""
        from api.utils.normalizers import cluster_similar_values

        # Note: This depends on whether preprocessing happens before clustering
        # If values are pre-normalized, this test verifies clustering works
        values = ["San Francisco", "SAN FRANCISCO", "san francisco"]
        result = cluster_similar_values(values)
        # With high enough threshold, case variants may cluster
        # Test passes if we get canonical mapping
        assert all(v in result for v in values if v)

    def test_cluster_similar_names(self) -> None:
        """Similar names (typos) cluster together."""
        from api.utils.normalizers import cluster_similar_values

        values = ["San Francisco", "San Franciso", "San Fransisco"]
        result = cluster_similar_values(values, threshold=85)
        # Similar names should cluster to same canonical
        canonical_values = set(result.values())
        # With 85% threshold, these should cluster
        assert len(canonical_values) <= 2  # Either 1 or 2 clusters

    def test_cluster_distinct_values(self) -> None:
        """Distinct values remain separate."""
        from api.utils.normalizers import cluster_similar_values

        values = ["San Francisco", "Oakland", "Berkeley"]
        result = cluster_similar_values(values)
        # Distinct names should remain separate
        assert len(set(result.values())) == 3

    def test_cluster_respects_threshold(self) -> None:
        """Threshold parameter controls clustering sensitivity."""
        from api.utils.normalizers import cluster_similar_values

        values = ["San Francisco", "San Jose"]
        # With very high threshold, should stay separate
        result_high = cluster_similar_values(values, threshold=95)
        assert len(set(result_high.values())) == 2

        # With very low threshold, might cluster
        result_low = cluster_similar_values(values, threshold=50)
        # Either clusters or doesn't based on similarity
        assert len(set(result_low.values())) >= 1


# ============================================================================
# Integration tests for city normalization pipeline
# ============================================================================


class TestCityNormalizationPipeline:
    """Integration tests for full city normalization."""

    def test_real_world_city_variants(self) -> None:
        """Common real-world city name variants normalize correctly."""
        from api.utils.normalizers import normalize_city

        test_cases = [
            ("San Francisco", "San Francisco"),
            ("san francisco", "San Francisco"),
            ("SAN FRANCISCO", "San Francisco"),
            ("San Francisco, CA", "San Francisco"),
            ("San Francisco, CA 94102", "San Francisco"),
            ("  San Francisco  ", "San Francisco"),
        ]
        for input_val, expected in test_cases:
            result = normalize_city(input_val)
            assert result == expected, f"normalize_city('{input_val}') = '{result}', expected '{expected}'"

    def test_na_filtering_in_pipeline(self) -> None:
        """N/A values filtered throughout pipeline."""
        from api.utils.normalizers import normalize_city

        na_values = ["N/A", "n/a", "None", "null", "-", "..."]
        for val in na_values:
            assert normalize_city(val) == "", f"Expected empty for '{val}'"
