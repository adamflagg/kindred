"""The FastAPI half of the view-as gate must agree with the Go half.

Both load pocketbase/rbac/testdata/view_as_vectors.json.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from bunking.rbac.view_as import VIEW_AS_HEADER, ViewAsDecision, decide_view_as, parse_view_as

VECTORS_PATH = Path(__file__).resolve().parents[3] / "pocketbase" / "rbac" / "testdata" / "view_as_vectors.json"


def _user_vectors() -> list[Any]:
    vectors = json.loads(VECTORS_PATH.read_text())
    # FastAPI never holds a superuser or anonymous AuthUser: the middleware
    # rejects the first and 401s the second before view-as runs. Only the
    # "user" vectors apply here; the Go suite runs every one.
    return [pytest.param(v, id=v["name"]) for v in vectors if v["auth"] == "user"]


@pytest.mark.parametrize("vector", _user_vectors())
def test_decide_view_as_matches_shared_vectors(vector: dict[str, Any]) -> None:
    got = decide_view_as(vector["real_is_admin"], vector["real_permissions"], vector["header"])
    want = vector["want"]
    assert got == ViewAsDecision(
        applied=want["applied"], is_admin=want["is_admin"], permissions=frozenset(want["permissions"])
    )


def test_vectors_cover_the_user_cases() -> None:
    assert len(_user_vectors()) >= 8


def test_header_name_matches_the_go_constant() -> None:
    assert VIEW_AS_HEADER == "X-Kindred-View-As"


def test_parse_view_as_absent_is_none() -> None:
    assert parse_view_as(None) is None
