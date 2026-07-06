"""Stale dated-note detection (#1801).

Staff-note fields (bunking_notes / internal_notes) are cumulative history.
An entry whose newest detectable date is 3+ years before the current season
must not become current-year intent — it auto-declines (visible in request
management, one click to re-resolve) rather than silently vanishing.

Two dating conventions exist in the raw content:
- CampMinder-appended datestamp suffix: ``AUTHOR (Jul  4 2025  1:58PM)``
- Manual year prefix: ``2019 - Bunk with younger kids next yr``
"""

from typing import Any

from bunking.sync.bunk_request_processor.disposition.stale_note import (
    STALE_NOTE_YEARS,
    is_stale_dated_note,
    newest_note_year,
)

SEASON = 2026


class TestNewestNoteYear:
    def test_campminder_datestamp_suffix(self):
        text = "Do not bunk with Liam Garcia. Really didn't get along SAMUEL JOHNSON (Jul  4 2025  1:58PM)"
        assert newest_note_year(text) == 2025

    def test_manual_year_prefix(self):
        assert newest_note_year("2019 - Bunk with younger kids next yr") == 2019

    def test_year_prefix_with_colon(self):
        assert newest_note_year("2021: prefers quieter cabins") == 2021

    def test_both_conventions_takes_newest(self):
        text = "2019 - old context, re-confirmed RILEY SAM (May 22 2026  4:04PM)"
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

    def test_multi_entry_newline_takes_newest(self):
        # internal_notes keeps raw newlines between cumulative entries — a
        # year prefix on ANY entry must count, newest wins.
        text = "2019 - separate from older brother\n2025 - update: now fine together"
        assert newest_note_year(text) == 2025

    def test_multi_entry_pipe_joined_takes_newest(self):
        # bunking_notes entries are " | "-joined by the orchestrator after
        # staff-signature stripping (orchestrator._prepare_parse_requests).
        text = "2019 - old context | 2025 - update: fine now"
        assert newest_note_year(text) == 2025

    def test_pipe_in_prose_does_not_create_entry(self):
        # A mid-entry year that isn't at an entry start still must not match.
        assert newest_note_year("likes trains | class of 2019 vibes") is None


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
        text = "Rising 5th grade confirmed RILEY SAM (May 22 2026  4:04PM)"
        assert not is_stale_dated_note("bunking_notes", text, SEASON)

    def test_undated_note_is_not_stale(self):
        assert not is_stale_dated_note("bunking_notes", "never with Olivia Chen", SEASON)

    def test_structured_fields_never_stale(self):
        # The gate applies to cumulative staff-note fields only — a form answer
        # or dropdown is current-year by construction.
        assert not is_stale_dated_note("bunk_request_form", "2019 - Emma Johnson", SEASON)
        assert not is_stale_dated_note("socialize_with", "2019 - whatever", SEASON)


class TestStaffMetadataYears:
    """Production bunking_notes lose their CampMinder datestamp suffixes before
    parsing — the orchestrator strips ``STAFFNAME (DATETIME)`` signatures into
    staff_metadata. Staleness must read those authorship timestamps too."""

    def test_current_staff_timestamp_protects_old_prefix(self):
        # "2019 - ... re-confirmed <sig 2026>" arrives stripped; the 2026
        # authorship timestamp lives only in staff_metadata. Newest year wins.
        staff_metadata = {
            "staff_name": "Riley Sam",
            "timestamp": "May 22 2026  4:04PM",
            "all_staff": [{"staff": "Riley Sam", "timestamp": "May 22 2026  4:04PM"}],
        }
        assert not is_stale_dated_note(
            "bunking_notes", "2019 - old context, re-confirmed", SEASON, staff_metadata=staff_metadata
        )

    def test_stale_staff_timestamp_detected_without_text_year(self):
        # Datestamp-only convention: signature stripped, no year left in text —
        # the stale year must come from the authorship timestamp.
        staff_metadata = {
            "staff_name": "Samuel Johnson",
            "timestamp": "Jun  1 2020  9:00AM",
            "all_staff": [{"staff": "Samuel Johnson", "timestamp": "Jun  1 2020  9:00AM"}],
        }
        assert is_stale_dated_note(
            "bunking_notes", "Do not bunk with Liam Garcia", SEASON, staff_metadata=staff_metadata
        )

    def test_newest_of_multiple_staff_timestamps_wins(self):
        staff_metadata = {
            "staff_name": "Riley Sam",
            "timestamp": "Apr  7 2026 11:14AM",
            "all_staff": [
                {"staff": "Samuel Johnson", "timestamp": "Feb  8 2020  1:11PM"},
                {"staff": "Riley Sam", "timestamp": "Apr  7 2026 11:14AM"},
            ],
        }
        assert not is_stale_dated_note("bunking_notes", "note one | follow-up", SEASON, staff_metadata=staff_metadata)

    def test_no_years_anywhere_is_not_stale(self):
        assert not is_stale_dated_note(
            "bunking_notes", "never with Olivia Chen", SEASON, staff_metadata={"all_staff": []}
        )


class TestProductionPipelineShape:
    """End-to-end regression for #1804 review finding 1: run the REAL
    orchestrator preprocessing (parse_multi_staff_notes strip + join + staff
    metadata extraction) and assert staleness on what the pipeline actually
    produces."""

    @staticmethod
    def _preprocess(note_text: str) -> tuple[str, dict[str, Any] | None]:
        # Mirrors orchestrator._prepare_parse_requests for BUNKING_NOTES.
        from bunking.sync.bunk_request_processor.services.staff_note_parser import (
            parse_multi_staff_notes,
        )

        parsed_notes = parse_multi_staff_notes(note_text)
        request_text = " | ".join(n["content"] for n in parsed_notes if n["content"])
        staff_entries = [n for n in parsed_notes if n["staff"]]
        staff_metadata = None
        if staff_entries:
            staff_metadata = {
                "staff_name": staff_entries[-1]["staff"],
                "timestamp": staff_entries[-1]["timestamp"],
                "all_staff": [{"staff": n["staff"], "timestamp": n["timestamp"]} for n in staff_entries],
            }
        return request_text, staff_metadata

    def test_reconfirmed_old_note_survives_stripping(self):
        text, staff_metadata = self._preprocess("2019 - old context, re-confirmed RILEY SAM (May 22 2026  4:04PM)")
        assert "(May 22 2026" not in text  # signature really was stripped
        assert not is_stale_dated_note("bunking_notes", text, SEASON, staff_metadata=staff_metadata)

    def test_datestamp_only_stale_note_detected_after_stripping(self):
        text, staff_metadata = self._preprocess("Wants Emma Johnson EMMA JOHNSON (Jun  1 2020  9:00AM)")
        assert is_stale_dated_note("bunking_notes", text, SEASON, staff_metadata=staff_metadata)

    def test_second_entry_year_prefix_detected_after_join(self):
        text, staff_metadata = self._preprocess("2019 - separate from older brother\n2025 - update: now fine together")
        assert not is_stale_dated_note("bunking_notes", text, SEASON, staff_metadata=staff_metadata)
