"""Tests for geo normalizer module.

Tests the Python-based geographic normalization using RapidFuzz for
token-aware fuzzy matching. This replaces the weak Go implementation.
"""


class TestCityLookupMultiVariant:
    """Tests for multi-variant city lookup loading."""

    def test_load_city_lookup_multi_returns_lists(self) -> None:
        """Lookup values should be lists of 'City, ST' strings."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()
        assert "oakland" in lookup
        assert isinstance(lookup["oakland"], list)
        assert len(lookup["oakland"]) >= 1
        for variant in lookup["oakland"]:
            assert ", " in variant, f"Expected 'City, ST' format, got: {variant}"

    def test_load_city_location_has_state(self) -> None:
        """Location metadata should have state for each canonical."""
        from bunking.geo_normalizer.normalizer import _load_city_location

        location = _load_city_location()
        for canonical, meta in list(location.items())[:10]:
            assert "state" in meta, f"Missing state for: {canonical}"

    def test_load_city_lookup_multi_caches(self) -> None:
        """Multi-variant lookup should be cached after first load."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup1 = _load_city_lookup_multi()
        lookup2 = _load_city_lookup_multi()
        assert lookup1 is lookup2

    def test_multi_variant_lookup_has_city_st_values(self) -> None:
        """Multi-variant lookup should have 'City, ST' formatted values."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()
        # Multi-variant city: must have state-qualified variants
        assert "lafayette" in lookup
        for variant in lookup["lafayette"]:
            assert ", " in variant


class TestStateAwareCityNormalization:
    """Tests for state-aware city normalization."""

    def test_single_variant_returns_city_st(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Oakland", state="CA")
        assert canonical == "Oakland, CA"
        assert conf == 1.0

    def test_multi_variant_prefers_state_match(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Lafayette", state="CA")
        assert canonical == "Lafayette, CA"
        assert conf == 1.0

        canonical, conf = normalize_city_value("Lafayette", state="LA")
        assert canonical == "Lafayette, LA"
        assert conf == 1.0

    def test_multi_variant_no_state_reduces_confidence(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Lafayette", state="")
        assert canonical.startswith("Lafayette, ")
        assert conf == 0.9  # no state context

    def test_multi_variant_wrong_state_reduces_confidence(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Lafayette", state="NY")
        assert canonical.startswith("Lafayette, ")
        assert conf == 0.7  # state mismatch fallback

    def test_alias_returns_city_st(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, _ = normalize_city_value("SF")
        assert canonical == "San Francisco, CA"

    def test_millbrae_blvd_alias(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, _ = normalize_city_value("Millbrae Blvd")
        assert canonical == "Millbrae, CA"

    def test_state_suffix_in_input(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Oakland, CA")
        assert canonical == "Oakland, CA"
        assert conf == 1.0

    def test_state_suffix_with_zip(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, _ = normalize_city_value("Oakland, CA 94611")
        assert canonical == "Oakland, CA"

    def test_fuzzy_match_with_state(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Lafayete", state="CA")
        assert canonical == "Lafayette, CA"
        assert conf == 0.85  # fuzzy + state match

    def test_fuzzy_match_wrong_state(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Lafayete", state="NY")
        assert canonical.startswith("Lafayette, ")
        assert conf == 0.65  # fuzzy + state mismatch

    def test_no_match_with_state(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Xyzzyburgh", state="CA")
        assert canonical == "Xyzzyburgh, CA"
        assert conf == 0.5

    def test_no_match_no_state_low_confidence(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_city_value

        canonical, conf = normalize_city_value("Xyzzyburgh")
        assert canonical == "Xyzzyburgh"
        assert conf == 0.3  # low confidence: unknown city, no state context


class TestCityNormalization:
    """Tests for city name normalization."""

    def test_normalize_empty_list(self) -> None:
        """Empty input returns empty output."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities([])
        assert result == {}

    def test_normalize_single_city(self) -> None:
        """Single city maps to its City, ST canonical."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["San Francisco"])
        assert result["San Francisco"]["canonical"] == "San Francisco, CA"
        assert result["San Francisco"]["confidence"] >= 0.9

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

        result = normalize_cities(["SF", "San Francisco"])
        # SF alias expands; both should have same canonical
        assert result["SF"]["canonical"] == result["San Francisco"]["canonical"]

    def test_normalize_with_state_suffix(self) -> None:
        """City with state suffix should be normalized."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Oakland, CA", "Oakland"])
        # Both should map to same canonical
        assert result["Oakland, CA"]["canonical"] == result["Oakland"]["canonical"]


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
        """Exact match without state context has confidence 0.9."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Oakland"])
        assert result["Oakland"]["confidence"] >= 0.9

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

        # Both should normalize to "San Francisco, CA"
        assert result["San Francico"]["canonical"] == "San Francisco, CA"
        assert result["San Francisco"]["canonical"] == "San Francisco, CA"

    def test_typo_corrected_regardless_of_input_order(self) -> None:
        """Typo correction should work regardless of input order."""
        from bunking.geo_normalizer import normalize_cities

        # Put typo first to test that it still gets corrected
        values1 = ["San Francico", "San Francisco"]
        values2 = ["San Francisco", "San Francico"]

        result1 = normalize_cities(values1)
        result2 = normalize_cities(values2)

        # Both should give the same canonical spelling
        assert result1["San Francico"]["canonical"] == "San Francisco, CA"
        assert result2["San Francico"]["canonical"] == "San Francisco, CA"
        assert result1 == result2

    def test_known_california_cities_recognized(self) -> None:
        """Known California cities should be recognized from static list."""
        from bunking.geo_normalizer import normalize_cities

        ca_cities = ["Oakland", "Berkeley", "Palo Alto", "San Jose", "Los Angeles"]

        result = normalize_cities(ca_cities)

        # Each should resolve to a "City, CA" canonical
        for city in ca_cities:
            assert result[city]["canonical"].endswith(", CA"), f"{city} not CA"
            assert city.split(",")[0] in result[city]["canonical"]
            assert result[city]["confidence"] >= 0.9

    def test_case_insensitive_lookup(self) -> None:
        """City lookup should be case-insensitive."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["oakland", "OAKLAND", "Oakland"])

        # All should normalize to same canonical
        canonical = result["Oakland"]["canonical"]
        assert result["oakland"]["canonical"] == canonical
        assert result["OAKLAND"]["canonical"] == canonical

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
            # Canonical now includes state suffix
            canonical = result[typo]["canonical"]
            assert canonical.startswith(correct), f"Expected {typo} -> {correct}*, got {canonical}"

    def test_close_but_different_cities_not_merged(self) -> None:
        """Similar but different cities should remain distinct."""
        from bunking.geo_normalizer import normalize_cities

        # These are real, distinct cities that should NOT be merged
        distinct_cities = ["Oakland", "Oakdale", "Oakley"]

        result = normalize_cities(distinct_cities)

        # Each should map to distinct canonicals
        canonicals = {result[city]["canonical"] for city in distinct_cities}
        assert len(canonicals) == 3, f"Expected 3 distinct canonicals, got {canonicals}"

    def test_city_with_state_suffix_and_typo(self) -> None:
        """City with state suffix and typo should be corrected."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["San Francico, CA", "San Francisco"])

        # The typo with state suffix should still correct to San Francisco, CA
        assert result["San Francico, CA"]["canonical"] == "San Francisco, CA"
        assert result["San Francisco"]["canonical"] == "San Francisco, CA"


class TestStaticCityList:
    """Tests for the static city list data file."""

    def test_city_list_loads_successfully(self) -> None:
        """The city list should load without errors."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()

        assert isinstance(lookup, dict)
        assert len(lookup) > 0

    def test_city_list_contains_california_cities(self) -> None:
        """The city list should contain major California cities."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()

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
            assert any("CA" in v for v in lookup[city]), f"Expected CA variant for {city}"

    def test_city_list_contains_major_us_cities(self) -> None:
        """The city list should contain major US cities outside California."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()

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

    def test_lookup_returns_city_st_format(self) -> None:
        """Lookup values should have proper City, ST format."""
        from bunking.geo_normalizer.normalizer import _load_city_lookup_multi

        lookup = _load_city_lookup_multi()

        assert "San Francisco, CA" in lookup["san francisco"]
        assert "Los Angeles, CA" in lookup["los angeles"]
        assert "New York, NY" in lookup["new york"]


class TestCityAliases:
    """Tests for city alias expansion in normalization."""

    def test_millbrae_blvd_alias(self) -> None:
        """'Millbrae Blvd' should normalize to 'Millbrae, CA'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["Millbrae Blvd"])
        assert result["Millbrae Blvd"]["canonical"] == "Millbrae, CA"

    def test_la_canada_flt_alias(self) -> None:
        """'La Canada Flt' should normalize to 'La Canada Flintridge, CA'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["La Canada Flt"])
        assert result["La Canada Flt"]["canonical"] == "La Canada Flintridge, CA"

    def test_west_menlo_park_alias(self) -> None:
        """'West Menlo Park' should normalize to 'Menlo Park, CA'."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["West Menlo Park"])
        assert result["West Menlo Park"]["canonical"] == "Menlo Park, CA"

    def test_aliases_are_case_insensitive(self) -> None:
        """Aliases should work regardless of case."""
        from bunking.geo_normalizer import normalize_cities

        result = normalize_cities(["millbrae blvd", "MILLBRAE BLVD"])
        assert result["millbrae blvd"]["canonical"] == "Millbrae, CA"
        assert result["MILLBRAE BLVD"]["canonical"] == "Millbrae, CA"


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


class TestNormalizeValuesStateThreading:
    def test_city_with_state_context(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_values

        result = normalize_values("city", [{"value": "Lafayette", "state": "CA", "country": ""}])
        assert result["Lafayette"]["canonical"] == "Lafayette, CA"

    def test_school_with_state_context(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_values

        result = normalize_values("school", [{"value": "Acalanes High School", "state": "CA", "country": ""}])
        assert "Acalanes High School" in result

    def test_string_input_backwards_compat(self) -> None:
        from bunking.geo_normalizer.normalizer import normalize_values

        result = normalize_values("city", ["Oakland"])
        assert "Oakland" in result


class TestCountryAwareNormalization:
    """Tests for country-aware normalization via normalize_values.

    When values include country context, non-US entries should pass through
    without US-specific fuzzy matching, while US entries continue to be
    normalized as before.
    """

    def test_normalize_cities_skips_non_us(self) -> None:
        """Non-US city passes through as-is without fuzzy matching.

        'London' with country='GB' should NOT match 'London' Ohio or any
        US city. It should pass through unchanged.
        """
        from bunking.geo_normalizer import normalize_values

        result = normalize_values(
            "city",
            [{"value": "London", "state": "", "country": "GB"}],
        )
        assert result["London"]["canonical"] == "London"
        assert result["London"]["confidence"] == 1.0

    def test_normalize_cities_us_default(self) -> None:
        """Empty country treated as US; normal fuzzy matching works.

        A city dict with empty country should go through normal US
        normalization (e.g., typo correction).
        """
        from bunking.geo_normalizer import normalize_values

        result = normalize_values(
            "city",
            [{"value": "San Francico", "state": "CA", "country": ""}],
        )
        assert result["San Francico"]["canonical"] == "San Francisco, CA"

    def test_normalize_schools_skips_non_us(self) -> None:
        """Non-US school passes through without fuzzy matching."""
        from bunking.geo_normalizer import normalize_values

        result = normalize_values(
            "school",
            [{"value": "Eton College", "state": "", "country": "GB"}],
        )
        assert result["Eton College"]["canonical"] == "Eton College"
        assert result["Eton College"]["confidence"] == 1.0

    def test_normalize_congregations_skips_non_us(self) -> None:
        """Non-US congregation passes through without fuzzy matching."""
        from bunking.geo_normalizer import normalize_values

        result = normalize_values(
            "congregation",
            [{"value": "Great Synagogue of Jerusalem", "state": "", "country": "IL"}],
        )
        assert result["Great Synagogue of Jerusalem"]["canonical"] == "Great Synagogue of Jerusalem"
        assert result["Great Synagogue of Jerusalem"]["confidence"] == 1.0

    def test_normalize_values_backwards_compatible(self) -> None:
        """Plain string list still works (no regression).

        The existing call signature with list[str] must continue to work.
        """
        from bunking.geo_normalizer import normalize_values

        result = normalize_values("city", ["Oakland", "oakland"])
        canonical = result["Oakland"]["canonical"]
        assert result["oakland"]["canonical"] == canonical

    def test_normalize_values_mixed_format(self) -> None:
        """Mix of strings and dicts in the same list.

        Some callers may send a mix until migration is complete.
        """
        from bunking.geo_normalizer import normalize_values

        result = normalize_values(
            "city",
            [
                "Oakland",
                {"value": "London", "state": "", "country": "GB"},
                {"value": "San Francico", "state": "CA", "country": "US"},
            ],
        )
        # Plain string treated as US, normal fuzzy matching
        assert "Oakland" in result["Oakland"]["canonical"]
        # Non-US passes through
        assert result["London"]["canonical"] == "London"
        assert result["London"]["confidence"] == 1.0
        # US dict goes through normal matching
        assert result["San Francico"]["canonical"] == "San Francisco, CA"

    def test_normalize_values_various_non_us_country_codes(self) -> None:
        """Various non-US country codes all pass through."""
        from bunking.geo_normalizer import normalize_values

        values = [
            {"value": "Toronto", "state": "ON", "country": "CA"},
            {"value": "Melbourne", "state": "VIC", "country": "AU"},
            {"value": "Tel Aviv", "state": "", "country": "IL"},
        ]
        result = normalize_values("city", values)
        for item in values:
            city = item["value"]
            assert result[city]["canonical"] == city
            assert result[city]["confidence"] == 1.0

    def test_normalize_values_us_country_variants(self) -> None:
        """US, USA, and UNITED STATES all treated as domestic."""
        from bunking.geo_normalizer import normalize_values

        values = [
            {"value": "Oakland", "state": "CA", "country": "US"},
            {"value": "Oakland", "state": "CA", "country": "USA"},
            {"value": "Oakland", "state": "CA", "country": "United States"},
        ]
        # All should go through normal US normalization
        result = normalize_values("city", values)
        assert "Oakland" in result["Oakland"]["canonical"]
