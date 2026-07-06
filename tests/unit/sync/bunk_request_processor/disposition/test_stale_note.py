"""Stale dated-note detection (#1801).

Staff-note fields (bunking_notes / internal_notes) are cumulative history.
An entry whose newest detectable date is 3+ years before the current season
must not become current-year intent — it auto-declines (visible in request
management, one click to re-resolve) rather than silently vanishing.

Two dating conventions exist in the raw content:
- CampMinder-appended datestamp suffix: ``AUTHOR (Jul  4 2025  1:58PM)``
- Manual year prefix: ``2019 - Bunk with younger kids next yr``
"""

from bunking.sync.bunk_request_processor.disposition.stale_note import (
    STALE_NOTE_YEARS,
    is_stale_dated_note,
    newest_note_year,
)

SEASON = 2026


class TestNewestNoteYear:
    def test_campminder_datestamp_suffix(self):
        text = "Do not bunk with Liam Garcia. Really didn't get along ASHLEY COSTELLO (Jul  4 2025  1:58PM)"
        assert newest_note_year(text) == 2025

    def test_manual_year_prefix(self):
        assert newest_note_year("2019 - Bunk with younger kids next yr") == 2019

    def test_year_prefix_with_colon(self):
        assert newest_note_year("2021: prefers quieter cabins") == 2021

    def test_both_conventions_takes_newest(self):
        text = "2019 - old context, re-confirmed SHOSHIE FLAGG (May 22 2026  4:04PM)"
        assert newest_note_year(text) == 2026

    def test_multiple_datestamps_takes_newest(self):
        text = "note one (Feb  8 2020  1:11PM) follow-up EMMA JOHNSON (Apr  7 2024 11:14AM)"
        assert newest_note_year(text) == 2024

    def test_undated_text_returns_none(self):
        assert newest_note_year("Should not be in a bunk with Olivia Chen.") is None

    def test_bare_year_mid_text_not_detected(self):
        # A 4-digit number that is neither a prefix nor a datestamp must not
        # count as a date — years appear in prose ("class of 2019").
        assert newest_note_year("wants the class of 2019 cabin vibe") is None

    def test_empty_and_none_safe(self):
        assert newest_note_year("") is None


class TestIsStaleDatedNote:
    def test_old_prefixed_bunking_note_is_stale(self):
        assert is_stale_dated_note("bunking_notes", "2019 - Bunk with younger kids next yr", SEASON)

    def test_old_datestamped_internal_note_is_stale(self):
        text = "keep an eye on cabin dynamics LIAM GARCIA (Jun  1 2020  9:00AM)"
        assert is_stale_dated_note("internal_notes", text, SEASON)

    def test_boundary_exactly_three_years_prior_is_stale(self):
        assert STALE_NOTE_YEARS == 3
        assert is_stale_dated_note("bunking_notes", "2023 - separate from cousin", SEASON)

    def test_two_years_prior_is_not_stale(self):
        assert not is_stale_dated_note("bunking_notes", "2024 - separate from cousin", SEASON)

    def test_current_season_datestamp_is_not_stale(self):
        text = "Rising 5th grade confirmed SHOSHIE FLAGG (May 22 2026  4:04PM)"
        assert not is_stale_dated_note("bunking_notes", text, SEASON)

    def test_undated_note_is_not_stale(self):
        assert not is_stale_dated_note("bunking_notes", "never with Noah Williams", SEASON)

    def test_structured_fields_never_stale(self):
        # The gate applies to cumulative staff-note fields only — a form answer
        # or dropdown is current-year by construction.
        assert not is_stale_dated_note("bunk_request_form", "2019 - Emma Johnson", SEASON)
        assert not is_stale_dated_note("socialize_with", "2019 - whatever", SEASON)
