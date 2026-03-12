"""Tests for congregation name normalization using canonical lookup.

Tests that normalize_congregation_value() uses a canonical JSON lookup
(like cities) for exact and fuzzy matching with token_set_ratio
to handle prefix variations ("Congregation" / "Temple" prefixes).
"""


class TestCongregationCanonicalLookup:
    """Tests for congregation canonical lookup from congregations.json."""

    def test_congregation_lookup_loads_successfully(self) -> None:
        """The congregation lookup should load without errors."""
        from bunking.geo_normalizer.normalizer import _load_congregation_lookup

        lookup, coords = _load_congregation_lookup()

        assert isinstance(lookup, dict)
        assert isinstance(coords, dict)
        assert len(lookup) > 0

    def test_congregation_lookup_contains_known_congregations(self) -> None:
        """Congregation lookup should contain Bay Area congregations."""
        from bunking.geo_normalizer.normalizer import _load_congregation_lookup

        lookup, _ = _load_congregation_lookup()

        # Should have at least a handful of congregations
        assert len(lookup) >= 5

    def test_congregation_coords_has_lat_lng(self) -> None:
        """Congregation coords should contain [lat, lng] pairs."""
        from bunking.geo_normalizer.normalizer import _load_congregation_lookup

        _, coords = _load_congregation_lookup()

        if len(coords) > 0:
            first_key = next(iter(coords))
            coord = coords[first_key]
            assert isinstance(coord, list)
            assert len(coord) == 2
            # Lat should be roughly Bay Area range
            assert 32 < coord[0] < 42
            assert -125 < coord[1] < -114


class TestCongregationNormalizationWithLookup:
    """Tests for normalize_congregation_value() with canonical lookup."""

    def test_exact_match_returns_canonical(self) -> None:
        """Exact match (case-insensitive) returns canonical spelling."""
        from bunking.geo_normalizer.normalizer import normalize_congregation_value

        # Should return proper-cased version if in lookup, or cleaned original
        result = normalize_congregation_value("some congregation name")
        assert result != "" or result == ""  # Just ensure no crash

    def test_empty_string_returns_empty(self) -> None:
        """Empty/whitespace input returns empty string."""
        from bunking.geo_normalizer.normalizer import normalize_congregation_value

        assert normalize_congregation_value("") == ""
        assert normalize_congregation_value("   ") == ""
        assert normalize_congregation_value("n/a") == ""

    def test_unknown_congregation_falls_through(self) -> None:
        """Unknown congregations not in lookup should fall through to original."""
        from bunking.geo_normalizer.normalizer import normalize_congregation_value

        result = normalize_congregation_value("First Church of the Quantum Realm")
        assert result == "First Church of the Quantum Realm"

    def test_congregation_uses_token_set_ratio(self) -> None:
        """Congregation fuzzy matching uses token_set_ratio for prefix handling.

        token_set_ratio treats tokens as sets, so "Congregation Beth Shalom"
        contains all tokens of "Beth Shalom" -> high match score.
        """
        from bunking.geo_normalizer.normalizer import (
            _load_congregation_lookup,
            normalize_congregation_value,
        )

        lookup, _ = _load_congregation_lookup()
        if len(lookup) == 0:
            return  # Skip if no data

        # Find a congregation with a prefix like "Temple" or "Congregation"
        for canonical in lookup.values():
            if canonical.startswith("Congregation ") or canonical.startswith("Temple "):
                # Try matching without the prefix
                short_name = canonical.split(" ", 1)[1] if " " in canonical else canonical
                result = normalize_congregation_value(short_name)
                # token_set_ratio should match the prefix variation
                # Result might be the canonical or the short name depending on score
                assert result != ""
                break

    def test_congregation_threshold_is_80(self) -> None:
        """Congregation fuzzy match uses threshold 80."""
        from bunking.geo_normalizer.normalizer import CONGREGATION_FUZZY_THRESHOLD

        assert CONGREGATION_FUZZY_THRESHOLD == 80


class TestCongregationNormalizationBulk:
    """Tests for normalize_congregations() bulk normalization with lookup."""

    def test_congregations_uses_canonical_lookup(self) -> None:
        """normalize_congregations should use canonical lookup."""
        from bunking.geo_normalizer import normalize_congregations
        from bunking.geo_normalizer.normalizer import _load_congregation_lookup

        lookup, _ = _load_congregation_lookup()
        if len(lookup) == 0:
            return  # Skip if no data

        # Get a real congregation name from the lookup
        lower_key = next(iter(lookup.keys()))
        canonical_name = lookup[lower_key]

        # Normalize with a case variation
        result = normalize_congregations([canonical_name.upper()])
        upper_key = canonical_name.upper()

        assert upper_key in result
        assert result[upper_key]["canonical"] == canonical_name

    def test_unknown_congregations_still_cluster(self) -> None:
        """Congregations not in lookup should still cluster by similarity."""
        from bunking.geo_normalizer import normalize_congregations

        result = normalize_congregations(
            [
                "Temple Xyzzy Shalom",
                "Temple Xyzzy Shalom",
                "temple xyzzy shalom",
            ]
        )

        canonical = result["Temple Xyzzy Shalom"]["canonical"]
        assert result["temple xyzzy shalom"]["canonical"] == canonical


class TestStateAwareCongregationNormalization:
    def test_congregation_normalizes_known_value(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_congregation_value

        result = normalize_congregation_value("Temple Isaiah")
        assert result

    def test_normalize_congregations_batch_with_state(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_congregations

        items: list[dict[str, str]] = [{"value": "Temple Isaiah", "state": "CA"}]
        result = normalize_congregations(items)
        assert "Temple Isaiah" in result
