"""Row 16 (#3208): dead metrics surface stays deleted.

Nothing rendered these fields or called the comparison route; they were
computed on every request for no reader.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.schemas.metrics import (
    RegistrationMetricsResponse,
    RetentionMetricsResponse,
    RetentionTrendsResponse,
)


@pytest.fixture
def client():
    os.environ["AUTH_MODE"] = "bypass"
    os.environ["SKIP_PB_AUTH"] = "true"
    with patch("api.routers.metrics.schedule_aid_warm"):
        from api.main import create_app

        yield TestClient(create_app())
    os.environ.pop("AUTH_MODE", None)
    os.environ.pop("SKIP_PB_AUTH", None)


def test_comparison_route_is_gone(client):
    resp = client.get("/api/metrics/comparison", params={"year_a": 2025, "year_b": 2026})
    assert resp.status_code == 404


def test_comparison_schema_and_service_are_gone():
    import api.schemas as schemas
    import api.schemas.metrics as metrics_schemas

    assert not hasattr(schemas, "ComparisonMetricsResponse")
    assert not hasattr(metrics_schemas, "ComparisonMetricsResponse")
    with pytest.raises(ImportError):
        import api.services.comparison_service  # noqa: F401


def test_retention_trends_drops_unread_fields():
    fields = RetentionTrendsResponse.model_fields
    for name in ("avg_retention_rate", "trend_direction", "by_gender_grouped", "by_grade_grouped"):
        assert name not in fields


def test_retention_response_drops_compare_year_total():
    assert "compare_year_total" not in RetentionMetricsResponse.model_fields


def test_registration_response_drops_unrendered_by_session_length():
    fields = RegistrationMetricsResponse.model_fields
    assert "by_session_length" not in fields
    assert "by_session_length_by_session" in fields
    assert "by_gender_by_session_length" in fields
