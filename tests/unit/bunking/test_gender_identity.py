"""The one gender identity label rule Camperships and Analytics share (#2898; epic #3207 decisions 38 and 38b).

A write-in is "self-described", a blank is "not given", otherwise CampMinder's own Gender Identity label. The binary
Gender field (cabins, capacity, the solver) is never read.
"""

from __future__ import annotations

from bunking.gender_identity import (
    IDENTITY_ORDER,
    NOT_GIVEN,
    SELF_DESCRIBED,
    gender_label,
    identity_sort_key,
)


def test_a_write_in_is_self_described_whatever_the_label() -> None:
    assert gender_label("", "my own words") == SELF_DESCRIBED
    assert gender_label("Not listed above", "my own words") == SELF_DESCRIBED


def test_a_blank_answer_is_not_given() -> None:
    assert gender_label("", "") == NOT_GIVEN
    assert gender_label("  ", "  ") == NOT_GIVEN


def test_otherwise_campminders_own_label() -> None:
    assert gender_label("Non-binary", "") == "Non-binary"
    assert gender_label(" Girl/woman ", "") == "Girl/woman"


def test_the_labels_are_the_ruled_words() -> None:
    assert SELF_DESCRIBED == "self-described"
    assert NOT_GIVEN == "not given"


def test_camperships_reads_the_same_rule() -> None:
    """The two surfaces must never report different splits for the same campers (#2898)."""
    from bunking.financial_aid.reports import development

    assert development.gender_label is gender_label
    assert development.SELF_DESCRIBED is SELF_DESCRIBED
    assert development.NOT_GIVEN is NOT_GIVEN


def test_identity_order_puts_known_labels_first_then_unknown_then_the_two_non_answers_last() -> None:
    labels = [NOT_GIVEN, "Zeta (new CampMinder option)", SELF_DESCRIBED, "Boy/man", "Agender", "Girl/woman"]
    assert sorted(labels, key=identity_sort_key) == [
        "Girl/woman",
        "Boy/man",
        "Agender",
        "Zeta (new CampMinder option)",
        SELF_DESCRIBED,
        NOT_GIVEN,
    ]


def test_identity_order_lists_every_campminder_option_seen() -> None:
    for label in (
        "Girl/woman",
        "Boy/man",
        "Non-binary",
        "Transgender girl/woman",
        "Transgender boy/man",
        "Agender",
        "Not listed above",
        "Prefer not to answer",
    ):
        assert label in IDENTITY_ORDER


def test_the_binary_fallback_is_a_parameter_only_analytics_passes() -> None:
    """Ruling 58: Analytics passes the binary field for a blank answer; Camperships passes nothing and is unchanged."""
    assert gender_label("", "", binary_fallback="F") == "Girl/woman"
    assert gender_label("", "", binary_fallback="M") == "Boy/man"
    assert gender_label("", "", binary_fallback="Other") == NOT_GIVEN
    assert gender_label("", "", binary_fallback="") == NOT_GIVEN
    assert gender_label("Non-binary", "", binary_fallback="F") == "Non-binary"
    assert gender_label("", "words", binary_fallback="M") == SELF_DESCRIBED
    assert gender_label("", "") == NOT_GIVEN
