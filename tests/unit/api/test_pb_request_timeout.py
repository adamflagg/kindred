"""The API's PocketBase clients wait a real bound for a page, not httpx's 5-second default.

The SDK builds ``httpx.Client(base_url=..., **kwargs)``, so a client built with no ``timeout`` gives up on any page
after 5 s. A full-season read whose page took 5-7 s under concurrent load turned Reports > Development into a 500.
These tests serve a page slower than 5 s from a real socket and read it through the API's own client factory.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from api import dependencies
from api.dependencies import PB_REQUEST_TIMEOUT_SECONDS, create_task_pb_client

HTTPX_DEFAULT_SECONDS = 5.0
SLOW_PAGE_SECONDS = 5.5  # slower than httpx's default, well inside the bound
PAGE = {"page": 1, "perPage": 1000, "totalItems": 1, "totalPages": 1, "items": [{"id": "rec000000000001"}]}


class _SlowPage(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        time.sleep(SLOW_PAGE_SECONDS)
        body = json.dumps(PAGE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def slow_pb_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SlowPage)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_the_bound_is_tens_of_seconds() -> None:
    assert 20 <= PB_REQUEST_TIMEOUT_SECONDS <= 120


def test_the_global_client_and_a_task_client_carry_the_bound() -> None:
    expected = httpx.Timeout(PB_REQUEST_TIMEOUT_SECONDS)
    assert dependencies.pb.http_client.timeout == expected
    assert create_task_pb_client().http_client.timeout == expected


def test_a_page_slower_than_httpx_default_but_inside_the_bound_is_read(
    slow_pb_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert HTTPX_DEFAULT_SECONDS < SLOW_PAGE_SECONDS < PB_REQUEST_TIMEOUT_SECONDS
    monkeypatch.setattr(dependencies, "pb_url", slow_pb_url)
    client = create_task_pb_client()
    page = client.collection("person_custom_values").get_list(1, 1000)
    assert [item.id for item in page.items] == ["rec000000000001"]
