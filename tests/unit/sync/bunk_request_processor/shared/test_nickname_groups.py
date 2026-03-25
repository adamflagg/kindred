"""Tests for nickname_groups module — nicknames library integration + camp overrides."""

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


class TestCampOverrides:
    """Test camp-specific nickname overrides."""

    def test_camp_override_esti(self):
        """Camp override: Esti → Esther."""
        variations = find_nickname_variations("Esti")
        lower_vars = [v.lower() for v in variations]
        assert "esther" in lower_vars

    def test_camp_override_ari(self):
        """Camp override: Ari → Arielle/Ariel."""
        variations = find_nickname_variations("Ari")
        lower_vars = [v.lower() for v in variations]
        assert any(n in lower_vars for n in ["arielle", "ariel", "ariella"])

    def test_camp_override_rafa(self):
        """Camp override: Rafa → Rafael."""
        variations = find_nickname_variations("Rafa")
        lower_vars = [v.lower() for v in variations]
        assert "rafael" in lower_vars


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
