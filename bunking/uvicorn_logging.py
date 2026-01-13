"""
Custom Uvicorn logging configuration.

Filters health check access logs and provides consistent formatting
matching the unified format: 2026-01-06T14:05:52Z [source] LEVEL message

Usage:
    uvicorn api.main:app --log-config bunking/uvicorn_logging_config.json
    Or programmatically via UVICORN_LOGGING_CONFIG dict.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any


class UvicornAccessFilter(logging.Filter):
    """Filter health check requests from access logs.

    Suppresses /health and /api/health GET requests at INFO level
    to reduce log noise from Docker health checks.
    """

    HEALTH_PATHS = {"/health", "/api/health"}

    def filter(self, record: logging.LogRecord) -> bool:
        """Filter out health check requests unless DEBUG is enabled."""
        message = record.getMessage()
        for path in self.HEALTH_PATHS:
            if f'"{path} ' in message or f'"{path}"' in message:
                # Only log at DEBUG level
                if not logging.getLogger().isEnabledFor(logging.DEBUG):
                    return False
        return True


class UvicornFormatter(logging.Formatter):
    """Consistent formatter for Uvicorn logs.

    Output format: 2026-01-06T14:05:52Z [uvicorn] LEVEL message
    """

    def __init__(self, source: str = "uvicorn"):
        self.source = source
        super().__init__()

    def format(self, record: logging.LogRecord) -> str:
        """Format uvicorn log record with ISO8601 UTC timestamp."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return f"{timestamp} [{self.source}] {record.levelname} {record.getMessage()}"


# Uvicorn logging configuration dict
# Use with: uvicorn.run(..., log_config=UVICORN_LOGGING_CONFIG)
UVICORN_LOGGING_CONFIG: dict[str, Any] = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "health_filter": {
            "()": UvicornAccessFilter,
        },
    },
    "formatters": {
        "default": {
            "()": UvicornFormatter,
            "source": "uvicorn",
        },
        "access": {
            "()": UvicornFormatter,
            "source": "uvicorn",
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
        },
        "access": {
            "formatter": "access",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "filters": ["health_filter"],
        },
    },
    "loggers": {
        "uvicorn": {
            "handlers": ["default"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn.error": {
            "handlers": ["default"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn.access": {
            "handlers": ["access"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
