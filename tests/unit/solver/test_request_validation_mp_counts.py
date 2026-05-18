"""TDD tests for new MP and all-camper counts in request_validation_summary.

See docs/superpowers/specs/2026-05-11-solver-debug-metric-expansion-design.md
for the scenarios this exercises. The post-solve diagnostic loop already
buckets unsatisfied campers; this PR layers symmetric met/total counts for
the 'all requests' and 'MP requests' scopes on top.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from bunking.models_v2 import DirectBunk, DirectBunkAssignment, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.solver.feasibility import RequestValidationSummary

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
) -> RequestValidationSummary:
    """Build a DirectBunkingSolver, install fixed assignments, invoke the
    post-solve diagnostic helper directly, and return its
    request_validation_summary.

    We bypass the full CP-SAT solve because the counts only depend on
    (requests, assignments) — not on the solver's search behavior. This
    keeps the test fast and deterministic.

    Internally `_check_must_satisfy_one_violations` builds person_to_bunk
    and calls `satisfied_request_ids_by_person` itself, so we only need to
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


def test_entirely_impossible_mp_camper_excluded_from_mp_campers_total() -> None:
    """mp_campers_total counts only campers with >=1 POSSIBLE MP request.

    Camper 1's single MP request targets a non-roster cm_id (entirely
    impossible). Camper 2 has a satisfiable MP request. With camper 1
    correctly excluded, mp_campers_total == 1 and mp_campers_satisfied == 1
    -> the 'Acceptable' rate is 100%, not 50%.
    """
    p1 = _person(1, session_cm_id=500)
    p2 = _person(2, session_cm_id=500)
    p3 = _person(3, session_cm_id=500)
    bunks = [_bunk(10, capacity=10, session_cm_id=500)]
    requests = [
        # Camper 1: only MP request targets cm_id 999 (not in persons) -> impossible.
        _req("r1", requester_id=1, target_id=999, source_field="bunk_with"),
        # Camper 2: MP request to camper 3, satisfiable.
        _req("r2", requester_id=2, target_id=3, source_field="bunk_with"),
    ]
    # Put everyone in the one bunk so r2 is satisfied.
    assignments = {1: 10, 2: 10, 3: 10}

    summary = _run_post_solve_with_fixed_assignments([p1, p2, p3], bunks, requests, assignments)

    assert summary["mp_campers_total"] == 1
    assert summary["mp_campers_satisfied"] == 1


def test_impossible_mp_request_excluded_from_mp_requests_totals() -> None:
    """mp_requests_total and mp_requests_satisfied gate on possibility, mirroring
    the mp_campers_* keys fixed in #1429.

    Camper 1 has two MP requests: r_imp targets cm_id 999 (not in persons -> impossible)
    and r_ok targets camper 2 (satisfiable). The impossible request must be excluded
    from BOTH numerator and denominator, so mp_request_rate (Optimized) = 1/1 = 100%,
    not 1/2 = 50%.
    """
    p1 = _person(1, session_cm_id=500)
    p2 = _person(2, session_cm_id=500)
    bunks = [_bunk(10, capacity=10, session_cm_id=500)]
    requests = [
        _req("r_imp", requester_id=1, target_id=999, source_field="bunk_with"),  # impossible
        _req("r_ok", requester_id=1, target_id=2, source_field="bunk_with"),  # possible + satisfied
    ]
    assignments = {1: 10, 2: 10}

    s = _run_post_solve_with_fixed_assignments([p1, p2], bunks, requests, assignments)

    assert s["mp_requests_total"] == 1
    assert s["mp_requests_satisfied"] == 1


def test_entirely_impossible_camper_excluded_from_all_campers_totals() -> None:
    """all_campers_total and all_campers_satisfied gate on possibility, mirroring
    the mp_campers_* fix from #1429. Bug today: a camper whose ENTIRE resolved
    request set is impossible is counted in all_campers_total with no path to the
    numerator, dragging 'Camper rate' below 100%.

    Camper 1's only resolved request (any source) is impossible -> excluded.
    Camper 2 has a satisfiable bunk_with -> included and counted satisfied.
    Expected: all_campers_total == 1, all_campers_satisfied == 1 -> rate = 100%.
    """
    p1 = _person(1, session_cm_id=500)
    p2 = _person(2, session_cm_id=500)
    p3 = _person(3, session_cm_id=500)
    bunks = [_bunk(10, capacity=10, session_cm_id=500)]
    requests = [
        # Camper 1: only request targets a non-roster cm_id -> impossible.
        _req("r_imp", requester_id=1, target_id=999, source_field="bunk_with"),
        # Camper 2: satisfiable MP request.
        _req("r_ok", requester_id=2, target_id=3, source_field="bunk_with"),
    ]
    assignments = {1: 10, 2: 10, 3: 10}

    s = _run_post_solve_with_fixed_assignments([p1, p2, p3], bunks, requests, assignments)

    assert s["all_campers_total"] == 1
    assert s["all_campers_satisfied"] == 1


def test_impossible_request_excluded_from_all_requests_totals() -> None:
    """New all_requests_total / all_requests_satisfied keys give 'Request rate'
    (all_request_rate in the UI) the same possible-gating discipline as the
    other three rate metrics. Without these keys the UI computes all_request_rate
    from stats.total_requests / stats.satisfied_request_count, which counts
    impossible requests (and even pending/declined ones) in the denominator.

    Two resolved bunk_with requests, one impossible, one satisfied -> rate = 1/1 = 100%.
    """
    p1 = _person(1, session_cm_id=500)
    p2 = _person(2, session_cm_id=500)
    bunks = [_bunk(10, capacity=10, session_cm_id=500)]
    requests = [
        _req("r_imp", requester_id=1, target_id=999, source_field="bunk_with"),  # impossible
        _req("r_ok", requester_id=1, target_id=2, source_field="bunk_with"),  # possible + satisfied
    ]
    assignments = {1: 10, 2: 10}

    s = _run_post_solve_with_fixed_assignments([p1, p2], bunks, requests, assignments)

    assert s["all_requests_total"] == 1
    assert s["all_requests_satisfied"] == 1


def test_not_bunk_with_unassigned_target_counts_as_satisfied() -> None:
    """Pins divergence #1 inside the MSO diagnostic.

    A camper whose only resolved request is a ``not_bunk_with`` against an
    unassigned target is now counted as *satisfied* by the canonical predicate
    ("no conflict possible"). The retired ``calculate_satisfied_requests``
    treated it as unsatisfied, which would have landed this camper in
    ``unsatisfied_other_unmet``. This locks the post-`satisfied_request_ids_by_person`
    behavior so the diagnostic's treatment of the edge is explicit, not implicit.
    """
    persons = [_person(1), _person(2)]
    bunks = [_bunk(100)]
    requests = [
        # not_bunk_with -> STAFF (non-material); target 2 is on the roster but
        # left out of `assignments` below, so it is unassigned at solve time.
        _req("r1", 1, 2, source_field="not_bunk_with", request_type="not_bunk_with"),
    ]
    assignments = {1: 100}  # camper 2 deliberately unassigned

    s = _run_post_solve_with_fixed_assignments(persons, bunks, requests, assignments)

    # Divergence #1: the request is satisfied, so the camper is counted as
    # satisfied and lands in NONE of the unmet buckets.
    assert s["all_campers_total"] == 1
    assert s["all_campers_satisfied"] == 1
    assert s["unsatisfied_other_unmet"] == 0
    assert s["unsatisfied_material_parent_unmet"] == 0
    assert s["unsatisfied_no_possible"] == 0
    # not_bunk_with is non-material, so MP scopes are untouched.
    assert s["mp_campers_total"] == 0
