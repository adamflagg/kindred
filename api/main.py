#!/usr/bin/env python3
"""
Kindred API - HTTP API layer for the Kindred cabin assignment system.

This is the main FastAPI application that serves as the backend-for-frontend (BFF)
for the React bunking interface. It orchestrates:
- OR-Tools solver runs
- Draft scenario management
- Social graph visualization
- Sync scheduling
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from bunking.auth_middleware import (
    AuthUser,
    create_auth_middleware,
    get_current_user,
)
from bunking.config import ConfigLoader
from bunking.logging_config import configure_logging, get_logger

from .dependencies import (
    auth_state,
    authenticate_pb,
    pb,
    start_pb_token_refresh,
)
from .settings import get_settings

# Configure unified logging format
# Format: 2026-01-06T14:05:52Z [api] LEVEL message
configure_logging(source="api")
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application lifecycle - startup and shutdown."""
    settings = get_settings()

    # Startup
    refresh_task = None
    if not settings.skip_pb_auth:
        await authenticate_pb()
        refresh_task = await start_pb_token_refresh()
        ConfigLoader.initialize(
            pocketbase_url=settings.pocketbase_url,
            validate_on_init=True,
        )
        logger.info("ConfigLoader initialized with validate_on_init=True")
    else:
        logger.warning("Skipping PocketBase authentication (SKIP_PB_AUTH=true)")
        auth_state.pb_client = pb

    yield

    # Shutdown
    if refresh_task:
        refresh_task.cancel()
    from api.services.metrics_sql_connection import close_connection

    close_connection()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="Kindred API", description="Kindred cabin assignment API", lifespan=lifespan)

    # Add exception handlers
    @app.exception_handler(401)
    async def unauthorized_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=401, content={"detail": str(exc.detail) if hasattr(exc, "detail") else "Unauthorized"}
        )

    @app.exception_handler(403)
    async def forbidden_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=403, content={"detail": str(exc.detail) if hasattr(exc, "detail") else "Forbidden"}
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Catch unhandled exceptions and return a generic error to clients.

        Logs full error details server-side for debugging while preventing
        internal error messages from leaking to the frontend.
        """
        logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    # Load settings
    settings = get_settings()

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition"],
    )

    # Authentication configuration
    auth_mode = settings.get_effective_auth_mode()
    admin_group = settings.admin_group_name

    # Add authentication middleware (runs after CORS due to reverse order)
    app.add_middleware(lambda a: create_auth_middleware(a, auth_mode, admin_group))

    # Register routers
    from .routers import (
        debug,
        geo,
        internal,
        metrics,
        requests,
        satisfaction,
        scenarios,
        session_availability,
        social_graph,
        solver,
        validation,
    )

    app.include_router(validation.router)
    app.include_router(solver.router)
    app.include_router(scenarios.router)
    app.include_router(social_graph.router)
    app.include_router(satisfaction.router)
    app.include_router(requests.router)
    app.include_router(debug.router)
    app.include_router(metrics.router)
    app.include_router(session_availability.router)
    app.include_router(geo.router)
    app.include_router(internal.router)

    # Core endpoints (not in a router)
    @app.get("/health")
    async def health_check() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "healthy", "service": "kindred-api"}

    @app.get("/api/config")
    async def get_auth_config() -> dict[str, Any]:
        """Get authentication configuration for frontend."""
        current_auth_mode = settings.get_effective_auth_mode()

        if current_auth_mode == "bypass":
            return {"auth_mode": "bypass"}

        return {
            "auth_mode": "production",
            "authority": settings.oidc_issuer,
            "client_id": settings.oidc_client_id,
            "redirect_uri": settings.oidc_redirect_uri,
            "scope": "openid profile email groups",
            "response_type": "code",
            "automatic_silent_renew": True,
            "load_user_info": False,
        }

    @app.get("/api/user/me")
    async def get_current_user_info(user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
        """Get current user information including permissions."""
        return user.to_dict()

    @app.get("/api/permissions")
    async def get_permission_registry(user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
        """Get the permission registry for role-editing UI.

        Returns all valid permission codenames and their descriptions.
        Any authenticated user can read this; it's used by the role editor.
        """
        from bunking.rbac.permissions import ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS

        return {
            "permissions": [
                {"codename": perm, "description": PERMISSION_DESCRIPTIONS.get(perm, "")}
                for perm in sorted(ALL_PERMISSIONS)
            ],
            "total": len(ALL_PERMISSIONS),
        }

    return app


# Create app instance for uvicorn
app = create_app()
