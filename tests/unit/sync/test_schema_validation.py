# mypy: ignore-errors
# NOTE: This test requires PocketBase running on localhost:8090 and skips in CI
from __future__ import annotations

#!/usr/bin/env python3
"""
Test schema validation for enhanced request system.
Ensures that invalid data is properly rejected and valid data is accepted.
"""

import os
import sys

import pytest
from pocketbase.utils import ClientResponseError  # type: ignore[attr-defined]

from pocketbase import PocketBase

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# PocketBase configuration
PB_URL = "http://localhost:8090"
PB_ADMIN_EMAIL = "admin@camp.local"
PB_ADMIN_PASSWORD = "campbunking123"


@pytest.fixture
def pb_client():
    """Create authenticated PocketBase client"""
    pytest.skip("Requires PocketBase instance running on localhost:8090")
    pb = PocketBase(PB_URL)
    pb.collection("_superusers").auth_with_password(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
    return pb


@pytest.fixture
def base_request_data():
    """Base valid request data for tests"""
    return {
        "requester_person_cm_id": 100001,
        "requested_person_cm_id": 0,
        "request_type": "positive",
        "priority": 1,
        "year": 2025,
        "original_text": "Test request",
        "status": "unresolved",
        "confidence_score": 0.0,
        "is_reciprocal": False,
        "session_cm_id": 0,
        "resolution_notes": "",
        "parse_notes": "",
        "keywords_found": {},
        "conflict_group_id": "",
        "requires_family_decision": False,
        "priority_locked": False,
        "priority_override_reason": "",
        "request_source": "csv_explicit",
        "prior_year_continuity": False,
        "prior_year_bunk_cm_id": 0,
        "eligible_continuity_campers": {},
        "selected_continuity_campers": {},
        "can_be_dropped": False,
        "was_dropped_for_spread": False,
    }


def test_invalid_status_value(pb_client, base_request_data):
    """Test that invalid status values are rejected"""
    base_request_data["status"] = "active"  # Invalid value

    with pytest.raises(ClientResponseError) as exc_info:
        pb_client.collection("bunk_requests").create(base_request_data)

    assert "status" in str(exc_info.value.data)


def test_valid_status_values(pb_client, base_request_data):
    """Test that all valid status values are accepted"""
    valid_statuses = ["unresolved", "resolved", "manual_review", "not_found"]
    created_ids = []

    try:
        for idx, status in enumerate(valid_statuses):
            data = base_request_data.copy()
            data["status"] = status
            data["requester_person_cm_id"] = 100002 + idx

            result = pb_client.collection("bunk_requests").create(data)
            assert result.status == status
            created_ids.append(result.id)

    finally:
        # Clean up
        for record_id in created_ids:
            try:
                pb_client.collection("bunk_requests").delete(record_id)
            except Exception:
                pass


def test_invalid_request_source(pb_client, base_request_data):
    """Test that invalid request_source values are rejected"""
    base_request_data["request_source"] = "invalid_source"

    with pytest.raises(ClientResponseError) as exc_info:
        pb_client.collection("bunk_requests").create(base_request_data)

    assert "request_source" in str(exc_info.value.data)


def test_valid_request_sources(pb_client, base_request_data):
    """Test that all valid request_source values are accepted"""
    valid_sources = ["csv_explicit", "socialize_field", "prior_year", "manual_entry"]
    created_ids = []

    try:
        for idx, source in enumerate(valid_sources):
            data = base_request_data.copy()
            data["request_source"] = source
            data["requester_person_cm_id"] = 100010 + idx

            result = pb_client.collection("bunk_requests").create(data)
            assert result.request_source == source
            created_ids.append(result.id)

    finally:
        # Clean up
        for record_id in created_ids:
            try:
                pb_client.collection("bunk_requests").delete(record_id)
            except Exception:
                pass


def test_priority_constraints(pb_client, base_request_data):
    """Test priority field constraints (1-10)"""
    # Test invalid priority values
    # Note: 0 is accepted as it's treated as null/empty for optional fields
    invalid_priorities = [11, -1, 100]

    for priority in invalid_priorities:
        data = base_request_data.copy()
        data["priority"] = priority
        data["requester_person_cm_id"] = 100020 + abs(priority)

        with pytest.raises(ClientResponseError) as exc_info:
            pb_client.collection("bunk_requests").create(data)

        assert "priority" in str(exc_info.value.data)

    # Test valid priority values (including 0 which is treated as null)
    valid_priorities = [0, 1, 5, 10]
    created_ids = []

    try:
        for priority in valid_priorities:
            data = base_request_data.copy()
            data["priority"] = priority
            data["requester_person_cm_id"] = 100030 + priority

            result = pb_client.collection("bunk_requests").create(data)
            assert result.priority == priority
            created_ids.append(result.id)

    finally:
        # Clean up
        for record_id in created_ids:
            try:
                pb_client.collection("bunk_requests").delete(record_id)
            except Exception:
                pass


def test_confidence_score_constraints(pb_client, base_request_data):
    """Test confidence_score field constraints (0-100)"""
    # Test invalid confidence scores
    invalid_scores = [-1, 101, 200]

    for score in invalid_scores:
        data = base_request_data.copy()
        data["confidence_score"] = score
        data["requester_person_cm_id"] = 100040 + int(score)

        with pytest.raises(ClientResponseError) as exc_info:
            pb_client.collection("bunk_requests").create(data)

        assert "confidence_score" in str(exc_info.value.data)

    # Test valid confidence scores
    valid_scores = [0.0, 50.5, 85.0, 100.0]
    created_ids = []

    try:
        for idx, score in enumerate(valid_scores):
            data = base_request_data.copy()
            data["confidence_score"] = score
            data["requester_person_cm_id"] = 100050 + idx

            result = pb_client.collection("bunk_requests").create(data)
            assert result.confidence_score == score
            created_ids.append(result.id)

    finally:
        # Clean up
        for record_id in created_ids:
            try:
                pb_client.collection("bunk_requests").delete(record_id)
            except Exception:
                pass


def test_year_constraints(pb_client, base_request_data):
    """Test year field constraints (2020-2100)"""
    # Test invalid years
    invalid_years = [2019, 2101, 1999]

    for year in invalid_years:
        data = base_request_data.copy()
        data["year"] = year
        data["requester_person_cm_id"] = 100060 + year

        with pytest.raises(ClientResponseError) as exc_info:
            pb_client.collection("bunk_requests").create(data)

        assert "year" in str(exc_info.value.data)

    # Test valid years
    valid_years = [2020, 2025, 2050, 2100]
    created_ids = []

    try:
        for year in valid_years:
            data = base_request_data.copy()
            data["year"] = year
            data["requester_person_cm_id"] = 100070 + year

            result = pb_client.collection("bunk_requests").create(data)
            assert result.year == year
            created_ids.append(result.id)

    finally:
        # Clean up
        for record_id in created_ids:
            try:
                pb_client.collection("bunk_requests").delete(record_id)
            except Exception:
                pass


def test_required_fields(pb_client):
    """Test that required fields are enforced"""
    required_fields = ["requester_person_cm_id", "request_type", "year", "status"]

    for field in required_fields:
        data = {"requester_person_cm_id": 100080, "request_type": "positive", "year": 2025, "status": "unresolved"}

        # Remove the required field
        del data[field]

        with pytest.raises(ClientResponseError) as exc_info:
            pb_client.collection("bunk_requests").create(data)

        # The error should mention the missing field
        assert field in str(exc_info.value.data).lower()


def test_json_field_validation(pb_client, base_request_data):
    """Test that JSON fields accept proper JSON data"""
    # Valid JSON data
    data = base_request_data.copy()
    data["requester_person_cm_id"] = 100090
    data["keywords_found"] = {"must_be_with": True, "priority": True}
    data["eligible_continuity_campers"] = [111, 222, 333]
    data["selected_continuity_campers"] = [111]

    try:
        result = pb_client.collection("bunk_requests").create(data)
        assert result.keywords_found == {"must_be_with": True, "priority": True}
        assert len(result.eligible_continuity_campers) == 3

        # Clean up
        pb_client.collection("bunk_requests").delete(result.id)

    except ClientResponseError as e:
        pytest.fail(f"Failed to create request with JSON fields: {e.data}")


def test_unique_constraint(pb_client, base_request_data):
    """Test unique constraint on requester/requested/type/year/session combination"""
    data = base_request_data.copy()
    data["requester_person_cm_id"] = 100100
    data["requested_person_cm_id"] = 100101
    data["request_type"] = "positive"
    data["year"] = 2025
    data["session_cm_id"] = 12345

    # Create first request
    result1 = pb_client.collection("bunk_requests").create(data)

    try:
        # Try to create duplicate - should fail
        with pytest.raises(ClientResponseError) as exc_info:
            pb_client.collection("bunk_requests").create(data)

        # Should be a unique constraint violation
        assert "unique" in str(exc_info.value.data).lower()

    finally:
        # Clean up
        pb_client.collection("bunk_requests").delete(result1.id)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
