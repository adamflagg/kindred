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

``build_age_preference_alignment_fixture`` — age_preference coverage (#1433),
reshaped for the #1664 materiality rule.

  #1664 — a ``bunk_request_form`` AGE_PREFERENCE is Material-Parent (gets an MSO
  satvar via ``add_age_preference_satisfaction_vars`` → lands in
  ``request_satisfied_vars``) ONLY IF its requester has no resolved-and-possible
  ``bunk_request_form`` BUNK_WITH/NOT_BUNK_WITH. If the requester also carries a
  satisfiable real form request, ``compute_material_request_ids`` suppresses the
  age-pref (immaterial) and it gets NO satvar. So an age-pref camper that I want
  to assert satisfaction on must NOT have a bunk_with of its OWN — otherwise it
  is suppressed and never reaches the satvar map.

  Why the old "unsatisfied material age-pref" case is GONE (not just relocated):
  parent_paramount's hard must-satisfy-ONE forces at least one of a camper's MP
  requests satisfied. A *material* age-pref, by #1664's own definition, is the
  requester's ONLY material request (any satisfiable form bunk_with would have
  suppressed it). So a material age-pref is its camper's sole MSO term and is
  ALWAYS forced satisfied in any feasible solve — a deterministically-UNSATISFIED
  material age-pref is structurally impossible under #1664. The previous fixture's
  ``apref_realunsat`` relied on cm_10 ALSO carrying a satisfiable cohesion
  bunk_with to absorb the MSO obligation, freeing the age-pref to go unsatisfied;
  that exact shape is now what #1664 suppresses.

  So the fixture's non-trivial coverage is preserved two ways:
    1. A real, non-trivially-SATISFIED material age-pref on an age-pref-only
       camper (cm_5), deterministically pinned to a bunk that lacks the bad grade
       — exercises the satvar↔predicate alignment binding on a true satvar whose
       outcome turns on bunk membership, not on the roster (the trivsat anchors
       are satisfied regardless of placement).
    2. The #1664 suppression itself: cm_13 carries BOTH a satisfiable cohesion
       bunk_with AND a form age-pref; its age-pref is suppressed (NO satvar). The
       tests assert that suppressed id is absent from request_satisfied_vars while
       its bunk_with satvar is present — directly covering the rule this PR adds.

Determinism levers (all hard constraints):
  * 16 female campers, two bunks (capacity 8, MIN_BUNK_OCCUPANCY=8, 16 == 8*2
    forces all-used) -> exactly 8 per bunk.
  * MAX_UNIQUE_GRADES_PER_BUNK=2 caps each bunk at 2 distinct grades; max_gap=1
    (max_spread-1 under mock_config) caps any bunk_with's grade gap at 1.
  * Bunk A holds grades {5, 6}, Bunk B holds grades {6, 7}. The four grade-5
    campers can only live with grade 6 (grade-5 + grade-7 = span 2, forbidden),
    so they are grade-pinned to Bunk A; the four grade-7 campers are grade-pinned
    to Bunk B. That fixes which bunk is "A" (the grade-5 bunk) vs "B".
  * Pinning the age-pref-only SAT camper cm_5 (grade 6 fits BOTH bunks, so grade
    alone won't pin it, and it has no bunk_with of its own to ride a cohesion
    edge): a *grade-pinned puller* requests it. cm_2 (grade 5, pinned to A)
    ``bunk_with`` -> cm_5 forces cm_5 into A. The puller owns the bunk_with (its
    own age-pref, if any, would be the suppressed one — pullers have none), while
    the pulled age-pref camper stays material under #1664.
  * The suppression demonstrator cm_13 (grade 6) is pinned to B by its OWN
    cohesion bunk_with -> cm_9 (grade 7, pinned to B).

Avoids the mixed-grade case (has_older AND has_younger) — see
AGE_PREF_EXPECTED_SATISFACTION's note on the solver/predicate semantic gap.
"""

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
MP_SOURCE = "bunk_request_form"
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


# Roster for age_preference alignment, reshaped for #1664 (see module docstring).
# Bunk A holds grades {5, 6}; Bunk B holds grades {6, 7}. Grade-5 campers are
# grade-pinned to A and grade-7 campers to B (a {5,7} or {5,6,7} bunk exceeds
# MAX_UNIQUE_GRADES_PER_BUNK=2 / max_gap=1). All bunk_with gaps are <= 1, so
# none are dropped by GradeCompatibilityImpossibility.
#
#   Bunk A (grades {5,6}, 8 campers):
#     cm_1  g5  age-pref "older"  (age-pref-only, MATERIAL — no bunk_with)
#     cm_2  g5  puller: bunk_with -> cm_5 (pins cm_5 into A)
#     cm_3  g5  filler: bunk_with -> cm_1
#     cm_4  g5  filler: bunk_with -> cm_1
#     cm_5  g6  age-pref "younger" (age-pref-only, MATERIAL — non-trivial SAT)
#     cm_6  g6  filler: bunk_with -> cm_1
#     cm_7  g6  filler: bunk_with -> cm_1
#     cm_8  g6  filler: bunk_with -> cm_1
#   Bunk B (grades {6,7}, 8 campers):
#     cm_9  g7  age-pref "younger" (age-pref-only, MATERIAL — no bunk_with)
#     cm_10 g7  filler: bunk_with -> cm_9
#     cm_11 g7  filler: bunk_with -> cm_9
#     cm_12 g7  filler: bunk_with -> cm_9
#     cm_13 g6  bunk_with -> cm_9 (satisfiable) AND age-pref "younger"
#               -> #1664 SUPPRESSES the age-pref (no satvar); bunk_with keeps one
#     cm_14 g6  filler: bunk_with -> cm_9
#     cm_15 g6  filler: bunk_with -> cm_9
#     cm_16 g6  filler: bunk_with -> cm_9
AGE_A_ANCHOR = 1  # grade 5, age-pref "older"
AGE_A_G5_PULLER = 2  # grade 5, bunk_with -> cm_5
AGE_A_G5_FILLERS = [3, 4]  # grade 5, bunk_with -> cm_1
AGE_A_REALSAT = 5  # grade 6, age-pref "younger" (non-trivial SAT, pinned to A)
AGE_A_G6_FILLERS = [6, 7, 8]  # grade 6, bunk_with -> cm_1
AGE_B_ANCHOR = 9  # grade 7, age-pref "younger"
AGE_B_G7_FILLERS = [10, 11, 12]  # grade 7, bunk_with -> cm_9
AGE_B_SUPPRESSED = 13  # grade 6, bunk_with -> cm_9 + age-pref "younger" (suppressed)
AGE_B_G6_FILLERS = [14, 15, 16]  # grade 6, bunk_with -> cm_9

# Forced satisfaction outcomes for the age_preference alignment fixture.
#
# Materiality note (#1664): only age-pref-only campers (no bunk_with of their
# own) keep an age_preference satvar. Each entry below is such a camper. The
# fillers' bunk_with requests are MATERIAL too and DO get satvars — but they are
# bunk_with, not age_preference, and the two age-pref tests only iterate this
# map, so they are intentionally absent here.
#
# Why every entry is True (no unsatisfied case): parent_paramount's hard
# must-satisfy-ONE forces a camper's sole material request satisfied, and a
# material age-pref is — by #1664's own definition — its camper's only material
# request. So a material age-pref is ALWAYS satisfied in a feasible solve; a
# deterministically-unsatisfied material age-pref is structurally impossible
# here. The lost "unsatisfied" coverage is replaced by AGE_PREF_SUPPRESSED_IDS
# (the #1664 suppression assertion) below.
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
    # cm_1 (g5) "older": no grade < 5 exists anywhere -> trivially sat.
    "apref_trivsat_g5_older": True,
    # cm_9 (g7) "younger": no grade > 7 exists anywhere -> trivially sat.
    "apref_trivsat_g7_younger": True,
    # cm_5 (g6) "younger" pinned to Bunk A: Bunk A has no grade 7 (grade 7 lives
    # only in Bunk B) -> no older bunkmate -> SAT. Non-trivial: the outcome turns
    # on cm_5 being separated from the grade-7 campers (must-satisfy-one then
    # binds the satvar to that clean placement), not on the roster as a whole.
    "apref_realsat_g6_younger": True,
}

# #1664 suppression: cm_13 carries BOTH a satisfiable cohesion bunk_with AND a
# form age-pref. compute_material_request_ids drops the age-pref (immaterial), so
# it never reaches add_age_preference_satisfaction_vars and gets NO satvar. The
# tests assert this id is ABSENT from request_satisfied_vars while cm_13's
# bunk_with (a real material request) IS present — the heart of this PR.
AGE_PREF_SUPPRESSED_IDS: frozenset[str] = frozenset({"apref_suppressed_g6_younger"})

# cm_13's coexisting (satisfiable, possible) bunk_with — present in the satvar
# map even though its age-pref sibling is suppressed.
AGE_PREF_SUPPRESSED_REQUESTER_BW_ID = "mp_b_filler_13"


def build_age_preference_alignment_fixture() -> DirectSolverInput:
    """Build the age_preference satvar <-> predicate alignment scenario.

    See module docstring for the determinism + #1664-materiality rationale and
    AGE_PREF_EXPECTED_SATISFACTION for the deliberately-avoided mixed-grade case.
    """
    persons = [
        make_person(AGE_A_ANCHOR, session=SESSION, gender="F", grade=5),
        make_person(AGE_A_G5_PULLER, session=SESSION, gender="F", grade=5),
        *(make_person(cm_id, session=SESSION, gender="F", grade=5) for cm_id in AGE_A_G5_FILLERS),
        make_person(AGE_A_REALSAT, session=SESSION, gender="F", grade=6),
        *(make_person(cm_id, session=SESSION, gender="F", grade=6) for cm_id in AGE_A_G6_FILLERS),
        make_person(AGE_B_ANCHOR, session=SESSION, gender="F", grade=7),
        *(make_person(cm_id, session=SESSION, gender="F", grade=7) for cm_id in AGE_B_G7_FILLERS),
        make_person(AGE_B_SUPPRESSED, session=SESSION, gender="F", grade=6),
        *(make_person(cm_id, session=SESSION, gender="F", grade=6) for cm_id in AGE_B_G6_FILLERS),
    ]

    bunks = [
        make_bunk(2001, session=SESSION, gender="F", capacity=8),
        make_bunk(2002, session=SESSION, gender="F", capacity=8),
    ]

    requests = []

    # --- Bunk A cohesion (all MP bunk_with) ---
    # Puller cm_2 (grade 5, grade-pinned to A) drags the SAT age-pref camper cm_5
    # into A. cm_2 owns this bunk_with, so cm_5 has no request of its own and
    # stays material under #1664.
    requests.append(
        make_request(
            "mp_a_puller_5",
            requester=AGE_A_G5_PULLER,
            requestee=AGE_A_REALSAT,
            request_type="bunk_with",
            source_field=MP_SOURCE,
            session=SESSION,
        )
    )
    # Grade-5 and grade-6 fillers ride cohesion edges to the grade-5 anchor cm_1.
    for cm_id in AGE_A_G5_FILLERS + AGE_A_G6_FILLERS:
        requests.append(
            make_request(
                f"mp_a_filler_{cm_id}",
                requester=cm_id,
                requestee=AGE_A_ANCHOR,
                request_type="bunk_with",
                source_field=MP_SOURCE,
                session=SESSION,
            )
        )

    # --- Bunk B cohesion (all MP bunk_with) ---
    # Every grade-7 filler and grade-6 camper (incl. the suppression demonstrator
    # cm_13) rides a cohesion edge to the grade-7 anchor cm_9. cm_13's bunk_with
    # is what makes its sibling age-pref immaterial under #1664.
    for cm_id in AGE_B_G7_FILLERS + [AGE_B_SUPPRESSED] + AGE_B_G6_FILLERS:
        requests.append(
            make_request(
                f"mp_b_filler_{cm_id}",
                requester=cm_id,
                requestee=AGE_B_ANCHOR,
                request_type="bunk_with",
                source_field=MP_SOURCE,
                session=SESSION,
            )
        )

    # --- Age-preference targets ---
    requests += [
        # cm_1 (grade 5) "older", age-pref-only -> MATERIAL. No grade < 5 exists
        # -> trivially sat.
        make_request(
            "apref_trivsat_g5_older",
            requester=AGE_A_ANCHOR,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="older",
            session=SESSION,
        ),
        # cm_9 (grade 7) "younger", age-pref-only -> MATERIAL. No grade > 7 exists
        # -> trivially sat.
        make_request(
            "apref_trivsat_g7_younger",
            requester=AGE_B_ANCHOR,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
        # cm_5 (grade 6) "younger", age-pref-only -> MATERIAL. Pinned to Bunk A
        # {5,6}: no grade 7 -> SAT (non-trivial).
        make_request(
            "apref_realsat_g6_younger",
            requester=AGE_A_REALSAT,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
        # cm_13 (grade 6) "younger" — SUPPRESSED by #1664: cm_13 also has the
        # satisfiable bunk_with mp_b_filler_13, so this age-pref is immaterial and
        # gets NO satvar. Pinned (via that bunk_with) to Bunk B {6,7}.
        make_request(
            "apref_suppressed_g6_younger",
            requester=AGE_B_SUPPRESSED,
            requestee=None,
            request_type="age_preference",
            source_field=MP_SOURCE,
            age_preference_target="younger",
            session=SESSION,
        ),
    ]

    return make_input(persons, bunks, requests)
