"""Shared fixtures for bunking.satisfaction tests.

The synthetic_session fixture exercises every (request_type, source_field,
assignment) combination the predicate handles. Capturing pre-migration
solver/graph output against this fixture and comparing post-migration is the
core regression guard for the #1041 consolidation work.
"""

from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture
def synthetic_persons() -> list[dict[str, Any]]:
    return [
        {"cm_id": 1, "grade": 10, "gender": "M"},
        {"cm_id": 2, "grade": 10, "gender": "M"},
        {"cm_id": 3, "grade": 11, "gender": "M"},
        {"cm_id": 4, "grade": 9, "gender": "M"},
        {"cm_id": 5, "grade": 10, "gender": "M"},
    ]


@pytest.fixture
def synthetic_bunks() -> list[dict[str, Any]]:
    return [
        {"cm_id": 100, "name": "Cabin Alpha", "gender": "M", "max_size": 8},
        {"cm_id": 101, "name": "Cabin Beta", "gender": "M", "max_size": 8},
    ]


@pytest.fixture
def synthetic_assignments() -> list[dict[str, Any]]:
    # 1, 2, 3 in Alpha; 4, 5 in Beta
    return [
        {"person_cm_id": 1, "bunk_cm_id": 100},
        {"person_cm_id": 2, "bunk_cm_id": 100},
        {"person_cm_id": 3, "bunk_cm_id": 100},
        {"person_cm_id": 4, "bunk_cm_id": 101},
        {"person_cm_id": 5, "bunk_cm_id": 101},
    ]


@pytest.fixture
def synthetic_requests() -> list[dict[str, Any]]:
    """Every valid (request_type, source_field) combination the predicate handles.

    Truth table:
      r1: 1 bunk_with 2, source=bunk_request_form     → SATISFIED   (both in Alpha)
      r2: 1 bunk_with 4, source=bunk_request_form     → UNSATISFIED (Alpha vs Beta)
      r4: 3 not_bunk_with 4, source=staff_not_bunk_with → SATISFIED (Alpha vs Beta)
      r5: 3 not_bunk_with 1, source=staff_not_bunk_with → UNSATISFIED (both in Alpha)
      r6: 4 bunk_with 5, source=bunking_notes         → SATISFIED   (both in Beta)
      r7: 5 bunk_with 4, source=internal_notes        → SATISFIED   (both in Beta)
      r_age: 8 age_preference, source=socialize_with  → IMMATERIAL_PARENT (uncounted)

    Off-axis combos (e.g. socialize_with × bunk_with) are not in the registry's
    14-row universe — see docs/architecture/request-classification.md. The
    request_registry's `weight_for` raises on them; fixtures must use valid
    combos only.
    """
    return [
        # bunk_with → MATERIAL_PARENT
        {
            "id": "r1",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
            "year": 2026,
            "session_id": 999,
        },  # satisfied
        {
            "id": "r2",
            "requester_id": 1,
            "requestee_id": 4,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
            "year": 2026,
            "session_id": 999,
        },  # unsatisfied
        # not_bunk_with → STAFF
        {
            "id": "r4",
            "requester_id": 3,
            "requestee_id": 4,
            "request_type": "not_bunk_with",
            "source_field": "staff_not_bunk_with",
            "year": 2026,
            "session_id": 999,
        },  # satisfied
        {
            "id": "r5",
            "requester_id": 3,
            "requestee_id": 1,
            "request_type": "not_bunk_with",
            "source_field": "staff_not_bunk_with",
            "year": 2026,
            "session_id": 999,
        },  # violated
        # bunking_notes → STAFF
        {
            "id": "r6",
            "requester_id": 4,
            "requestee_id": 5,
            "request_type": "bunk_with",
            "source_field": "bunking_notes",
            "year": 2026,
            "session_id": 999,
        },  # satisfied
        # internal_notes → STAFF
        {
            "id": "r7",
            "requester_id": 5,
            "requestee_id": 4,
            "request_type": "bunk_with",
            "source_field": "internal_notes",
            "year": 2026,
            "session_id": 999,
        },  # satisfied
        # age_preference request_type, source_field=socialize_with → IMMATERIAL_PARENT.
        # Production age preference rows use the socialize_with parent dropdown source;
        # source_field='age_preference' is not a valid PB value (bucket.py raises on
        # unknown). Graph builder skips age_preference rows at the request_type level.
        {
            "id": "r_age",
            "requester_id": 8,
            "requestee_id": 0,
            "request_type": "age_preference",
            "source_field": "socialize_with",
            "year": 2026,
            "session_id": 100,
            "requester_grade": 7,
            "bunkmate_grades": [7, 8],
            "age_preference_target": "older",
        },
    ]
