"""
Centralized logging configuration for Kindred.

Provides unified logging format across all Python services:
Format: 2026-01-06T14:05:52Z [source] LEVEL message

Environment Variables:
    LOG_LEVEL: Set to "DEBUG", "TRACE", or "INFO" (default)
               - INFO: Normal operation logs
               - DEBUG: Detailed diagnostic information
               - TRACE: Very verbose low-level diagnostics (API params, etc.)

Usage:
    from bunking.logging_config import configure_logging, get_logger

    configure_logging(source="api")
    logger = get_logger(__name__)
    logger.info("Application started")
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import UTC, datetime

# Custom TRACE level for very verbose diagnostics
TRACE = 5
logging.addLevelName(TRACE, "TRACE")


def _trace(self: logging.Logger, message: object, *args: object, **kw: object) -> None:
    """Log a message at TRACE level (5)."""
    if self.isEnabledFor(TRACE):
        self._log(TRACE, message, args, **kw)  # type: ignore[arg-type]


# Add trace method to Logger class
logging.Logger.trace = _trace  # type: ignore[attr-defined]


class ISO8601Formatter(logging.Formatter):
    """Custom formatter producing ISO8601 timestamps in UTC.

    Output format: 2026-01-06T14:05:52Z [source] LEVEL message
    """

    def __init__(self, source: str = "app"):
        """Initialize formatter with a source identifier.

        Args:
            source: Identifier shown in brackets (e.g., "api", "sync", "pocketbase")
        """
        self.source = source
        super().__init__()

    def format(self, record: logging.LogRecord) -> str:
        """Format a log record with ISO8601 UTC timestamp."""
        # ISO8601 UTC timestamp
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Level name
        level = record.levelname

        # Format the message with any arguments
        message = record.getMessage()

        # Handle exceptions
        if record.exc_info:
            exception_text = self.formatException(record.exc_info)
            message = f"{message}\n{exception_text}"

        return f"{timestamp} [{self.source}] {level} {message}"


class HealthCheckFilter(logging.Filter):
    """Filter to suppress health check logs at INFO level.

    Health check endpoints generate a lot of noise (every 10-15 seconds).
    This filter suppresses them unless LOG_LEVEL=DEBUG is set.
    """

    HEALTH_PATHS = {"/health", "/api/health"}

    def filter(self, record: logging.LogRecord) -> bool:
        """Filter out health check logs at INFO level.

        Args:
            record: The log record to evaluate

        Returns:
            True if the record should be logged, False to suppress
        """
        # Always allow DEBUG level logs (when debug is enabled)
        if record.levelno == logging.DEBUG:
            return True

        # Check if this is an access log for health endpoints
        message = record.getMessage()
        return all(not (path in message and ("GET" in message or "200" in message)) for path in self.HEALTH_PATHS)


def configure_logging(
    source: str = "app",
    level: int | None = None,
    debug: bool | None = None,
) -> logging.Logger:
    """Configure logging for a service component.

    Args:
        source: Source identifier for log messages (e.g., "api", "sync", "solver")
        level: Logging level (defaults to INFO, or DEBUG/TRACE from LOG_LEVEL env var)
        debug: Enable debug mode (overrides level to DEBUG)

    Returns:
        Configured root logger
    """
    # Determine level from environment or parameters
    if level is None:
        log_level_env = os.getenv("LOG_LEVEL", "").upper()
        if log_level_env == "TRACE":
            level = TRACE
        elif log_level_env == "DEBUG" or debug:
            level = logging.DEBUG
        else:
            level = logging.INFO

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Clear existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Create stdout handler with our formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(ISO8601Formatter(source=source))
    handler.addFilter(HealthCheckFilter())

    root_logger.addHandler(handler)

    # Configure Uvicorn loggers to use our handler (prevents bypass of HealthCheckFilter)
    # Uvicorn creates its own handlers by default - we need to replace them
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(uvicorn_logger_name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.addHandler(handler)
        uvicorn_logger.setLevel(level)
        uvicorn_logger.propagate = False  # Prevent double logging

    # Suppress noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)  # Suppress full prompt dumps

    return root_logger


def get_logger(name: str) -> logging.Logger:
    """Get a logger for the given module name.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Logger instance
    """
    return logging.getLogger(name)
