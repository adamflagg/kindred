"""Tests for DirectBunkingSolver._validate_requests() cross-session handling.

When a bunk_with request targets a camper in a different session, it should be
classified as impossible — session boundary constraints make it unsatisfiable.

When a not_bunk_with request targets a camper in a different session, it should
remain possible — session boundaries already guarantee separation.
"""

from __future__ import annotations

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver

_FICTIONAL_NAMES = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Noah", "Williams"),
    ("Ava", "Martinez"),
    ("Ethan", "Brown"),
]


def _make_person(cm_id: int, session: int, *, gender: str = "F", grade: int = 6) -> DirectPerson:
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


def _make_bunk(cm_id: int, session: int, *, gender: str = "F", name: str | None = None) -> DirectBunk:
    return DirectBunk(
        id=f"bunk_{cm_id}",
        campminder_id=cm_id,
        name=name or f"B-{cm_id}",
        capacity=12,
        gender=gender,
        session_cm_id=session,
    )


def _make_request(
    req_id: str,
    requester: int,
    requested: int | None,
    session: int,
    *,
    request_type: str = "bunk_with",
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type,
        session_cm_id=session,
        year=2026,
        status="resolved",
    )


class TestValidateRequestsCrossSession:
    """_validate_requests must check session compatibility, not just solver membership."""

    def test_bunk_with_same_session_is_possible(self, mock_config):
        """bunk_with targeting a camper in the same session is possible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 100)],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 100)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_bunk_with_different_session_is_impossible(self, mock_config):
        """bunk_with targeting a camper in a different session is impossible.

        Even though the requestee is in the solver (person_idx_map), session
        boundary constraints prevent them from ever sharing a bunk.
        """
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 200)],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 100), _make_bunk(2002, 200)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1

    def test_not_bunk_with_different_session_is_possible(self, mock_config):
        """not_bunk_with targeting a camper in a different session is still possible.

        Session boundaries already guarantee they'll be in different bunks,
        so this request is trivially satisfied — not impossible.
        """
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 200)],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="not_bunk_with")],
                bunks=[_make_bunk(2001, 100), _make_bunk(2002, 200)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_not_bunk_with_same_session_is_possible(self, mock_config):
        """not_bunk_with targeting a camper in the same session is possible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 100)],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="not_bunk_with")],
                bunks=[_make_bunk(2001, 100)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_bunk_with_person_not_in_solver_is_impossible(self, mock_config):
        """bunk_with targeting someone not in the solver at all (existing behavior)."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100)],
                requests=[_make_request("r1", 1001, 9999, 100, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 100)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1

    def test_mixed_requests_split_correctly(self, mock_config):
        """Camper with both same-session and cross-session requests gets correct split."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100),
                    _make_person(1002, 100),  # same session
                    _make_person(1003, 200),  # different session
                ],
                requests=[
                    _make_request("r1", 1001, 1002, 100, request_type="bunk_with"),
                    _make_request("r2", 1001, 1003, 100, request_type="bunk_with"),
                ],
                bunks=[_make_bunk(2001, 100), _make_bunk(2002, 200)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert solver.possible_requests[1001][0].id == "r1"
        assert len(solver.impossible_requests[1001]) == 1
        assert solver.impossible_requests[1001][0].id == "r2"

    def test_age_preference_in_bounds_is_possible(self, mock_config):
        """age_preference requests where the requester is not at the same-gender
        grade bound (in the wrong direction) remain possible. See
        TestValidateRequestsAgePrefNoEligibleGrade for the at-bound case
        (which lands in impossible_requests per camp policy)."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F", grade=4),
                    _make_person(1002, 100, gender="F", grade=6),  # older same-gender peer
                ],
                requests=[
                    DirectBunkRequest(
                        id="r1",
                        requester_person_cm_id=1001,
                        request_type="age_preference",
                        age_preference_target="older",
                        session_cm_id=100,
                        year=2026,
                        status="resolved",
                    ),
                ],
                bunks=[_make_bunk(2001, 100)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_validation_summary_counts_cross_session_as_impossible(self, mock_config):
        """request_validation_summary should count cross-session requests as impossible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 200)],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 100), _make_bunk(2002, 200)],
            ),
            ConfigLoader.get_instance(),
        )

        assert solver.request_validation_summary["impossible_requests"] == 1
        assert solver.request_validation_summary["affected_campers"] == 1

    def test_affected_campers_dedupes_flat_against_target_not_in_solver(self, mock_config):
        """A camper with BOTH a predicate-caught impossible request and a
        target-not-in-solver request must be counted ONCE, not twice."""
        # Person 1001 has two impossible requests:
        #   r1: bunk_with cross-session 1002 → caught by predicate (report.flat)
        #   r2: bunk_with 9999 (not in person_idx_map) → target_not_in_solver_extra
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 100), _make_person(1002, 200)],
                requests=[
                    _make_request("r1", 1001, 1002, 100, request_type="bunk_with"),
                    _make_request("r2", 1001, 9999, 100, request_type="bunk_with"),
                ],
                bunks=[_make_bunk(2001, 100), _make_bunk(2002, 200)],
            ),
            ConfigLoader.get_instance(),
        )

        assert solver.request_validation_summary["impossible_requests"] == 2
        # Both requests come from camper 1001 — affected count is 1, not 2.
        assert solver.request_validation_summary["affected_campers"] == 1


class TestValidateRequestsPairNoSharedBunk:
    """bunk_with between campers with no shared eligible bunk is impossible.

    The Taste-1 infeasibility uncovered by PR #1391 (Stage 4 hard MSO) traced
    to cross-gender bunk_with MP requests slipping past _validate_requests.
    The hard MP constraint then forced co-placement that gender constraints
    forbid → INFEASIBLE.
    """

    def test_bunk_with_cross_gender_is_impossible(self, mock_config):
        """Girl asks bunk_with a boy in same session — no gender-compatible shared bunk."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F"),
                    _make_person(1002, 100, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[
                    _make_bunk(2001, 100, gender="F"),
                    _make_bunk(2002, 100, gender="M"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1
        assert solver.request_validation_summary["impossible_by_reason"]["pair_no_shared_bunk"] == 1

    def test_not_bunk_with_cross_gender_is_possible(self, mock_config):
        """not_bunk_with cross-gender is trivially satisfied — gender already separates them."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F"),
                    _make_person(1002, 100, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="not_bunk_with")],
                bunks=[
                    _make_bunk(2001, 100, gender="F"),
                    _make_bunk(2002, 100, gender="M"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_bunk_with_with_ag_bunk_available_is_possible(self, mock_config):
        """AG/Mixed bunks accept any gender — cross-gender bunk_with stays possible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F"),
                    _make_person(1002, 100, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 100, gender="AG")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_same_gender_bunk_with_remains_possible(self, mock_config):
        """Sanity: same-gender bunk_with is unaffected by the new check."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F"),
                    _make_person(1002, 100, gender="F"),
                ],
                requests=[_make_request("r1", 1001, 1002, 100, request_type="bunk_with")],
                bunks=[
                    _make_bunk(2001, 100, gender="F"),
                    _make_bunk(2002, 100, gender="M"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0


def _age_pref_request(req_id: str, requester: int, session: int, *, target: str) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        request_type="age_preference",
        age_preference_target=target,
        session_cm_id=session,
        year=2026,
        status="resolved",
    )


class TestValidateRequestsAgePrefNoEligibleGrade:
    """age_preference at the same-gender grade bound (in the wrong direction) is impossible.

    Camp policy per staff: if a camper prefers older kids but they're the oldest
    grade in the session for their gender, "too bad, it's impossible." Same for
    youngest-prefers-younger. Surfacing these in the impossibility breakdown
    keeps them visible to staff via mp_set_entirely_impossible.

    The bound is computed from the session's actual same-gender camper pool
    (AG cabins don't enter — person.gender is M or F; AG is a bunk attribute).
    A follow-up issue tracks tying this to admin-configured min/max grades.
    """

    def test_older_at_max_grade_is_impossible(self, mock_config):
        """M grade 6 prefers older; session has only grade ≤6 boys → impossible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="M", grade=6),
                    _make_person(1002, 100, gender="M", grade=5),
                    _make_person(1003, 100, gender="M", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="older")],
                bunks=[_make_bunk(2001, 100, gender="M")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1
        assert solver.request_validation_summary["impossible_by_reason"]["age_pref_no_eligible_grade"] == 1

    def test_younger_at_min_grade_is_impossible(self, mock_config):
        """F grade 2 prefers younger; session has only grade ≥2 girls → impossible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="F", grade=2),
                    _make_person(1002, 100, gender="F", grade=3),
                    _make_person(1003, 100, gender="F", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="younger")],
                bunks=[_make_bunk(2001, 100, gender="F")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1

    def test_older_with_older_same_gender_peer_is_possible(self, mock_config):
        """M grade 6 prefers older; session HAS a grade-7 boy → possible (in bounds)."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="M", grade=6),
                    _make_person(1002, 100, gender="M", grade=7),
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="older")],
                bunks=[_make_bunk(2001, 100, gender="M")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_opposite_preference_at_bound_remains_possible(self, mock_config):
        """M grade 6 prefers YOUNGER while at max grade — fine, younger boys exist."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="M", grade=6),
                    _make_person(1002, 100, gender="M", grade=5),
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="younger")],
                bunks=[_make_bunk(2001, 100, gender="M")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_older_grade_in_other_gender_does_not_count(self, mock_config):
        """M grade 6 prefers older; older girls exist but no older boys → impossible.

        Per camp policy (and the cross-gender gate landed earlier), older
        kids of the OTHER gender don't satisfy 'older' for a single-gender
        bunk — and AG isn't a person attribute. Same-gender pool only.
        """
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="M", grade=6),
                    _make_person(1002, 100, gender="M", grade=5),
                    _make_person(1003, 100, gender="F", grade=8),  # older but wrong gender
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="older")],
                bunks=[
                    _make_bunk(2001, 100, gender="M"),
                    _make_bunk(2002, 100, gender="F"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1

    def test_no_same_gender_peers_marks_impossible(self, mock_config):
        """Degenerate: lone-gender camper in session → no same-gender peers → impossible.

        If you're the only boy in a session, there are no older OR younger
        boys to bunk with. Either direction is moot.
        """
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 100, gender="M", grade=4),
                    _make_person(1002, 100, gender="F", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 100, target="older")],
                bunks=[
                    _make_bunk(2001, 100, gender="M"),
                    _make_bunk(2002, 100, gender="F"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1
