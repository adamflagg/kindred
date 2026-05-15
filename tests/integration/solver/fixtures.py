"""Integration-test scenario builders for the solver.

`build_alignment_fixture` returns a DirectSolverInput engineered so the solver
has exactly one feasible partition (up to bunk relabelling) — every assertion
target resolves to a known satisfied/unsatisfied value regardless of which
optimal solution CP-SAT lands on.

Determinism levers (all hard constraints):
  * 16 grade-6 female campers, 2 female bunks, capacity 8 each.
  * cabin min-occupancy (hardcoded MIN_BUNK_OCCUPANCY = 8) + force-all-used
    (16 campers >= 8 * 2 bunks) => each used bunk holds exactly 8.
  * Campers 2-8 each have one Material-Parent bunk_with -> camper 1, so
    parent_paramount's hard must-satisfy-one binds them into camper 1's bunk.
    {1..8} fills one bunk to capacity; {9..16} are forced into the other.

The two camper groups therefore land in different bunks in every feasible
solution, which fixes the satisfied/unsatisfied outcome of every request the
alignment test asserts on.
"""

from __future__ import annotations

from bunking.models_v2 import DirectSolverInput
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)

SESSION = 1000001

# Material-Parent source field (MATERIAL_PARENT bucket per bunking/satisfaction/
# bucket.py); "bunking_notes" is an explicit-but-non-MP STAFF-bucket source.
MP_SOURCE = "bunk_with"
NON_MP_SOURCE = "bunking_notes"

# Camper cm_ids 1..8 are the MP clique (forced together by parent_paramount);
# 9..16 are forced into the other bunk.
CLIQUE = list(range(1, 9))
OTHER = list(range(9, 17))

# Request ids the alignment test asserts on, with their structurally-forced
# satisfaction outcome. The solver/predicate must agree with these values.
EXPECTED_SATISFACTION: dict[str, bool] = {
    # MP bunk_with: parent_paramount forces sat == 1, and co-placement holds.
    "mp_2_1": True,
    "mp_3_1": True,
    "mp_4_1": True,
    "mp_5_1": True,
    "mp_6_1": True,
    "mp_7_1": True,
    "mp_8_1": True,
    # Non-MP bunk_with, both ends in the OTHER bunk -> satisfied.
    "sat_nonmp_bw": True,
    # Non-MP bunk_with, one end in CLIQUE one in OTHER -> unsatisfied.
    "unsat_nonmp_bw": False,
    # Non-MP not_bunk_with, the two ends in different bunks -> satisfied.
    "sat_nonmp_nbw": True,
    # Non-MP not_bunk_with, both ends in CLIQUE (same bunk) -> unsatisfied.
    "unsat_nonmp_nbw": False,
}

# Request ids that exercise the build/validation path but never get a shared
# sat var (age_preference + impossible requests). The alignment test asserts
# these are absent from request_satisfied_vars.
BUILD_PATH_EXERCISERS: frozenset[str] = frozenset({"exer_age_pref", "exer_target_not_in_solver", "exer_malformed"})


def build_alignment_fixture() -> DirectSolverInput:
    """Build the satvar <-> predicate alignment scenario.

    See module docstring for the determinism rationale.
    """
    persons = [make_person(cm_id, session=SESSION, gender="F", grade=6) for cm_id in CLIQUE + OTHER]

    # capacity=8 + MIN_BUNK_OCCUPANCY=8 + 16 campers => exactly 8 per bunk.
    bunks = [
        make_bunk(2001, session=SESSION, gender="F", capacity=8),
        make_bunk(2002, session=SESSION, gender="F", capacity=8),
    ]

    requests = []

    # MP clique: campers 2..8 each request camper 1 (Material-Parent). Each is
    # the camper's only MP request, so parent_paramount forces it satisfied.
    for cm_id in CLIQUE[1:]:
        requests.append(
            make_request(
                f"mp_{cm_id}_1",
                requester=cm_id,
                requestee=1,
                request_type="bunk_with",
                source_field=MP_SOURCE,
                session=SESSION,
            )
        )

    # Non-MP assertion targets — all between gender/grade-compatible pairs, so
    # they get a shared bidirectional sat var via get_or_create_request_sat_var.
    requests += [
        # camper 9 -> camper 10, both forced into OTHER bunk -> satisfied.
        make_request(
            "sat_nonmp_bw",
            requester=9,
            requestee=10,
            request_type="bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
        # camper 1 (CLIQUE) -> camper 9 (OTHER) -> unsatisfied.
        make_request(
            "unsat_nonmp_bw",
            requester=1,
            requestee=9,
            request_type="bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
        # camper 1 (CLIQUE) -> camper 10 (OTHER), different bunks -> satisfied.
        make_request(
            "sat_nonmp_nbw",
            requester=1,
            requestee=10,
            request_type="not_bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
        # camper 1 -> camper 3, both in CLIQUE (same bunk) -> unsatisfied.
        make_request(
            "unsat_nonmp_nbw",
            requester=1,
            requestee=3,
            request_type="not_bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
    ]

    # Build-path exercisers — never enter request_satisfied_vars. Kept non-MP
    # so they don't perturb the deterministic partition.
    requests += [
        # age_preference: get_or_create_request_sat_var returns None for it.
        # All campers are grade 6, so AgePreferenceImpossibility also flags it.
        make_request(
            "exer_age_pref",
            requester=12,
            requestee=None,
            request_type="age_preference",
            source_field=NON_MP_SOURCE,
            age_preference_target="older",
            session=SESSION,
        ),
        # target not in the solver roster -> TargetNotInSolverImpossibility.
        make_request(
            "exer_target_not_in_solver",
            requester=13,
            requestee=999999,
            request_type="bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
        # malformed bunk_with (no requestee) -> MalformedRequestImpossibility.
        make_request(
            "exer_malformed",
            requester=14,
            requestee=None,
            request_type="bunk_with",
            source_field=NON_MP_SOURCE,
            session=SESSION,
        ),
    ]

    return make_input(persons, bunks, requests)
