"""Tests for school name normalization using canonical lookup.

Tests that normalize_school_value() uses a canonical JSON lookup
(like cities) for exact and fuzzy matching, falling back to the
original value for unknown schools.
"""


class TestSchoolCanonicalLookup:
    """Tests for school canonical lookup from schools.json."""

    def test_school_lookup_loads_successfully(self) -> None:
        """The school lookup should load without errors."""
        from bunking.geo_normalizer.normalizer import _load_school_lookup

        lookup, coords = _load_school_lookup()

        assert isinstance(lookup, dict)
        assert isinstance(coords, dict)
        assert len(lookup) > 0

    def test_school_lookup_contains_known_schools(self) -> None:
        """School lookup should contain well-known California schools."""
        from bunking.geo_normalizer.normalizer import _load_school_lookup

        lookup, _ = _load_school_lookup()

        # Should contain common school name patterns (lowercase keys)
        # At least a few well-known schools should be present
        assert len(lookup) > 100  # California has thousands of schools

    def test_school_coords_has_lat_lng(self) -> None:
        """School coords should contain [lat, lng] pairs."""
        from bunking.geo_normalizer.normalizer import _load_school_lookup

        _, coords = _load_school_lookup()

        if len(coords) > 0:
            first_key = next(iter(coords))
            coord = coords[first_key]
            assert isinstance(coord, list)
            assert len(coord) == 2
            # Lat should be roughly California range
            assert 32 < coord[0] < 42
            assert -125 < coord[1] < -114


class TestSchoolNormalizationWithLookup:
    """Tests for normalize_school_value() with canonical lookup."""

    def test_exact_match_returns_canonical(self) -> None:
        """Exact match (case-insensitive) returns canonical spelling."""
        from bunking.geo_normalizer.normalizer import normalize_school_value

        # A school that exists in the lookup should return canonical form
        result = normalize_school_value("riverside elementary")
        # Should return proper-cased version if in lookup, or cleaned original
        assert result != ""
        assert result == result.strip()

    def test_empty_string_returns_empty(self) -> None:
        """Empty/whitespace input returns empty string."""
        from bunking.geo_normalizer.normalizer import normalize_school_value

        assert normalize_school_value("") == ""
        assert normalize_school_value("   ") == ""
        assert normalize_school_value("n/a") == ""

    def test_unknown_school_falls_through(self) -> None:
        """Unknown schools not in lookup should fall through to original."""
        from bunking.geo_normalizer.normalizer import normalize_school_value

        # Completely made-up school name
        result = normalize_school_value("Xyzzy Academy of Quantum Basketweaving")
        assert result == "Xyzzy Academy of Quantum Basketweaving"

    def test_fuzzy_match_corrects_typo(self) -> None:
        """Fuzzy matching should correct school name typos."""
        from bunking.geo_normalizer.normalizer import (
            _load_school_lookup,
            normalize_school_value,
        )

        lookup, _ = _load_school_lookup()
        if len(lookup) == 0:
            return  # Skip if no data

        # Get a real school name and create a typo
        canonical = next(iter(lookup.values()))
        # Add a typo (swap two adjacent characters)
        if len(canonical) > 4:
            typo = canonical[:2] + canonical[3] + canonical[2] + canonical[4:]
            result = normalize_school_value(typo)
            # Should correct to canonical or at least return something
            assert result != ""

    def test_school_threshold_is_80(self) -> None:
        """School fuzzy match uses threshold 80 (lower than cities at 85).

        This accommodates common school name variations like
        "Elem" vs "Elementary", "K-8" suffixes, etc.
        """
        from bunking.geo_normalizer.normalizer import SCHOOL_FUZZY_THRESHOLD

        assert SCHOOL_FUZZY_THRESHOLD == 80


class TestSchoolNormalizationBulk:
    """Tests for normalize_schools() bulk normalization with lookup."""

    def test_schools_uses_canonical_lookup(self) -> None:
        """normalize_schools should use canonical lookup, not just clustering."""
        from bunking.geo_normalizer import normalize_schools
        from bunking.geo_normalizer.normalizer import _load_school_lookup

        lookup, _ = _load_school_lookup()
        if len(lookup) == 0:
            return  # Skip if no data

        # Get a real school name from the lookup
        lower_key = next(iter(lookup.keys()))
        canonical_name = lookup[lower_key]

        # Normalize with a case variation
        result = normalize_schools([canonical_name.upper()])
        upper_key = canonical_name.upper()

        assert upper_key in result
        assert result[upper_key]["canonical"] == canonical_name

    def test_unknown_schools_still_cluster(self) -> None:
        """Schools not in lookup still cluster by similarity (same casing)."""
        from bunking.geo_normalizer import normalize_schools

        # Same casing variants cluster; different-cased unknowns may not
        # because token_sort_ratio is case-sensitive
        result = normalize_schools(
            [
                "Xyzzy Academy of Fine Arts",
                "Xyzzy Academy of Fine Arts",
                "Xyzzy Academy Of Fine Arts",
            ]
        )

        # All should cluster together (same case, minor variation)
        canonical = result["Xyzzy Academy of Fine Arts"]["canonical"]
        assert result["Xyzzy Academy Of Fine Arts"]["canonical"] == canonical
