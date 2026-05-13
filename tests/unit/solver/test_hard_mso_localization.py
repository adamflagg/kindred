"""Smoke + correctness tests for localize_hard_mso_infeasibility.

Stream 5 (Infeasibility Localization for Hard Constraints) — see
docs/reference/solver-roadmap.md. Verifies the IIS-style diagnostic
that runs after find_infeasibility_cause identifies parent_paramount
as the cause.
"""

from __future__ import annotations

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.feasibility import localize_hard_mso_infeasibility


def _person(cm_id: int, session: int, *, gender: str = "F", grade: int = 5) -> DirectPerson:
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=f"Test{cm_id}",
        last_name="Person",
        grade=grade,
        birthdate="2015-01-01",
        gender=gender,
        session_cm_id=session,
    )


def _bunk(cm_id: int, session: int, *, gender: str = "F", capacity: int = 8) -> DirectBunk:
    return DirectBunk(
        id=f"bunk_{cm_id}",
        campminder_id=cm_id,
        name=f"B-{cm_id}",
        capacity=capacity,
        gender=gender,
        session_cm_id=session,
    )


def _bunk_with_mp(req_id: str, requester: int, requestee: int, session: int) -> DirectBunkRequest:
    """MP bunk_with: source_field='bunk_with' makes it material parent per is_material_parent_request."""
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requestee,
        request_type="bunk_with",
        source_field="bunk_with",
        session_cm_id=session,
        year=2026,
        status="resolved",
        priority=1,
    )


class TestLocalizeHardMSOInfeasibility:
    def test_returns_skipped_when_no_mp_candidates(self, mock_config):
        """If no campers have possible MP, the localizer returns a 'skipped' result."""
        si = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100)],
            requests=[],  # No requests at all
            bunks=[_bunk(2001, 100)],
        )

        result = localize_hard_mso_infeasibility(si, ConfigLoader.get_instance(), time_limit_seconds=2)

        assert result["approach"] == "skipped"
        assert result["candidate_count"] == 0
        assert result["singleton_critical_cms"] == []
        assert result["minimal_correction_set"] == []

    def test_returns_skipped_when_candidates_exceed_max(self, mock_config):
        """Bound on diagnostic cost: huge candidate sets are skipped."""
        # We can simulate this with a tiny session and max_candidates=0
        si = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100)],
            requests=[_bunk_with_mp("r1", 1001, 1002, 100)],
            bunks=[_bunk(2001, 100)],
        )

        result = localize_hard_mso_infeasibility(
            si, ConfigLoader.get_instance(), time_limit_seconds=2, max_candidates=0
        )

        assert result["approach"] == "skipped"
        assert "exceeds max_candidates" in result["notes"]

    def test_skipped_result_dict_has_expected_shape(self, mock_config):
        """The result dict always carries the keys downstream callers expect.

        We test against the skipped-path here because exercising the real
        solve path requires the live ConfigLoader (not the mock), which
        is already covered via the Taste 1 sweep end-to-end.
        """
        si = DirectSolverInput(
            persons=[_person(1001, 100), _person(1002, 100)],
            requests=[],
            bunks=[_bunk(2001, 100)],
        )

        result = localize_hard_mso_infeasibility(si, ConfigLoader.get_instance(), time_limit_seconds=2)

        for key in ("approach", "candidate_count", "singleton_critical_cms", "minimal_correction_set", "notes"):
            assert key in result, f"missing key {key} in result dict"
        assert result["approach"] in ("singleton", "deletion_filter", "skipped")
        assert isinstance(result["singleton_critical_cms"], list)
        assert isinstance(result["minimal_correction_set"], list)
