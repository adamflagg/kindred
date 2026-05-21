"""Tests for unified logging format.

TDD tests - written BEFORE implementation.
Target format: 2026-01-06T14:05:52Z [source] LEVEL message

When LOG_COMPACT=true (default), omits timestamp and top-level source labels.
Sub-labels (containing "/") are preserved even in compact mode.
"""

import io
import logging
import os
import re
from datetime import datetime
from unittest.mock import patch


class TestISO8601Formatter:
    """Test the custom ISO8601 formatter produces correct output."""

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_format_matches_specification(self):
        """Verify output matches: 2026-01-06T14:05:52Z [source] LEVEL message"""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Test message",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Verify format with regex
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[test\] INFO Test message$"
        assert re.match(pattern, output), f"Output '{output}' doesn't match expected format"

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_timestamp_is_utc(self):
        """Verify timestamp is in UTC (ends with Z)."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Test",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)
        timestamp_str = output.split(" ")[0]

        # Must end with Z (UTC indicator)
        assert timestamp_str.endswith("Z"), f"Timestamp '{timestamp_str}' should end with Z"

        # Verify it's a valid ISO8601 timestamp
        parsed = datetime.fromisoformat(timestamp_str)
        assert parsed is not None

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_different_log_levels(self):
        """Verify all log levels are formatted correctly."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")

        for level, level_name in [
            (logging.DEBUG, "DEBUG"),
            (logging.INFO, "INFO"),
            (logging.WARNING, "WARNING"),
            (logging.ERROR, "ERROR"),
            (logging.CRITICAL, "CRITICAL"),
        ]:
            record = logging.LogRecord(
                name="test",
                level=level,
                pathname="",
                lineno=0,
                msg="Message",
                args=(),
                exc_info=None,
            )
            output = formatter.format(record)
            assert f"] {level_name} " in output, f"Level {level_name} not found in output"

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_source_tag_in_brackets(self):
        """Verify source is wrapped in square brackets."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Test",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)
        assert "[api]" in output, f"Source tag [api] not found in '{output}'"

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_message_formatting_with_args(self):
        """Verify message formatting works with arguments."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="User %s logged in from %s",
            args=("alice", "192.168.1.1"),
            exc_info=None,
        )

        output = formatter.format(record)
        assert "User alice logged in from 192.168.1.1" in output


class TestHealthCheckFilter:
    """Test health check log filtering."""

    def test_suppresses_health_endpoint_at_info_level(self):
        """Health check logs should be suppressed at INFO level."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        # Simulate uvicorn access log for health endpoint
        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /health HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        # At INFO level, should be filtered out (return False)
        result = filter_instance.filter(record)
        assert result is False, "Health check log should be suppressed at INFO level"

    def test_suppresses_api_health_endpoint(self):
        """Should also suppress /api/health endpoint."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='192.168.32.3:40210 - "GET /api/health HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is False, "/api/health should also be suppressed"

    def test_allows_non_health_endpoints(self):
        """Non-health endpoint logs should pass through."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /api/sessions HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "Non-health endpoints should not be filtered"

    def test_allows_health_at_debug_level(self):
        """Health checks should pass through when log level is DEBUG."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /health HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "Health checks should pass at DEBUG level"

    def test_suppresses_solver_run_poll(self):
        """GET /api/solver/run/<uuid> polls fire ~1/s for the duration of a solve and flood logs."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='172.20.0.4:36134 - "GET /api/solver/run/2e8660bd-fea0-45d9-a622-09c69e67b961 HTTP/1.1" 200',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is False, "Solver run status polls should be suppressed at INFO"

    def test_allows_solver_run_post(self):
        """POST /api/solver/run (kicking off a run) must remain visible — distinct path shape."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='172.20.0.4:41182 - "POST /api/solver/run HTTP/1.1" 200',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "POST /api/solver/run kickoff should not be suppressed"

    def test_allows_failing_solver_run_poll(self):
        """Failing GETs on the poll endpoint (4xx/5xx) must stay visible — only successful 200 polls are noise."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='172.20.0.4:36134 - "GET /api/solver/run/2e8660bd-fea0-45d9-a622-09c69e67b961 HTTP/1.1" 500',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "Failing solver run polls must remain visible at INFO"

    def test_allows_failing_health_check(self):
        """Failing GETs on /health (4xx/5xx) must stay visible too."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /health HTTP/1.1" 503',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "Failing health checks must remain visible at INFO"

    def test_does_not_suppress_healthz_lookalike(self):
        """/healthz must not be suppressed — HEALTH_PATHS uses /health, but substring matching would catch it."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /healthz HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "/healthz must not be filtered (only exact /health)"

    def test_does_not_suppress_healthcheck_lookalike(self):
        """/api/healthcheck must not be suppressed by the /api/health entry."""
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='127.0.0.1:56948 - "GET /api/healthcheck HTTP/1.1" 200 OK',
            args=(),
            exc_info=None,
        )

        result = filter_instance.filter(record)
        assert result is True, "/api/healthcheck must not be filtered (only exact /api/health)"

    def test_log_level_debug_bypasses_suppression(self):
        """When the root logger is at DEBUG, INFO access logs must pass through.

        Uvicorn emits access logs at INFO level regardless of LOG_LEVEL, so the
        bypass cannot rely on record.levelno — it must check the effective level.
        """
        from bunking.logging_config import HealthCheckFilter

        filter_instance = HealthCheckFilter()
        root = logging.getLogger()
        prev_level = root.level
        root.setLevel(logging.DEBUG)
        try:
            record = logging.LogRecord(
                name="uvicorn.access",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg='172.20.0.4:36134 - "GET /api/solver/run/2e8660bd-fea0-45d9-a622-09c69e67b961 HTTP/1.1" 200',
                args=(),
                exc_info=None,
            )
            result = filter_instance.filter(record)
            assert result is True, "DEBUG mode must show all access logs"
        finally:
            root.setLevel(prev_level)


class TestConfigureLogging:
    """Test the configure_logging function."""

    def test_configure_logging_returns_logger(self):
        """configure_logging should return a logger instance."""
        from bunking.logging_config import configure_logging

        logger = configure_logging(source="test")
        assert logger is not None
        assert isinstance(logger, logging.Logger)

    def test_configure_logging_sets_level_from_debug_flag(self):
        """Debug flag should set level to DEBUG."""
        from bunking.logging_config import configure_logging

        logger = configure_logging(source="test", debug=True)
        assert logger.level == logging.DEBUG

    def test_configure_logging_default_level_is_info(self):
        """Default level should be INFO when LOG_LEVEL is not set."""
        from bunking.logging_config import configure_logging

        with patch.dict("os.environ", {}, clear=True):
            logger = configure_logging(source="test", debug=False)
        assert logger.level == logging.INFO

    def test_get_logger_returns_named_logger(self):
        """get_logger should return a logger with the given name."""
        from bunking.logging_config import get_logger

        logger = get_logger("test.module")
        assert logger.name == "test.module"


class TestDebugPrefixFormatting:
    """Test that DEBUG level logs get [DEBUG] prefix for consistency with Go output."""

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_debug_level_message_has_debug_prefix(self):
        """DEBUG level messages should have [DEBUG] prefix in the message."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="Some debug info",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should contain [DEBUG] prefix in the message portion
        assert "[DEBUG]" in output, f"DEBUG level output should contain [DEBUG] prefix: {output}"
        # The [DEBUG] should appear after the level name
        assert "] DEBUG [DEBUG]" in output, f"[DEBUG] should appear after level name: {output}"

    def test_info_level_message_no_debug_prefix(self):
        """INFO level messages should NOT have [DEBUG] prefix."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Some info message",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should NOT contain [DEBUG] prefix
        assert "[DEBUG]" not in output, f"INFO level output should NOT contain [DEBUG] prefix: {output}"

    def test_warning_level_message_no_debug_prefix(self):
        """WARNING level messages should NOT have [DEBUG] prefix."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.WARNING,
            pathname="",
            lineno=0,
            msg="Some warning message",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should NOT contain [DEBUG] prefix
        assert "[DEBUG]" not in output, f"WARNING level output should NOT contain [DEBUG] prefix: {output}"

    def test_error_level_message_no_debug_prefix(self):
        """ERROR level messages should NOT have [DEBUG] prefix."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="test")
        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname="",
            lineno=0,
            msg="Some error message",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should NOT contain [DEBUG] prefix
        assert "[DEBUG]" not in output, f"ERROR level output should NOT contain [DEBUG] prefix: {output}"

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_debug_prefix_format_matches_go_style(self):
        """The [DEBUG] prefix should match Go's style: '[DEBUG] message'."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="sync")
        record = logging.LogRecord(
            name="test",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="Processing batch",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Go style: slog.Info("[DEBUG] " + msg) produces "[DEBUG] Processing batch"
        # Python should match: "... DEBUG [DEBUG] Processing batch"
        assert "[DEBUG] Processing batch" in output, f"Debug message should be prefixed with [DEBUG]: {output}"


class TestIntegration:
    """Integration tests for the logging system."""

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_end_to_end_log_output(self):
        """Test complete logging flow produces expected output."""
        from bunking.logging_config import configure_logging, get_logger

        # Capture output
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)

        # Configure logging
        configure_logging(source="integration_test", debug=False)
        logger = get_logger("test")

        # Replace handler to capture output
        root = logging.getLogger()
        root.handlers.clear()
        from bunking.logging_config import ISO8601Formatter

        handler.setFormatter(ISO8601Formatter(source="integration_test"))
        root.addHandler(handler)

        # Log a message
        logger.info("Test integration message")

        # Verify output format
        output = stream.getvalue()
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[integration_test\] INFO Test integration message\n$"
        assert re.match(pattern, output), f"Output '{output}' doesn't match expected format"


class TestCompactMode:
    """Test LOG_COMPACT mode for Docker log deduplication."""

    @patch.dict("os.environ", {"LOG_COMPACT": "true"})
    def test_compact_mode_omits_timestamp_and_source(self):
        """Compact mode with top-level source should omit timestamp and source label."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Server started",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should be just "INFO Server started" — no timestamp, no [api]
        assert output == "INFO Server started", f"Compact output should be 'INFO Server started', got '{output}'"

    @patch.dict("os.environ", {"LOG_COMPACT": "true"})
    def test_compact_mode_keeps_sub_labels(self):
        """Compact mode should preserve sub-labels like sync/sessions."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="sync/sessions")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Starting session sync",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should keep the sub-label but no timestamp
        assert output == "[sync/sessions] INFO Starting session sync", (
            f"Compact sub-label output should be '[sync/sessions] INFO Starting session sync', got '{output}'"
        )

    @patch.dict("os.environ", {"LOG_COMPACT": "false"})
    def test_compact_mode_disabled_shows_full_format(self):
        """LOG_COMPACT=false should produce full format with timestamp and source."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Server started",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        # Should have full format: timestamp [source] LEVEL message
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[api\] INFO Server started$"
        assert re.match(pattern, output), f"Full format output doesn't match: '{output}'"

    def test_compact_mode_defaults_to_true(self):
        """When LOG_COMPACT is unset, compact mode should default to true."""
        from bunking.logging_config import ISO8601Formatter

        # Remove LOG_COMPACT from env entirely
        env = os.environ.copy()
        env.pop("LOG_COMPACT", None)
        with patch.dict("os.environ", env, clear=True):
            formatter = ISO8601Formatter(source="api")
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="Test",
                args=(),
                exc_info=None,
            )

            output = formatter.format(record)

            # Default (unset) should be compact
            assert output == "INFO Test", f"Default should be compact, got '{output}'"

    @patch.dict("os.environ", {"LOG_COMPACT": "true"})
    def test_compact_mode_preserves_debug_prefix(self):
        """Compact mode should still add [DEBUG] prefix for DEBUG level."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")
        record = logging.LogRecord(
            name="test",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="Some debug info",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)

        assert output == "DEBUG [DEBUG] Some debug info", (
            f"Compact DEBUG should be 'DEBUG [DEBUG] Some debug info', got '{output}'"
        )

    @patch.dict("os.environ", {"LOG_COMPACT": "true"})
    def test_compact_mode_preserves_exception_info(self):
        """Compact mode should still include exception traceback."""
        from bunking.logging_config import ISO8601Formatter

        formatter = ISO8601Formatter(source="api")

        try:
            raise ValueError("test error")
        except ValueError:
            import sys

            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname="",
            lineno=0,
            msg="Something failed",
            args=(),
            exc_info=exc_info,
        )

        output = formatter.format(record)

        # Should start with compact format but include traceback
        assert output.startswith("ERROR Something failed"), f"Should start with compact format: '{output}'"
        assert "ValueError: test error" in output, f"Should include exception: '{output}'"
