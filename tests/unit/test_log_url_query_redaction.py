"""Every log line, not just the access log, must drop name-bearing query values.

When a PocketBase call made from Python fails, the SDK raises a
``ClientResponseError`` whose ``str()`` includes the full request URL. A name
search puts the name in that URL's ``filter``. Whoever logs the error -- a
``logger.exception`` in a repository, the global FastAPI exception handler, an
``exc_info=True`` anywhere -- would then write the name to the log, in the
message, in the ``%s`` arguments, or in the traceback.

The catch-all redaction runs on the formatted line of every handler that
``configure_logging`` installs, so it covers all of those paths at once. It
replaces the values of ``filter`` and of every parameter the access-log filter
already redacts, and keeps the parameter names and the other values.
"""

import io
import logging
from collections.abc import Iterator

import pytest
from pocketbase.errors import ClientResponseError

ENCODED_URL = (
    "http://127.0.0.1:8090/api/collections/persons/records"
    "?page=1&perPage=50&filter=%28first_name~%22Emma%22+%26%26+last_name~%22Johnson%22%29&skipTotal=1"
)
PLAIN_URL = 'http://127.0.0.1:8090/api/collections/persons/records?filter=(first_name~"Emma")&perPage=50'


def _redact(text: str) -> str:
    from bunking.logging_config import redact_sensitive_query_values

    return redact_sensitive_query_values(text)


class TestRedactSensitiveQueryValues:
    def test_encoded_filter_value_is_redacted(self) -> None:
        out = _redact(f"URL: {ENCODED_URL}")

        assert "Emma" not in out
        assert "Johnson" not in out
        assert "filter=[REDACTED]" in out
        assert "page=1&perPage=50" in out, "parameters before the filter stay readable"
        assert "skipTotal=1" in out, "parameters after the filter stay readable"

    def test_unencoded_filter_value_is_redacted(self) -> None:
        out = _redact(f"URL: {PLAIN_URL}")

        assert "Emma" not in out
        assert out == "URL: http://127.0.0.1:8090/api/collections/persons/records?filter=[REDACTED]&perPage=50"

    @pytest.mark.parametrize(
        "value",
        [
            '(first_name ~ "Emma Johnson")',
            '((first_name ~ "Emma") && (last_name ~ "Johnson"))',
            'first_name~"Emma"&&last_name~"Johnson"',
            "(first_name='Emma Johnson' || preferred_name='Emma')",
        ],
    )
    def test_unencoded_filter_with_spaces_quotes_and_operators_is_redacted(self, value: str) -> None:
        out = _redact(f"GET /api/collections/persons/records?filter={value}&perPage=50 failed")

        assert "Emma" not in out
        assert "Johnson" not in out
        assert "?filter=[REDACTED]&perPage=50 failed" in out

    def test_value_at_end_of_line_is_redacted(self) -> None:
        out = _redact("URL: http://pb.example.com/api/x?perPage=50&filter=first_name~%22Emma%22\nStatus: 400")

        assert "Emma" not in out
        assert out == "URL: http://pb.example.com/api/x?perPage=50&filter=[REDACTED]\nStatus: 400"

    def test_access_log_shaped_line_keeps_protocol_and_status(self) -> None:
        line = '127.0.0.1:1 - "GET /api/debug/search-persons?q=Riley%20Chen&year=2025 HTTP/1.1" 200'

        assert _redact(line) == '127.0.0.1:1 - "GET /api/debug/search-persons?q=[REDACTED]&year=2025 HTTP/1.1" 200'

    def test_url_inside_a_repr_stops_at_the_closing_quote_and_paren(self) -> None:
        out = _redact("URL('http://pb.example.com/api/x?filter=name~%22Emma%22') failed")

        assert "Emma" not in out
        assert out == "URL('http://pb.example.com/api/x?filter=[REDACTED]') failed"

    @pytest.mark.parametrize("param", ["q", "search", "actor", "email", "name", "token", "code", "state", "FILTER"])
    def test_shares_the_access_log_parameter_list(self, param: str) -> None:
        out = _redact(f"call to http://pb.example.com/api/x?{param}=secret-ish&page=2 failed")

        assert "secret-ish" not in out
        assert f"{param}=[REDACTED]&page=2 failed" in out

    def test_access_log_filter_also_covers_filter(self) -> None:
        from bunking.logging_config import AccessLogQueryRedactionFilter

        assert "filter" in AccessLogQueryRedactionFilter.REDACTED_PARAMS

    @pytest.mark.parametrize(
        "text",
        [
            "Solver complete: OPTIMAL, wall=3.2s, workers=8",
            "filter=abc outside a URL query is left alone",
            "http://pb.example.com/api/collections/persons/records?page=1&perPage=50&sort=-created&expand=household",
            "progress 50% of 100%",
        ],
    )
    def test_text_without_sensitive_query_values_is_unchanged(self, text: str) -> None:
        assert _redact(text) == text

    def test_redaction_is_idempotent(self) -> None:
        once = _redact(f"URL: {PLAIN_URL}")
        assert _redact(once) == once


@pytest.fixture
def captured_root() -> Iterator[io.StringIO]:
    """Configure logging the way kindred-api does and capture what its handler writes."""
    from bunking.logging_config import configure_logging

    configure_logging(source="api")
    stream = io.StringIO()
    handlers = [h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler)]
    assert handlers, "configure_logging should install a stream handler on the root logger"
    previous = [h.setStream(stream) for h in handlers]
    try:
        yield stream
    finally:
        for handler, old_stream in zip(handlers, previous, strict=True):
            if old_stream is not None:
                handler.setStream(old_stream)


def _pocketbase_error(url: str) -> ClientResponseError:
    return ClientResponseError(
        "Response error. Status code:400",
        url=url,
        status=400,
        data={"code": 400, "message": "Something went wrong while processing your request."},
    )


class TestConfiguredHandlersRedactEveryRecord:
    @pytest.mark.parametrize("url", [ENCODED_URL, PLAIN_URL])
    def test_logger_exception_with_pocketbase_error(self, captured_root: io.StringIO, url: str) -> None:
        log = logging.getLogger("bunking.sync.test_catch_all")
        try:
            raise _pocketbase_error(url)
        except ClientResponseError as e:
            log.exception("PocketBase lookup failed: %s", e)

        output = captured_root.getvalue()
        assert "Traceback" in output, "the traceback is still logged"
        assert "ClientResponseError" in output
        assert "Status: 400" in output
        assert "filter=[REDACTED]" in output
        assert "perPage=50" in output
        assert "Emma" not in output
        assert "Johnson" not in output

    def test_exc_info_on_a_plain_message(self, captured_root: io.StringIO) -> None:
        """The global exception handler's shape: the error is only in the traceback."""
        log = logging.getLogger("api.main")
        try:
            raise _pocketbase_error(PLAIN_URL)
        except ClientResponseError:
            log.error("Unhandled error on GET /api/sessions", exc_info=True)

        output = captured_root.getvalue()
        assert "Unhandled error on GET /api/sessions" in output
        assert "filter=[REDACTED]" in output
        assert "Emma" not in output

    def test_percent_args_are_redacted_and_still_formatted(self, captured_root: io.StringIO) -> None:
        logging.getLogger("bunking.test").warning("Request to %s returned %d", ENCODED_URL, 400)

        output = captured_root.getvalue()
        assert "Emma" not in output
        assert "filter=[REDACTED]&skipTotal=1 returned 400" in output

    def test_uvicorn_error_logger_is_covered(self, captured_root: io.StringIO) -> None:
        try:
            raise _pocketbase_error(ENCODED_URL)
        except ClientResponseError:
            logging.getLogger("uvicorn.error").exception("Exception in ASGI application")

        output = captured_root.getvalue()
        assert "Exception in ASGI application" in output
        assert "Emma" not in output


def test_install_wraps_a_plain_basicconfig_style_handler() -> None:
    """The request-processor CLI configures logging with basicConfig; it is covered too."""
    from bunking.logging_config import install_sensitive_query_redaction

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(levelname)s - %(message)s"))
    log = logging.getLogger("tests.catch_all.basicconfig")
    log.propagate = False
    log.addHandler(handler)
    try:
        install_sensitive_query_redaction()
        install_sensitive_query_redaction()  # idempotent
        try:
            raise _pocketbase_error(PLAIN_URL)
        except ClientResponseError:
            log.exception("lookup failed")
    finally:
        log.removeHandler(handler)

    output = stream.getvalue()
    assert output.startswith("ERROR - lookup failed")
    assert "filter=[REDACTED]" in output
    assert "Emma" not in output
    assert output.count("[REDACTED]") == 1


def test_request_processor_cli_installs_the_redaction(monkeypatch: pytest.MonkeyPatch) -> None:
    from bunking.logging_config import SensitiveQueryRedactingFormatter
    from bunking.sync.bunk_request_processor import process_requests

    root = logging.getLogger()
    saved = root.handlers[:]
    root.handlers.clear()
    monkeypatch.setattr("sys.argv", ["process_requests", "--session", "all", "--source-field", "not_a_field"])
    try:
        with pytest.raises(SystemExit):
            process_requests.main()
        installed = root.handlers[:]
    finally:
        root.handlers[:] = saved

    assert installed, "basicConfig should have installed a root handler"
    assert all(isinstance(h.formatter, SensitiveQueryRedactingFormatter) for h in installed)
