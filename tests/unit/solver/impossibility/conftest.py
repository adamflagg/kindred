"""Shared fixtures for impossibility predicate tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput

FICTIONAL_NAMES = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Noah", "Williams"),
    ("Ava", "Martinez"),
    ("Ethan", "Brown"),
    ("Sophia", "Davis"),
    ("Mason", "Rodriguez"),
    ("Isabella", "Wilson"),
    ("Lucas", "Anderson"),
]


DEFAULT_YEAR = 2026
DEFAULT_BIRTHDATE = "2015-06-15"  # ~10 years old; safe default for solver tests


def _name_for(cm_id: int) -> tuple[str, str]:
    return FICTIONAL_NAMES[cm_id % len(FICTIONAL_NAMES)]


def make_person(
    cm_id: int,
    *,
    session: int = 1000,
    gender: str | None = "F",
    grade: int = 6,
    birthdate: str = DEFAULT_BIRTHDATE,
) -> DirectPerson:
    first, last = _name_for(cm_id)
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first,
        last_name=last,
        gender=gender,
        grade=grade,
        birthdate=birthdate,
        session_cm_id=session,
    )


def make_bunk(
    cm_id: int,
    *,
    session: int = 1000,
    gender: str = "F",
    capacity: int = 12,
    name: str | None = None,
) -> DirectBunk:
    return DirectBunk(
        id=f"bunk_{cm_id}",
        campminder_id=cm_id,
        name=name or f"Bunk{cm_id}",
        gender=gender,
        capacity=capacity,
        session_cm_id=session,
    )


def make_request(
    req_id: str,
    *,
    requester: int,
    requestee: int | None,
    request_type: str = "bunk_with",
    source_field: str = "bunk_with",
    age_preference_target: str | None = None,
    session: int = 1000,
    year: int = DEFAULT_YEAR,
) -> DirectBunkRequest:
    # requestee=None means "no requestee" (e.g., age_preference, malformed tests).
    # Pass through as None to DirectBunkRequest.requested_person_cm_id (optional).
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requestee,
        request_type=request_type,
        source_field=source_field,
        status="resolved",
        session_cm_id=session,
        year=year,
        age_preference_target=age_preference_target,
    )


def make_input(
    persons: list[DirectPerson],
    bunks: list[DirectBunk],
    requests: list[DirectBunkRequest],
) -> DirectSolverInput:
    return DirectSolverInput(persons=persons, bunks=bunks, requests=requests)


@pytest.fixture
def mock_config() -> Any:
    cfg = MagicMock()
    cfg.get_int.return_value = 2  # default max_grade_range for grade compatibility
    cfg.get_constraint.return_value = 2
    cfg.get_str.return_value = "hard"
    return cfg
