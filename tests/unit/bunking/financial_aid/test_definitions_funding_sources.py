"""Funding sources' note (Reports back end, Part C; clean spec §5.7; D88, D100)."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_funding_sources_show_the_three_facts_note() -> None:
    assert SURFACES["reports-funding-sources"] == ("source_facts",)
    note = BY_KEY["source_facts"]
    assert (note.term, note.spec) == ("Three facts", "§5.7")
    assert "who paid" in note.text
    assert "never funder_type" in note.text
