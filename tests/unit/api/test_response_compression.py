"""Responses are compressed on the wire (#1966).

The weekend roster is ~107 KB of JSON and shipped `content-encoding: none`:
neither Caddyfile carried `encode` and the app had no GZip middleware, so the
whole payload crossed the network raw. JSON of that shape compresses roughly
9:1, and the cost is paid on every cold load of every weekend.

This asserts the BEHAVIOUR -- an actual compressed response -- rather than the
presence of a middleware class, because a middleware installed with a
`minimum_size` above the payload is installed and does nothing.
"""

import json

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.main import create_app


def _app_with_probe_route():
    """The real app plus one route returning a roster-sized JSON body.

    Sized and shaped like the real payload rather than a run of one repeated
    character: a string of 100,000 identical bytes compresses ~1000:1 and would
    pass this test against a middleware that never fires on realistic data.
    """
    app = create_app()

    @app.get("/__compression_probe")
    async def probe() -> JSONResponse:
        parties = [
            {
                "display_name": f"Household {index}",
                # Fictional ids, per tests/CLAUDE.md. Offset from the sanctioned
                # 1000001 so 400 households stay distinct -- collapsing them onto
                # two ids would shrink the payload this fixture exists to size.
                "household_cm_id": 1_000_001 + index,
                "unit_code": f"unit-{index % 40}",
                "request_text": "Would like to be near friends; ground floor if possible.",
            }
            for index in range(400)
        ]
        return JSONResponse(content={"parties": parties})

    return app


def test_large_json_response_is_gzipped() -> None:
    client = TestClient(_app_with_probe_route())

    response = client.get("/__compression_probe", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip", "roster-sized JSON crossed the wire uncompressed"


@pytest.mark.parametrize(
    "accept_encoding",
    [
        pytest.param("identity", id="explicit-identity"),
        # Plain `curl` sends NO Accept-Encoding header rather than `identity`.
        # An empty value exercises the same branch: the middleware asks whether
        # "gzip" appears in the header, defaulting to "" when it is absent, so
        # absent and empty are indistinguishable to it.
        pytest.param("", id="header-absent-or-empty"),
    ],
)
def test_compression_is_negotiated_not_forced(accept_encoding: str) -> None:
    """A client that did not ask for gzip must still get a readable body.

    This is how the measurements in #1966 were taken, so a forced encoding
    would have made those numbers unreproducible as well as breaking clients.
    """
    client = TestClient(_app_with_probe_route())

    response = client.get("/__compression_probe", headers={"Accept-Encoding": accept_encoding})

    assert response.status_code == 200
    assert "content-encoding" not in response.headers
    assert len(json.loads(response.content)["parties"]) == 400
