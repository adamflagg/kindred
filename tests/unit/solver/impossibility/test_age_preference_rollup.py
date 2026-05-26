"""Rollup-level guard: an oldest-grade 'older' MP-only camper is entirely impossible.

This is the data that drives the post-check families-to-contact cohort and the
mp_campers_total denominator gating. The per-request predicate is pinned in
test_age_preference.py; this pins the camper-level rollup in
validate_impossibility.mp_campers_entirely_impossible so a future change can't
silently drop these campers out of the cohort (which would also pull them into
the solver's must-satisfy-one constraint and distort cabin shape).
"""

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_oldest_grade_older_mp_camper_is_entirely_impossible(mock_config):
    # Oldest grade-10 camper with a MATERIAL-parent 'older' age preference; one
    # younger same-gender peer exists so the camper IS placeable, just not with
    # an older peer. The rollup must still flag the camper (kept out of MSO).
    oldest = make_person(1, session=100, gender="M", grade=10)
    younger = make_person(2, session=100, gender="M", grade=9)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
        source_field="bunk_request_form",  # MATERIAL_PARENT
    )
    input_data = make_input([oldest, younger], [make_bunk(10, session=100, gender="M")], [req])

    report = validate_impossibility(input_data, mock_config)

    cohort = {c["cm_id"]: c for c in report.mp_campers_entirely_impossible}
    assert 1 in cohort, "oldest-grade 'older' MP camper must be in the entirely-impossible rollup"
    assert "age_pref_no_eligible_grade" in cohort[1]["reason_codes"]
