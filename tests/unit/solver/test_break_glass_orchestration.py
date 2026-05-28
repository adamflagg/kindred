"""Integration tests for the break-glass always-place orchestrator (Stream D).

When pass-1 is INFEASIBLE and overflow alone can't fix it (the capacity probe
returns False), solve() runs a terminal break-glass pass that relaxes the
request layer (parent-paramount MSO + staff NBW) from hard to penalized-soft so
that *every* camper is still placed. This REPLACES Stream C's no-assignments
return for request-conflict infeasibility.

A no-assignments return now happens only when the structural wall
self-contradicts (gender / grade-adjacency / capacity) — break-glass relaxes
requests, never structure.
"""

from collections.abc import Generator
from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.direct_solver import DirectBunkingSolver
from bunking.models_v2 import DirectBunkRequest
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from tests.unit.bunking.solver.conftest import (
    FICTIONAL_CAMPER_NAMES,
    build_direct_solver_input,
    create_bunk,
    create_person,
)


class _PenaltyStubLoader:
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


@pytest.fixture
def mock_config() -> Generator[Any]:
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

    with ConfigLoader.use(_PenaltyStubLoader()):  # type: ignore[arg-type]
        yield cfg


class TestBreakGlassOrchestration:
    def test_request_conflict_break_glass_places_everyone(self, mock_config):
        """Headline behavior: a request conflict that overflow alone can't fix is
        no longer an INFEASIBLE return — break-glass relaxes MSO and places all 25.

        Roster (mirrors the now-removed request-conflict diagnostic scenario):
          - 25 F campers, all grade 5, 2 F bunks (12-cap each = 24 strict seats)
          - 14 of the 25 have a material bunk_with to camper X (cm_id 1001)
          - Hard MSO would force X + 14 = 15 into X's bunk > 13-cap → INFEASIBLE
            even with overflow → capacity probe returns False → break-glass fires.

        Break-glass softens MSO (a hard-MSO solve here is INFEASIBLE), so the only
        way all 25 land is if the slack vars actually relaxed the request layer.
        """
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="F",
                grade=5,
            )
            for i in range(25)
        ]
        x_target = campers[0]  # cm_id 1001 — the shared bunk_with target
        bunks = [
            create_bunk(cm_id=2001, name="G-1", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="G-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        requests = [
            DirectBunkRequest(
                id=f"req-bg-{i + 1:04d}",
                requester_person_cm_id=campers[1 + i].campminder_person_id,
                requested_person_cm_id=x_target.campminder_person_id,
                request_type="bunk_with",
                source_field="bunk_request_form",
                status="resolved",
                session_cm_id=1000,
                year=2026,
                is_first_requested=True,
            )
            for i in range(14)
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks, requests=requests)

        solver = DirectBunkingSolver(input_data=solver_input, config_service=mock_config)
        result = solver.solve(time_limit_seconds=30)

        assert result is not None
        assert result.break_glass_used is True  # break-glass actually ran (not pass-2)
        assert len(result.assignments) == 25  # EVERY camper placed
        assert result.infeasibility_diagnosis is None  # not an INFEASIBLE return

        # ctx-lifetime guard: the break-glass pass must have populated the MSO
        # slack dict on the solver. If the slack dict default-constructed inside
        # each fresh ctx (instead of being backed on self and passed by
        # reference), add_break_glass_penalties would have seen an empty dict and
        # placement of all 25 with a hard MSO would have been INFEASIBLE.
        assert len(solver.break_glass_mso_unmet_vars) > 0

    def test_structural_impossibility_returns_no_assignments(self, mock_config):
        """Break-glass relaxes requests, NEVER structure. A grade-adjacency
        structural wall that self-contradicts still yields a no-assignments
        INFEASIBLE return with break_glass_used=False.

        Construction (grade-adjacency wall, verified empirically INFEASIBLE):
          - 7 grade-2 + 7 grade-4 campers (no grade 3), all F, 2 F bunks (12-cap).
          - grade_adjacency forbids any bunk holding non-adjacent grades {2, 4},
            so the 14 campers cannot all share one bunk. They cannot all fit in
            one bunk anyway (14 > 13-cap). A clean 7/7 split across the two bunks
            is structurally blocked by the interacting capacity/adjacency walls —
            the probe reports "multiple interacting constraints".
          - These walls are STRUCTURAL_HARD; break-glass (request-only relaxation)
            cannot touch them, so the solve returns no assignments.

        We assert a diagnosis string is present but do NOT assert it names a
        specific constraint (structural walls may report "multiple interacting").
        """
        # 7 grade-2 + 7 grade-4 = 14 campers, all F, 2 F bunks. The grade-adjacency
        # wall (no {2,4} bunk) plus capacity makes this structurally INFEASIBLE,
        # and break-glass (request-only relaxation) cannot help.
        campers = []
        for i in range(7):
            campers.append(
                create_person(
                    cm_id=1001 + i,
                    first_name=FICTIONAL_CAMPER_NAMES[i][0],
                    last_name=FICTIONAL_CAMPER_NAMES[i][1],
                    gender="F",
                    grade=2,
                )
            )
        for i in range(7):
            campers.append(
                create_person(
                    cm_id=1101 + i,
                    first_name=FICTIONAL_CAMPER_NAMES[7 + i][0],
                    last_name=FICTIONAL_CAMPER_NAMES[7 + i][1],
                    gender="F",
                    grade=4,
                )
            )
        bunks = [
            create_bunk(cm_id=2001, name="G-1", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="G-2", gender="F", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        solver_input = build_direct_solver_input(persons=campers, bunks=bunks)

        solver = DirectBunkingSolver(input_data=solver_input, config_service=mock_config)
        result = solver.solve(time_limit_seconds=30)

        assert result is not None
        assert result.assignments == []
        assert result.break_glass_used is False
        assert result.infeasibility_diagnosis is not None
        assert len(result.infeasibility_diagnosis) > 0
