"""The ZIP tables' note (Reports back end, Part C; clean spec §9.4; D90; owner rule, item 28): it says who is counted."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_zip_screen_says_who_is_counted() -> None:
    assert SURFACES["reports-development-zip"] == ("zip_who_counts",)
    note = BY_KEY["zip_who_counts"]
    assert note.term == "Who counts"
    assert "households" in note.text
    assert "aid-eligible" in note.text
    assert "subset" in note.text
    assert "received aid" in note.text
    assert "only a session that is not aid-eligible is not counted" in note.text
