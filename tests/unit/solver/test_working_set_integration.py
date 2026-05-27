"""Unit B Tasks 5–7: working-set reduction wired into DirectBunkingSolver (#1609).

Tests verify:
  Task 5 — solver builds its CP-SAT model from the REDUCED working set only
  Task 6 — frozen rosters are merged into the output + partial_resolve summary
  Task 7 — run-result stats are scored against the FULL merged board
"""

from typing import Any, ClassVar
from unittest.mock import MagicMock

from bunking.config import ConfigLoader
from bunking.models_v2 import (
    DirectBunk,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.solver.direct_solver import DirectBunkingSolver

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

DEFAULT_SESSION = 1000001
DEFAULT_YEAR = 2026
DEFAULT_BIRTHDATE = "2015-06-15"

FICTIONAL_NAMES = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Noah", "Williams"),
    ("Ava", "Martinez"),
]


def _person(cm_id: int) -> DirectPerson:
    first, last = FICTIONAL_NAMES[cm_id % len(FICTIONAL_NAMES)]
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first,
        last_name=last,
        grade=6,
        birthdate=DEFAULT_BIRTHDATE,
        gender="F",
        session_cm_id=DEFAULT_SESSION,
    )


def _bunk(cm_id: int, name: str | None = None) -> DirectBunk:
    return DirectBunk(
        id=f"pb-{cm_id}",
        campminder_id=cm_id,
        name=name or f"G-{cm_id - 3000}",
        capacity=12,
        gender="F",
        session_cm_id=DEFAULT_SESSION,
    )


class _ZeroPenaltyLoader:
    """Stub ConfigLoader that zeros all penalties."""

    _values: ClassVar[dict[str, int]] = {
        "constraint.cabin_minimum_occupancy.penalty": 0,
        "constraint.grade_spread.penalty": 0,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


def _make_cfg() -> Any:
    """Canonical MagicMock config used across partial-resolve unit tests."""
    cfg = MagicMock()

    def _get_constraint(constraint_type: str, param: str, default: Any = None) -> Any:
        if constraint_type == "grade_spread" and param == "max_spread":
            return 2
        return default if default is not None else 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = lambda key, default=None: default if default is not None else 0
    cfg.get_float.side_effect = lambda key, default=None: default if default is not None else 0.0
    cfg.get_str.side_effect = lambda key, default=None: "hard" if "grade_spread.mode" in key else (default or "")
    cfg.get_bool.side_effect = lambda key, default=None: default if default is not None else False
    cfg.get_soft_constraint_weight.side_effect = lambda name: 0
    return cfg


# ---------------------------------------------------------------------------
# Task 5: model built from reduced working set
# ---------------------------------------------------------------------------


def test_solver_excludes_locked_entities_from_model() -> None:
    """After reduction, solver.person_ids and solver.bunks reflect only the unlocked world."""
    persons = [_person(i) for i in (1, 2, 3)]
    bunks = [
        _bunk(3001, name="G-1"),
        _bunk(3002, name="G-2"),
    ]
    inp = DirectSolverInput(
        persons=persons,
        requests=[],
        bunks=bunks,
        locked_bunks={3001: [1, 2]},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        solver = DirectBunkingSolver(inp, _make_cfg())

    # Model only sees the unlocked camper and bunk
    assert set(solver.person_ids) == {3}
    assert {b.campminder_id for b in solver.bunks} == {3002}

    # Full input preserved
    assert {p.campminder_person_id for p in solver._full_input.persons} == {1, 2, 3}

    # Frozen assignments captured
    frozen_pairs = {(a.person_cm_id, a.bunk_cm_id) for a in solver._frozen_assignments}
    assert frozen_pairs == {(1, 3001), (2, 3001)}


# ---------------------------------------------------------------------------
# Task 6: frozen rosters merged into output + partial_resolve summary
# ---------------------------------------------------------------------------


def test_output_contains_frozen_plus_working_and_partial_summary() -> None:
    """solve() must include frozen roster rows and the partial_resolve stats key."""
    persons = [_person(i) for i in (1, 2, 3)]
    bunks = [
        _bunk(3001, name="G-1"),
        _bunk(3002, name="G-2"),
    ]
    inp = DirectSolverInput(
        persons=persons,
        requests=[],
        bunks=bunks,
        locked_bunks={3001: [1, 2]},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        out = DirectBunkingSolver(inp, _make_cfg()).solve(time_limit_seconds=5)

    assert out is not None
    placed = {(a.person_cm_id, a.bunk_cm_id) for a in out.assignments}
    # Frozen roster preserved
    assert (1, 3001) in placed
    assert (2, 3001) in placed
    # Working camper placed in the unlocked bunk
    assert (3, 3002) in placed
    # Partial summary present
    assert "partial_resolve" in out.stats
    assert out.stats["partial_resolve"]["cross_boundary_request_count"] == 0


# ---------------------------------------------------------------------------
# Task 7: full-board scoring includes locked-bunk requests
# ---------------------------------------------------------------------------


def test_run_stats_score_full_board_including_locked_requests() -> None:
    """A bunk_with request whose both parties are frozen-together must appear in satisfied_requests."""
    persons = [_person(i) for i in (1, 2, 3)]
    bunks = [
        _bunk(3001, name="G-1"),
        _bunk(3002, name="G-2"),
    ]
    r1 = DirectBunkRequest(
        id="r1",
        requester_person_cm_id=1,
        requested_person_cm_id=2,
        request_type="bunk_with",
        session_cm_id=DEFAULT_SESSION,
        year=DEFAULT_YEAR,
        source_field="bunk_request_form",
        status="resolved",
    )
    inp = DirectSolverInput(
        persons=persons,
        requests=[r1],
        bunks=bunks,
        locked_bunks={3001: [1, 2]},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        out = DirectBunkingSolver(inp, _make_cfg()).solve(time_limit_seconds=5)

    assert out is not None
    # r1 (bunk_with between frozen campers 1 and 2) must be satisfied by the freeze
    satisfied_for_1 = out.satisfied_requests.get(1, [])
    assert "r1" in satisfied_for_1
    # Stats should reflect the full request board, not the empty working-set
    assert out.stats["total_requests"] >= 1


# ---------------------------------------------------------------------------
# partial_resolve key: present on allow_unassigned=True solves
# ---------------------------------------------------------------------------


def test_partial_resolve_stats_attached_via_solve() -> None:
    """End-to-end: allow_unassigned=True → partial_resolve key appears in output.stats.

    16 F campers across 2 bunks (satisfies min-occupancy 8/bunk). Bunk 3001 locked
    with 8 occupants; bunk 3002 is free. 8 unlocked campers all land in bunk 3002.
    All 16 are placed → unassigned_count == 0.
    """
    locked_ids = list(range(1001, 1009))  # 8 campers frozen in bunk 3001
    unlocked_ids = list(range(2001, 2009))  # 8 campers to be placed in bunk 3002
    persons = [_person(i) for i in locked_ids + unlocked_ids]
    bunks = [_bunk(3001), _bunk(3002)]
    inp = DirectSolverInput(
        persons=persons,
        bunks=bunks,
        requests=[],
        locked_bunks={3001: locked_ids},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        out = DirectBunkingSolver(inp, _make_cfg()).solve(time_limit_seconds=5)

    assert out is not None
    assert "partial_resolve" in out.stats
    assert out.stats["partial_resolve"]["unassigned_count"] == 0  # all 16 placed
    assert out.stats["partial_resolve"]["cross_boundary_request_count"] == 0
