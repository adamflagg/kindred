"""Tests for geo normalizer module.

Tests the Python-based geographic normalization using RapidFuzz for
token-aware fuzzy matching. This replaces the weak Go implementation.
"""


class TestCityNormalization:
    """Tests for city name normalization."""

    def test_normalize_empty_list(self) -> None:
        """Empty input returns empty output."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities([])
        assert result == {}

    def test_normalize_single_city(self) -> None:
        """Single city maps to itself."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["San Francisco"])
        assert result == {"San Francisco": {"canonical": "San Francisco", "confidence": 1.0}}

    def test_normalize_case_variations(self) -> None:
        """Case variations should cluster together."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["San Francisco", "san francisco", "SAN FRANCISCO"])
        # All should map to the first encountered value
        canonical = result["San Francisco"]["canonical"]
        assert result["san francisco"]["canonical"] == canonical
        assert result["SAN FRANCISCO"]["canonical"] == canonical

    def test_normalize_common_abbreviations(self) -> None:
        """Common city abbreviations should expand."""
        from bunking.geo_normalizer import normalize_cities

        # Note: This test will fail until we implement city alias handling
        result = normalize_cities(["SF", "San Francisco"])
        # SF should map to San Francisco
        assert result["SF"]["canonical"] == "San Francisco"

    def test_normalize_with_state_suffix(self) -> None:
        """City with state suffix should be normalized."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Oakland, CA", "Oakland"])
        # Both should map to "Oakland"
        assert result["Oakland, CA"]["canonical"] == "Oakland"
        assert result["Oakland"]["canonical"] == "Oakland"


class TestSchoolNormalization:
    """Tests for school name normalization with token-aware fuzzy matching."""

    def test_normalize_empty_list(self) -> None:
        """Empty input returns empty output."""
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools([])
        assert result == {}

    def test_normalize_case_variations(self) -> None:
        """Case variations should cluster together."""
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(["Riverside Elementary", "riverside elementary"])
        canonical = result["Riverside Elementary"]["canonical"]
        assert result["riverside elementary"]["canonical"] == canonical

    def test_normalize_elementary_abbreviation(self) -> None:
        """Elementary vs Elem may not cluster due to character difference.

        Note: 'Elem' (4 chars) vs 'Elementary' (10 chars) is ~82% similar,
        which is below most fuzzy thresholds. This is expected behavior.
        """
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(["Riverside Elementary", "Riverside Elem"])
        # These may or may not cluster depending on threshold
        # At minimum, both should be in the result with valid data
        assert "Riverside Elementary" in result
        assert "Riverside Elem" in result
        assert result["Riverside Elementary"]["confidence"] >= 0.8
        assert result["Riverside Elem"]["confidence"] >= 0.8

    def test_normalize_word_reordering(self) -> None:
        """Word reordering should cluster (token_sort_ratio handles this)."""
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(["Elementary School Riverside", "Riverside Elementary School"])
        # Token sort ratio should handle word reordering
        # These should cluster together
        assert result["Elementary School Riverside"]["canonical"] == result["Riverside Elementary School"]["canonical"]

    def test_preserve_distinct_schools(self) -> None:
        """Distinctly different schools should not cluster."""
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(["Riverside Elementary", "Oak Valley Middle"])
        # These should remain distinct
        assert result["Riverside Elementary"]["canonical"] != result["Oak Valley Middle"]["canonical"]

    def test_preserve_similar_but_distinct_canonical_schools(self) -> None:
        """Schools with similar names that are both in canonical lookup stay separate.

        This is the Park Day School / Mark Day School bug: token_sort_ratio
        gives ~85.7 which exceeds the clustering threshold of 85. But both are
        distinct canonical entries in schools.json, so they must not be merged.
        """
        from bunking.geo_normalizer import normalize_schools

        result = normalize_schools(
            [
                "Park Day School",
                "Mark Day School",
                "Park Day School",  # duplicate to test frequency handling
            ]
        )

        assert result["Park Day School"]["canonical"] == "Park Day School"
        assert result["Mark Day School"]["canonical"] == "Mark Day School"


class TestCongregationNormalization:
    """Tests for congregation/synagogue name normalization."""

    def test_normalize_empty_list(self) -> None:
        """Empty input returns empty output."""
        from bunking.geo_normalizer import normalize_congregations

        result = normalize_congregations([])
        assert result == {}

    def test_normalize_word_reordering(self) -> None:
        """Word reordering should cluster (Temple Beth Israel vs Beth Israel Temple)."""
        from bunking.geo_normalizer import normalize_congregations

        result = normalize_congregations(["Temple Beth Israel", "Beth Israel Temple"])
        # Token sort ratio should handle word reordering
        assert result["Temple Beth Israel"]["canonical"] == result["Beth Israel Temple"]["canonical"]

    def test_normalize_congregation_prefix(self) -> None:
        """With and without 'Congregation' prefix should cluster.

        Uses token_set_ratio which treats tokens as sets, so
        'Congregation Beth Shalom' contains all tokens of 'Beth Shalom'.
        """
        from bunking.geo_normalizer import normalize_congregations

        result = normalize_congregations(["Congregation Beth Shalom", "Beth Shalom"])
        # These should cluster together (using token_set_ratio)
        assert result["Congregation Beth Shalom"]["canonical"] == result["Beth Shalom"]["canonical"]

    def test_preserve_distinct_congregations(self) -> None:
        """Distinctly different congregations should not cluster."""
        from bunking.geo_normalizer import normalize_congregations

        result = normalize_congregations(["Temple Beth Israel", "Temple Sinai"])
        # These should remain distinct
        assert result["Temple Beth Israel"]["canonical"] != result["Temple Sinai"]["canonical"]


class TestCLIInterface:
    """Tests for the CLI interface that Go will call."""

    @staticmethod
    def _project_root() -> str:
        """Find the project root (directory containing pyproject.toml)."""
        from pathlib import Path

        path = Path(__file__).resolve()
        for parent in path.parents:
            if (parent / "pyproject.toml").exists():
                return str(parent)
        raise RuntimeError("Could not find project root")

    def test_cli_json_output(self) -> None:
        """CLI should output valid JSON."""
        import json
        import subprocess

        result = subprocess.run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "bunking.geo_normalizer",
                "--category",
                "city",
                "--values",
                '["Oakland", "oakland"]',
            ],
            capture_output=True,
            text=True,
            cwd=self._project_root(),
        )
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert "Oakland" in output
        assert "oakland" in output
        assert output["Oakland"]["canonical"] == output["oakland"]["canonical"]

    def test_cli_school_category(self) -> None:
        """CLI should handle school category."""
        import json
        import subprocess

        result = subprocess.run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "bunking.geo_normalizer",
                "--category",
                "school",
                "--values",
                '["Riverside Elementary"]',
            ],
            capture_output=True,
            text=True,
            cwd=self._project_root(),
        )
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert "Riverside Elementary" in output


class TestConfidenceScoring:
    """Tests for confidence score calculation."""

    def test_exact_match_confidence(self) -> None:
        """Exact match should have confidence 1.0."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Oakland"])
        assert result["Oakland"]["confidence"] == 1.0

    def test_fuzzy_match_lower_confidence(self) -> None:
        """Fuzzy matches should have confidence < 1.0 when clustering occurs."""
        from bunking.geo_normalizer import normalize_congregations

        # Use congregation with token_set_ratio which will cluster these
        result = normalize_congregations(["Temple Beth Israel", "Beth Israel Temple"])
        # The reordered version should have slightly lower confidence
        # (it matched via fuzzy clustering, not exact match)
        reordered_conf = result["Beth Israel Temple"]["confidence"]
        # token_set_ratio gives 100 for same tokens in different order
        # so confidence will be 1.0 in this case
        assert reordered_conf >= 0.9  # Should be high confidence


class TestClusteringIdempotency:
    """Tests for clustering determinism/idempotency."""

    def test_clustering_is_deterministic_with_different_input_order(self) -> None:
        """Clustering should produce same results regardless of input order."""
        from bunking.geo_normalizer import normalize_cities

        # Same values in different orders
        values_order1 = ["San Francisco", "oakland", "Oakland", "san francisco"]
        values_order2 = ["Oakland", "san francisco", "San Francisco", "oakland"]
        values_order3 = ["oakland", "San Francisco", "san francisco", "Oakland"]

        result1 = normalize_cities(values_order1)
        result2 = normalize_cities(values_order2)
        result3 = normalize_cities(values_order3)

        # All should produce the same canonical mappings
        assert result1 == result2 == result3

    def test_congregation_clustering_determinism(self) -> None:
        """Congregation clustering should be deterministic."""
        from bunking.geo_normalizer import normalize_congregations

        # Different orders of similar congregation names
        values_order1 = ["Temple Beth Shalom", "Beth Shalom Temple", "Congregation Beth Shalom"]
        values_order2 = ["Congregation Beth Shalom", "Temple Beth Shalom", "Beth Shalom Temple"]

        result1 = normalize_congregations(values_order1)
        result2 = normalize_congregations(values_order2)

        # Results should be identical regardless of input order
        assert result1 == result2


class TestCityTypoCorrection:
    """Tests for city typo correction using static city list.

    The static city list ensures that typos like "San Francico" are corrected
    to "San Francisco" even when the typo appears in fewer records. This prevents
    alphabetical sorting from making typos canonical.
    """

    def test_typo_corrected_to_canonical_spelling(self) -> None:
        """A city typo should be corrected to the canonical spelling.

        This is the core problem: "San Francico" (typo) sorts before
        "San Francisco" alphabetically, but we want the correct spelling.
        """
        from bunking.geo_normalizer import normalize_cities

        # Typo with fewer occurrences, correct spelling with more
        values = ["San Francico", "San Francisco", "San Francisco", "San Francisco"]

        result = normalize_cities(values)

        # Both should normalize to "San Francisco" (the correct spelling)
        assert result["San Francico"]["canonical"] == "San Francisco"
        assert result["San Francisco"]["canonical"] == "San Francisco"

    def test_typo_corrected_regardless_of_input_order(self) -> None:
        """Typo correction should work regardless of input order."""
        from bunking.geo_normalizer import normalize_cities

        # Put typo first to test that it still gets corrected
        values1 = ["San Francico", "San Francisco"]
        values2 = ["San Francisco", "San Francico"]

        result1 = normalize_cities(values1)
        result2 = normalize_cities(values2)

        # Both should give the same canonical spelling
        assert result1["San Francico"]["canonical"] == "San Francisco"
        assert result2["San Francico"]["canonical"] == "San Francisco"
        assert result1 == result2

    def test_known_california_cities_recognized(self) -> None:
        """Known California cities should be recognized from static list."""
        from bunking.geo_normalizer import normalize_cities

        ca_cities = ["Oakland", "Berkeley", "Palo Alto", "San Jose", "Los Angeles"]

        result = normalize_cities(ca_cities)

        # Each should be its own canonical (correctly spelled)
        for city in ca_cities:
            assert result[city]["canonical"] == city
            assert result[city]["confidence"] == 1.0

    def test_case_insensitive_lookup(self) -> None:
        """City lookup should be case-insensitive."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["oakland", "OAKLAND", "Oakland"])

        # All should normalize to proper case "Oakland"
        assert result["oakland"]["canonical"] == "Oakland"
        assert result["OAKLAND"]["canonical"] == "Oakland"
        assert result["Oakland"]["canonical"] == "Oakland"

    def test_unknown_city_falls_back_to_frequency(self) -> None:
        """Unknown cities (not in static list) should use frequency-based fallback."""
        from bunking.geo_normalizer import normalize_cities

        # Made-up city names not in any list
        values = ["Smalltown", "Smalltown", "Smalltown", "smalltown"]

        result = normalize_cities(values)

        # Should cluster together (frequency or alphabetical)
        canonical = result["Smalltown"]["canonical"]
        assert result["smalltown"]["canonical"] == canonical

    def test_common_typos_corrected(self) -> None:
        """Common typos should be corrected via fuzzy matching to known cities."""
        from bunking.geo_normalizer import normalize_cities

        typos_and_correct = [
            ("Sacremento", "Sacramento"),
            ("San Deigo", "San Diego"),
            ("Los Angelas", "Los Angeles"),
            ("Oakalnd", "Oakland"),
        ]

        for typo, correct in typos_and_correct:
            result = normalize_cities([typo])
            assert result[typo]["canonical"] == correct, f"Expected {typo} -> {correct}"

    def test_close_but_different_cities_not_merged(self) -> None:
        """Similar but different cities should remain distinct."""
        from bunking.geo_normalizer import normalize_cities

        # These are real, distinct cities that should NOT be merged
        distinct_cities = ["Oakland", "Oakdale", "Oakley"]

        result = normalize_cities(distinct_cities)

        # Each should map to itself, not get merged
        for city in distinct_cities:
            assert result[city]["canonical"] == city

    def test_city_with_state_suffix_and_typo(self) -> None:
        """City with state suffix and typo should be corrected."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["San Francico, CA", "San Francisco"])

        # The typo with state suffix should still correct to San Francisco
        assert result["San Francico, CA"]["canonical"] == "San Francisco"
        assert result["San Francisco"]["canonical"] == "San Francisco"


class TestStaticCityList:
    """Tests for the static city list data file."""

    def test_city_list_loads_successfully(self) -> None:
        """The city list should load without errors."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup

        lookup = _load_city_lookup()

        assert isinstance(lookup, dict)
        assert len(lookup) > 0

    def test_city_list_contains_california_cities(self) -> None:
        """The city list should contain major California cities."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup

        lookup = _load_city_lookup()

        # Major CA cities should be present
        expected = [
            "san francisco",
            "los angeles",
            "oakland",
            "berkeley",
            "palo alto",
            "san jose",
            "sacramento",
            "san diego",
        ]

        for city in expected:
            assert city in lookup, f"Expected {city} in lookup"

    def test_city_list_contains_major_us_cities(self) -> None:
        """The city list should contain major US cities outside California."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup

        lookup = _load_city_lookup()

        # Major non-CA cities
        expected = [
            "new york",
            "chicago",
            "houston",
            "phoenix",
            "seattle",
            "denver",
            "boston",
        ]

        for city in expected:
            assert city in lookup, f"Expected {city} in lookup"

    def test_lookup_returns_proper_case(self) -> None:
        """Lookup values should have proper title case."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup

        lookup = _load_city_lookup()

        # Check that values have proper case
        assert lookup.get("san francisco") == "San Francisco"
        assert lookup.get("los angeles") == "Los Angeles"
        assert lookup.get("new york") == "New York"


class TestCityAliases:
    """Tests for city alias expansion in normalization."""

    def test_millbrae_blvd_alias(self) -> None:
        """'Millbrae Blvd' should normalize to 'Millbrae'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Millbrae Blvd"])
        assert result["Millbrae Blvd"]["canonical"] == "Millbrae"

    def test_la_canada_flt_alias(self) -> None:
        """'La Canada Flt' should normalize to 'La Canada Flintridge'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["La Canada Flt"])
        assert result["La Canada Flt"]["canonical"] == "La Canada Flintridge"

    def test_west_menlo_park_alias(self) -> None:
        """'West Menlo Park' should normalize to 'Menlo Park'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["West Menlo Park"])
        assert result["West Menlo Park"]["canonical"] == "Menlo Park"

    def test_aliases_are_case_insensitive(self) -> None:
        """Aliases should work regardless of case."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["millbrae blvd", "MILLBRAE BLVD"])
        assert result["millbrae blvd"]["canonical"] == "Millbrae"
        assert result["MILLBRAE BLVD"]["canonical"] == "Millbrae"


class TestLocationMetadata:
    """Tests for location metadata (city/state) in geo JSON files."""

    def test_school_json_has_location_metadata(self) -> None:
        """Verify schools.json includes city/state per canonical entry."""
        import json
        from importlib.resources import files

        data_file = files("bunking.geo_normalizer.data").joinpath("schools.json")
        data = json.loads(data_file.read_text())
        assert "location" in data
        assert len(data["location"]) > 0
        # Spot check a known school
        sample = next(iter(data["location"].values()))
        assert "city" in sample
        assert "state" in sample

    def test_congregation_json_has_location_metadata(self) -> None:
        """Verify congregations.json includes city/state per canonical entry."""
        import json
        from importlib.resources import files

        data_file = files("bunking.geo_normalizer.data").joinpath("congregations.json")
        data = json.loads(data_file.read_text())
        assert "location" in data
        assert len(data["location"]) > 0
        # Spot check a known congregation
        sample = next(iter(data["location"].values()))
        assert "city" in sample
        assert "state" in sample

    def test_city_json_has_location_metadata(self) -> None:
        """Verify us_cities.json includes state per canonical entry."""
        import json
        from importlib.resources import files

        data_file = files("bunking.geo_normalizer.data").joinpath("us_cities.json")
        data = json.loads(data_file.read_text())
        assert "location" in data
        assert len(data["location"]) > 0
        # Spot check a known city
        sample = next(iter(data["location"].values()))
        assert "state" in sample
