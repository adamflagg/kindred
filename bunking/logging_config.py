"""
Centralized logging configuration for Kindred.

Provides unified logging format across all Python services:
Format: 2026-01-06T14:05:52Z [source] LEVEL message

Environment Variables:
    LOG_LEVEL: Set to "DEBUG", "TRACE", or "INFO" (default)
               - INFO: Normal operation logs
               - DEBUG: Detailed diagnostic information
               - TRACE: Very verbose low-level diagnostics (API params, etc.)
    LOG_COMPACT: Set to "true" (default) or "false"
               - true: Omit timestamp and top-level source label (for Docker)
               - false: Full format with timestamp and source (for local dev)

Usage:
    from bunking.logging_config import configure_logging, get_logger

    configure_logging(source="api")
    logger = get_logger(__name__)
    logger.info("Application started")
"""

import logging
import os
import re
import sys
from datetime import UTC, datetime
from typing import ClassVar

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
        self.compact = os.environ.get("LOG_COMPACT", "true").lower() not in ("false", "0")
        super().__init__()

    def format(self, record: logging.LogRecord) -> str:
        """Format a log record with ISO8601 UTC timestamp."""
        # ISO8601 UTC timestamp
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Level name
        level = record.levelname

        # Format the message with any arguments
        message = record.getMessage()

        # Add [DEBUG] prefix for DEBUG level to match Go output style
        # Go uses: slog.Info("[DEBUG] " + msg) for debug logging
        if record.levelno == logging.DEBUG:
            message = f"[DEBUG] {message}"

        # Handle exceptions
        if record.exc_info:
            exception_text = self.formatException(record.exc_info)
            message = f"{message}\n{exception_text}"

        if self.compact:
            if "/" in self.source:
                return f"[{self.source}] {level} {message}"
            return f"{level} {message}"

        return f"{timestamp} [{self.source}] {level} {message}"


class HealthCheckFilter(logging.Filter):
    """Filter to suppress high-frequency access log noise at INFO level.

    Covers two recurring sources:
    - Health check endpoints (every 10-15 seconds from Docker probes).
    - Solver run status polls (~1/s for the duration of every solve).

    Only successful (200) GET requests are filtered. ``HEALTH_EXACT_PATHS``
    matches whole paths so ``/healthz`` or ``/api/healthcheck`` stay visible;
    ``HEALTH_PATH_PREFIXES`` matches the per-run solver poll (the UUID-bearing
    suffix) without catching the bare POST that kicks off a run.

    Set LOG_LEVEL=DEBUG to see all access logs.
    """

    HEALTH_EXACT_PATHS: ClassVar[set[str]] = {"/health", "/api/health"}
    HEALTH_PATH_PREFIXES: ClassVar[tuple[str, ...]] = ("/api/solver/run/",)
    _ACCESS_LOG_RE: ClassVar[re.Pattern[str]] = re.compile(
        r'"(?P<method>[A-Z]+) (?P<path>\S+) HTTP/\d\.\d" (?P<status>\d{3})'
    )

    def filter(self, record: logging.LogRecord) -> bool:
        """Filter out health check logs at INFO level.

        Args:
            record: The log record to evaluate

        Returns:
            True if the record should be logged, False to suppress
        """
        # In DEBUG/TRACE mode, keep all access logs visible. Uvicorn access
        # records are always INFO regardless of LOG_LEVEL, so we must check
        # the root logger's effective level rather than `record.levelno`.
        if logging.getLogger().getEffectiveLevel() <= logging.DEBUG:
            return True

        # Suppression is only intended for INFO access-log noise; pass through
        # anything at WARNING or higher (and the artificial DEBUG records).
        if record.levelno != logging.INFO:
            return True

        # Parse the uvicorn access-log line; if it doesn't match, leave it alone.
        match = self._ACCESS_LOG_RE.search(record.getMessage())
        if not match:
            return True
        if match.group("method") != "GET" or match.group("status") != "200":
            return True

        path = match.group("path")
        if path in self.HEALTH_EXACT_PATHS:
            return False
        return not any(path.startswith(prefix) for prefix in self.HEALTH_PATH_PREFIXES)


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
