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

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from bunking.auth_middleware import (
    AuthUser,
    create_auth_middleware,
    get_current_user,
)
from bunking.config import ConfigLoader
from bunking.financial_aid.change_log import add_commit_listener
from bunking.logging_config import configure_logging, get_logger
from bunking.rbac.permissions import (
    ADMIN_ONLY_AREAS,
    PERMISSION_AREAS,
    PERMISSION_DESCRIPTIONS,
    PERMISSION_INFO,
)
from bunking.solver.logging import SOLVER_LOGS_DIR, prune_solver_logs

from .dependencies import (
    auth_state,
    authenticate_pb,
    pb,
    start_pb_token_refresh,
)
from .routers import (
    admin_audit_log,
    campers,
    debug,
    financial_aid,
    geo,
    internal,
    jotform,
    lodging,
    lodging_friend_groups,
    metrics,
    requests,
    satisfaction,
    scenarios,
    session_availability,
    social_graph,
    solver,
    subject_notes,
    validation,
)
from .schemas.permissions import PermissionEntry, PermissionRegistryResponse, PermissionScreen
from .schemas.version import ApiVersionResponse
from .services.aid_season_cache import bind_warm_loop, on_aid_commit
from .services.aid_sync_inputs import cancel_aid_warm, set_season_warmer, start_aid_inputs_refresher
from .services.lodging_cache_warm import start_lodging_cache_refresher
from .services.metrics_sql_connection import close_connection
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
    # Expired solver run logs go at startup too, not only after a solve, so a
    # deploy in the off-season still clears them. Never raises.
    prune_solver_logs(SOLVER_LOGS_DIR)
    refresh_task = None
    lodging_refresh_task = None
    aid_refresh_task = None
    # Every Camperships write clears its season from the shared season cache (layer 2) before its response returns.
    # Registered whatever the auth mode: a cached season no write clears would be stale.
    remove_aid_listener = add_commit_listener(on_aid_commit)
    try:
        if not settings.skip_pb_auth:
            await authenticate_pb()
            refresh_task = await start_pb_token_refresh()
            ConfigLoader.initialize(
                pocketbase_url=settings.pocketbase_url,
                validate_on_init=True,
            )
            logger.info("ConfigLoader initialized with validate_on_init=True")
            # kindred#2803: warm the weekend year cache in the background -- now,
            # and again on the backstop -- so a staff member's first click after a
            # restart or a backstop expiry is not the one that pays for it.
            lodging_refresh_task = start_lodging_cache_refresher()
            # Camperships' sync inputs (layer 1), likewise in the background, now and after every backstop expiry: the
            # first season build after a restart or an expiry should not be the one that reads every person, household
            # and registration. Each warm then rebuilds the priced season (layer 2) through the router's own staff read,
            # so it fills the very cache entry staff read; so does the warm that follows each write's clear.
            set_season_warmer(lambda year: financial_aid._decisions().named_season(year))
            bind_warm_loop(asyncio.get_running_loop())
            aid_refresh_task = start_aid_inputs_refresher()
        else:
            logger.warning("Skipping PocketBase authentication (SKIP_PB_AUTH=true)")
            auth_state.pb_client = pb

        yield

        # Shutdown
        if refresh_task:
            refresh_task.cancel()
        if lodging_refresh_task:
            lodging_refresh_task.cancel()
        if aid_refresh_task:
            aid_refresh_task.cancel()
        cancel_aid_warm()  # a warm a sync's clear scheduled, if one is still reading
        close_connection()
    finally:
        # Also on a failed startup: a listener left registered would outlive this app.
        remove_aid_listener()
        bind_warm_loop(None)
        set_season_warmer(None)


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

    # Response compression (#1966).
    #
    # The weekend roster is ~107 KB of JSON and was crossing the wire raw --
    # neither Caddyfile carries `encode`, so nothing downstream was doing this
    # either. JSON of that shape compresses roughly 9:1.
    #
    # Added FIRST so it sits innermost and compresses the handler's response
    # before CORS and auth add their headers; those are header-only and are not
    # affected by the body encoding. `minimum_size` keeps small bodies alone,
    # where the gzip header and the CPU cost outweigh the saving.
    #
    # This is negotiated, not forced: a client that does not offer gzip -- an
    # explicit `Accept-Encoding: identity`, or no such header at all, which is
    # what plain `curl` sends -- still gets a raw body.
    app.add_middleware(GZipMiddleware, minimum_size=1000)

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
    app.include_router(validation.router)
    app.include_router(solver.router)
    app.include_router(scenarios.router)
    app.include_router(social_graph.router)
    app.include_router(satisfaction.router)
    app.include_router(requests.router)
    app.include_router(debug.router)
    app.include_router(metrics.router)
    app.include_router(session_availability.router)
    app.include_router(lodging.router)
    app.include_router(lodging_friend_groups.router)
    app.include_router(subject_notes.router)
    app.include_router(jotform.router)
    app.include_router(financial_aid.router)
    app.include_router(campers.router)
    app.include_router(geo.router)
    app.include_router(internal.router)
    app.include_router(admin_audit_log.router)

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

    @app.get("/api/version", response_model=ApiVersionResponse)
    async def get_api_version(user: AuthUser = Depends(get_current_user)) -> ApiVersionResponse:
        """The version this image was built at (KINDRED_VERSION), or "dev".

        Any signed-in user can read this. CD rebuilds only the images whose
        files changed, so the frontend asks each component for its own.
        """
        return ApiVersionResponse(api=os.environ.get("KINDRED_VERSION", "").strip() or "dev")

    @app.get("/api/permissions", response_model=PermissionRegistryResponse)
    async def get_permission_registry(user: AuthUser = Depends(get_current_user)) -> PermissionRegistryResponse:
        """The permission registry the Users page explains RBAC from.

        Code defaults only: admin wording overrides are a PocketBase collection
        the browser merges. Any authenticated user can read this.
        """
        ordered = [code for area in PERMISSION_AREAS for code, info in PERMISSION_INFO.items() if info.area == area]
        return PermissionRegistryResponse(
            permissions=[
                PermissionEntry(
                    codename=code,
                    description=PERMISSION_DESCRIPTIONS[code],
                    label=PERMISSION_INFO[code].label,
                    short=PERMISSION_INFO[code].short,
                    area=PERMISSION_INFO[code].area,
                    screens=[PermissionScreen(name=s.name, path=s.path) for s in PERMISSION_INFO[code].screens],
                )
                for code in ordered
            ],
            areas=list(PERMISSION_AREAS),
            admin_only=list(ADMIN_ONLY_AREAS),
            total=len(ordered),
        )

    return app


# Create app instance for uvicorn
app = create_app()
