"""TDD tests for new MP and all-camper counts in request_validation_summary.

See docs/superpowers/specs/2026-05-11-solver-debug-metric-expansion-design.md
for the scenarios this exercises. The post-solve diagnostic loop already
buckets unsatisfied campers; this PR layers symmetric met/total counts for
the 'all requests' and 'MP requests' scopes on top.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.models_v2 import DirectBunk, DirectBunkAssignment, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.sync.bunk_request_processor.core.models import RequestType


# --- Test fixture builders -------------------------------------------------


def _person(cm_id: int, session_cm_id: int = 500) -> DirectPerson:
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=f"Camper{cm_id}",
        last_name="Test",
        grade=5,
        birthdate="2015-01-01",
        gender="F",
        session_cm_id=session_cm_id,
    )


def _bunk(cm_id: int, capacity: int = 10, session_cm_id: int = 500) -> DirectBunk:
    return DirectBunk(
        id=f"bunk-{cm_id}",
        campminder_id=cm_id,
        name=f"Bunk{cm_id}",
        capacity=capacity,
        gender="F",
        session_cm_id=session_cm_id,
    )


def _req(
    req_id: str,
    requester_id: int,
    target_id: int,
    source_field: str,
    request_type: str = "bunk_with",
    status: str = "resolved",
    priority: int = 4,
    session_cm_id: int = 500,
    year: int = 2026,
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester_id,
        requested_person_cm_id=target_id,
        request_type=request_type,
        source_field=source_field,
        status=status,
        priority=priority,
        session_cm_id=session_cm_id,
        year=year,
    )


def _run_post_solve_with_fixed_assignments(
    persons: list[DirectPerson],
    bunks: list[DirectBunk],
    requests: list[DirectBunkRequest],
    assignments: dict[int, int],
) -> dict[str, Any]:
    """Build a DirectBunkingSolver, install fixed assignments, invoke the
    post-solve diagnostic helper directly, and return its
    request_validation_summary.

    We bypass the full CP-SAT solve because the counts only depend on
    (requests, assignments) — not on the solver's search behavior. This
    keeps the test fast and deterministic.

    Internally `_check_must_satisfy_one_violations` builds person_to_bunk
    and calls `calculate_satisfied_requests` itself, so we only need to
    hand it the assignment list.
    """
    input_data = DirectSolverInput(persons=persons, bunks=bunks, requests=requests)
    solver = DirectBunkingSolver(input_data, config_service=MagicMock())

    # _validate_requests() is called in __init__ and populates possible_requests
    # + request_validation_summary; the diagnostic reads possible_requests, and
    # the new MP count keys get merged into the same summary dict.

    assignment_list = [
        DirectBunkAssignment(person_cm_id=pid, bunk_cm_id=bid, session_cm_id=500, year=2026)
        for pid, bid in assignments.items()
    ]
    solver._check_must_satisfy_one_violations(assignment_list)
    return solver.request_validation_summary


# --- Scenarios ------------------------------------------------------------


class TestMPAndAllCamperCounts:
    """Symmetric met/total/unmet counts for all-request and MP-request scopes."""

    def test_camper_with_mp_satisfied_and_mp_unsatisfied(self) -> None:
        """Scenario 1: One camper with [MP-sat, MP-unsat].

        mp_requests_total=2, mp_requests_satisfied=1,
        mp_campers_total=1, mp_campers_satisfied=1 (>=1 MP satisfied),
        all_campers_total=1, all_campers_satisfied=1.
        """
        persons = [_person(1), _person(2), _person(3)]
        bunks = [_bunk(100), _bunk(200)]
        requests = [
            _req("r1", 1, 2, source_field="bunk_with"),  # MP, satisfied (B in same bunk)
            _req("r2", 1, 3, source_field="bunk_with"),  # MP, unsatisfied (C in other bunk)
        ]
        assignments = {1: 100, 2: 100, 3: 200}

        s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

        assert s["mp_requests_total"] == 2
        assert s["mp_requests_satisfied"] == 1
        assert s["mp_campers_total"] == 1
        assert s["mp_campers_satisfied"] == 1
        assert s["all_campers_total"] == 1
        assert s["all_campers_satisfied"] == 1

    def test_camper_with_mp_unsatisfied_and_other_satisfied(self) -> None:
        """Scenario 2: [MP-unsat, OTHER-sat] -- locks in inequality vs unmet bucket.

        Existing `unsatisfied_material_parent_unmet` bucket SKIPS this camper
        (they got >=1 of anything). But mp_campers_satisfied does NOT count
        them -- they didn't get any MP satisfied. all_campers_satisfied
        counts them.
        """
        persons = [_person(1), _person(2), _person(3)]
        bunks = [_bunk(100), _bunk(200)]
        requests = [
            _req("r1", 1, 3, source_field="bunk_with"),  # MP, unsatisfied
            _req("r2", 1, 2, source_field="bunking_notes"),  # STAFF, satisfied
        ]
        assignments = {1: 100, 2: 100, 3: 200}

        s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

        assert s["mp_requests_total"] == 1
        assert s["mp_requests_satisfied"] == 0
        assert s["mp_campers_total"] == 1
        assert s["mp_campers_satisfied"] == 0  # MP not satisfied
        assert s["all_campers_total"] == 1
        assert s["all_campers_satisfied"] == 1  # OTHER was satisfied
        # Existing bucket: camper NOT in unmet (got >=1 anything satisfied)
        assert s["unsatisfied_material_parent_unmet"] == 0

    def test_camper_with_all_unsatisfied(self) -> None:
        """Scenario 3: [MP-unsat, OTHER-unsat] -- in unmet bucket and not satisfied counts."""
        persons = [_person(1), _person(2), _person(3)]
        bunks = [_bunk(100), _bunk(200)]
        requests = [
            _req("r1", 1, 3, source_field="bunk_with"),  # MP, unsatisfied
            _req("r2", 1, 3, source_field="bunking_notes"),  # STAFF, unsatisfied
        ]
        assignments = {1: 100, 2: 100, 3: 200}

        s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

        assert s["mp_campers_total"] == 1
        assert s["mp_campers_satisfied"] == 0
        assert s["all_campers_total"] == 1
        assert s["all_campers_satisfied"] == 0
        # Existing bucket: camper IS in unmet (got 0 anything satisfied) AND
        # had MP possible -> material_parent_unmet
        assert s["unsatisfied_material_parent_unmet"] == 1

    def test_camper_with_only_other_satisfied(self) -> None:
        """Scenario 4: no MP requests, only OTHER-sat -- excluded from MP counts entirely."""
        persons = [_person(1), _person(2)]
        bunks = [_bunk(100)]
        requests = [
            _req("r1", 1, 2, source_field="bunking_notes"),  # STAFF, satisfied
        ]
        assignments = {1: 100, 2: 100}

        s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

        assert s["mp_requests_total"] == 0
        assert s["mp_requests_satisfied"] == 0
        assert s["mp_campers_total"] == 0  # No MP -> can't be in total
        assert s["mp_campers_satisfied"] == 0
        assert s["all_campers_total"] == 1
        assert s["all_campers_satisfied"] == 1

    def test_camper_with_no_resolved_requests(self) -> None:
        """Scenario 5: no requests at all -- excluded from all totals."""
        persons = [_person(1), _person(2)]
        bunks = [_bunk(100)]
        requests: list[DirectBunkRequest] = []
        assignments = {1: 100, 2: 100}

        s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

        assert s["mp_requests_total"] == 0
        assert s["mp_campers_total"] == 0
        assert s["all_campers_total"] == 0
        assert s["all_campers_satisfied"] == 0
