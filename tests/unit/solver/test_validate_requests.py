"""Tests for DirectBunkingSolver._validate_requests() cross-session handling.

When a bunk_with request targets a camper in a different session, it should be
classified as impossible — session boundary constraints make it unsatisfiable.

When a not_bunk_with request targets a camper in a different session, it should
remain possible — session boundaries already guarantee separation.
"""

import logging

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
    source_field: str = "bunk_request_form",
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type,
        session_cm_id=session,
        year=2026,
        status="resolved",
        source_field=source_field,
    )


class TestValidateRequestsCrossSession:
    """_validate_requests must check session compatibility, not just solver membership."""

    def test_bunk_with_same_session_is_possible(self, mock_config):
        """bunk_with targeting a camper in the same session is possible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000001)],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 1000001)],
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
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000002)],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 1000001), _make_bunk(2002, 1000002)],
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
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000002)],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="not_bunk_with")],
                bunks=[_make_bunk(2001, 1000001), _make_bunk(2002, 1000002)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_not_bunk_with_same_session_is_possible(self, mock_config):
        """not_bunk_with targeting a camper in the same session is possible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000001)],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="not_bunk_with")],
                bunks=[_make_bunk(2001, 1000001)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_bunk_with_person_not_in_solver_is_impossible(self, mock_config):
        """bunk_with targeting someone not in the solver at all (existing behavior)."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 1000001)],
                requests=[_make_request("r1", 1001, 9999, 1000001, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 1000001)],
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
                    _make_person(1001, 1000001),
                    _make_person(1002, 1000001),  # same session
                    _make_person(1003, 1000002),  # different session
                ],
                requests=[
                    _make_request("r1", 1001, 1002, 1000001, request_type="bunk_with"),
                    _make_request("r2", 1001, 1003, 1000001, request_type="bunk_with"),
                ],
                bunks=[_make_bunk(2001, 1000001), _make_bunk(2002, 1000002)],
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
                    _make_person(1001, 1000001, gender="F", grade=4),
                    _make_person(1002, 1000001, gender="F", grade=6),  # older same-gender peer
                ],
                requests=[
                    DirectBunkRequest(
                        id="r1",
                        requester_person_cm_id=1001,
                        request_type="age_preference",
                        age_preference_target="older",
                        session_cm_id=1000001,
                        year=2026,
                        status="resolved",
                    ),
                ],
                bunks=[_make_bunk(2001, 1000001)],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 1
        assert len(solver.impossible_requests[1001]) == 0

    def test_validation_summary_counts_cross_session_as_impossible(self, mock_config):
        """request_validation_summary should count cross-session requests as impossible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000002)],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 1000001), _make_bunk(2002, 1000002)],
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
        #   r2: bunk_with 9999 (not in person_idx_map) → target_not_in_solver predicate (report.flat)
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[_make_person(1001, 1000001), _make_person(1002, 1000002)],
                requests=[
                    _make_request("r1", 1001, 1002, 1000001, request_type="bunk_with"),
                    _make_request("r2", 1001, 9999, 1000001, request_type="bunk_with"),
                ],
                bunks=[_make_bunk(2001, 1000001), _make_bunk(2002, 1000002)],
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
                    _make_person(1001, 1000001, gender="F"),
                    _make_person(1002, 1000001, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[
                    _make_bunk(2001, 1000001, gender="F"),
                    _make_bunk(2002, 1000001, gender="M"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1
        assert solver.request_validation_summary["impossible_by_reason"]["material_parent"] == {
            "pair_no_shared_bunk": 1
        }

    def test_not_bunk_with_cross_gender_is_possible(self, mock_config):
        """not_bunk_with cross-gender is trivially satisfied — gender already separates them."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 1000001, gender="F"),
                    _make_person(1002, 1000001, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="not_bunk_with")],
                bunks=[
                    _make_bunk(2001, 1000001, gender="F"),
                    _make_bunk(2002, 1000001, gender="M"),
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
                    _make_person(1001, 1000001, gender="F"),
                    _make_person(1002, 1000001, gender="M"),
                ],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[_make_bunk(2001, 1000001, gender="AG")],
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
                    _make_person(1001, 1000001, gender="F"),
                    _make_person(1002, 1000001, gender="F"),
                ],
                requests=[_make_request("r1", 1001, 1002, 1000001, request_type="bunk_with")],
                bunks=[
                    _make_bunk(2001, 1000001, gender="F"),
                    _make_bunk(2002, 1000001, gender="M"),
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
        source_field="socialize_with",
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
                    _make_person(1001, 1000001, gender="M", grade=6),
                    _make_person(1002, 1000001, gender="M", grade=5),
                    _make_person(1003, 1000001, gender="M", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="older")],
                bunks=[_make_bunk(2001, 1000001, gender="M")],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1
        # Group 65 #1539: impossible_by_reason["immaterial_parent"] is now filtered
        # out of the popup-visible summary (socialize_with / age-pref rows are not
        # actionable for staff). The raw impossibility_report still records them.
        assert solver.request_validation_summary["impossible_by_reason"]["immaterial_parent"] == {}
        # The raw report still contains the impossible item.
        assert any(item.bucket == "immaterial_parent" for item in solver.impossibility_report.flat)

    def test_younger_at_min_grade_is_impossible(self, mock_config):
        """F grade 2 prefers younger; session has only grade ≥2 girls → impossible."""
        solver = DirectBunkingSolver(
            DirectSolverInput(
                persons=[
                    _make_person(1001, 1000001, gender="F", grade=2),
                    _make_person(1002, 1000001, gender="F", grade=3),
                    _make_person(1003, 1000001, gender="F", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="younger")],
                bunks=[_make_bunk(2001, 1000001, gender="F")],
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
                    _make_person(1001, 1000001, gender="M", grade=6),
                    _make_person(1002, 1000001, gender="M", grade=7),
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="older")],
                bunks=[_make_bunk(2001, 1000001, gender="M")],
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
                    _make_person(1001, 1000001, gender="M", grade=6),
                    _make_person(1002, 1000001, gender="M", grade=5),
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="younger")],
                bunks=[_make_bunk(2001, 1000001, gender="M")],
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
                    _make_person(1001, 1000001, gender="M", grade=6),
                    _make_person(1002, 1000001, gender="M", grade=5),
                    _make_person(1003, 1000001, gender="F", grade=8),  # older but wrong gender
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="older")],
                bunks=[
                    _make_bunk(2001, 1000001, gender="M"),
                    _make_bunk(2002, 1000001, gender="F"),
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
                    _make_person(1001, 1000001, gender="M", grade=4),
                    _make_person(1002, 1000001, gender="F", grade=4),
                ],
                requests=[_age_pref_request("r1", 1001, 1000001, target="older")],
                bunks=[
                    _make_bunk(2001, 1000001, gender="M"),
                    _make_bunk(2002, 1000001, gender="F"),
                ],
            ),
            ConfigLoader.get_instance(),
        )

        assert len(solver.possible_requests[1001]) == 0
        assert len(solver.impossible_requests[1001]) == 1


class TestImpossibilityReportReuse:
    """DirectBunkingSolver accepts a precomputed ImpossibilityReport so the
    diagnostic probe loops (find_infeasibility_cause, localize_hard_mso_
    infeasibility) build many solvers without re-running the full
    request×predicate scan on every construction.
    """

    @staticmethod
    def _input() -> DirectSolverInput:
        return DirectSolverInput(
            persons=[_make_person(1001, 1000001), _make_person(1002, 1000001)],
            requests=[_make_request("r1", 1001, 1002, 1000001)],
            bunks=[_make_bunk(2001, 1000001)],
        )

    def test_no_report_runs_validate_impossibility(self, mock_config, monkeypatch):
        """Default path: validate_impossibility runs once and the report is stored."""
        from bunking.solver import impossibility

        calls = {"n": 0}
        real = impossibility.validate_impossibility

        def counting(*args, **kwargs):
            calls["n"] += 1
            return real(*args, **kwargs)

        monkeypatch.setattr(impossibility, "validate_impossibility", counting)

        solver = DirectBunkingSolver(self._input(), ConfigLoader.get_instance())

        assert calls["n"] == 1
        assert solver.impossibility_report is not None

    def test_precomputed_report_skips_validate_impossibility(self, mock_config, monkeypatch):
        """Passing impossibility_report reuses it — validate_impossibility is not re-run,
        and request classification is identical to the from-scratch path."""
        from bunking.solver import impossibility

        base = DirectBunkingSolver(self._input(), ConfigLoader.get_instance())
        report = base.impossibility_report

        calls = {"n": 0}
        real = impossibility.validate_impossibility

        def counting(*args, **kwargs):
            calls["n"] += 1
            return real(*args, **kwargs)

        monkeypatch.setattr(impossibility, "validate_impossibility", counting)

        reused = DirectBunkingSolver(self._input(), ConfigLoader.get_instance(), impossibility_report=report)

        assert calls["n"] == 0
        assert reused.impossibility_report is report
        # Classification still happens — possible/impossible dicts populated identically.
        assert {k: [r.id for r in v] for k, v in reused.possible_requests.items()} == {
            k: [r.id for r in v] for k, v in base.possible_requests.items()
        }


class TestValidateRequestsReasonSummaryLog:
    """The infeasibility warning must stay informative even when the bucketed
    breakdown is empty.

    _build_impossible_by_reason_by_bucket drops requests with a missing or
    unknown source_field, but total_impossible still counts them. When every
    impossible request is dropped this way, the per-bucket breakdown is all
    empty and the log line must not degrade to a bare "infeasible ()".
    """

    def test_warning_not_empty_parens_when_all_unclassified(self, mock_config, caplog):
        """All impossible requests have an unclassifiable source_field → empty
        bucketed breakdown, but the warning still carries a reason note."""
        with caplog.at_level(logging.WARNING):
            solver = DirectBunkingSolver(
                DirectSolverInput(
                    persons=[_make_person(1001, 1000001)],
                    requests=[_make_request("r1", 1001, 9999, 1000001, source_field="garbage_field")],
                    bunks=[_make_bunk(2001, 1000001)],
                ),
                ConfigLoader.get_instance(),
            )

        # Counted as impossible, but dropped from the bucketed breakdown.
        assert solver.request_validation_summary["impossible_requests"] == 1
        assert solver.request_validation_summary["impossible_by_reason"] == {
            "material_parent": {},
            "immaterial_parent": {},
            "staff": {},
        }

        infeasible_warnings = [r.message for r in caplog.records if "infeasible" in r.message]
        assert infeasible_warnings, "expected an infeasibility warning to be logged"
        assert "infeasible ()" not in infeasible_warnings[0]


def test_target_not_in_solver_classified_impossible_after_delegation():
    """_validate_requests still classifies a bunk_with to a non-roster target as
    impossible — now via the predicate, not the deleted hand-rolled fallback."""
    from unittest.mock import MagicMock

    from bunking.solver.direct_solver import DirectBunkingSolver
    from tests.unit.solver.impossibility.conftest import (
        make_bunk,
        make_input,
        make_person,
        make_request,
    )

    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    requests = [make_request("r_ghost", requester=1, requestee=777, session=1000001)]
    input_data = make_input([p1], bunks, requests)

    solver = DirectBunkingSolver(input_data, MagicMock())

    impossible_ids = {r.id for reqs in solver.impossible_requests.values() for r in reqs}
    assert "r_ghost" in impossible_ids


def test_mp_set_entirely_impossible_populated_at_init():
    """The entirely-impossible MP camper rollup is populated during __init__
    (from the report), before add_constraints runs."""
    from unittest.mock import MagicMock

    from bunking.solver.direct_solver import DirectBunkingSolver
    from tests.unit.solver.impossibility.conftest import (
        make_bunk,
        make_input,
        make_person,
        make_request,
    )

    p1 = make_person(1, session=1000001, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    # Camper 1's only MP request targets a non-roster cm_id -> entire MP set impossible.
    requests = [make_request("r1", requester=1, requestee=777, session=1000001)]
    input_data = make_input([p1], bunks, requests)

    solver = DirectBunkingSolver(input_data, MagicMock())

    assert solver.mp_set_entirely_impossible == [1]
