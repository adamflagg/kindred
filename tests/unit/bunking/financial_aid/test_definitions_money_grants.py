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
        "register_not_counted",
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
    assert "never typed" in _text("register_cancelled")
    assert _text("funder").startswith("Funder:")


def test_the_grants_notes_are_the_final_mocks_five_short_notes() -> None:
    """Final UX (owner 10-09, star 5; design-language section 12; money-grants.html): five short notes. The long unnumbered
    sentence under the table is gone (its words are notes 4 and 5), and Counted became Not counted (star 17). These
    keys are on no other surface (SURFACES lists them under grants alone), so no other page's notes change."""
    assert _text("register_amount") == (
        "Amount: the grant line's net in CampMinder, or a commitment's amount. Outside money: never in Remaining or "
        "Posted."
    )
    assert _text("register_offsets") == (
        "Aid request it offsets: the camper's request, by session, and the round the grant lowers, or \"didn't "
        "apply\". A never-applied household's line goes to a camper only when it has one eligible camper."
    )
    assert _text("register_stands") == (
        'Where it stands: "\u2713 in CM" once a CampMinder line carries it; "Committed \u00b7 not in CM" while only '
        "entered by hand."
    )
    assert _text("register_cancelled") == (
        "Cancelled (\u2298 before a name): from the camper's enrollment, never typed. A posted grant still counts "
        "until CampMinder reverses it."
    )
    assert _text("register_not_counted") == (
        "Not counted (a grey italic amount): a reversed line, a line waiting for its camper, or a commitment whose "
        "camper cancelled. Every other line counts, a didn't-apply family's household line included."
    )
    assert BY_KEY["register_not_counted"].term == "Not counted"
    owners = [s for s, keys in SURFACES.items() if any(k.startswith("register_") for k in keys)]
    assert owners == ["grants"]
    assert len(SURFACES["grants"]) <= 6  # design-language section 12: six notes at most


def test_the_reporting_group_note_no_longer_points_at_today() -> None:
    assert "on Today" not in _text("reporting_group")


def test_funders_notes_are_the_final_mocks_four_short_ones() -> None:
    """Final UX (owner 10-09, star 5; design-language section 12; money-funders.html): Money > Funders' four notes are
    the mock's shorter words, with no per-surface sentence trailing the table. The meanings are unchanged (D88, D100,
    D58, D74). These four keys are on no other surface, so no other page's notes change. "Changing it re-places
    household-level lines" left note 3: the editor shows the server's GROUP_CHANGE_WARNING at the moment it applies."""
    assert _text("funder") == (
        "Funder: Camp is the camp's own aid. Each other header is an outside funder with its terms, eligibility and "
        'contacts; "No funder yet" comes last.'
    )
    assert _text("incentive") == "Incentive or need-based: a flag on each description, never the funder type."
    assert _text("reporting_group") == (
        "Reporting group: the budget pool an outside source funds; household-level grant lines follow it. An outside "
        "source with no programs set needs a group."
    )
    assert _text("source_lines") == (
        "Lines this season: the season's live CampMinder lines a description classifies, counting any line "
        "reclassified in To place, and their net. Reversed lines are left out."
    )
    owners = [
        s for s, keys in SURFACES.items() if {"funder", "incentive", "reporting_group", "source_lines"} & set(keys)
    ]
    assert owners == ["money-sources"]
    assert len(SURFACES["money-sources"]) <= 6  # design-language section 12: six notes at most


def test_to_place_notes_say_what_the_final_mock_says() -> None:
    """Final UX (owner 10-09, star 5; design-language section 12): Money > To place's notes are the mock's shorter words.
    The meanings are unchanged: D151's figure, D12/D16's suggestion and D146/D152's placement check. These keys are on
    no other surface (SURFACES lists them under money-to-place alone), so no other page's notes change."""
    assert _text("not_yet_in_campminder") == (
        "Not yet in CampMinder: what a request still lacks there: its locked total plus decided rounds waiting for "
        "Posted, less camp aid already placed on it."
    )
    assert _text("to_place_suggestion") == (
        "Suggestion: the dashboard's proposed placement or split, with its evidence. It counts toward nothing until "
        "a person confirms it, and never picks between equal matches."
    )
    assert _text("placement_tick") == (
        "Placing checks Posted: on the rounds the money covers in full, oldest first. If pricing changed since the "
        "posting, the money is placed and Posted is checked by hand."
    )
    surfaces_with = [s for s, keys in SURFACES.items() if "placement_tick" in keys or "to_place_suggestion" in keys]
    assert surfaces_with == ["money-to-place"]
    assert len(SURFACES["money-to-place"]) <= 6  # design-language section 12: six notes at most


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
    # Final UX (money-funders.html note 3): the sentence about re-placing moved to the editor, which shows the
    # server's own GROUP_CHANGE_WARNING when the group moves; the note keeps the claim "household-level lines follow it".
    assert "household-level grant lines follow it" in text
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
