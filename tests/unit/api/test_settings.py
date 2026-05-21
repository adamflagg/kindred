"""Tests for api/settings module."""

from unittest.mock import patch

import pytest

from api.settings import Settings, _allow_auth_bypass


class TestAllowAuthBypass:
    """Tests for _allow_auth_bypass function (canonical source)."""

    @pytest.mark.parametrize(
        ("env", "expected"),
        [
            ({"CI": "true", "GITHUB_ACTIONS": "true"}, True),
            ({"GITHUB_ACTIONS": "true"}, False),
            ({"CI": "true"}, False),
            ({}, False),
            ({"ALLOW_AUTH_BYPASS": "true"}, True),
            ({"ALLOW_AUTH_BYPASS": "1"}, True),
            ({"ALLOW_AUTH_BYPASS": "yes"}, True),
            ({"ALLOW_AUTH_BYPASS": "false"}, False),
            ({"CI": "yes", "GITHUB_ACTIONS": "1"}, False),
        ],
        ids=[
            "both_ci_signals",
            "missing_ci",
            "missing_github_actions",
            "neither_signal",
            "allow_bypass_true",
            "allow_bypass_1",
            "allow_bypass_yes",
            "allow_bypass_false",
            "ci_wrong_values",
        ],
    )
    def test_bypass_env_combinations(self, env, expected):
        """Test _allow_auth_bypass with various env var combinations."""
        with patch.dict("os.environ", env, clear=True):
            assert _allow_auth_bypass() is expected


class TestGetEffectiveAuthMode:
    """Tests for Settings.get_effective_auth_mode method."""

    @pytest.mark.parametrize(
        ("is_docker", "env", "expected"),
        [
            (False, {"AUTH_MODE": "bypass"}, "bypass"),
            (True, {"AUTH_MODE": "bypass"}, "production"),
            (True, {"AUTH_MODE": "bypass", "ALLOW_AUTH_BYPASS": "true"}, "bypass"),
            (True, {"AUTH_MODE": "bypass", "CI": "true", "GITHUB_ACTIONS": "true"}, "bypass"),
            (True, {"AUTH_MODE": "production"}, "production"),
        ],
        ids=[
            "non_docker_returns_configured",
            "docker_forces_production",
            "docker_bypass_explicitly_permitted",
            "docker_bypass_github_actions",
            "docker_production_unchanged",
        ],
    )
    def test_effective_auth_mode(self, is_docker, env, expected):
        """Test get_effective_auth_mode with various docker/env combinations."""
        with patch.dict("os.environ", env, clear=True):
            with patch("api.settings._is_docker_environment", return_value=is_docker):
                settings = Settings()
                if is_docker:
                    settings.is_docker = True
                assert settings.get_effective_auth_mode() == expected
