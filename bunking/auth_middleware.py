"""
Authentication middleware v2 - supports both JWT validation and legacy modes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiohttp
from fastapi import Depends, HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from pocketbase import PocketBase

from .jwt_auth import JWTValidator, PocketBaseTokenValidator, extract_bearer_token

logger = logging.getLogger(__name__)


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
    except (FileNotFoundError, PermissionError):
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

    def to_dict(self) -> dict[str, Any]:
        """Convert user to dictionary for JSON serialization."""
        return {
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name,
            "groups": self.groups,
            "is_admin": self.is_admin,
        }


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware for handling authentication.

    Supports two modes:
    - bypass: Always authenticate as DevAdmin (development only)
    - production: Validate JWT tokens from OIDC provider
    """

    def __init__(self, app: Any, auth_mode: str, admin_group: str, pb_client: PocketBase | None = None):
        super().__init__(app)
        self.auth_mode = auth_mode.lower()
        self.admin_group = admin_group
        self.pb = pb_client
        self._pb_client_setter: Callable[[PocketBase], None] | None = None
        self._userinfo_cache: dict[str, dict[str, Any]] = {}

        # Validate auth mode
        if self.auth_mode not in ["bypass", "production"]:
            raise ValueError(f"Invalid AUTH_MODE: {auth_mode}. Must be bypass or production")

        # Security: Block bypass mode in Docker containers (production deployments)
        if self.auth_mode == "bypass" and _is_docker_environment():
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
            self.jwt_validator = JWTValidator(issuer)

            # Initialize PocketBase token validator as fallback
            # This handles tokens issued by PocketBase (not OIDC directly)
            pocketbase_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
            self.pb_token_validator = PocketBaseTokenValidator(pocketbase_url)
            logger.info(f"PocketBase token validator initialized for {pocketbase_url}")

    async def _extract_user_from_jwt(self, request: Request) -> AuthUser | None:
        """Extract user information from JWT token."""
        authorization = request.headers.get("Authorization")
        logger.debug(f"Authorization header present: {'Yes' if authorization else 'No'}")

        token = extract_bearer_token(authorization)

        if not token:
            logger.debug("No bearer token found in Authorization header")
            return None

        logger.debug(f"Token found, length: {len(token)}, first 20 chars: {token[:20]}...")

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

                    logger.info("Token validated via PocketBase")
                    # For PocketBase tokens, we grant admin access to all authenticated users
                    # since PocketBase handles authorization via OAuth2
                    claims["groups"] = ["admin"]
            except Exception as e:
                logger.error(f"PocketBase token validation error: {type(e).__name__}: {e}")

        if not claims:
            logger.warning("All token validation methods failed")
            return None

        # Debug logging for claims before userinfo
        logger.info(
            f"JWT claims before userinfo: {json.dumps({k: v for k, v in claims.items() if k != '_pb_record'}, indent=2)}"
        )

        # Fetch additional claims from userinfo if needed
        claims = await self._fetch_userinfo_if_needed(token, claims)

        # Debug logging for claims after userinfo
        logger.info(f"Final claims after userinfo: {json.dumps(claims, indent=2)}")

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
        logger.info(f"User {username} groups: {groups}")

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

        # Sync user to PocketBase if we have a client
        if user and self.pb:
            try:
                await self._sync_user_to_pocketbase(user)
            except Exception as e:
                # Log but don't fail the request if sync fails
                logger.error(f"Failed to sync user to PocketBase: {e}")

        # Add user to request state
        request.state.user = user

        # Check admin access for admin routes
        if request.url.path.startswith("/admin") or request.url.path.startswith("/api/users"):
            if not user.is_admin:
                logger.warning(f"Non-admin user {user.username} attempted to access {request.url.path}")
                return JSONResponse(status_code=403, content={"detail": "Admin access required"})

        # Log the authenticated request
        logger.debug(f"Authenticated request from {user.username} to {request.url.path}")

        final_response = await call_next(request)
        return final_response

    async def _sync_user_to_pocketbase(self, user: AuthUser) -> None:
        """Sync user information to PocketBase."""
        if not self.pb:
            return

        try:
            # Try to find existing user in app_users collection
            existing = None
            try:
                result = await asyncio.to_thread(
                    self.pb.collection("app_users").get_list,
                    page=1,
                    per_page=1,
                    query_params={"filter": f'username="{user.username}"'},
                )
                if result.items:
                    existing = result.items[0]
            except Exception as e:
                logger.debug(f"User not found or error searching: {e}")

            now = datetime.now(UTC).isoformat()

            user_data = {
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
                "groups": user.groups,
                "is_admin": user.is_admin,
                "last_login": now,
                "active": True,
            }

            if existing:
                # Update existing user
                await asyncio.to_thread(self.pb.collection("app_users").update, existing.id, user_data)
                logger.debug(f"Updated user {user.username} in PocketBase")
            else:
                # Create new user
                user_data["first_seen"] = now

                await asyncio.to_thread(self.pb.collection("app_users").create, user_data)
                logger.info(f"Created new user {user.username} in PocketBase")

        except Exception as e:
            logger.error(f"Error syncing user {user.username} to PocketBase: {e}")
            # Don't raise - we don't want auth to fail if PocketBase is down


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


def require_admin(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """
    Dependency to require admin access.

    Usage:
        @app.get("/admin/protected")
        async def admin_route(user: AuthUser = Depends(require_admin)):
            return {"message": f"Hello admin {user.username}"}
    """
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    return user


# Global reference to middleware instance for PocketBase client updates
_auth_middleware_instance = None


def create_auth_middleware(app: Any, auth_mode: str, admin_group: str) -> AuthMiddleware:
    """Create auth middleware instance and store global reference."""
    global _auth_middleware_instance
    _auth_middleware_instance = AuthMiddleware(app, auth_mode, admin_group, pb_client=None)
    return _auth_middleware_instance


def set_pocketbase_client(pb_client: PocketBase) -> None:
    """Set PocketBase client on the middleware instance."""
    global _auth_middleware_instance
    if _auth_middleware_instance:
        _auth_middleware_instance.pb = pb_client
        logger.info("Updated auth middleware with PocketBase client")
