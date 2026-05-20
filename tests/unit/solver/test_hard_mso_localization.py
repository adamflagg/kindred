"""Smoke + correctness tests for localize_hard_mso_infeasibility.

See docs/architecture/solver-internals.md ("Infeasibility localization
(IIS)") for the design. Verifies the IIS-style diagnostic that runs
after find_infeasibility_cause identifies parent_paramount as the
cause.
"""

from __future__ import annotations

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver import feasibility
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
    """MP bunk_with: source_field='bunk_request_form' makes it material parent per is_material_parent_request."""
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requestee,
        request_type="bunk_with",
        source_field="bunk_request_form",
        session_cm_id=session,
        year=2026,
        status="resolved",
        priority=1,
    )


class TestLocalizeHardMSOInfeasibility:
    def test_returns_skipped_when_no_mp_candidates(self, mock_config):
        """If no campers have possible MP, the localizer returns a 'skipped' result."""
        si = DirectSolverInput(
            persons=[_person(1001, 1000001), _person(1002, 1000001)],
            requests=[],  # No requests at all
            bunks=[_bunk(2001, 1000001)],
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
            persons=[_person(1001, 1000001), _person(1002, 1000001)],
            requests=[_bunk_with_mp("r1", 1001, 1002, 1000001)],
            bunks=[_bunk(2001, 1000001)],
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
            persons=[_person(1001, 1000001), _person(1002, 1000001)],
            requests=[],
            bunks=[_bunk(2001, 1000001)],
        )

        result = localize_hard_mso_infeasibility(si, ConfigLoader.get_instance(), time_limit_seconds=2)

        for key in ("approach", "candidate_count", "singleton_critical_cms", "minimal_correction_set", "notes"):
            assert key in result, f"missing key {key} in result dict"
        assert result["approach"] in ("singleton", "deletion_filter", "skipped")
        assert isinstance(result["singleton_critical_cms"], list)
        assert isinstance(result["minimal_correction_set"], list)


def _three_candidate_input() -> DirectSolverInput:
    """3 MP-hard-constrained requesters (1001, 1002, 1003 → 1004) → exactly 3 candidates."""
    return DirectSolverInput(
        persons=[_person(1001, 1000001), _person(1002, 1000001), _person(1003, 1000001), _person(1004, 1000001)],
        requests=[
            _bunk_with_mp("r1", 1001, 1004, 1000001),
            _bunk_with_mp("r2", 1002, 1004, 1000001),
            _bunk_with_mp("r3", 1003, 1004, 1000001),
        ],
        bunks=[_bunk(2001, 1000001)],
    )


class TestLocalizeUnknownProbeHandling:
    """A CP-SAT probe that returns UNKNOWN (e.g. hit the time limit) is
    inconclusive and MUST abort localization with approach='skipped' — never
    be silently treated as INFEASIBLE. Treating UNKNOWN as infeasible produces
    false 'cause is not parent_paramount' verdicts and spurious
    minimal_correction_set results.

    Pre-fix, only the singleton pass checked for UNKNOWN; the deletion-filter
    flow did not. These guard the deletion-filter probe sites.
    """

    def test_singleton_probe_unknown_returns_skipped(self, mock_config, monkeypatch):
        """An UNKNOWN during the singleton pass aborts with approach='skipped'."""
        monkeypatch.setattr(feasibility, "_probe_mp_feasibility", lambda *_args, **_kwargs: None)

        result = localize_hard_mso_infeasibility(
            _three_candidate_input(), ConfigLoader.get_instance(), time_limit_seconds=2
        )

        assert result["approach"] == "skipped"
        assert "UNKNOWN" in result["notes"]

    def test_deletion_filter_full_removal_unknown_returns_skipped(self, mock_config, monkeypatch):
        """An UNKNOWN on the full-removal probe aborts — not a false
        'cause is not parent_paramount' verdict."""

        def fake(input_data, config, time_limit_seconds, skip, impossibility_report=None):
            # Singletons (len 1) are non-critical; full removal (len 3) is inconclusive.
            return False if len(skip) == 1 else None

        monkeypatch.setattr(feasibility, "_probe_mp_feasibility", fake)

        result = localize_hard_mso_infeasibility(
            _three_candidate_input(), ConfigLoader.get_instance(), time_limit_seconds=2
        )

        assert result["approach"] == "skipped"
        assert "UNKNOWN" in result["notes"]

    def test_deletion_filter_trial_unknown_returns_skipped(self, mock_config, monkeypatch):
        """An UNKNOWN on a deletion-filter trial probe aborts — not a false
        minimal_correction_set."""

        def fake(input_data, config, time_limit_seconds, skip, impossibility_report=None):
            n = len(skip)
            if n == 1:
                return False  # no singleton is critical
            if n == 3:
                return True  # full removal restores feasibility → enter the loop
            return None  # a deletion-filter trial (len 2) is inconclusive

        monkeypatch.setattr(feasibility, "_probe_mp_feasibility", fake)

        result = localize_hard_mso_infeasibility(
            _three_candidate_input(), ConfigLoader.get_instance(), time_limit_seconds=2
        )

        assert result["approach"] == "skipped"
        assert result["minimal_correction_set"] == []
        assert "UNKNOWN" in result["notes"]


class TestLocalizeDeterministicOrdering:
    """candidate_cms must be sorted so the deletion-filter walk — and the
    minimal_correction_set it produces — is reproducible regardless of the
    upstream request/dict insertion order."""

    def test_candidates_probed_in_sorted_order(self, mock_config, monkeypatch):
        probed: list[set[int]] = []

        def fake(input_data, config, time_limit_seconds, skip, impossibility_report=None):
            probed.append(set(skip))
            return len(skip) != 1  # singletons infeasible; larger skip sets feasible

        monkeypatch.setattr(feasibility, "_probe_mp_feasibility", fake)

        # Requests deliberately out of CM order: requester 1003 first, then 1001, 1002.
        si = DirectSolverInput(
            persons=[_person(1001, 1000001), _person(1002, 1000001), _person(1003, 1000001), _person(1004, 1000001)],
            requests=[
                _bunk_with_mp("r3", 1003, 1004, 1000001),
                _bunk_with_mp("r1", 1001, 1004, 1000001),
                _bunk_with_mp("r2", 1002, 1004, 1000001),
            ],
            bunks=[_bunk(2001, 1000001)],
        )

        localize_hard_mso_infeasibility(si, ConfigLoader.get_instance(), time_limit_seconds=2)

        # Singleton pass = first len(candidates) probes, in ascending CM order.
        assert probed[:3] == [{1001}, {1002}, {1003}]
