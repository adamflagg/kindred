"""The ZIP tables' notes (approved final mock reports-zip.html; spec §9.4; D90): five short notes, in the mock's words."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_zip_screen_keeps_five_notes_in_the_mocks_order() -> None:
    assert SURFACES["reports-development-zip"] == (
        "zip_who_counts",
        "zip_dollars",
        "zip_zip",
        "zip_families",
        "zip_geography",
    )


def test_the_zip_notes_read_as_the_mock_words_them() -> None:
    assert BY_KEY["zip_who_counts"].term == "Every camper"
    assert BY_KEY["zip_who_counts"].text == (
        "Every camper: campers in an aid-eligible session of the chosen group, by their household's billing ZIP. "
        "A camper only in a session not open to aid isn't counted."
    )
    assert BY_KEY["zip_dollars"].term == "Campers who got aid · Dollars"
    assert BY_KEY["zip_dollars"].text == (
        "Campers who got aid · Dollars: the same campers, who attended and got money from any source: the camp's "
        "awards (= Posted) and every outside grant, net of reversals. A household-level grant lands on its "
        "household's ZIP."
    )
    assert BY_KEY["zip_zip"].text == (
        "ZIP: the first five digits of the billing postal code on the household's record for that season. "
        "Outside the US and No ZIP on file come last, under any sort."
    )
    assert BY_KEY["zip_families"].text == "Families: CampMinder households, each counted once per table."
    # reports-zip.html bolds "Small groups show as they are": the kit bolds a term only when "," follows it.
    assert BY_KEY["zip_geography"].term == "Small groups show as they are"
    assert BY_KEY["zip_geography"].text == (
        "Small groups show as they are, a one-family ZIP and its dollars included: a row is a ZIP, never a "
        "family. Geography goes no finer than ZIP."
    )


def test_each_zip_note_opens_with_its_term() -> None:
    for key in SURFACES["reports-development-zip"]:
        text = BY_KEY[key].text
        assert text.startswith(BY_KEY[key].term)
        assert "amber" not in text
