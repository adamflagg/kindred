"""
JWT authentication module for OIDC and PocketBase token validation.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from typing import Any, cast

import httpx
import jwt
from jwt import PyJWK
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

logger = logging.getLogger(__name__)


def _decode_jwt_claims_unsafe(token: str) -> dict[str, Any]:
    """Decode JWT claims WITHOUT verification. For inspection only."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        # Decode payload (second part), add padding if needed
        payload = parts[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        return cast(dict[str, Any], json.loads(decoded))
    except Exception:
        return {}


class PocketBaseTokenValidator:
    """Validates PocketBase-issued JWT tokens by calling PocketBase API."""

    def __init__(self, pocketbase_url: str):
        self.pocketbase_url = pocketbase_url.rstrip("/")
        self._validation_cache: dict[str, tuple[dict[str, Any], float]] = {}  # token_hash -> (claims, expiry)
        self._cache_ttl = 60  # Cache validations for 60 seconds

    def validate_token(self, token: str) -> dict[str, Any] | None:
        """
        Validate a PocketBase token by calling the auth-refresh endpoint.

        Returns user claims if valid, None otherwise.
        """
        # Security: Early rejection of admin tokens
        # Decode without verification to check collection ID
        unverified_claims = _decode_jwt_claims_unsafe(token)
        collection_id = unverified_claims.get("collectionId", "")
        # PocketBase uses "pbc_3142635823" for _superusers collection
        if collection_id.startswith("pbc_") or collection_id == "_superusers":
            # Check if this is actually a superuser token by the collection ID pattern
            # or if it explicitly says _superusers
            if "3142635823" in collection_id or collection_id == "_superusers":
                logger.warning(
                    "SECURITY: Rejecting _superusers admin token. Admin tokens cannot be used for API authentication."
                )
                return None

        # Check cache first (use hash of token for cache key to avoid collision)
        cache_key = hashlib.sha256(token.encode()).hexdigest()[:32]
        cached = self._validation_cache.get(cache_key)
        if cached is not None:
            claims, expiry = cached
            if time.time() < expiry:
                logger.debug("Using cached PocketBase token validation")
                return claims

        try:
            # Try to call the auth-refresh endpoint with the token
            # This validates the token and returns user info
            response = httpx.post(
                f"{self.pocketbase_url}/api/collections/users/auth-refresh",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5.0,
            )

            if response.status_code == 200:
                data = response.json()
                record = data.get("record", {})

                # Build claims from PocketBase user record
                claims = {
                    "sub": record.get("id", ""),
                    "email": record.get("email", ""),
                    "name": record.get("name", record.get("username", "")),
                    "preferred_username": record.get("username", ""),
                    # PocketBase OAuth users often have verified=true
                    "email_verified": record.get("verified", False),
                    # Include raw record for additional info
                    "_pb_record": record,
                }

                # Cache the result
                self._validation_cache[cache_key] = (claims, time.time() + self._cache_ttl)

                logger.info(f"PocketBase token validated for user: {claims.get('preferred_username')}")
                return claims

            logger.debug(f"PocketBase auth-refresh returned status {response.status_code}")
            return None

        except httpx.TimeoutException:
            logger.warning("PocketBase token validation timed out")
            return None
        except Exception as e:
            logger.error(f"Error validating PocketBase token: {type(e).__name__}: {e}")
            return None


class JWTValidator:
    """Validates JWT tokens against OIDC provider JWKS."""

    def __init__(self, issuer: str):
        self.issuer = issuer.rstrip("/")
        self.jwks_uri: str | None = None
        self.jwks_cache: dict[str, Any] | None = None
        self.jwks_cache_time: float = 0
        self.jwks_cache_ttl = 3600  # 1 hour cache

        # Initialize JWKS URI from discovery
        self._discover_jwks_uri()

    def _discover_jwks_uri(self) -> None:
        """Discover JWKS URI from OIDC discovery endpoint."""
        try:
            discovery_url = f"{self.issuer}/.well-known/openid-configuration"
            logger.debug(f"Attempting OIDC discovery at: {discovery_url}")
            response = httpx.get(discovery_url, timeout=10.0)
            response.raise_for_status()

            config = response.json()
            self.jwks_uri = config.get("jwks_uri")

            if not self.jwks_uri:
                raise ValueError(f"No jwks_uri found in discovery document at {discovery_url}")

            logger.info(f"Discovered JWKS URI: {self.jwks_uri}")
        except Exception as e:
            logger.error(f"Failed to discover JWKS URI from {self.issuer}: {type(e).__name__}: {e}")
            # Fallback to common pattern
            self.jwks_uri = f"{self.issuer}/.well-known/jwks.json"
            logger.warning(f"Using fallback JWKS URI: {self.jwks_uri}")

    def _fetch_jwks(self) -> dict[str, Any]:
        """Fetch JWKS from the OIDC provider."""
        current_time = time.time()

        # Check cache
        if self.jwks_cache is not None and (current_time - self.jwks_cache_time) < self.jwks_cache_ttl:
            return self.jwks_cache

        if self.jwks_uri is None:
            raise ValueError("JWKS URI not configured")

        try:
            response = httpx.get(self.jwks_uri, timeout=10.0)
            response.raise_for_status()

            self.jwks_cache = cast(dict[str, Any], response.json())
            self.jwks_cache_time = current_time

            logger.debug(f"Fetched JWKS with {len(self.jwks_cache.get('keys', []))} keys")
            return self.jwks_cache
        except Exception as e:
            logger.error(f"Failed to fetch JWKS: {e}")
            if self.jwks_cache is not None:
                logger.warning("Using stale JWKS cache")
                return self.jwks_cache
            raise

    def _get_signing_key(self, token: str) -> Any:
        """Get the signing key for the token."""
        try:
            # Get the kid from token header
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")

            if not kid:
                logger.warning("No kid in token header")
                return None

            # Fetch JWKS
            jwks = self._fetch_jwks()

            # Find the key
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    return PyJWK.from_dict(key).key

            logger.warning(f"Key with kid '{kid}' not found in JWKS")
            return None
        except Exception as e:
            logger.error(f"Error getting signing key: {e}")
            return None

    def validate_token(self, token: str, required_scopes: list[str] | None = None) -> dict[str, Any] | None:
        """
        Validate a JWT token and return the claims if valid.

        Args:
            token: The JWT token to validate
            required_scopes: Optional list of required scopes

        Returns:
            The token claims if valid, None otherwise
        """
        try:
            # Get signing key
            signing_key = self._get_signing_key(token)
            if not signing_key:
                logger.error("No signing key found")
                return None

            # Validate token
            logger.debug(f"Validating token with issuer: {self.issuer}")
            claims = cast(
                dict[str, Any],
                jwt.decode(
                    token,
                    signing_key,
                    algorithms=["RS256", "HS256"],
                    issuer=self.issuer,
                    options={
                        "verify_exp": True,
                        "verify_iat": True,
                        "verify_nbf": True,
                        "verify_iss": True,
                        "verify_aud": False,  # Not all OIDC providers set audience
                    },
                ),
            )
            logger.debug(f"Token validated successfully, sub: {claims.get('sub')}")

            # Check required scopes if provided
            if required_scopes:
                token_scopes = claims.get("scope", "").split()
                for scope in required_scopes:
                    if scope not in token_scopes:
                        logger.warning(f"Required scope '{scope}' not in token")
                        return None

            return claims
        except ExpiredSignatureError:
            logger.warning("Token has expired")
            return None
        except InvalidTokenError as e:
            logger.warning(f"Invalid token: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error validating token: {e}")
            return None


def extract_bearer_token(authorization_header: str | None) -> str | None:
    """Extract bearer token from Authorization header."""
    if not authorization_header:
        return None

    parts = authorization_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    return parts[1]
