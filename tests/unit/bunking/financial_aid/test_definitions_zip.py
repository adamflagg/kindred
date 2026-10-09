"""The ZIP tables' note (Reports back end, Part C; clean spec §9.4; D90; owner rule, item 28): it says who is counted."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_zip_screen_says_who_is_counted() -> None:
    assert SURFACES["reports-development-zip"] == (
        "zip_who_counts",
        "zip_dollars",
        "zip_zip",
        "zip_families",
        "zip_geography",
    )
    note = BY_KEY["zip_who_counts"]
    assert note.term == "Who counts"
    assert "households" in note.text
    assert "aid-eligible" in note.text
    assert "subset" in note.text
    assert "received aid" in note.text
    assert "only a session that is not aid-eligible is not counted" in note.text


def test_the_zip_note_follows_the_chosen_group() -> None:
    """The ZIP read takes a `group` (any pool of the season, or all; the summer group when none is picked), so the
    note must not say the tables are always the summer group's."""
    text = BY_KEY["zip_who_counts"].text
    assert "in the summer group," not in text
    assert "in the chosen group" in text
    assert "the summer group unless another, or all groups, is picked" in text


def test_the_zip_screen_numbers_the_dollars_zip_families_and_geography_notes() -> None:
    assert BY_KEY["zip_dollars"].text.startswith("Dollars: all money")
    assert "{camp}'s awarded amounts" in BY_KEY["zip_dollars"].text
    assert "first five digits of the billing postal code" in BY_KEY["zip_zip"].text
    assert BY_KEY["zip_families"].text.startswith("Families: CampMinder households, each once per table")
    assert "no finer than ZIP" in BY_KEY["zip_geography"].text
    for key in ("zip_dollars", "zip_zip", "zip_families", "zip_geography"):
        text = BY_KEY[key].text
        assert text.startswith(BY_KEY[key].term)
        assert "amber" not in text
