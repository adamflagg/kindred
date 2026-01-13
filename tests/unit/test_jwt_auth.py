"""Tests for jwt_auth module - JWT validation with PyJWT.

These tests verify the JWTValidator class correctly validates OIDC tokens
using the PyJWT library. Written as TDD before migration from python-jose.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from bunking.jwt_auth import (
    JWTValidator,
    PocketBaseTokenValidator,
    _decode_jwt_claims_unsafe,
    extract_bearer_token,
)

# =============================================================================
# Test Fixtures and Helpers
# =============================================================================


def create_mock_token(
    payload: dict[str, Any],
    header: dict[str, Any] | None = None,
) -> str:
    """Create a mock JWT token (unsigned, for testing parsing only)."""
    if header is None:
        header = {"alg": "RS256", "typ": "JWT", "kid": "test-key-id"}

    def encode_part(data: dict[str, Any]) -> str:
        json_bytes = json.dumps(data).encode()
        return base64.urlsafe_b64encode(json_bytes).rstrip(b"=").decode()

    header_b64 = encode_part(header)
    payload_b64 = encode_part(payload)
    # Fake signature
    signature = base64.urlsafe_b64encode(b"fake-signature").rstrip(b"=").decode()

    return f"{header_b64}.{payload_b64}.{signature}"


@pytest.fixture
def mock_jwks() -> dict[str, Any]:
    """Mock JWKS response with RSA public key."""
    return {
        "keys": [
            {
                "kty": "RSA",
                "kid": "test-key-id",
                "use": "sig",
                "alg": "RS256",
                "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
                "e": "AQAB",
            }
        ]
    }


@pytest.fixture
def mock_oidc_discovery() -> dict[str, Any]:
    """Mock OIDC discovery document."""
    return {
        "issuer": "https://auth.example.com",
        "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
        "authorization_endpoint": "https://auth.example.com/authorize",
        "token_endpoint": "https://auth.example.com/token",
    }


# =============================================================================
# Tests for _decode_jwt_claims_unsafe
# =============================================================================


class TestDecodeJWTClaimsUnsafe:
    """Tests for _decode_jwt_claims_unsafe helper function."""

    def test_decode_valid_token(self) -> None:
        """Test decoding a valid JWT token without verification."""
        payload = {"sub": "user-123", "email": "user@example.com", "exp": 9999999999}
        token = create_mock_token(payload)

        result = _decode_jwt_claims_unsafe(token)

        assert result["sub"] == "user-123"
        assert result["email"] == "user@example.com"

    def test_decode_invalid_token_format(self) -> None:
        """Test decoding invalid token format returns empty dict."""
        result = _decode_jwt_claims_unsafe("not-a-jwt-token")
        assert result == {}

    def test_decode_token_with_two_parts(self) -> None:
        """Test decoding token with wrong number of parts."""
        result = _decode_jwt_claims_unsafe("header.payload")
        assert result == {}

    def test_decode_token_with_invalid_base64(self) -> None:
        """Test decoding token with invalid base64 payload."""
        result = _decode_jwt_claims_unsafe("header.!!!invalid-base64!!!.signature")
        assert result == {}


# =============================================================================
# Tests for extract_bearer_token
# =============================================================================


class TestExtractBearerToken:
    """Tests for extract_bearer_token helper function."""

    def test_extract_valid_bearer_token(self) -> None:
        """Test extracting a valid bearer token."""
        result = extract_bearer_token("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature")
        assert result == "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"

    def test_extract_bearer_token_lowercase(self) -> None:
        """Test extracting bearer token with lowercase 'bearer'."""
        result = extract_bearer_token("bearer some-token")
        assert result == "some-token"

    def test_extract_bearer_token_none_header(self) -> None:
        """Test extracting from None header."""
        result = extract_bearer_token(None)
        assert result is None

    def test_extract_bearer_token_empty_header(self) -> None:
        """Test extracting from empty header."""
        result = extract_bearer_token("")
        assert result is None

    def test_extract_bearer_token_wrong_scheme(self) -> None:
        """Test extracting with wrong auth scheme."""
        result = extract_bearer_token("Basic dXNlcjpwYXNz")
        assert result is None

    def test_extract_bearer_token_no_token(self) -> None:
        """Test extracting with scheme but no token."""
        result = extract_bearer_token("Bearer")
        assert result is None

    def test_extract_bearer_token_too_many_parts(self) -> None:
        """Test extracting with too many parts."""
        result = extract_bearer_token("Bearer token extra")
        assert result is None


# =============================================================================
# Tests for JWTValidator
# =============================================================================


class TestJWTValidatorInit:
    """Tests for JWTValidator initialization."""

    def test_init_discovers_jwks_uri(self, mock_oidc_discovery: dict[str, Any]) -> None:
        """Test that initialization discovers JWKS URI from OIDC config."""
        with patch("httpx.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_oidc_discovery
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            validator = JWTValidator("https://auth.example.com")

            assert validator.jwks_uri == "https://auth.example.com/.well-known/jwks.json"
            assert validator.issuer == "https://auth.example.com"

    def test_init_strips_trailing_slash(self, mock_oidc_discovery: dict[str, Any]) -> None:
        """Test that issuer trailing slash is stripped."""
        with patch("httpx.get") as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_oidc_discovery
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            validator = JWTValidator("https://auth.example.com/")

            assert validator.issuer == "https://auth.example.com"

    def test_init_fallback_jwks_uri_on_discovery_failure(self) -> None:
        """Test fallback JWKS URI when discovery fails."""
        with patch("httpx.get") as mock_get:
            mock_get.side_effect = Exception("Network error")

            validator = JWTValidator("https://auth.example.com")

            # Should use fallback
            assert validator.jwks_uri == "https://auth.example.com/.well-known/jwks.json"


class TestJWTValidatorFetchJWKS:
    """Tests for JWTValidator._fetch_jwks method."""

    def test_fetch_jwks_success(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test successful JWKS fetch."""
        with patch("httpx.get") as mock_get:
            # First call for discovery, second for JWKS
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")
            result = validator._fetch_jwks()

            assert "keys" in result
            assert len(result["keys"]) == 1
            assert result["keys"][0]["kid"] == "test-key-id"

    def test_fetch_jwks_caching(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test that JWKS is cached."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            # First fetch
            result1 = validator._fetch_jwks()
            # Second fetch should use cache
            result2 = validator._fetch_jwks()

            assert result1 == result2
            # Only 2 calls: discovery + first JWKS fetch
            assert mock_get.call_count == 2

    def test_fetch_jwks_cache_expires(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test that JWKS cache expires after TTL."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")
            validator.jwks_cache_ttl = 1  # 1 second TTL

            # First fetch
            validator._fetch_jwks()

            # Simulate cache expiry
            validator.jwks_cache_time = time.time() - 2

            # Second fetch should refetch
            validator._fetch_jwks()

            # Should have 3 calls: discovery + 2 JWKS fetches
            assert mock_get.call_count == 3


class TestJWTValidatorGetSigningKey:
    """Tests for JWTValidator._get_signing_key method."""

    def test_get_signing_key_success(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test successful signing key retrieval."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123", "iss": "https://auth.example.com"}
            token = create_mock_token(payload, {"alg": "RS256", "typ": "JWT", "kid": "test-key-id"})

            key = validator._get_signing_key(token)

            # Key should be constructed (not None)
            assert key is not None

    def test_get_signing_key_missing_kid(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test signing key retrieval with missing kid in token."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            mock_get.return_value = discovery_response

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123"}
            # Token without kid in header
            token = create_mock_token(payload, {"alg": "RS256", "typ": "JWT"})

            key = validator._get_signing_key(token)

            assert key is None

    def test_get_signing_key_kid_not_in_jwks(
        self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]
    ) -> None:
        """Test signing key retrieval with kid not found in JWKS."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123"}
            # Token with different kid
            token = create_mock_token(payload, {"alg": "RS256", "typ": "JWT", "kid": "unknown-key-id"})

            key = validator._get_signing_key(token)

            assert key is None


class TestJWTValidatorValidateToken:
    """Tests for JWTValidator.validate_token method."""

    def test_validate_token_returns_none_without_signing_key(self, mock_oidc_discovery: dict[str, Any]) -> None:
        """Test that validation returns None when no signing key found."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = {"keys": []}  # Empty JWKS
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123"}
            token = create_mock_token(payload)

            result = validator.validate_token(token)

            assert result is None

    def test_validate_token_expired(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test that expired tokens return None."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            # Create expired token - we'll mock the decode to raise ExpiredSignatureError
            payload = {"sub": "user-123", "exp": int(time.time()) - 3600}  # Expired 1 hour ago
            token = create_mock_token(payload)

            # Mock jwt.decode to simulate PyJWT behavior
            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                # Import the correct exception class from PyJWT
                import jwt as pyjwt

                mock_decode.side_effect = pyjwt.ExpiredSignatureError("Token expired")

                result = validator.validate_token(token)

            assert result is None

    def test_validate_token_invalid_issuer(
        self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]
    ) -> None:
        """Test that tokens with wrong issuer return None."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123", "iss": "https://wrong-issuer.com"}
            token = create_mock_token(payload)

            # Mock jwt.decode to simulate PyJWT behavior for invalid issuer
            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                import jwt as pyjwt

                mock_decode.side_effect = pyjwt.InvalidIssuerError("Invalid issuer")

                result = validator.validate_token(token)

            assert result is None

    def test_validate_token_invalid_signature(
        self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]
    ) -> None:
        """Test that tokens with invalid signature return None."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            payload = {"sub": "user-123"}
            token = create_mock_token(payload)

            # Mock jwt.decode to simulate PyJWT behavior for invalid signature
            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                import jwt as pyjwt

                mock_decode.side_effect = pyjwt.InvalidSignatureError("Invalid signature")

                result = validator.validate_token(token)

            assert result is None

    def test_validate_token_success(self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]) -> None:
        """Test successful token validation."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            expected_claims = {
                "sub": "user-123",
                "email": "user@example.com",
                "iss": "https://auth.example.com",
                "exp": int(time.time()) + 3600,
            }

            token = create_mock_token(expected_claims)

            # Mock successful decode
            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                mock_decode.return_value = expected_claims

                result = validator.validate_token(token)

            assert result is not None
            assert result["sub"] == "user-123"
            assert result["email"] == "user@example.com"

    def test_validate_token_checks_required_scopes(
        self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]
    ) -> None:
        """Test that required scopes are checked."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            claims = {
                "sub": "user-123",
                "scope": "openid profile",  # Missing 'admin' scope
            }

            token = create_mock_token(claims)

            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                mock_decode.return_value = claims

                result = validator.validate_token(token, required_scopes=["admin"])

            assert result is None  # Missing required scope

    def test_validate_token_passes_with_required_scopes(
        self, mock_oidc_discovery: dict[str, Any], mock_jwks: dict[str, Any]
    ) -> None:
        """Test that tokens with required scopes pass."""
        with patch("httpx.get") as mock_get:
            discovery_response = MagicMock()
            discovery_response.json.return_value = mock_oidc_discovery
            discovery_response.raise_for_status = MagicMock()

            jwks_response = MagicMock()
            jwks_response.json.return_value = mock_jwks
            jwks_response.raise_for_status = MagicMock()

            mock_get.side_effect = [discovery_response, jwks_response]

            validator = JWTValidator("https://auth.example.com")

            claims = {
                "sub": "user-123",
                "scope": "openid profile admin",  # Has 'admin' scope
            }

            token = create_mock_token(claims)

            with patch("bunking.jwt_auth.jwt.decode") as mock_decode:
                mock_decode.return_value = claims

                result = validator.validate_token(token, required_scopes=["admin"])

            assert result is not None
            assert result["sub"] == "user-123"


# =============================================================================
# Tests for PocketBaseTokenValidator
# =============================================================================


class TestPocketBaseTokenValidator:
    """Tests for PocketBaseTokenValidator class."""

    def test_init(self) -> None:
        """Test validator initialization."""
        validator = PocketBaseTokenValidator("http://localhost:8090")
        assert validator.pocketbase_url == "http://localhost:8090"

    def test_init_strips_trailing_slash(self) -> None:
        """Test that trailing slash is stripped from URL."""
        validator = PocketBaseTokenValidator("http://localhost:8090/")
        assert validator.pocketbase_url == "http://localhost:8090"

    def test_validate_rejects_superuser_token(self) -> None:
        """Test that _superusers tokens are rejected."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        # Create a token with _superusers collection ID
        payload = {"sub": "admin", "collectionId": "_superusers"}
        token = create_mock_token(payload)

        result = validator.validate_token(token)

        assert result is None

    def test_validate_rejects_pbc_superuser_token(self) -> None:
        """Test that pbc_3142635823 (superuser collection) tokens are rejected."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        # Create a token with PocketBase's internal superuser collection ID
        payload = {"sub": "admin", "collectionId": "pbc_3142635823"}
        token = create_mock_token(payload)

        result = validator.validate_token(token)

        assert result is None

    def test_validate_success(self) -> None:
        """Test successful PocketBase token validation."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        payload = {"sub": "user-123", "collectionId": "users"}
        token = create_mock_token(payload)

        with patch("httpx.post") as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "record": {
                    "id": "user-123",
                    "email": "user@example.com",
                    "username": "testuser",
                    "name": "Test User",
                    "verified": True,
                }
            }
            mock_post.return_value = mock_response

            result = validator.validate_token(token)

        assert result is not None
        assert result["sub"] == "user-123"
        assert result["email"] == "user@example.com"
        assert result["preferred_username"] == "testuser"

    def test_validate_caches_result(self) -> None:
        """Test that validation results are cached."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        payload = {"sub": "user-123", "collectionId": "users"}
        token = create_mock_token(payload)

        with patch("httpx.post") as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "record": {
                    "id": "user-123",
                    "email": "user@example.com",
                    "username": "testuser",
                }
            }
            mock_post.return_value = mock_response

            # First call
            result1 = validator.validate_token(token)
            # Second call should use cache
            result2 = validator.validate_token(token)

        assert result1 == result2
        # Only one HTTP call should have been made
        assert mock_post.call_count == 1

    def test_validate_returns_none_on_401(self) -> None:
        """Test that 401 response returns None."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        payload = {"sub": "user-123", "collectionId": "users"}
        token = create_mock_token(payload)

        with patch("httpx.post") as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 401
            mock_post.return_value = mock_response

            result = validator.validate_token(token)

        assert result is None

    def test_validate_returns_none_on_timeout(self) -> None:
        """Test that timeout returns None."""
        import httpx

        validator = PocketBaseTokenValidator("http://localhost:8090")

        payload = {"sub": "user-123", "collectionId": "users"}
        token = create_mock_token(payload)

        with patch("httpx.post") as mock_post:
            mock_post.side_effect = httpx.TimeoutException("Timeout")

            result = validator.validate_token(token)

        assert result is None

    def test_validate_returns_none_on_error(self) -> None:
        """Test that other errors return None."""
        validator = PocketBaseTokenValidator("http://localhost:8090")

        payload = {"sub": "user-123", "collectionId": "users"}
        token = create_mock_token(payload)

        with patch("httpx.post") as mock_post:
            mock_post.side_effect = Exception("Network error")

            result = validator.validate_token(token)

        assert result is None
