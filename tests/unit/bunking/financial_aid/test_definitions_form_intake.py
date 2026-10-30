"""Requests › Form intake's notes (PR 3; the approved mock's Audit item 8, and the adult aid form mock v2's five): each
opens with its bold term."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_form_intake_shows_five_notes_in_the_mocks_order() -> None:
    keys = SURFACES["requests-form-intake"]
    assert keys == (
        "intake_form_asked",
        "intake_became",
        "intake_campminder_aid",
        "intake_needs_a_look",
        "intake_responses_to_link",
    )
    assert [BY_KEY[k].term for k in keys] == [
        "Form asked",
        "Became",
        "CampMinder aid",
        "Needs a look",
        "Responses to link",
    ]
    for key in keys:
        note = BY_KEY[key]
        assert note.text.startswith(f"{note.term}:")


def test_the_needs_a_look_note_says_what_the_filter_counts() -> None:
    text = BY_KEY["intake_needs_a_look"].text
    for words in ("CampMinder aid on no request", "no request holds", "unclear", "reviewed"):
        assert words in text
    assert "shown, never counted" in BY_KEY["intake_campminder_aid"].text


def test_the_adult_aid_form_reads_in_the_notes() -> None:
    """Adult aid form mock v2: Form asked names the chip, Became counts adults, Needs a look gains the deleted and
    second-after-a-decision responses, and Responses to link says when the dashboard links one on its own."""
    assert '"adult aid form" marks the Google form' in BY_KEY["intake_form_asked"].text
    assert "it prices that adult's own request" in BY_KEY["intake_form_asked"].text
    assert "this camper or adult" in BY_KEY["intake_became"].text
    look = BY_KEY["intake_needs_a_look"].text
    assert "deleted in Google" in look
    assert "flagged, not applied" in look
    link = BY_KEY["intake_responses_to_link"].text
    for words in ("could not tie to one person", "exactly one registered person", "name, birthdate and email"):
        assert words in link
