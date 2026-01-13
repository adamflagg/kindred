"""Tests for OIDC discovery functionality.

TDD tests for the discover_oidc_endpoints function that will be added to
scripts/setup/configure_pocketbase_oauth.py
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch


class TestDiscoverOidcEndpoints:
    """Test OIDC endpoint discovery from .well-known/openid-configuration."""

    def test_discover_endpoints_success(self) -> None:
        """Test successful discovery of all endpoints."""
        # Import will fail until implementation exists - that's expected in TDD
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "issuer": "https://auth.example.com",
            "authorization_endpoint": "https://auth.example.com/authorize",
            "token_endpoint": "https://auth.example.com/token",
            "userinfo_endpoint": "https://auth.example.com/userinfo",
            "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
        }

        with patch("requests.get", return_value=mock_response) as mock_get:
            result = discover_oidc_endpoints("https://auth.example.com")

            mock_get.assert_called_once_with(
                "https://auth.example.com/.well-known/openid-configuration",
                timeout=10,
            )

            assert result is not None
            assert result["auth_url"] == "https://auth.example.com/authorize"
            assert result["token_url"] == "https://auth.example.com/token"
            assert result["userinfo_url"] == "https://auth.example.com/userinfo"

    def test_discover_endpoints_strips_trailing_slash(self) -> None:
        """Test that trailing slash is stripped from issuer URL."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "authorization_endpoint": "https://auth.example.com/authorize",
            "token_endpoint": "https://auth.example.com/token",
            "userinfo_endpoint": "https://auth.example.com/userinfo",
        }

        with patch("requests.get", return_value=mock_response) as mock_get:
            discover_oidc_endpoints("https://auth.example.com/")

            # Should NOT have double slash
            mock_get.assert_called_once_with(
                "https://auth.example.com/.well-known/openid-configuration",
                timeout=10,
            )

    def test_discover_endpoints_network_error(self) -> None:
        """Test handling of network errors during discovery."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        with patch("requests.get", side_effect=Exception("Connection refused")):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None

    def test_discover_endpoints_http_error(self) -> None:
        """Test handling of HTTP errors (404, 500, etc.)."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("404 Not Found")

        with patch("requests.get", return_value=mock_response):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None

    def test_discover_endpoints_missing_auth_endpoint(self) -> None:
        """Test handling of missing authorization_endpoint in response."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "token_endpoint": "https://auth.example.com/token",
            "userinfo_endpoint": "https://auth.example.com/userinfo",
            # Missing authorization_endpoint
        }

        with patch("requests.get", return_value=mock_response):
            result = discover_oidc_endpoints("https://auth.example.com")
            # Should return None if any required endpoint is missing
            assert result is None

    def test_discover_endpoints_missing_token_endpoint(self) -> None:
        """Test handling of missing token_endpoint in response."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "authorization_endpoint": "https://auth.example.com/authorize",
            "userinfo_endpoint": "https://auth.example.com/userinfo",
            # Missing token_endpoint
        }

        with patch("requests.get", return_value=mock_response):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None

    def test_discover_endpoints_missing_userinfo_endpoint(self) -> None:
        """Test handling of missing userinfo_endpoint in response."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "authorization_endpoint": "https://auth.example.com/authorize",
            "token_endpoint": "https://auth.example.com/token",
            # Missing userinfo_endpoint
        }

        with patch("requests.get", return_value=mock_response):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None

    def test_discover_endpoints_invalid_json(self) -> None:
        """Test handling of invalid JSON response."""
        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = ValueError("Invalid JSON")

        with patch("requests.get", return_value=mock_response):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None

    def test_discover_endpoints_timeout(self) -> None:
        """Test handling of request timeout."""
        import requests

        from scripts.setup.configure_pocketbase_oauth import discover_oidc_endpoints

        with patch("requests.get", side_effect=requests.exceptions.Timeout):
            result = discover_oidc_endpoints("https://auth.example.com")
            assert result is None
