"""The API access log must not record free-text or credential query values.

Uvicorn logs every request at INFO with its full path *and* query string. The
pipeline debug page's person search sends what staff type -- a camper's name --
as ``?q=`` on every keystroke, and the audit log filters by a staff email in
``?actor=``. The access-log filter keeps the parameter names (so the line still
says what was asked for) and replaces those values.
"""

import io
import logging

import pytest

ACCESS_FORMAT = '%s - "%s %s HTTP/%s" %d'


def _access_record(path: str) -> logging.LogRecord:
    """A record shaped exactly like uvicorn's access-log call."""
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg=ACCESS_FORMAT,
        args=("127.0.0.1:56948", "GET", path, "1.1", 200),
        exc_info=None,
    )


def _filtered_message(path: str) -> str:
    from bunking.logging_config import AccessLogQueryRedactionFilter

    record = _access_record(path)
    assert AccessLogQueryRedactionFilter().filter(record) is True, "redaction must never drop a line"
    return record.getMessage()


class TestAccessLogQueryRedactionFilter:
    def test_person_search_query_is_redacted(self) -> None:
        message = _filtered_message("/api/debug/search-persons?q=Emma%20Johnson&year=2025")

        assert "Emma" not in message
        assert "Johnson" not in message
        assert "q=[REDACTED]" in message
        assert "year=2025" in message, "non-sensitive parameters stay readable"

    @pytest.mark.parametrize(
        ("param", "value"),
        [
            ("search", "Liam"),
            ("actor", "test%40example.com"),
            ("token", "eyJhbGciOiJIUzI1NiJ9.e30.sig"),
            ("access_token", "abc123"),
            ("code", "oidc-code-xyz"),
            ("state", "oidc-state-xyz"),
            ("Q", "Olivia"),
        ],
    )
    def test_sensitive_parameters_are_redacted(self, param: str, value: str) -> None:
        message = _filtered_message(f"/api/x?page=2&{param}={value}&per_page=50")

        assert value not in message
        assert f"{param}=[REDACTED]" in message
        assert "page=2" in message
        assert "per_page=50" in message

    def test_path_without_query_is_unchanged(self) -> None:
        assert _filtered_message("/api/sessions") == '127.0.0.1:56948 - "GET /api/sessions HTTP/1.1" 200'

    def test_non_sensitive_query_is_unchanged(self) -> None:
        path = "/api/metrics/registration?year=2025&session_types=main,ag"
        assert path in _filtered_message(path)

    def test_record_without_uvicorn_args_passes_through(self) -> None:
        from bunking.logging_config import AccessLogQueryRedactionFilter

        record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "plain message", (), None)
        assert AccessLogQueryRedactionFilter().filter(record) is True
        assert record.getMessage() == "plain message"


def test_configure_logging_redacts_the_uvicorn_access_logger() -> None:
    """Wired end to end: a line logged through uvicorn's access logger comes out redacted."""
    from bunking.logging_config import configure_logging

    configure_logging(source="api")
    access_logger = logging.getLogger("uvicorn.access")
    stream = io.StringIO()
    handlers = [h for h in access_logger.handlers if isinstance(h, logging.StreamHandler)]
    assert handlers, "configure_logging should give uvicorn.access a stream handler"
    previous = [h.setStream(stream) for h in handlers]
    try:
        access_logger.info(
            ACCESS_FORMAT, "127.0.0.1:1", "GET", "/api/debug/search-persons?q=Riley&year=2025", "1.1", 200
        )
    finally:
        for handler, old_stream in zip(handlers, previous, strict=True):
            if old_stream is not None:
                handler.setStream(old_stream)

    output = stream.getvalue()
    assert "/api/debug/search-persons?q=[REDACTED]&year=2025" in output
    assert "Riley" not in output
