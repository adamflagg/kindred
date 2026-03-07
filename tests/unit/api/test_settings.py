"""Tests for api/settings module."""

from __future__ import annotations

from unittest.mock import patch

from api.settings import Settings, _allow_auth_bypass


class TestAllowAuthBypass:
    """Tests for _allow_auth_bypass function (canonical source)."""

    def test_ci_both_signals_required(self):
        """Test that both CI=true and GITHUB_ACTIONS=true allow bypass."""
        with patch.dict("os.environ", {"CI": "true", "GITHUB_ACTIONS": "true"}):
            assert _allow_auth_bypass() is True

    def test_ci_missing_ci_signal(self):
        """Test that GITHUB_ACTIONS alone is not sufficient."""
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "true"}, clear=True):
            assert _allow_auth_bypass() is False

    def test_ci_missing_github_actions_signal(self):
        """Test that CI alone is not sufficient."""
        with patch.dict("os.environ", {"CI": "true"}, clear=True):
            assert _allow_auth_bypass() is False

    def test_neither_signal(self):
        """Test that missing both signals returns False."""
        with patch.dict("os.environ", {}, clear=True):
            assert _allow_auth_bypass() is False

    def test_allow_auth_bypass_env_var(self):
        """Test that ALLOW_AUTH_BYPASS=true allows bypass (local Docker testing)."""
        with patch.dict("os.environ", {"ALLOW_AUTH_BYPASS": "true"}, clear=True):
            assert _allow_auth_bypass() is True

    def test_allow_auth_bypass_env_var_false(self):
        """Test that ALLOW_AUTH_BYPASS=false does not allow bypass."""
        with patch.dict("os.environ", {"ALLOW_AUTH_BYPASS": "false"}, clear=True):
            assert _allow_auth_bypass() is False


class TestGetEffectiveAuthMode:
    """Tests for Settings.get_effective_auth_mode method."""

    def test_non_docker_returns_configured_mode(self):
        """Test that non-Docker environments return the configured auth_mode."""
        with patch.dict("os.environ", {"AUTH_MODE": "bypass"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=False):
                settings = Settings()
                assert settings.get_effective_auth_mode() == "bypass"

    def test_docker_forces_production(self):
        """Test that Docker environments force production mode (security)."""
        with patch.dict("os.environ", {"AUTH_MODE": "bypass"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                with patch("api.settings._allow_auth_bypass", return_value=False):
                    settings = Settings()
                    settings.is_docker = True
                    assert settings.get_effective_auth_mode() == "production"

    def test_docker_allows_bypass_when_explicitly_permitted(self):
        """Test that Docker allows bypass when auth bypass is explicitly permitted."""
        with patch.dict("os.environ", {"AUTH_MODE": "bypass", "ALLOW_AUTH_BYPASS": "true"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                settings = Settings()
                settings.is_docker = True
                assert settings.get_effective_auth_mode() == "bypass"

    def test_docker_allows_bypass_in_github_actions(self):
        """Test that Docker + GitHub Actions allows bypass mode (for CI)."""
        with patch.dict("os.environ", {"AUTH_MODE": "bypass", "CI": "true", "GITHUB_ACTIONS": "true"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                settings = Settings()
                settings.is_docker = True
                assert settings.get_effective_auth_mode() == "bypass"

    def test_production_mode_unchanged_in_docker(self):
        """Test that production mode stays production in Docker."""
        with patch.dict("os.environ", {"AUTH_MODE": "production"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                settings = Settings()
                settings.is_docker = True
                assert settings.get_effective_auth_mode() == "production"
