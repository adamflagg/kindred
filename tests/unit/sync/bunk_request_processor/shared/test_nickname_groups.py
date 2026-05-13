"""Tests for nickname_groups module — nicknames library integration + camp overrides."""

from unittest.mock import patch

from bunking.sync.bunk_request_processor.shared.nickname_groups import find_nickname_variations


class TestNicknameLibraryIntegration:
    """Test that the nicknames library provides expanded coverage."""

    def test_library_nicknames_robert_rob(self):
        """nicknames library provides Rob → Robert mapping."""
        variations = find_nickname_variations("Rob")
        lower_vars = [v.lower() for v in variations]
        assert "robert" in lower_vars

    def test_library_nicknames_addy(self):
        """nicknames library provides Addy → Adelaide/Addison."""
        variations = find_nickname_variations("Addy")
        lower_vars = [v.lower() for v in variations]
        assert "adelaide" in lower_vars or "addison" in lower_vars

    def test_library_nicknames_mike_michael(self):
        """Mike → Michael still works (covered by both built-in and library)."""
        variations = find_nickname_variations("Mike")
        lower_vars = [v.lower() for v in variations]
        assert "michael" in lower_vars

    def test_bidirectional_adelaide_addy(self):
        """Full name Adelaide returns short form Addy."""
        variations = find_nickname_variations("Adelaide")
        lower_vars = [v.lower() for v in variations]
        assert "addy" in lower_vars


_MOCK_OVERRIDES = {
    "danny": ["Daniel", "Dan"],
    "lulu": ["Louise"],
    "sammy": ["Samuel", "Samantha"],
    "olly": ["Oliver"],
    "rafi": ["Rafael", "Raphael"],
    "sofia": ["Sophia"],
    "joni": ["Joan", "Jonathan"],
}


def _with_mock_overrides(name: str) -> list[str]:
    """Call find_nickname_variations with mocked overrides."""
    with patch(
        "bunking.sync.bunk_request_processor.shared.nickname_groups._load_overrides",
        return_value=_MOCK_OVERRIDES,
    ):
        return find_nickname_variations(name)


class TestCampOverrides:
    """Test the override mechanism with mock data (real overrides are private config)."""

    def test_override_forward_lookup(self):
        """Override key resolves to its values."""
        lower_vars = [v.lower() for v in _with_mock_overrides("Danny")]
        assert "daniel" in lower_vars
        assert "dan" in lower_vars

    def test_override_reverse_lookup(self):
        """Override value resolves back to its key."""
        lower_vars = [v.lower() for v in _with_mock_overrides("Louise")]
        assert "lulu" in lower_vars

    def test_override_does_not_include_self(self):
        """Override lookup excludes the input name itself."""
        lower_vars = [v.lower() for v in _with_mock_overrides("Sammy")]
        assert "sammy" not in lower_vars
        assert "samuel" in lower_vars


class TestIssue865NicknameMappings:
    """Test nickname mappings from issue #865 — Olly, Rafi, Sofia, Joni."""

    def test_olly_resolves_to_oliver(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Olly")]
        assert "oliver" in lower_vars

    def test_oliver_resolves_to_olly(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Oliver")]
        assert "olly" in lower_vars

    def test_rafi_resolves_to_rafael(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Rafi")]
        assert "rafael" in lower_vars

    def test_rafi_resolves_to_raphael(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Rafi")]
        assert "raphael" in lower_vars

    def test_sofia_resolves_to_sophia(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Sofia")]
        assert "sophia" in lower_vars

    def test_sophia_resolves_to_sofia(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Sophia")]
        assert "sofia" in lower_vars

    def test_joni_resolves_to_joan(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Joni")]
        assert "joan" in lower_vars

    def test_joni_resolves_to_jonathan(self):
        lower_vars = [v.lower() for v in _with_mock_overrides("Joni")]
        assert "jonathan" in lower_vars


class TestExistingBehaviorPreserved:
    """Verify existing built-in nickname groups still work."""

    def test_builtin_kate_katherine(self):
        variations = find_nickname_variations("Kate")
        lower_vars = [v.lower() for v in variations]
        assert "katherine" in lower_vars

    def test_builtin_spelling_zoe_zoey(self):
        variations = find_nickname_variations("Zoe")
        lower_vars = [v.lower() for v in variations]
        assert "zoey" in lower_vars

    def test_no_self_in_variations(self):
        """Input name should not appear in its own variations."""
        variations = find_nickname_variations("Mike")
        lower_vars = [v.lower() for v in variations]
        assert "mike" not in lower_vars


class TestDeterminismAndOrdering:
    """Variations must be deterministic and alphabetically sorted across calls.

    Underlying nickname groups are set-derived; without explicit sorting, iteration
    order varies across Python invocations. The fuzzy_match fallback iterates this
    list and a non-deterministic order produces inconsistent resolutions.
    """

    def test_find_nickname_variations_is_deterministic(self):
        results = [find_nickname_variations("Katherine") for _ in range(10)]
        first = results[0]
        for i, r in enumerate(results[1:], start=2):
            assert r == first, f"call #{i} returned {r!r}, expected {first!r}"

    def test_find_nickname_variations_is_sorted(self):
        variations = find_nickname_variations("Katherine")
        assert variations == sorted(variations), f"not sorted: {variations}"

    def test_find_nickname_variations_is_sorted_josephine(self):
        variations = find_nickname_variations("Josephine")
        assert variations == sorted(variations), f"not sorted: {variations}"

    def test_find_nickname_variations_returns_empty_for_unknown_name(self):
        variations = find_nickname_variations("Xqyzzyzzy")
        assert variations == []
