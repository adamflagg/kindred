"""Requests › Form intake's four notes (PR 3; the approved mock's Audit item 8): each opens with its bold term."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_form_intake_shows_four_notes_in_the_mocks_order() -> None:
    keys = SURFACES["requests-form-intake"]
    assert keys == ("intake_form_asked", "intake_became", "intake_campminder_aid", "intake_needs_a_look")
    assert [BY_KEY[k].term for k in keys] == ["Form asked", "Became", "CampMinder aid", "Needs a look"]
    for key in keys:
        note = BY_KEY[key]
        assert note.text.startswith(f"{note.term}:")


def test_the_needs_a_look_note_says_what_the_filter_counts() -> None:
    text = BY_KEY["intake_needs_a_look"].text
    for words in ("CampMinder aid on no request", "no request holds", "unclear", "reviewed"):
        assert words in text
    assert "shown, never counted" in BY_KEY["intake_campminder_aid"].text
