"""Guard: the (source, type) combos the hard staff-separation constraint relies on."""

from bunking.satisfaction.request_registry import SolverRule, rule_for


def test_staff_not_bunk_with_is_hard_mnt():
    assert rule_for("staff_not_bunk_with", "not_bunk_with") == SolverRule.HARD_MNT


def test_manual_not_bunk_with_is_hard_mnt():
    assert rule_for("manual", "not_bunk_with") == SolverRule.HARD_MNT


def test_parent_not_bunk_with_is_not_hard_mnt():
    # bunk_request_form NBW is HARD_MSO (parent-paramount), NOT staff separation.
    assert rule_for("bunk_request_form", "not_bunk_with") != SolverRule.HARD_MNT


def test_notes_not_bunk_with_stays_soft():
    assert rule_for("bunking_notes", "not_bunk_with") == SolverRule.SOFT
    assert rule_for("internal_notes", "not_bunk_with") == SolverRule.SOFT
