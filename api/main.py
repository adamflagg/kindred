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
from bunking.logging_config import configure_logging, get_logger

from .dependencies import (
    auth_state,
    authenticate_pb,
    pb,
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
    if not settings.skip_pb_auth:
        await authenticate_pb()
        logger.info("Config initialization handled by PocketBase on startup")
    else:
        logger.warning("Skipping PocketBase authentication (SKIP_PB_AUTH=true)")
        auth_state.pb_client = pb

    yield

    # Shutdown (no cleanup needed - Go scheduler handles sync scheduling)


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

    # Load settings
    settings = get_settings()

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # Authentication configuration
    auth_mode = settings.get_effective_auth_mode()
    admin_group = settings.admin_group_name

    # Add authentication middleware (runs after CORS due to reverse order)
    app.add_middleware(lambda a: create_auth_middleware(a, auth_mode, admin_group))

    # Register routers
    from .routers import (
        debug,
        metrics,
        requests,
        scenarios,
        social_graph,
        solver,
        validation,
    )

    app.include_router(validation.router)
    app.include_router(solver.router)
    app.include_router(scenarios.router)
    app.include_router(social_graph.router)
    app.include_router(requests.router)
    app.include_router(debug.router)
    app.include_router(metrics.router)

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
        """Get current user information."""
        return user.to_dict()

    return app


# Create app instance for uvicorn
app = create_app()
