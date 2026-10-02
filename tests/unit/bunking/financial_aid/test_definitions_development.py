"""Reports › Development's notes (Reports back end, Part B; clean spec §4.8, §5.7, §5.10, §5.11; D87–D94, D99,
D101, D103, D142): development's signed meanings, on its own surface."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_development_surface_lists_its_notes_in_order() -> None:
    assert SURFACES["reports-development"] == (
        "total_awards_granted",
        "need",
        "dev_recipients",
        "teens",
        "dev_families",
        "gender",
        "first_time",
        "dev_appeals",
        "household_level",
    )


def test_total_awards_granted_is_all_money_never_relabelled_awarded() -> None:
    """D87, §5.6: "Awarded" and "Total Awards Granted" are never relabelled as each other."""
    note = BY_KEY["total_awards_granted"]
    assert (note.term, note.spec) == ("Total Awards Granted", "§5.7")
    assert "every outside grant" in note.text
    assert "awarded" not in note.term.lower()


def test_need_is_every_ask_as_a_floor() -> None:
    """D91."""
    assert "never less than any earlier ask's own figure" in BY_KEY["need"].text


def test_who_counts_is_campers_who_attended_and_got_money() -> None:
    """D92."""
    text = BY_KEY["dev_recipients"].text
    assert "attended" in text
    assert "including campers who never applied" in text


def test_household_level_grants_say_how_much_they_leave_out() -> None:
    """D142: camper cuts show them as household-level, and the report says by how much."""
    assert "household-level" in BY_KEY["household_level"].text
