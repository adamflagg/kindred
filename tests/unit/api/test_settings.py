"""Tests for api/settings module."""

from __future__ import annotations

from unittest.mock import patch

from api.settings import Settings, _is_github_actions


class TestIsGitHubActions:
    """Tests for _is_github_actions function (canonical source)."""

    def test_both_signals_required(self):
        """Test that both CI=true and GITHUB_ACTIONS=true are required."""
        with patch.dict("os.environ", {"CI": "true", "GITHUB_ACTIONS": "true"}):
            assert _is_github_actions() is True

    def test_missing_ci_signal(self):
        """Test that GITHUB_ACTIONS alone is not sufficient."""
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "true"}, clear=True):
            assert _is_github_actions() is False

    def test_missing_github_actions_signal(self):
        """Test that CI alone is not sufficient."""
        with patch.dict("os.environ", {"CI": "true"}, clear=True):
            assert _is_github_actions() is False

    def test_neither_signal(self):
        """Test that missing both signals returns False."""
        with patch.dict("os.environ", {}, clear=True):
            assert _is_github_actions() is False


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
                with patch("api.settings._is_github_actions", return_value=False):
                    settings = Settings()
                    # Mock the instance method since it calls the module function
                    settings.is_docker = True
                    assert settings.get_effective_auth_mode() == "production"

    def test_docker_allows_bypass_in_github_actions(self):
        """Test that Docker + GitHub Actions allows bypass mode (for CI)."""
        with patch.dict("os.environ", {"AUTH_MODE": "bypass", "CI": "true", "GITHUB_ACTIONS": "true"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                settings = Settings()
                settings.is_docker = True
                # _is_github_actions() will return True due to env vars
                assert settings.get_effective_auth_mode() == "bypass"

    def test_production_mode_unchanged_in_docker(self):
        """Test that production mode stays production in Docker."""
        with patch.dict("os.environ", {"AUTH_MODE": "production"}, clear=True):
            with patch("api.settings._is_docker_environment", return_value=True):
                settings = Settings()
                settings.is_docker = True
                assert settings.get_effective_auth_mode() == "production"
