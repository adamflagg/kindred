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
