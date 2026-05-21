"""
Authentication middleware v2 - supports both JWT validation and legacy modes.
"""

import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
import httpx
from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from api.settings import _allow_auth_bypass
from bunking.logging_config import get_logger

from .jwt_auth import JWTValidator, PocketBaseTokenValidator, extract_bearer_token

logger = get_logger(__name__)


def _is_docker_environment() -> bool:
    """Detect if running inside a Docker container."""
    # Check for .dockerenv file (most reliable)
    if Path("/.dockerenv").exists():
        return True
    # Check for explicit env var
    if os.getenv("DOCKER_CONTAINER") == "true":
        return True
    # Check cgroup (works on most Linux systems)
    try:
        with open("/proc/1/cgroup") as f:
            return "docker" in f.read()
    except FileNotFoundError, PermissionError:
        pass
    return False


class AuthUser:
    """Represents an authenticated user."""

    def __init__(self, username: str, email: str, display_name: str, groups: list[str], is_admin: bool):
        self.username = username
        self.email = email
        self.display_name = display_name
        self.groups = groups
        self.is_admin = is_admin
        self.permissions: set[str] = set()

    def to_dict(self) -> dict[str, Any]:
        """Convert user to dictionary for JSON serialization."""
        return {
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name,
            "groups": self.groups,
            "is_admin": self.is_admin,
            "permissions": sorted(self.permissions),
        }


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware for handling authentication.

    Supports two modes:
    - bypass: Always authenticate as DevAdmin (development only)
    - production: Validate JWT tokens from OIDC provider
    """

    def __init__(self, app: Any, auth_mode: str, admin_group: str):
        super().__init__(app)
        self.auth_mode = auth_mode.lower()
        self.admin_group = admin_group
        self._userinfo_cache: dict[str, dict[str, Any]] = {}
        self._pb_admin_token: str | None = None
        self._pb_admin_token_expires: float = 0.0
        self._permissions_cache: dict[str, dict[str, Any]] = {}

        # Validate auth mode
        if self.auth_mode not in ["bypass", "production"]:
            raise ValueError(f"Invalid AUTH_MODE: {auth_mode}. Must be bypass or production")

        # Security: Block bypass mode in Docker containers (production deployments)
        # Exception: Allow bypass when explicitly permitted (CI or local testing)
        if self.auth_mode == "bypass" and _is_docker_environment():
            if _allow_auth_bypass():
                logger.warning(
                    "AUTH_MODE=bypass allowed in Docker (auth bypass explicitly permitted). "
                    "This is safe for CI/local testing but should never occur in production."
                )
            else:
                raise ValueError(
                    "SECURITY ERROR: AUTH_MODE=bypass is not allowed in Docker containers. "
                    "Docker deployments must use AUTH_MODE=production."
                )

        logger.info(f"Authentication middleware initialized in {self.auth_mode} mode")

        # Initialize JWT validator for production mode
        self.jwt_validator = None
        self.pb_token_validator = None
        if self.auth_mode == "production":
            issuer = os.getenv("OIDC_ISSUER")
            if not issuer:
                raise ValueError("OIDC_ISSUER must be set in production mode")
            audience = os.getenv("OIDC_CLIENT_ID")
            self.jwt_validator = JWTValidator(issuer, audience=audience)

            # Initialize PocketBase token validator as fallback
            # This handles tokens issued by PocketBase (not OIDC directly)
            pocketbase_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")

            # Security: Validate POCKETBASE_URL is on trusted network
            # Use urlparse to prevent prefix-spoofing (e.g. http://127.0.0.1.evil.com)
            # Allow: localhost, 127.0.0.1, and any dotless hostname (Docker service names
            # like "pocketbase" or "kindred-pocketbase" never contain dots, while public
            # hostnames like "evil.example.com" always do)
            parsed = urlparse(pocketbase_url)
            hostname = parsed.hostname or ""
            is_trusted = hostname in ("127.0.0.1", "localhost") or ("." not in hostname and hostname != "")
            if not is_trusted:
                raise ValueError(f"POCKETBASE_URL must be on trusted network, got: {pocketbase_url}")

            self.pb_token_validator = PocketBaseTokenValidator(pocketbase_url)
            logger.info(f"PocketBase token validator initialized for {pocketbase_url}")

    async def _get_pb_admin_token(self) -> str | None:
        """Get a cached PocketBase admin token, refreshing if expired."""
        if self._pb_admin_token and self._pb_admin_token_expires > time.time():
            return self._pb_admin_token

        pb_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
        admin_email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
        admin_password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "")

        if not admin_password:
            logger.debug("No POCKETBASE_ADMIN_PASSWORD set, skipping PB permission fetch")
            return None

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{pb_url}/api/collections/_superusers/auth-with-password",
                    json={"identity": admin_email, "password": admin_password},
                )
                if response.status_code == 200:
                    data = response.json()
                    self._pb_admin_token = data.get("token")
                    # Cache for 50 minutes (tokens typically valid for 1 hour)
                    self._pb_admin_token_expires = time.time() + 3000
                    return self._pb_admin_token
                else:
                    logger.warning(f"PB admin auth failed: {response.status_code}")
                    return None
        except Exception:
            logger.debug("Failed to authenticate with PocketBase for permission fetch", exc_info=True)
            return None

    async def _populate_user_permissions(self, user: AuthUser) -> None:
        """Fetch cached_permissions and is_admin from PocketBase user record.

        Queries PocketBase for the user record by email, then populates
        user.permissions from the cached_permissions field and syncs is_admin.
        On failure, logs and continues with empty permissions (don't break auth).
        """
        try:
            # Check permissions cache first (keyed by email, expires after 60s)
            cache_key = f"perms:{user.email}"
            cached = self._permissions_cache.get(cache_key)
            if cached and cached.get("expires", 0) > time.time():
                user.permissions = set(cached.get("permissions", []))
                user.is_admin = bool(cached.get("is_admin", user.is_admin))
                return

            admin_token = await self._get_pb_admin_token()
            if not admin_token:
                return

            pb_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")

            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{pb_url}/api/collections/users/records",
                    params={"filter": f'email = "{user.email}"', "perPage": 1},
                    headers={"Authorization": admin_token},
                )
                if response.status_code == 200:
                    items = response.json().get("items", [])
                    if items:
                        record = items[0]
                        cached_perms = record.get("cached_permissions") or []
                        if isinstance(cached_perms, list):
                            user.permissions = set(cached_perms)
                        # Sync is_admin from PB record (authoritative, set by Go OIDC hook)
                        user.is_admin = bool(record.get("is_admin"))

                        # Cache the result for 60 seconds
                        self._permissions_cache[cache_key] = {
                            "permissions": list(user.permissions),
                            "is_admin": user.is_admin,
                            "expires": time.time() + 60,
                        }
                else:
                    logger.debug(f"PB user lookup returned {response.status_code}")
        except Exception:
            logger.debug("Could not fetch PB permissions, using empty set", exc_info=True)

    async def _extract_user_from_jwt(self, request: Request) -> AuthUser | None:
        """Extract user information from JWT token."""
        authorization = request.headers.get("Authorization")
        logger.debug(f"Authorization header present: {'Yes' if authorization else 'No'}")

        token = extract_bearer_token(authorization)

        if not token:
            logger.debug("No bearer token found in Authorization header")
            return None

        logger.debug(f"Token found, length: {len(token)}")

        # Try OIDC validation first
        claims: dict[str, Any] | None = None
        if self.jwt_validator is not None:
            try:
                claims = self.jwt_validator.validate_token(token)
                if claims:
                    logger.debug("Token validated via OIDC")
            except Exception as e:
                logger.debug(f"OIDC JWT validation error: {type(e).__name__}: {e}")

        # If OIDC validation failed, try PocketBase token validation
        if not claims and self.pb_token_validator:
            logger.debug("OIDC validation failed, trying PocketBase token validation")
            try:
                claims = self.pb_token_validator.validate_token(token)
                if claims:
                    # Security: Reject admin tokens (_superusers collection) in production
                    # These should only be used for PocketBase admin UI, not API access
                    pb_record = claims.get("_pb_record", {})
                    collection_name = pb_record.get("collectionName", "")
                    if collection_name == "_superusers":
                        logger.warning(
                            "SECURITY: Rejected _superusers token in production mode. "
                            "Admin tokens cannot be used for API authentication."
                        )
                        return None

                    logger.debug("Token validated via PocketBase")
            except Exception as e:
                logger.error(f"PocketBase token validation error: {type(e).__name__}: {e}")

        if not claims:
            logger.warning("All token validation methods failed")
            return None

        # Debug logging for claims before userinfo
        logger.debug(
            f"JWT claims before userinfo: {json.dumps({k: v for k, v in claims.items() if k != '_pb_record'}, indent=2)}"
        )

        # Fetch additional claims from userinfo if needed
        claims = await self._fetch_userinfo_if_needed(token, claims)

        # Debug logging for claims after userinfo
        logger.debug(f"Final claims after userinfo: {json.dumps(claims, indent=2)}")

        # Extract user info from claims
        username = claims.get("preferred_username") or claims.get("sub", "")
        email = claims.get("email", "")
        display_name = claims.get("name", username)

        # Extract groups - can be in different claim names
        groups = []
        for claim_name in ["groups", "cognito:groups", "custom:groups", "resource_access", "realm_access"]:
            if claim_name in claims:
                claim_value = claims[claim_name]
                logger.debug(f"Found {claim_name} claim: {claim_value}")
                if isinstance(claim_value, list):
                    groups.extend(claim_value)
                elif isinstance(claim_value, str):
                    groups.extend([g.strip() for g in claim_value.split(",") if g.strip()])
                elif isinstance(claim_value, dict):
                    # Handle nested groups (e.g., Keycloak's resource_access)
                    if "roles" in claim_value:
                        groups.extend(claim_value["roles"])

        # Check for Pocket ID roles claim
        if "https://pocketid.app/roles" in claims:
            pocket_roles = claims["https://pocketid.app/roles"]
            logger.debug(f"Found Pocket ID roles: {pocket_roles}")
            if isinstance(pocket_roles, list):
                groups.extend(pocket_roles)
            elif isinstance(pocket_roles, str):
                groups.extend([r.strip() for r in pocket_roles.split(",") if r.strip()])

        # Log groups found
        logger.debug(f"User {username} groups: {groups}")

        is_admin = self.admin_group in groups

        return AuthUser(username=username, email=email, display_name=display_name, groups=groups, is_admin=is_admin)

    async def _fetch_userinfo_if_needed(self, token: str, claims: dict[str, Any]) -> dict[str, Any]:
        """Fetch additional claims from userinfo endpoint if essential claims are missing."""
        # Check if we need to fetch userinfo
        if claims.get("email") and claims.get("groups"):
            return claims  # All essential claims present

        # Skip userinfo fetch for PocketBase tokens (they don't work with OIDC userinfo)
        if "_pb_record" in claims:
            logger.debug("Skipping userinfo fetch for PocketBase token")
            return claims

        # Use sub claim as cache key
        cache_key = f"userinfo:{claims.get('sub', 'unknown')}"

        # Check cache first
        if hasattr(self, "_userinfo_cache"):
            cached = self._userinfo_cache.get(cache_key, {})
            if cached.get("expires", 0) > time.time():
                logger.debug(f"Using cached userinfo for {cache_key}")
                claims.update(cached["data"])
                return claims

        # Fetch from userinfo endpoint
        if self.jwt_validator is None:
            return claims
        userinfo_url = f"{self.jwt_validator.issuer}/api/oidc/userinfo"
        logger.info(f"Fetching userinfo from {userinfo_url} for missing claims")

        try:
            async with (
                aiohttp.ClientSession() as session,
                session.get(
                    userinfo_url, headers={"Authorization": f"Bearer {token}"}, timeout=aiohttp.ClientTimeout(total=5)
                ) as response,
            ):
                if response.status == 200:
                    userinfo = await response.json()
                    logger.debug(f"Userinfo response keys: {list(userinfo.keys())}")

                    # Cache for 5 minutes
                    if not hasattr(self, "_userinfo_cache"):
                        self._userinfo_cache = {}

                    self._userinfo_cache[cache_key] = {"data": userinfo, "expires": time.time() + 300}

                    # Merge userinfo into claims
                    claims.update(userinfo)
                    logger.info(f"Successfully fetched userinfo for user {claims.get('sub')}")
                else:
                    logger.error(f"Userinfo endpoint returned {response.status}")
        except TimeoutError:
            logger.error("Userinfo request timed out after 5 seconds")
        except Exception as e:
            logger.error(f"Failed to fetch userinfo: {type(e).__name__}: {e}")

        return claims

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Process the request and add authentication context."""

        # Skip authentication for health check and config endpoints
        # /solver/config and /api/config are both used by frontend to determine auth mode
        # /health and /api/health are used by Docker/load balancers
        if request.url.path in ["/health", "/api/health", "/api/config", "/solver/config"]:
            response = await call_next(request)
            return response

        # Skip auth for metrics cache invalidation (safe, idempotent operation).
        # Called by PocketBase hook on registration config changes (no user context).
        if request.url.path == "/api/metrics/cache/invalidate" and request.method == "POST":
            response = await call_next(request)
            return response

        # Skip auth for internal service-to-service endpoints.
        # These are only reachable on the Docker internal network (Caddy blocks external access).
        if request.url.path.startswith("/api/internal/"):
            response = await call_next(request)
            return response

        user: AuthUser | None = None

        # Determine user based on auth mode
        if self.auth_mode == "bypass":
            # Always use DevAdmin
            user = AuthUser(
                username="DevAdmin",
                email="dev_admin@example.com",
                display_name="Dev Admin",
                groups=["admin"],
                is_admin=True,
            )
        else:  # production
            # Extract from JWT
            logger.debug(f"Production mode: extracting user from JWT for {request.url.path}")
            user = await self._extract_user_from_jwt(request)

        # Populate permissions from PocketBase (production mode only)
        # In bypass mode, is_admin=True already grants full access
        if user and self.auth_mode == "production":
            await self._populate_user_permissions(user)

        # Check if user is authenticated
        if not user:
            # Allow OPTIONS requests for CORS
            if request.method == "OPTIONS":
                response = await call_next(request)
                return response

            logger.warning(f"Unauthenticated request to {request.url.path} in {self.auth_mode} mode")
            # Return JSONResponse instead of raising HTTPException
            # (BaseHTTPMiddleware wraps raised exceptions causing 500 errors)
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})

        # Add user to request state
        request.state.user = user

        # Log the authenticated request
        logger.debug(f"Authenticated request from {user.username} to {request.url.path}")

        final_response = await call_next(request)
        return final_response


def get_current_user(request: Request) -> AuthUser:
    """
    Dependency to get the current authenticated user.

    Usage:
        @app.get("/protected")
        async def protected_route(user: AuthUser = Depends(get_current_user)):
            return {"message": f"Hello {user.username}"}
    """
    if not hasattr(request.state, "user") or not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user: AuthUser = request.state.user
    return user


def create_auth_middleware(app: Any, auth_mode: str, admin_group: str) -> AuthMiddleware:
    """Create auth middleware instance."""
    return AuthMiddleware(app, auth_mode, admin_group)
