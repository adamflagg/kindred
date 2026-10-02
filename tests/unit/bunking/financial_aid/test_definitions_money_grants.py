"""Slice 3's numbered notes (campership slice 3 back-end PR-B2, ask 4; clean spec §4.8): Money › To place, Money ›
Sources and Grants. Each new text is PENDING OWNER (owner question 4)."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def _text(key: str) -> str:
    definition = BY_KEY.get(key)
    assert definition is not None, key
    return definition.text


def test_slice_3s_three_surfaces_number_their_notes_in_this_order() -> None:
    assert SURFACES.get("money-to-place") == (
        "not_yet_in_campminder",
        "to_place_suggestion",
        "placement_tick",
        "posted",
    )
    assert SURFACES.get("money-sources") == ("source_facts", "reporting_group", "source_lines")
    assert SURFACES.get("grants") == ("grants", "expected_grant", "last_dollar", "household_level", "grantor_season")


def test_not_yet_in_campminder_is_d151s_figure() -> None:
    assert (
        "locked total, plus the decided amounts of its rounds waiting to be ticked (oldest first, up to the first "
        "round that can't be ticked), less the live camp-aid money already placed on it"
        in _text("not_yet_in_campminder")
    )


def test_a_suggestion_counts_toward_nothing_until_a_person_confirms_it() -> None:
    assert "counts toward nothing until a person confirms it" in _text("to_place_suggestion")  # D12, D16


def test_a_placement_ticks_only_rounds_covered_in_full_at_the_posting_days_price() -> None:
    text = _text("placement_tick")
    assert "covers in full, oldest first" in text  # D146, D151
    assert "as of the posting date" in text  # D152
    assert "the automatic tick is refused" in text


def test_expected_is_never_a_grant_and_a_season_counts_no_commitment() -> None:
    assert "never a grant" in _text("expected_grant")  # D56
    assert "commitment not yet in CampMinder are left out" in _text("grantor_season")  # owner question 3's default


def test_a_reporting_group_change_re_places_every_households_household_level_lines() -> None:
    """The ledger narrows a household-level line by group for every household (_sole_camper), as the shipped
    GROUP_CHANGE_WARNING says; the note claims no narrower scope."""
    text = _text("reporting_group")
    assert "Changing it re-places household-level lines on the next sync." in text
    assert "multi-program" not in text


def test_expected_clears_on_a_line_or_an_open_commitment() -> None:
    """expected_grants clears on a line of the source family (a reversed one too) or an open hand-entered commitment."""
    text = _text("expected_grant")
    assert (
        "It clears itself when a line or an open commitment arrives (a reversed line counts: the application was answered)."
        in text
    )
