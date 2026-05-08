"""Post-solve must-satisfy-one diagnostic split.

Today the post-solve reporting loop in `_check_constraint_violations` step 4
emits one `must_satisfy_one` warning category that conflates three populations:

A) Camper had only impossible requests (parent input issue — requestee in
   another session, or requestee not in the solver). The solver could never
   satisfy these and the soft constraint at `must_satisfy.py:91-94` already
   skips them entirely.
B) Camper had ≥1 possible MATERIAL_PARENT request (bunk_with) that the solver
   chose not to satisfy. This is the staff-headline failure mode.
C) Camper had only non-MATERIAL_PARENT possible requests (STAFF /
   IMMATERIAL_PARENT) and the solver satisfied none. Lower-priority signal
   per the parent-paramount design.

This split converts the diagnostic from "10 unsatisfied campers" (uninformative
re. solver feasibility) into three actionable categories.

The diagnostic only changes reporting — the soft constraint, hard constraints,
and objective are unchanged.
"""

from __future__ import annotations

from bunking.config import ConfigLoader
from bunking.models_v2 import (
    DirectBunk,
    DirectBunkAssignment,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.solver.direct_solver import DirectBunkingSolver

_FICTIONAL_NAMES = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Noah", "Williams"),
    ("Ava", "Martinez"),
    ("Ethan", "Brown"),
    ("Sophia", "Davis"),
    ("Mason", "Lopez"),
]

# New violation categories emitted by the split diagnostic.
CAT_NO_POSSIBLE = "must_satisfy_one_no_possible"
CAT_MATERIAL_PARENT_UNMET = "must_satisfy_one_material_parent_unmet"
CAT_OTHER_UNMET = "must_satisfy_one_other_unmet"


def _person(cm_id: int, session: int, *, gender: str = "F", grade: int = 6) -> DirectPerson:
    first, last = _FICTIONAL_NAMES[cm_id % len(_FICTIONAL_NAMES)]
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first,
        last_name=last,
        grade=grade,
        birthdate="2014-03-15",
        gender=gender,
        session_cm_id=session,
    )


def _bunk(cm_id: int, session: int, *, gender: str = "F") -> DirectBunk:
    return DirectBunk(
        id=f"bunk_{cm_id}",
        campminder_id=cm_id,
        name=f"B-{cm_id}",
        capacity=12,
        gender=gender,
        session_cm_id=session,
    )


def _request(
    req_id: str,
    requester: int,
    requested: int | None,
    session: int,
    *,
    request_type: str = "bunk_with",
    source_field: str = "bunk_with",
    status: str = "resolved",
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type,
        session_cm_id=session,
        year=2026,
        status=status,
        source_field=source_field,
    )


def _assignment(person_cm_id: int, bunk_cm_id: int, session: int) -> DirectBunkAssignment:
    return DirectBunkAssignment(
        person_cm_id=person_cm_id,
        session_cm_id=session,
        bunk_cm_id=bunk_cm_id,
        year=2026,
    )


def _violation_details(solver: DirectBunkingSolver, category: str) -> list[str]:
    """Extract the `details` strings logged under a given violation category."""
    return [v["details"] for v in solver.constraint_logger.violations.get(category, [])]


class TestMustSatisfyDiagnosticSplit:
    """Splits the post-solve must-satisfy-one diagnostic into three categories.

    Tests build a `DirectBunkingSolver` (which populates `possible_requests` /
    `impossible_requests` via `_validate_requests`), then call the extracted
    helper `_check_must_satisfy_one_violations(assignments)` and inspect
    `constraint_logger.violations`.
    """

    def test_camper_with_only_impossible_requests_flagged_as_no_possible(self, mock_config):
        """Type A: cross-session bunk_with → no possible request → 'no_possible' category, info severity."""
        # Camper 1001 in session 100 wants to bunk with 1002 in session 200 → impossible.
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 200)],
            requests=[_request("r1", 1001, 1002, 100)],
            bunks=[_bunk(2001, 100), _bunk(2002, 200)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())
        # Pre-condition: validation flagged it impossible.
        assert solver.possible_requests[1001] == []
        assert len(solver.impossible_requests[1001]) == 1

        # Place 1001 in some bunk (any solver outcome).
        assignments = [_assignment(1001, 2001, 100), _assignment(1002, 2002, 200)]

        solver._check_must_satisfy_one_violations(assignments)

        no_possible = _violation_details(solver, CAT_NO_POSSIBLE)
        assert len(no_possible) == 1
        assert "1001" in no_possible[0]
        # Severity should be `info` — the solver isn't at fault here.
        sev = solver.constraint_logger.violations[CAT_NO_POSSIBLE][0]["severity"]
        assert sev == "info"
        # The other categories must NOT contain this camper.
        assert _violation_details(solver, CAT_MATERIAL_PARENT_UNMET) == []
        assert _violation_details(solver, CAT_OTHER_UNMET) == []

    def test_unsatisfied_material_parent_request_flagged_as_material_parent_unmet(self, mock_config):
        """Type B: possible material-parent request unsatisfied → 'material_parent_unmet', warning severity."""
        # Both campers in session 100 — request is possible. After solve they're in different bunks.
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100)],
            requests=[_request("r1", 1001, 1002, 100, source_field="bunk_with")],
            bunks=[_bunk(2001, 100), _bunk(2002, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())
        assert len(solver.possible_requests[1001]) == 1
        assert solver.impossible_requests[1001] == []

        # Different bunks → bunk_with NOT satisfied.
        assignments = [_assignment(1001, 2001, 100), _assignment(1002, 2002, 100)]

        solver._check_must_satisfy_one_violations(assignments)

        material = _violation_details(solver, CAT_MATERIAL_PARENT_UNMET)
        assert len(material) == 1
        assert "1001" in material[0]
        sev = solver.constraint_logger.violations[CAT_MATERIAL_PARENT_UNMET][0]["severity"]
        assert sev == "warning"
        # Other categories empty.
        assert _violation_details(solver, CAT_NO_POSSIBLE) == []
        assert _violation_details(solver, CAT_OTHER_UNMET) == []

    def test_unsatisfied_staff_only_request_flagged_as_other_unmet(self, mock_config):
        """Type C: possible STAFF request unsatisfied, no MATERIAL_PARENT → 'other_unmet', info severity."""
        # not_bunk_with from a bunking_notes/internal_notes/not_bunk_with source.
        # The request is "satisfied" when targets are in DIFFERENT bunks; we put them in the SAME
        # bunk so the request is unsatisfied.
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100)],
            requests=[
                _request(
                    "r1",
                    1001,
                    1002,
                    100,
                    request_type="not_bunk_with",
                    source_field="not_bunk_with",
                ),
            ],
            bunks=[_bunk(2001, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())
        assert len(solver.possible_requests[1001]) == 1

        # Both in the same bunk — not_bunk_with is violated.
        assignments = [_assignment(1001, 2001, 100), _assignment(1002, 2001, 100)]

        solver._check_must_satisfy_one_violations(assignments)

        other = _violation_details(solver, CAT_OTHER_UNMET)
        assert len(other) == 1
        assert "1001" in other[0]
        sev = solver.constraint_logger.violations[CAT_OTHER_UNMET][0]["severity"]
        assert sev == "info"
        assert _violation_details(solver, CAT_NO_POSSIBLE) == []
        assert _violation_details(solver, CAT_MATERIAL_PARENT_UNMET) == []

    def test_mixed_material_and_staff_unsatisfied_falls_in_material_category(self, mock_config):
        """Mixed possible buckets: presence of any MATERIAL_PARENT routes to material_parent_unmet."""
        # 1001 has TWO possible requests, neither satisfied:
        #   - bunk_with 1002 (material, source_field='bunk_with')
        #   - not_bunk_with 1003 (staff, source_field='not_bunk_with')
        # Place 1001 separate from 1002 (bunk_with unmet) and same as 1003 (not_bunk_with unmet).
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100), _person(1003, 100)],
            requests=[
                _request("r1", 1001, 1002, 100, source_field="bunk_with"),
                _request(
                    "r2",
                    1001,
                    1003,
                    100,
                    request_type="not_bunk_with",
                    source_field="not_bunk_with",
                ),
            ],
            bunks=[_bunk(2001, 100), _bunk(2002, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())
        assert len(solver.possible_requests[1001]) == 2

        # 1001 + 1003 in B-2001 (not_bunk_with violated), 1002 in B-2002 (bunk_with violated).
        assignments = [
            _assignment(1001, 2001, 100),
            _assignment(1002, 2002, 100),
            _assignment(1003, 2001, 100),
        ]

        solver._check_must_satisfy_one_violations(assignments)

        # Material-parent presence wins — even though staff is also unmet, the camper appears
        # ONCE in the material_parent_unmet category, NOT in other_unmet.
        material = _violation_details(solver, CAT_MATERIAL_PARENT_UNMET)
        assert len(material) == 1
        assert "1001" in material[0]
        assert _violation_details(solver, CAT_OTHER_UNMET) == []
        assert _violation_details(solver, CAT_NO_POSSIBLE) == []

    def test_camper_with_at_least_one_satisfied_request_not_flagged(self, mock_config):
        """Camper with ≥1 satisfied request stays out of all three categories."""
        # 1001 wants 1002 (satisfied — same bunk) AND 1003 (unsatisfied — different bunk).
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100), _person(1003, 100)],
            requests=[
                _request("r1", 1001, 1002, 100, source_field="bunk_with"),
                _request("r2", 1001, 1003, 100, source_field="bunk_with"),
            ],
            bunks=[_bunk(2001, 100), _bunk(2002, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())

        # 1001 + 1002 in B-2001 (r1 satisfied), 1003 in B-2002 (r2 unsatisfied).
        assignments = [
            _assignment(1001, 2001, 100),
            _assignment(1002, 2001, 100),
            _assignment(1003, 2002, 100),
        ]

        solver._check_must_satisfy_one_violations(assignments)

        assert _violation_details(solver, CAT_NO_POSSIBLE) == []
        assert _violation_details(solver, CAT_MATERIAL_PARENT_UNMET) == []
        assert _violation_details(solver, CAT_OTHER_UNMET) == []

    def test_camper_with_no_requests_not_flagged(self, mock_config):
        """A camper with no requests at all is not flagged in any category."""
        input_data = DirectSolverInput(
            persons=[_person(1001, 100)],
            requests=[],
            bunks=[_bunk(2001, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())
        assignments = [_assignment(1001, 2001, 100)]

        solver._check_must_satisfy_one_violations(assignments)

        assert _violation_details(solver, CAT_NO_POSSIBLE) == []
        assert _violation_details(solver, CAT_MATERIAL_PARENT_UNMET) == []
        assert _violation_details(solver, CAT_OTHER_UNMET) == []

    def test_pending_or_declined_requests_excluded_from_diagnostic(self, mock_config):
        """Diagnostic mirrors the solver's resolved-only scope.

        `data_fetcher.py:140` filters bunk_requests to ``status="resolved"`` before
        the solver sees them — pending/declined never reach the constraint module
        in production. The diagnostic should match: a camper whose only requests
        are pending or declined must NOT show up in any of the three categories.
        Otherwise we'd be flagging "no satisfied requests" against a request set
        the solver was never asked to satisfy.

        This also collapses the "type A: cross-session" case in practice — the
        bunk_request_processor auto-DECLINES cross-session bunk_with at sync
        time, so they'd be filtered out here regardless.
        """
        # 1001 has only pending requests. 1002 has only declined requests.
        # Neither should appear in any diagnostic category.
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100), _person(1003, 100)],
            requests=[
                _request("rA", 1001, 1003, 100, source_field="bunk_with", status="pending"),
                _request("rB", 1002, 1003, 100, source_field="bunk_with", status="declined"),
            ],
            bunks=[_bunk(2001, 100), _bunk(2002, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())

        # Place 1001/1002 separate from 1003 — would be unsatisfied if they counted.
        assignments = [
            _assignment(1001, 2001, 100),
            _assignment(1002, 2001, 100),
            _assignment(1003, 2002, 100),
        ]

        solver._check_must_satisfy_one_violations(assignments)

        # Neither camper appears in any category — their requests aren't in solver scope.
        assert _violation_details(solver, CAT_NO_POSSIBLE) == []
        assert _violation_details(solver, CAT_MATERIAL_PARENT_UNMET) == []
        assert _violation_details(solver, CAT_OTHER_UNMET) == []
        # Summary counts reflect only resolved requests.
        summary = solver.request_validation_summary
        assert summary.get("unsatisfied_no_possible") == 0
        assert summary.get("unsatisfied_material_parent_unmet") == 0
        assert summary.get("unsatisfied_other_unmet") == 0

    def test_only_resolved_request_counted_when_camper_has_mixed_statuses(self, mock_config):
        """A camper with one resolved + one pending request is judged on the resolved one.

        If the resolved request is satisfied, the camper passes — the pending
        request neither helps nor hurts. If the resolved request is unsatisfied
        and the camper has no other resolved possible, they're flagged on the
        resolved one's bucket.
        """
        # 1001 has:
        #   - resolved bunk_with → 1002 (unsatisfied, different bunks)
        #   - pending bunk_with → 1003 (would-be-satisfied if counted, but pending so ignored)
        input_data = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100), _person(1003, 100)],
            requests=[
                _request("r-resolved", 1001, 1002, 100, source_field="bunk_with", status="resolved"),
                _request("r-pending", 1001, 1003, 100, source_field="bunk_with", status="pending"),
            ],
            bunks=[_bunk(2001, 100), _bunk(2002, 100)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())

        # 1001 + 1003 in B-2001 (would satisfy the pending), 1002 in B-2002 (resolved unsatisfied).
        assignments = [
            _assignment(1001, 2001, 100),
            _assignment(1003, 2001, 100),
            _assignment(1002, 2002, 100),
        ]

        solver._check_must_satisfy_one_violations(assignments)

        # Despite the pending request being "satisfied" by accident, the resolved one isn't —
        # so the camper IS flagged.
        material = _violation_details(solver, CAT_MATERIAL_PARENT_UNMET)
        assert len(material) == 1
        assert "1001" in material[0]

    def test_request_validation_summary_carries_breakdown(self, mock_config):
        """`request_validation_summary` exposes counts so the JSON log carries the breakdown.

        The structured solver-log JSON snapshots `request_validation_summary`.
        Adding the post-solve breakdown there makes the type-A vs type-B+C
        split visible in logs without needing to scrape the violation-list
        names.
        """
        # 1001 → type A (impossible), 1002 → type B (material unmet),
        # 1003 → type C (staff unmet), 1004 → satisfied.
        input_data = DirectSolverInput(
            persons=[
                _person(1001, 100),
                _person(1002, 100),
                _person(1003, 100),
                _person(1004, 100),
                _person(2001, 200),  # cross-session target for 1001
                _person(1005, 100),  # target for 1002
                _person(1006, 100),  # target for 1003
                _person(1007, 100),  # target for 1004
            ],
            requests=[
                _request("rA", 1001, 2001, 100, source_field="bunk_with"),  # type A
                _request("rB", 1002, 1005, 100, source_field="bunk_with"),  # type B
                _request(
                    "rC",
                    1003,
                    1006,
                    100,
                    request_type="not_bunk_with",
                    source_field="not_bunk_with",
                ),  # type C
                _request("rD", 1004, 1007, 100, source_field="bunk_with"),  # satisfied
            ],
            bunks=[_bunk(2001, 100), _bunk(2002, 100), _bunk(2010, 200)],
        )
        solver = DirectBunkingSolver(input_data, ConfigLoader.get_instance())

        assignments = [
            _assignment(1001, 2001, 100),
            _assignment(1002, 2001, 100),  # 1005 elsewhere → unmet
            _assignment(1005, 2002, 100),
            _assignment(1003, 2001, 100),
            _assignment(1006, 2001, 100),  # same bunk → not_bunk_with violated
            _assignment(1004, 2002, 100),
            _assignment(1007, 2002, 100),  # together → satisfied
            _assignment(2001, 2010, 200),
        ]

        solver._check_must_satisfy_one_violations(assignments)

        summary = solver.request_validation_summary
        assert summary.get("unsatisfied_no_possible") == 1
        assert summary.get("unsatisfied_material_parent_unmet") == 1
        assert summary.get("unsatisfied_other_unmet") == 1
