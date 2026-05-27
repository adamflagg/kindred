"""Regression guards: locked-roster infeasibility scenarios now return FEASIBLE (#1609).

Units A+B replaced the old "pin locked occupants + skip them per-constraint"
mechanism with a "reduce to unlocked working set" approach.  Because locked
campers are *removed* from the CP-SAT model entirely, two scenarios that were
previously infeasible under the old approach now produce feasible solutions:

  Scenario 1 — HARD staff not_bunk_with between two campers frozen together.
    Old: campers pinned to the same bunk + forced apart = INFEASIBLE.
    New: both removed from the model; staff froze them intentionally → FEASIBLE.

  Scenario 2 — Free camper's only material parent bunk_with targets a locked camper.
    Old: MSO sum(forcing)>=1 over a structurally-zero variable → INFEASIBLE.
    New: request dropped as cross-boundary; no forcing var; feasible + advisory.

Source-field confirmation
--------------------------
  * HARD_MNT key:     "staff_not_bunk_with" — (SourceField.STAFF_NOT_BUNK_WITH,
                      not_bunk_with) → SolverRule.HARD_MNT per request_registry.py.
                      Verified by test_staff_separation_wiring.py which constructs
                      the same fixture and asserts separation is enforced.
  * Material-parent:  "bunk_request_form" — (SourceField.BUNK_REQUEST_FORM,
                      bunk_with) → SolverRule.HARD_MSO, RequestBucket.MATERIAL_PARENT
                      per request_registry.py.  Verified by test_parent_paramount_
                      diagnostic.py which builds the same fixture and asserts
                      material_parent_unmet is raised.
"""

from bunking.config import ConfigLoader
from bunking.models_v2 import (
    DirectBunk,
    DirectBunkRequest,
    DirectPerson,
    DirectSolverInput,
)
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.unit.solver.test_working_set_integration import _make_cfg, _ZeroPenaltyLoader

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

DEFAULT_SESSION = 1000001
DEFAULT_YEAR = 2026
DEFAULT_BIRTHDATE = "2015-06-15"

_FICTIONAL_NAMES = [
    ("Emma", "Johnson"),
    ("Liam", "Garcia"),
    ("Olivia", "Chen"),
    ("Noah", "Williams"),
    ("Ava", "Martinez"),
    ("Ethan", "Brown"),
]


def _person(cm_id: int) -> DirectPerson:
    first, last = _FICTIONAL_NAMES[cm_id % len(_FICTIONAL_NAMES)]
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=first,
        last_name=last,
        grade=6,
        birthdate=DEFAULT_BIRTHDATE,
        gender="F",
        session_cm_id=DEFAULT_SESSION,
    )


def _f_bunk(cm_id: int, name: str) -> DirectBunk:
    return DirectBunk(
        id=f"pb-{cm_id}",
        campminder_id=cm_id,
        name=name,
        capacity=12,
        gender="F",
        session_cm_id=DEFAULT_SESSION,
    )


# ---------------------------------------------------------------------------
# Scenario 1: HARD staff not_bunk_with inside a locked cabin → FEASIBLE
# ---------------------------------------------------------------------------


def test_staff_not_bunk_with_inside_locked_cabin_is_feasible() -> None:
    """Campers 1 & 2 frozen together in locked bunk 3001, with a HARD staff
    not_bunk_with between them.

    OLD approach: pinned to the same bunk + forced apart = INFEASIBLE.
    NEW approach: both removed from the model entirely; staff chose to freeze
    them together, so the constraint never fires → FEASIBLE.

    Source-field: "staff_not_bunk_with" classifies as SolverRule.HARD_MNT via
    the registry — the same key used by test_staff_separation_wiring.py.
    """
    inp = DirectSolverInput(
        persons=[_person(i) for i in (1, 2, 3, 4)],
        requests=[
            DirectBunkRequest(
                id="nbw-staff",
                requester_person_cm_id=1,
                requested_person_cm_id=2,
                request_type="not_bunk_with",
                source_field="staff_not_bunk_with",
                session_cm_id=DEFAULT_SESSION,
                year=DEFAULT_YEAR,
            )
        ],
        bunks=[_f_bunk(3001, "G-1"), _f_bunk(3002, "G-2")],
        locked_bunks={3001: [1, 2]},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        out = DirectBunkingSolver(inp, _make_cfg()).solve(time_limit_seconds=5)

    assert out is not None, (
        "INFEASIBLE — reduction did not remove the locked campers from the model; "
        "the HARD_MNT staff separation constraint is firing on a pinned roster"
    )


# ---------------------------------------------------------------------------
# Scenario 2: material parent bunk_with targeting locked camper → FEASIBLE
# ---------------------------------------------------------------------------


def test_material_bunk_with_into_locked_cabin_is_feasible_and_reported() -> None:
    """Free camper 3's only material parent request targets locked camper 1.

    OLD approach: MSO adds sum(forcing_vars)>=1 but the only forcing var is
    structurally zero (target removed/pinned) → INFEASIBLE.
    NEW approach: request dropped as cross-boundary at reduction time; no
    forcing var; no MSO constraint; feasible + advisory counter incremented.

    Source-field: "bunk_request_form" classifies as SolverRule.HARD_MSO /
    RequestBucket.MATERIAL_PARENT via the registry — the same key used by
    test_parent_paramount_diagnostic.py.
    """
    inp = DirectSolverInput(
        persons=[_person(i) for i in (1, 2, 3)],
        requests=[
            DirectBunkRequest(
                id="mp-cross",
                requester_person_cm_id=3,
                requested_person_cm_id=1,
                request_type="bunk_with",
                source_field="bunk_request_form",
                session_cm_id=DEFAULT_SESSION,
                year=DEFAULT_YEAR,
            )
        ],
        bunks=[_f_bunk(3001, "G-1"), _f_bunk(3002, "G-2")],
        locked_bunks={3001: [1, 2]},
        allow_unassigned=True,
    )

    with ConfigLoader.use(_ZeroPenaltyLoader()):  # type: ignore[arg-type]
        out = DirectBunkingSolver(inp, _make_cfg()).solve(time_limit_seconds=5)

    assert out is not None, (
        "INFEASIBLE — cross-boundary bunk_with request was NOT dropped during "
        "working-set reduction; MSO forced a structurally-zero var to 1"
    )
    assert out.stats["partial_resolve"]["cross_boundary_request_count"] == 1, (
        "Expected exactly 1 cross-boundary request (camper 3 → locked camper 1); "
        f"got {out.stats['partial_resolve']['cross_boundary_request_count']}"
    )
