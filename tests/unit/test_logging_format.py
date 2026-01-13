"""Tests for unified logging format.

TDD tests - written BEFORE implementation.
Target format: 2026-01-06T14:05:52Z [source] LEVEL message
"""

from __future__ import annotations

import io
import logging
import re
from datetime import datetime


class TestISO8601Formatter:
    """Test the custom ISO8601 formatter produces correct output."""

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
        parsed = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        assert parsed is not None

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
        """Default level should be INFO."""
        from bunking.logging_config import configure_logging

        logger = configure_logging(source="test", debug=False)
        assert logger.level == logging.INFO

    def test_get_logger_returns_named_logger(self):
        """get_logger should return a logger with the given name."""
        from bunking.logging_config import get_logger

        logger = get_logger("test.module")
        assert logger.name == "test.module"


class TestIntegration:
    """Integration tests for the logging system."""

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
