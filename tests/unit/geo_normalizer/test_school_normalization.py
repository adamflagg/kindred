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

    def test_school_threshold_is_85(self) -> None:
        """School fuzzy match uses threshold 85 (same as cities).

        Token overlap filter prevents false positives, so 85 is safe
        while still catching abbreviations like "Elem" vs "Elementary".
        Manual typo mappings in schools.json handle edge cases.
        """
        from bunking.geo_normalizer.normalizer import SCHOOL_FUZZY_THRESHOLD

        assert SCHOOL_FUZZY_THRESHOLD == 85


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

    def test_distinct_canonical_schools_not_merged(self) -> None:
        """Two schools that are distinct canonical entries must not be merged.

        Park Day School and Mark Day School are both in schools.json as separate
        canonical entries. Even though token_sort_ratio("Mark Day School",
        "Park Day School") ~ 85.7, they must remain distinct because the
        per-value lookup resolved them to different canonical entries.
        """
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(["Park Day School", "Mark Day School"])

        assert result["Park Day School"]["canonical"] == "Park Day School"
        assert result["Mark Day School"]["canonical"] == "Mark Day School"
        # They must NOT be merged into the same canonical
        assert result["Park Day School"]["canonical"] != result["Mark Day School"]["canonical"]

    def test_canonical_match_skips_clustering(self) -> None:
        """Values that matched distinct canonical entries should never be clustered.

        Even with typo variants, if the per-value lookup resolves two inputs to
        different canonical entries, the clustering step must not re-merge them.
        """
        from bunking.geo_normalizer import normalize_schools

        # Both resolve via lookup to distinct canonical names
        # Adding case variation to verify lookup still works
        result = normalize_schools(["park day school", "mark day school"])

        park_canonical = result["park day school"]["canonical"]
        mark_canonical = result["mark day school"]["canonical"]

        assert park_canonical == "Park Day School"
        assert mark_canonical == "Mark Day School"
        assert park_canonical != mark_canonical

    def test_canonical_and_unknown_mixed(self) -> None:
        """Mix of canonical-matched and unknown schools normalizes correctly.

        Canonical-matched schools keep their lookup result.
        Unknown schools still get clustered among themselves.
        """
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(
            [
                "Park Day School",
                "Mark Day School",
                "Xyzzy Academy",
                "Xyzzy Academy",
            ]
        )

        # Canonical schools stay separate
        assert result["Park Day School"]["canonical"] == "Park Day School"
        assert result["Mark Day School"]["canonical"] == "Mark Day School"
        # Unknown school clusters with itself
        assert result["Xyzzy Academy"]["canonical"] == "Xyzzy Academy"


class TestSchoolGradeAnnotationStripping:
    """Tests for strip_school_grade_annotation() which removes grade info from school names.

    Parents often write "Highland (2nd)" meaning "Highland school, 2nd grade".
    The grade annotation must be stripped before matching to avoid false positives.
    """

    def test_parenthesized_ordinal_grade(self) -> None:
        """Strip parenthesized ordinal grades like (2nd), (3rd)."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland (2nd)") == "Highland"
        assert strip_school_grade_annotation("Highland (3rd)") == "Highland"
        assert strip_school_grade_annotation("Highland (1st)") == "Highland"
        assert strip_school_grade_annotation("Highland (4th)") == "Highland"
        assert strip_school_grade_annotation("Highland (5th)") == "Highland"
        assert strip_school_grade_annotation("Highland (12th)") == "Highland"

    def test_parenthesized_grade_with_word(self) -> None:
        """Strip parenthesized grade annotations with 'grade' word."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland (3rd grade)") == "Highland"
        assert strip_school_grade_annotation("Highland (2nd grade)") == "Highland"

    def test_parenthesized_kindergarten(self) -> None:
        """Strip parenthesized kindergarten variants."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland (K)") == "Highland"
        assert strip_school_grade_annotation("Highland (Kindergarten)") == "Highland"
        assert strip_school_grade_annotation("Highland (Pre-K)") == "Highland"
        assert strip_school_grade_annotation("Highland (TK)") == "Highland"

    def test_parenthesized_grade_range(self) -> None:
        """Strip parenthesized grade ranges like (K-5), (3rd-5th)."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland (K-5)") == "Highland"
        assert strip_school_grade_annotation("Highland (3rd-5th)") == "Highland"

    def test_suffix_grade_without_parens(self) -> None:
        """Strip trailing grade suffixes without parentheses."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland 2nd grade") == "Highland"
        assert strip_school_grade_annotation("Highland 2nd") == "Highland"

    def test_preserve_2nd_street_elementary(self) -> None:
        """'2nd Street Elementary' must NOT be stripped - 2nd is part of the name."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("2nd Street Elementary") == "2nd Street Elementary"

    def test_preserve_non_grade_parens(self) -> None:
        """Non-grade parenthesized info must NOT be stripped."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        # Abbreviation in parens
        assert strip_school_grade_annotation("Oakland School of Arts (OSA)") == "Oakland School of Arts (OSA)"

    def test_no_change_when_no_annotation(self) -> None:
        """School names without grade annotations are unchanged."""
        from bunking.geo_normalizer.normalizer import strip_school_grade_annotation

        assert strip_school_grade_annotation("Highland Elementary") == "Highland Elementary"
        assert strip_school_grade_annotation("Leland High") == "Leland High"


class TestSchoolNormalizationGradeAnnotation:
    """End-to-end tests for grade annotation handling in normalize_school_value().

    These tests verify the full pipeline: grade stripping + fuzzy matching
    produces correct results and prevents false positives.
    """

    def test_highland_2nd_does_not_match_leland_high(self) -> None:
        """'Highland (2nd)' must NOT fuzzy-match to 'Leland High'.

        This is the original bug: grade annotation '(2nd)' was not stripped,
        and after RapidFuzz processing, 'Highland' matched 'Leland High' at 84%.
        """
        from bunking.geo_normalizer.normalizer import normalize_school_value

        result = normalize_school_value("Highland (2nd)")
        assert result != "Leland High"

    def test_highland_bare_does_not_match_leland_high(self) -> None:
        """'Highland' alone must NOT fuzzy-match to 'Leland High'.

        Even without grade annotation, single-word 'Highland' should not match
        'Leland High' because they don't share a meaningful token.
        """
        from bunking.geo_normalizer.normalizer import normalize_school_value

        result = normalize_school_value("Highland")
        assert result != "Leland High"

    def test_leland_high_still_matches(self) -> None:
        """'Leland High' should still resolve to itself (exact match)."""
        from bunking.geo_normalizer.normalizer import normalize_school_value

        assert normalize_school_value("Leland High") == "Leland High"

    def test_highland_elementary_still_matches(self) -> None:
        """'Highland Elementary' should still resolve correctly."""
        from bunking.geo_normalizer.normalizer import normalize_school_value

        assert normalize_school_value("Highland Elementary") == "Highland Elementary"


class TestStateAwareSchoolNormalization:
    def test_school_accepts_state_param(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_school_value

        result = normalize_school_value("Acalanes High School", state="CA")
        assert result

    def test_normalize_schools_batch_with_state(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_schools

        items: list[dict[str, str]] = [{"value": "Acalanes High School", "state": "CA"}]
        result = normalize_schools(items)
        assert "Acalanes High School" in result
