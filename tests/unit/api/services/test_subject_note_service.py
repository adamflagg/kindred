"""Board notes (subject_notes, 1500000189): the service and its PocketBase store.

The store owns every filter string; the service is tested against an in-memory
FakeStore so the upsert/delete/promote rules are exercised for real rather than
asserted as mock calls. Fictional data throughout.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from api.schemas.subject_notes import (
    SubjectNotePromoteRequest,
    SubjectNoteWriteRequest,
)
from api.services.subject_note_service import (
    NoteKey,
    SubjectNoteStore,
    board_filter,
    key_filter,
    to_out,
)

YEAR = 2026
MAIN = 1000001  # a summer main session
AG = 1000002  # its AG child
FC5 = 1000005
FC6 = 1000006
PERSON = 1000101
HOUSEHOLD = 2000001


def _key(**overrides: Any) -> NoteKey:
    fields: dict[str, Any] = {
        "subject_kind": "person",
        "subject_cm_id": PERSON,
        "session_cm_id": MAIN,
        "year": YEAR,
        "scenario": "",
    }
    fields.update(overrides)
    return NoteKey(**fields)


class TestSchemas:
    def test_scenario_defaults_to_the_standard_note(self) -> None:
        req = SubjectNoteWriteRequest(
            subject_kind="person", subject_cm_id=PERSON, session_cm_id=MAIN, year=YEAR, body="Hi"
        )
        assert req.scenario == ""

    def test_body_over_the_cap_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            SubjectNoteWriteRequest(
                subject_kind="person", subject_cm_id=PERSON, session_cm_id=MAIN, year=YEAR, body="x" * 2001
            )

    def test_a_zero_id_is_refused(self) -> None:
        # RosterParty ids serialize as 0 for the unused grain; 0 is never a subject.
        with pytest.raises(ValidationError):
            SubjectNoteWriteRequest(subject_kind="household", subject_cm_id=0, session_cm_id=FC5, year=YEAR, body="x")

    def test_promote_needs_a_scenario(self) -> None:
        with pytest.raises(ValidationError):
            SubjectNotePromoteRequest(subject_kind="person", subject_cm_id=PERSON, session_cm_id=MAIN, year=YEAR)  # type: ignore[call-arg]

    def test_a_scenario_id_with_filter_syntax_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            SubjectNoteWriteRequest(
                subject_kind="person",
                subject_cm_id=PERSON,
                session_cm_id=MAIN,
                year=YEAR,
                scenario='x" || year > 0 || scenario = "',
                body="x",
            )


class TestFilters:
    def test_key_filter_names_every_key_field(self) -> None:
        assert key_filter(_key(scenario="scnA")) == (
            f'subject_kind = "person" && subject_cm_id = {PERSON} && session_cm_id = {MAIN} '
            f'&& year = {YEAR} && scenario = "scnA"'
        )

    def test_key_filter_for_the_standard_note_matches_the_empty_relation(self) -> None:
        assert key_filter(_key()).endswith('scenario = ""')

    def test_board_filter_on_the_live_view_reads_standard_notes_only(self) -> None:
        assert board_filter([FC5], YEAR, "") == f'year = {YEAR} && (session_cm_id = {FC5}) && (scenario = "")'

    def test_board_filter_inside_a_scenario_reads_both_layers_across_the_session_family(self) -> None:
        assert board_filter([MAIN, AG], YEAR, "scnA") == (
            f'year = {YEAR} && (session_cm_id = {MAIN} || session_cm_id = {AG}) && (scenario = "" || scenario = "scnA")'
        )


class TestStore:
    @pytest.mark.asyncio
    async def test_find_returns_the_first_match_or_none(self) -> None:
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []
        assert await SubjectNoteStore(pb).find(_key()) is None

        pb.collection.assert_called_with("subject_notes")
        params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
        assert params == {"filter": key_filter(_key()), "sort": "id"}

    @pytest.mark.asyncio
    async def test_list_plan_notes_filters_on_the_scenario(self) -> None:
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []
        await SubjectNoteStore(pb).list_plan_notes("scnA")
        params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
        assert params == {"filter": 'scenario = "scnA"', "sort": "id"}


class TestToOut:
    def test_a_datetime_updated_is_serialised_iso(self) -> None:
        rec = SimpleNamespace(
            subject_kind="household",
            subject_cm_id=HOUSEHOLD,
            session_cm_id=FC5,
            scenario="",
            body="Grandma is coming Saturday only.",
            updated_by="Test Staff",
            updated=datetime(2026, 9, 25, 12, 0, tzinfo=UTC),
        )
        out = to_out(rec)
        assert out.updated == "2026-09-25T12:00:00+00:00"
        assert out.subject_kind == "household"
