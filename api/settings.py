"""
Application settings using pydantic-settings for type-safe configuration.

All environment variables are centralized here with proper typing, validation,
and sensible defaults. Settings are loaded once at startup and cached.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _is_docker_environment() -> bool:
    """Detect if running inside a Docker container."""
    # Check for .dockerenv file (most reliable)
    if Path("/.dockerenv").exists():
        return True
    # Check cgroup (works on most Linux systems)
    try:
        with open("/proc/1/cgroup") as f:
            return "docker" in f.read()
    except (FileNotFoundError, PermissionError):
        pass
    return False


def _is_github_actions() -> bool:
    """Detect if running in GitHub Actions CI environment.

    Returns True only when BOTH CI=true AND GITHUB_ACTIONS=true are set.
    This dual-signal requirement prevents accidental bypass in production.
    """
    import os

    return os.getenv("CI") == "true" and os.getenv("GITHUB_ACTIONS") == "true"


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    All settings have sensible defaults for local development.
    Production values should be set via environment variables or .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # Ignore extra env vars not defined here
        case_sensitive=False,  # Allow AUTH_MODE or auth_mode
    )

    # === Authentication ===
    auth_mode: str = Field(
        default="production",
        description="Authentication mode: 'production' (JWT validation) or 'bypass' (dev only)",
    )
    admin_group_name: str = Field(
        default="admin",
        description="Name of the admin group in OIDC claims",
    )
    skip_pb_auth: bool = Field(
        default=False,
        description="Skip PocketBase authentication on startup (for testing)",
    )

    # === OIDC Configuration ===
    oidc_issuer: str = Field(
        default="",
        description="OIDC issuer/authority URL",
    )
    oidc_client_id: str = Field(
        default="",
        description="OIDC client ID",
    )
    oidc_redirect_uri: str = Field(
        default="",
        description="OIDC redirect URI after authentication",
    )

    # === PocketBase Configuration ===
    pocketbase_url: str = Field(
        default="http://127.0.0.1:8090",
        description="PocketBase server URL",
    )
    pocketbase_admin_email: str = Field(
        default="admin@camp.local",
        description="PocketBase admin email for API authentication",
    )
    pocketbase_admin_password: str = Field(
        default="",
        description="PocketBase admin password (required - no default for security)",
    )

    @field_validator("pocketbase_admin_password", mode="after")
    @classmethod
    def validate_admin_password(cls, v: str) -> str:
        """Validate admin password is set and not using insecure defaults."""
        insecure_defaults = {"campbunking123", "password", "admin", "123456", ""}
        if v in insecure_defaults:
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(
                "SECURITY WARNING: POCKETBASE_ADMIN_PASSWORD is not set or uses an insecure default. "
                "Set a strong password in your .env file for production use."
            )
        return v

    # === CORS Configuration ===
    # Note: Use str type for env var parsing, convert to list via property
    allowed_origins_str: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        alias="ALLOWED_ORIGINS",
        description="Allowed CORS origins (comma-separated)",
    )

    # === Docker Detection ===
    is_docker: bool = Field(
        default=False,
        description="Whether running in Docker container",
    )
    docker_container: bool = Field(
        default=False,
        description="Explicit Docker container flag",
    )

    # === System Settings ===
    tz: str = Field(
        default="America/Los_Angeles",
        description="Timezone for the application",
    )

    # === Graph Algorithm Settings ===
    graph_random_seed: int = Field(
        default=42,
        description="Random seed for reproducible graph algorithms (community detection, layout)",
    )

    @property
    def allowed_origins(self) -> list[str]:
        """Parse comma-separated origins string into list."""
        return [origin.strip() for origin in self.allowed_origins_str.split(",") if origin.strip()]

    @field_validator("is_docker", mode="before")
    @classmethod
    def parse_is_docker(cls, v: str | bool) -> bool:
        """Parse IS_DOCKER env var which can be 'true', '1', 'yes', etc."""
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes")
        return False

    @field_validator("auth_mode", mode="after")
    @classmethod
    def validate_auth_mode(cls, v: str) -> str:
        """Validate and normalize auth_mode."""
        v = v.lower()
        if v not in ("bypass", "production"):
            raise ValueError(f"Invalid AUTH_MODE: {v}. Must be 'bypass' or 'production'")
        return v

    def is_docker_environment(self) -> bool:
        """Check if running in a Docker environment."""
        return self.is_docker or self.docker_container or _is_docker_environment()

    def get_effective_auth_mode(self) -> str:
        """Get effective auth mode, forcing production in Docker (except CI).

        In Docker environments, always force production mode for security,
        EXCEPT when running in GitHub Actions CI where bypass is allowed
        for integration testing.
        """
        if self.is_docker_environment() and not _is_github_actions():
            return "production"
        return self.auth_mode


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Settings are loaded once and cached for the lifetime of the application.
    Use this function to access settings throughout the codebase.
    """
    return Settings()
