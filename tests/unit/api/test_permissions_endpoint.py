"""GET /api/permissions: the registry the Users page explains RBAC from (spec 2026-10-01 §3.1)."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from bunking.rbac.permissions import ALL_PERMISSIONS, PERMISSION_AREAS, PERMISSION_DESCRIPTIONS, PERMISSION_INFO


@pytest.fixture
def client():
    with patch.dict("os.environ", {"SKIP_PB_AUTH": "true"}):
        from api.main import create_app

        yield TestClient(create_app())


def test_returns_every_permission_with_its_copy(client):
    body = client.get("/api/permissions").json()
    assert body["total"] == len(ALL_PERMISSIONS)
    by_code = {p["codename"]: p for p in body["permissions"]}
    assert set(by_code) == set(ALL_PERMISSIONS)
    geo = by_code["metrics.geo"]
    assert geo["description"] == PERMISSION_DESCRIPTIONS["metrics.geo"]
    assert geo["label"] == "Geographic data"
    assert geo["short"] == "Geographic data"
    assert geo["area"] == "Analytics"
    assert geo["screens"] == [{"name": "Manage › Geo Data", "path": "/manage/geo"}]
    assert by_code["metrics.financial"]["screens"] == []


def test_orders_by_area_then_registry(client):
    body = client.get("/api/permissions").json()
    areas = [p["area"] for p in body["permissions"]]
    assert areas == sorted(areas, key=PERMISSION_AREAS.index)
    expected = [c for a in PERMISSION_AREAS for c, i in PERMISSION_INFO.items() if i.area == a]
    assert [p["codename"] for p in body["permissions"]] == expected


def test_carries_areas_and_admin_only(client):
    body = client.get("/api/permissions").json()
    assert body["areas"] == list(PERMISSION_AREAS)
    assert body["admin_only"][0] == "Manage › Sync"
