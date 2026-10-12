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


# Query parameters whose values never reach a log. ``q``/``search``/``name``/``email``/``actor``
# carry what staff typed or a staff identity; ``filter`` is the PocketBase filter the API
# builds for a name search, which a failing SDK call echoes back inside its error's URL;
# the rest are credentials. Shared by the access-log filter and the catch-all below.
SENSITIVE_QUERY_PARAMS: frozenset[str] = frozenset(
    {
        "q",
        "search",
        "actor",
        "email",
        "name",
        "filter",
        "token",
        "access_token",
        "refresh_token",
        "code",
        "state",
    }
)
REDACTED_VALUE = "[REDACTED]"

_QUERY_KEY_RE = re.compile(r"(?<=[?&])([A-Za-z_][A-Za-z0-9_.-]*)=")
# A quote opens a quoted segment only where a filter expression would put one (after an
# operator, an opening paren or a space); anywhere else at top level it closes the URL
# itself, as in ``URL('...?filter=x')`` or ``"url": "...?filter=x"``.
_QUOTE_OPENERS = frozenset("=~<>!(,|&")
# Filter operator characters. Top-level whitespace next to one of these is inside the
# expression (``first_name ~ "x" && year = 2025``), not the end of the value.
_FILTER_OPERATORS = frozenset("=~<>!?&|")


def _space_inside_expression(text: str, start: int, i: int) -> bool:
    """Whether the top-level whitespace at ``i`` sits between filter operands."""
    before = text[start:i].rstrip(" \t")
    j = i
    while j < len(text) and text[j] in " \t":
        j += 1
    if not before or j >= len(text):
        return False
    return before[-1] in _FILTER_OPERATORS or text[j] in _FILTER_OPERATORS


def _query_value_end(text: str, start: int) -> int:
    """Index just past the query value that begins at ``start``.

    A URL-encoded value ends at the next ``&``, whitespace or line end. An
    unencoded PocketBase filter can also hold quoted strings with spaces,
    parenthesised groups with spaces, ``&&``, and spaces around its operators;
    those are consumed whole so no part of a name is left behind. Errs towards
    redacting too much.
    """
    depth = 0
    quote = ""
    i, n = start, len(text)
    while i < n:
        c = text[i]
        if c == "\n":
            break
        if quote:
            if c == quote:
                quote = ""
        elif c in "\"'":
            prev = text[i - 1] if i > 0 else "="
            if prev in _QUOTE_OPENERS or prev.isspace():
                quote = c
            elif depth == 0:
                break
        elif c == "(":
            depth += 1
        elif c == ")":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and c.isspace():
            if not _space_inside_expression(text, start, i):
                break
        elif depth == 0 and c == "&":
            if not text.startswith("&&", i):
                break
            i += 1
        i += 1
    return i


def redact_sensitive_query_values(text: str) -> str:
    """Replace the value of every sensitive query parameter found in ``text``.

    Works on free text -- a log message, an exception's ``str()``, a whole
    traceback -- not only on a bare URL. Parameter names and every other
    parameter are kept, so the line still says what was requested.
    """
    if "=" not in text:
        return text
    out: list[str] = []
    copied = pos = 0
    while (m := _QUERY_KEY_RE.search(text, pos)) is not None:
        if m.group(1).lower() not in SENSITIVE_QUERY_PARAMS:
            pos = m.end()
            continue
        end = _query_value_end(text, m.end())
        out.append(text[copied : m.end()])
        out.append(REDACTED_VALUE)
        copied = pos = end
    if not out:
        return text
    out.append(text[copied:])
    return "".join(out)


class SensitiveQueryRedactingFormatter(logging.Formatter):
    """Wrap a handler's formatter so its finished line has sensitive query values redacted.

    It runs on the fully formatted output, so it covers the message, its ``%``
    arguments, the exception text and stack info alike -- whatever the wrapped
    formatter chooses to print. The traceback text the stdlib caches on the
    record is redacted too, so no other handler can reuse an unredacted copy.
    """

    def __init__(self, inner: logging.Formatter | None = None) -> None:
        super().__init__()
        self.inner = inner or logging.Formatter()

    def format(self, record: logging.LogRecord) -> str:
        """Format with the wrapped formatter, then redact."""
        line = self.inner.format(record)
        if record.exc_text:
            record.exc_text = redact_sensitive_query_values(record.exc_text)
        return redact_sensitive_query_values(line)


def install_sensitive_query_redaction() -> None:
    """Wrap the formatter of every handler currently attached to any logger.

    Idempotent. ``configure_logging`` calls it last; a process that sets logging
    up another way (``logging.basicConfig``) calls it after that setup. A handler
    added afterwards is not covered, so add handlers before calling it.
    """
    loggers: list[logging.Logger] = [logging.getLogger()]
    loggers += [lg for lg in logging.Logger.manager.loggerDict.values() if isinstance(lg, logging.Logger)]
    for lg in loggers:
        for handler in lg.handlers:
            if not isinstance(handler.formatter, SensitiveQueryRedactingFormatter):
                handler.setFormatter(SensitiveQueryRedactingFormatter(handler.formatter))


class AccessLogQueryRedactionFilter(logging.Filter):
    """Replace free-text and credential query values in uvicorn access-log lines.

    Uvicorn logs every request at INFO with its full path and query string.
    Some query values are what staff typed -- the pipeline debug person search
    sends a camper's name as ``?q=`` on each keystroke, the audit log filters by
    a staff email in ``?actor=`` -- and an OAuth-style ``code``/``state`` or a
    ``token`` must never reach a log. Parameter names are kept, so a line still
    says what was asked for; only the listed values are replaced.

    Attached to the ``uvicorn.access`` logger, it rewrites the path argument of
    uvicorn's ``'%s - "%s %s HTTP/%s" %d'`` call and never drops a record.
    """

    REDACTED_PARAMS: ClassVar[frozenset[str]] = SENSITIVE_QUERY_PARAMS
    REDACTED_VALUE: ClassVar[str] = REDACTED_VALUE
    _PATH_ARG_INDEX: ClassVar[int] = 2

    @classmethod
    def redact_path(cls, path: str) -> str:
        """Return ``path`` with each listed query parameter's value replaced."""
        base, sep, query = path.partition("?")
        if not sep:
            return path
        parts = []
        for pair in query.split("&"):
            key, eq, _value = pair.partition("=")
            redact = eq and key.lower() in cls.REDACTED_PARAMS
            parts.append(f"{key}={cls.REDACTED_VALUE}" if redact else pair)
        return f"{base}?{'&'.join(parts)}"

    def filter(self, record: logging.LogRecord) -> bool:
        """Rewrite the path argument in place; always keep the record."""
        args = record.args
        if isinstance(args, tuple) and len(args) > self._PATH_ARG_INDEX:
            path = args[self._PATH_ARG_INDEX]
            if isinstance(path, str) and "?" in path:
                i = self._PATH_ARG_INDEX
                record.args = (*args[:i], self.redact_path(path), *args[i + 1 :])
        return True


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

    # Logger-level, so it runs before any handler formats the line. Idempotent:
    # configure_logging may be called more than once in a process.
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, AccessLogQueryRedactionFilter) for f in access_logger.filters):
        access_logger.addFilter(AccessLogQueryRedactionFilter())

    # Catch-all, last so it wraps every handler set up above (root's, which uvicorn's
    # loggers share): a failed PocketBase call's error carries its request URL, and a
    # name search's URL carries the name in ``filter``, in the message or the traceback.
    install_sensitive_query_redaction()

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
