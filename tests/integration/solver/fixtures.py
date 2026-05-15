"""Integration-test scenario builders for the solver.

Two alignment fixtures live here, both engineered so the solver has exactly
one feasible partition (up to bunk relabelling). Every assertion target
resolves to a known satisfied/unsatisfied value regardless of which optimal
solution CP-SAT lands on.

``build_alignment_fixture`` — bunk_with / not_bunk_with coverage (#1398).
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

``build_age_preference_alignment_fixture`` — age_preference coverage (#1433).
Mixed-grade roster so age_preference requests have non-trivial outcomes.
Determinism levers:
  * 16 female campers split CLIQUE {cm_id 1 grade 5, 2..8 grade 6} and
    OTHER {cm_id 9 grade 7, 10..16 grade 6}. MP bunk_with requests 2..8 -> 1
    and 10..16 -> 9 force the two clusters into separate bunks. Grade gaps
    of 1 satisfy GradeCompatibilityImpossibility (max_gap = max_spread - 1 = 1
    under mock_config).
  * Two bunks, capacity 8, MIN_BUNK_OCCUPANCY=8 -> exactly 8 per bunk.

Avoids the mixed-grade case (has_older AND has_younger) — see
AGE_PREF_EXPECTED_SATISFACTION's note on the solver/predicate semantic gap.
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

    # Build-path exercisers — impossible requests dropped by _validate_requests
    # before sat-var creation, so they never enter request_satisfied_vars. Kept
    # non-MP so they don't perturb the deterministic partition.
    requests += [
        # age_preference: all campers are grade 6, so AgePreferenceImpossibility
        # flags it and it's dropped before reaching the sat-var builder. Used to
        # exercise the impossibility-drop path, NOT to assert age_preference has
        # no sat var in general — feasible age_preference does, per #1433. See
        # build_age_preference_alignment_fixture for the feasible-path tests.
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


# Mixed-grade roster for age_preference alignment. Grade gaps of 1 stay
# within GradeCompatibilityImpossibility's max_gap=1 (max_spread=2 in mock_config).
#   CLIQUE = {cm_id 1 grade 5, cm_ids 2..8 grade 6}
#   OTHER  = {cm_id 9 grade 7, cm_ids 10..16 grade 6}
AGE_CLIQUE_ANCHOR = 1  # grade 5
AGE_CLIQUE_REQUESTERS = list(range(2, 9))  # 2..8, grade 6
AGE_OTHER_ANCHOR = 9  # grade 7
AGE_OTHER_REQUESTERS = list(range(10, 17))  # 10..16, grade 6

# Forced satisfaction outcomes for the age_preference alignment fixture.
#
# Solver/predicate agreement note: the solver encoding treats "older" as
# "no younger bunkmate" (and symmetric for "younger"). The post-solve predicate
# is more permissive: "older" is also satisfied by has_older even if there are
# younger bunkmates (see bunking/utils/age_preference.py is_age_preference_satisfied).
# The two disagree in the mixed-grade case (has_older AND has_younger). This
# fixture deliberately avoids that case so the alignment assertion holds today;
# the gap matters only if/when the age_preference sat_var becomes an objective
# term and is documented in the PR description.
AGE_PREF_EXPECTED_SATISFACTION: dict[str, bool] = {
    # Trivially satisfied — no grade < 5 exists in roster.
    "apref_trivsat_g5_older": True,
    # Trivially satisfied — no grade > 7 exists in roster.
    "apref_trivsat_g7_younger": True,
    # CLIQUE has no grade 7 -> bunk_is_clean -> sat.
    "apref_realsat_g6_younger": True,
    # OTHER has grade 7 (cm_id 9) -> bunk dirty -> unsat.
    "apref_realunsat_g6_younger": False,
}


def build_age_preference_alignment_fixture() -> DirectSolverInput:
    """Build the age_preference satvar <-> predicate alignment scenario.

    See module docstring for the determinism rationale and AGE_PREF_EXPECTED_
    SATISFACTION for the deliberately-avoided mixed-grade case.
    """
    persons = [
        make_person(AGE_CLIQUE_ANCHOR, session=SESSION, gender="F", grade=5),
        *(make_person(cm_id, session=SESSION, gender="F", grade=6) for cm_id in AGE_CLIQUE_REQUESTERS),
        make_person(AGE_OTHER_ANCHOR, session=SESSION, gender="F", grade=7),
        *(make_person(cm_id, session=SESSION, gender="F", grade=6) for cm_id in AGE_OTHER_REQUESTERS),
    ]

    bunks = [
        make_bunk(2001, session=SESSION, gender="F", capacity=8),
        make_bunk(2002, session=SESSION, gender="F", capacity=8),
    ]

    requests = []

    # MP bunk_with cohesion: forces CLIQUE and OTHER into separate bunks.
    for cm_id in AGE_CLIQUE_REQUESTERS:
        requests.append(
            make_request(
                f"mp_clique_{cm_id}",
                requester=cm_id,
                requestee=AGE_CLIQUE_ANCHOR,
                request_type="bunk_with",
                source_field=MP_SOURCE,
                session=SESSION,
            )
        )
    for cm_id in AGE_OTHER_REQUESTERS:
        requests.append(
            make_request(
                f"mp_other_{cm_id}",
                requester=cm_id,
                requestee=AGE_OTHER_ANCHOR,
                request_type="bunk_with",
                source_field=MP_SOURCE,
                session=SESSION,
            )
        )

    # Age-preference assertion targets — all MP (source_field=MP_SOURCE) so
    # they pass through add_age_preference_satisfaction_vars and land in
    # request_satisfied_vars after the #1433 refactor.
    requests += [
        # cm_id 1 (grade 5) "older": no grade < 5 exists -> trivially sat.
        make_request(
            "apref_trivsat_g5_older",
            requester=AGE_CLIQUE_ANCHOR,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="older",
            session=SESSION,
        ),
        # cm_id 9 (grade 7) "younger": no grade > 7 exists -> trivially sat.
        make_request(
            "apref_trivsat_g7_younger",
            requester=AGE_OTHER_ANCHOR,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
        # cm_id 2 (grade 6) "younger" in CLIQUE: bad_grades={7}, CLIQUE has none -> sat.
        make_request(
            "apref_realsat_g6_younger",
            requester=AGE_CLIQUE_REQUESTERS[0],
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
        # cm_id 10 (grade 6) "younger" in OTHER: bad_grades={7}, OTHER has cm_id 9 -> unsat.
        make_request(
            "apref_realunsat_g6_younger",
            requester=AGE_OTHER_REQUESTERS[0],
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
    ]

    return make_input(persons, bunks, requests)
