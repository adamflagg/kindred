"""Slice 3's numbered notes (campership slice 3 back-end PR-B2, ask 4; clean spec §4.8): Money › To place, Money ›
Sources and Grants. Each new text is PENDING OWNER (owner question 4)."""

from __future__ import annotations

import re

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
    # Slice 3 (10-08): Money › Funders (Sources folded in) renders "Grants this season"; Money › Grants never did.
    # Final audit: Funders explains its own four columns (the mock's notes); "Grants this season" is not one of them.
    assert SURFACES.get("money-sources") == ("funder", "incentive", "reporting_group", "source_lines")
    # Final audit: the Register's five columns (Expected was cut, so its note goes); the Ledger names its Outside grants.
    assert SURFACES.get("grants") == (
        "register_amount",
        "register_offsets",
        "register_stands",
        "register_cancelled",
        "register_counted",
    )
    assert SURFACES.get("money-ledger") == ("in_campminder_net", "outside_grants_ledger")


def test_the_ledger_and_register_notes_say_what_the_mock_says() -> None:
    # Final UX (owner 10-09, star 5 and design-language section 12): the Ledger's notes are the mock's shorter words.
    # The tie-out line (client side) now carries the gap's causes, so the note only points at it.
    assert _text("in_campminder_net") == (
        "In CampMinder (net): the family's live camp-aid lines this season, after any reclassifying, net of "
        "reversals. It isn't Posted; the tie-out line shows the gap."
    )
    assert _text("outside_grants_ledger") == (
        "Outside grants: every other funder's lines, net of reversals, including lines not classified yet. "
        "Outside money is never Posted."
    )
    assert "household-level lines of families who didn't apply included" in _text("register_counted")
    assert "never typed" in _text("register_cancelled")
    assert _text("funder").startswith("Funder:")


def test_the_reporting_group_note_no_longer_points_at_today() -> None:
    assert "on Today" not in _text("reporting_group")


def test_not_yet_in_campminder_is_d151s_figure() -> None:
    assert (
        "locked total, plus the decided amounts of its rounds waiting for Posted to be checked (oldest first, up to "
        "the first round that can't be checked), less the live camp-aid money already placed on it"
        in _text("not_yet_in_campminder")
    )


def test_a_suggestion_counts_toward_nothing_until_a_person_confirms_it() -> None:
    assert "counts toward nothing until a person confirms it" in _text("to_place_suggestion")  # D12, D16


def test_a_placement_ticks_only_rounds_covered_in_full_at_the_posting_days_price() -> None:
    text = _text("placement_tick")
    assert "covers in full, oldest first" in text  # D146, D151
    assert "as of the posting date" in text  # D152
    assert "Posted is not checked automatically" in text


def test_a_placement_never_reads_pending() -> None:
    """Review item 32: ruling V1 (owner 10-03) named the state "pending", replacing "awaiting tonight's sync"."""
    text = _text("placement_tick")
    assert text.endswith("It never reads pending: the money is already in CampMinder.")
    assert "awaiting tonight's sync" not in text


def test_no_note_says_tick_or_awaiting_tonights_sync() -> None:
    """Owner text item 30: staff check Posted, never tick it; and V1's "pending" replaced "awaiting tonight's sync"."""
    for key, definition in BY_KEY.items():
        words = f"{definition.term} {definition.text}"
        assert not re.search(r"\b(un-?)?tick(ed|s|ing)?\b", words, re.IGNORECASE), key
        assert "awaiting tonight" not in words, key


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


def test_in_campminder_net_names_money_funders_where_sources_were_folded_in() -> None:
    """Owner Q2 (10-08): Money › Sources folded into Money › Funders, so the note never names the old tab.

    The final-UX rewording (10-09, star 5) dropped the tab's name altogether: "after any reclassifying" says it
    in the mock's shorter words, so only the absence of the retired name is still pinned.
    """
    text = BY_KEY["in_campminder_net"].text
    assert "Money › Sources" not in text
