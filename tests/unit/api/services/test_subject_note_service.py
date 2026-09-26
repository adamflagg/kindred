"""Board notes (subject_notes, 1500000189): the service and its PocketBase store.

The store owns every filter string; the service is tested against an in-memory
FakeStore so the upsert/delete/promote rules are exercised for real rather than
asserted as mock calls. Fictional data throughout.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]
from pydantic import ValidationError

from api.constants.collections import SUBJECT_NOTES
from api.schemas.subject_notes import (
    SubjectNotePromoteRequest,
    SubjectNoteWriteRequest,
)
from api.services.subject_note_service import (
    NoteKey,
    NothingToPromoteError,
    PromotedNoteTooLongError,
    SubjectNoteService,
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

    @pytest.mark.asyncio
    async def test_create_passes_the_row_through_to_pocketbase(self) -> None:
        pb = MagicMock()
        pb.collection.return_value.create.return_value = SimpleNamespace(id="note0")
        data = {**_key().row(), "body": "Hi", "updated_by": "Test Staff"}

        result = await SubjectNoteStore(pb).create(data)

        pb.collection.assert_called_with(SUBJECT_NOTES)
        pb.collection.return_value.create.assert_called_with(data)
        assert result.id == "note0"

    @pytest.mark.asyncio
    async def test_update_passes_the_record_id_and_row_through(self) -> None:
        pb = MagicMock()
        pb.collection.return_value.update.return_value = SimpleNamespace(id="note0", body="Updated")

        result = await SubjectNoteStore(pb).update("note0", {"body": "Updated"})

        pb.collection.assert_called_with(SUBJECT_NOTES)
        pb.collection.return_value.update.assert_called_with("note0", {"body": "Updated"})
        assert result.body == "Updated"

    @pytest.mark.asyncio
    async def test_delete_passes_the_record_id_through(self) -> None:
        pb = MagicMock()

        await SubjectNoteStore(pb).delete("note0")

        pb.collection.assert_called_with(SUBJECT_NOTES)
        pb.collection.return_value.delete.assert_called_with("note0")


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


# ---------------------------------------------------------------------------
# The service, against an in-memory store
# ---------------------------------------------------------------------------


def _pb_error(status: int) -> ClientResponseError:
    return ClientResponseError("pb", status=status, data={}, url="", is_abort=False, original_error=None)


class FakeStore:
    """subject_notes in memory, enforcing the unique key the migration declares."""

    def __init__(self) -> None:
        self.rows: dict[str, SimpleNamespace] = {}
        self._next = 0

    @staticmethod
    def _tuple(row: Any) -> tuple[Any, ...]:
        return (row.subject_kind, row.subject_cm_id, row.session_cm_id, row.year, row.scenario)

    async def find(self, key: NoteKey) -> Any | None:
        want = (key.subject_kind, key.subject_cm_id, key.session_cm_id, key.year, key.scenario)
        return next((r for r in self.rows.values() if self._tuple(r) == want), None)

    async def list_for(self, *, session_cm_ids: list[int], year: int, scenario: str) -> list[Any]:
        return [
            r
            for r in self.rows.values()
            if r.year == year and r.session_cm_id in session_cm_ids and r.scenario in ("", scenario)
        ]

    async def list_plan_notes(self, scenario: str) -> list[Any]:
        return [r for r in self.rows.values() if r.scenario == scenario]

    async def create(self, data: dict[str, Any]) -> Any:
        rec = SimpleNamespace(id=f"note{self._next}", updated="2026-09-25 12:00:00.000Z", **data)
        if any(self._tuple(r) == self._tuple(rec) for r in self.rows.values()):
            raise _pb_error(400)
        self._next += 1
        self.rows[rec.id] = rec
        return rec

    async def update(self, record_id: str, data: dict[str, Any]) -> Any:
        rec = self.rows[record_id]
        for name, value in data.items():
            setattr(rec, name, value)
        return rec

    async def delete(self, record_id: str) -> None:
        if record_id not in self.rows:
            raise _pb_error(404)
        del self.rows[record_id]

    def bodies(self) -> dict[tuple[Any, ...], str]:
        return {self._tuple(r): r.body for r in self.rows.values()}


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def service(store: FakeStore) -> SubjectNoteService:
    svc = SubjectNoteService(MagicMock(), store=store)  # type: ignore[arg-type]
    # Scope validation is Task 1.4's subject; here every session is its own family.
    svc.validate_scope = AsyncMock(side_effect=lambda *, session_cm_id, year, scenario: [session_cm_id])  # type: ignore[method-assign]
    return svc


def _write(body: str, **overrides: Any) -> SubjectNoteWriteRequest:
    fields: dict[str, Any] = {
        "subject_kind": "person",
        "subject_cm_id": PERSON,
        "session_cm_id": MAIN,
        "year": YEAR,
        "scenario": "",
        "body": body,
    }
    fields.update(overrides)
    return SubjectNoteWriteRequest(**fields)


def _promote(**overrides: Any) -> SubjectNotePromoteRequest:
    fields: dict[str, Any] = {
        "subject_kind": "person",
        "subject_cm_id": PERSON,
        "session_cm_id": MAIN,
        "year": YEAR,
        "scenario": "scnA",
    }
    fields.update(overrides)
    return SubjectNotePromoteRequest(**fields)


class TestSave:
    @pytest.mark.asyncio
    async def test_creates_then_updates_one_row(self, service: SubjectNoteService, store: FakeStore) -> None:
        first = await service.save(_write("Prefers a bottom bunk."), updated_by="Test Staff")
        second = await service.save(_write("  Prefers a bottom bunk; arriving late.  "), updated_by="Test Staff")

        assert first.deleted is False
        assert first.note is not None
        assert second.note is not None
        assert second.note.body == "Prefers a bottom bunk; arriving late."
        assert len(store.rows) == 1
        assert next(iter(store.rows.values())).updated_by == "Test Staff"

    @pytest.mark.asyncio
    async def test_an_empty_body_deletes_the_row(self, service: SubjectNoteService, store: FakeStore) -> None:
        await service.save(_write("Prefers a bottom bunk."), updated_by="Test Staff")
        result = await service.save(_write("   \n "), updated_by="Test Staff")
        assert result.deleted is True
        assert result.note is None
        assert store.rows == {}

    @pytest.mark.asyncio
    async def test_deleting_a_note_that_is_not_there_is_a_quiet_success(self, service: SubjectNoteService) -> None:
        result = await service.save(_write(""), updated_by="Test Staff")
        assert result.deleted is True

    @pytest.mark.asyncio
    async def test_a_lost_create_race_updates_the_winner(self, service: SubjectNoteService, store: FakeStore) -> None:
        # Another save creates the row between this save's find and its create.
        await store.create({**_key().row(), "body": "The other writer", "updated_by": "Other"})
        store.find = AsyncMock(side_effect=[None, next(iter(store.rows.values()))])  # type: ignore[method-assign]

        result = await service.save(_write("Mine"), updated_by="Test Staff")

        assert result.note is not None
        assert result.note.body == "Mine"
        assert len(store.rows) == 1

    @pytest.mark.asyncio
    async def test_a_plan_note_sits_beside_the_standard_note(
        self, service: SubjectNoteService, store: FakeStore
    ) -> None:
        await service.save(_write("Standard"), updated_by="Test Staff")
        await service.save(_write("Only in Draft A", scenario="scnA"), updated_by="Test Staff")
        assert len(store.rows) == 2

    @pytest.mark.asyncio
    async def test_a_family_on_two_weekends_keeps_two_notes(
        self, service: SubjectNoteService, store: FakeStore
    ) -> None:
        household = {"subject_kind": "household", "subject_cm_id": HOUSEHOLD}
        await service.save(_write("Grandma comes Saturday.", session_cm_id=FC5, **household), updated_by="Test Staff")
        await service.save(_write("Just the kids this time.", session_cm_id=FC6, **household), updated_by="Test Staff")

        fc5 = await service.list_for_board(session_cm_id=FC5, year=YEAR, scenario="")
        fc6 = await service.list_for_board(session_cm_id=FC6, year=YEAR, scenario="")
        assert [n.body for n in fc5] == ["Grandma comes Saturday."]
        assert [n.body for n in fc6] == ["Just the kids this time."]


class TestPromote:
    @pytest.mark.asyncio
    async def test_promote_with_no_standard_note_moves_the_text(
        self, service: SubjectNoteService, store: FakeStore
    ) -> None:
        await service.save(_write("Try Pine instead of Oak", scenario="scnA"), updated_by="Test Staff")
        result = await service.promote(_promote(), updated_by="Test Staff")

        assert result.note is not None
        assert result.note.scenario == ""
        assert result.note.body == "Try Pine instead of Oak"
        assert len(store.rows) == 1

    @pytest.mark.asyncio
    async def test_promote_appends_after_a_blank_line(self, service: SubjectNoteService, store: FakeStore) -> None:
        await service.save(_write("Arriving late Friday."), updated_by="Test Staff")
        await service.save(_write("Try Pine instead of Oak", scenario="scnA"), updated_by="Test Staff")

        result = await service.promote(_promote(), updated_by="Test Staff")

        assert result.note is not None
        assert result.note.body == "Arriving late Friday.\n\nTry Pine instead of Oak"
        assert [r.scenario for r in store.rows.values()] == [""]

    @pytest.mark.asyncio
    async def test_promote_refuses_a_merge_over_the_cap(self, service: SubjectNoteService, store: FakeStore) -> None:
        await service.save(_write("a" * 1500), updated_by="Test Staff")
        await service.save(_write("b" * 600, scenario="scnA"), updated_by="Test Staff")

        with pytest.raises(PromotedNoteTooLongError):
            await service.promote(_promote(), updated_by="Test Staff")
        assert sorted(len(b) for b in store.bodies().values()) == [600, 1500]

    @pytest.mark.asyncio
    async def test_promote_with_no_plan_note_is_an_error(self, service: SubjectNoteService) -> None:
        with pytest.raises(NothingToPromoteError):
            await service.promote(_promote(), updated_by="Test Staff")


class TestCopyPlanNotes:
    @pytest.mark.asyncio
    async def test_copies_only_the_source_scenarios_plan_notes(
        self, service: SubjectNoteService, store: FakeStore
    ) -> None:
        await service.save(_write("Standard"), updated_by="Test Staff")
        await service.save(_write("Only in A", scenario="scnA"), updated_by="Test Staff")
        await service.save(_write("Only in B", scenario="scnB"), updated_by="Test Staff")

        copied = await service.copy_plan_notes("scnA", "scnC")

        assert copied == 1
        by_scenario = {r.scenario: r.body for r in store.rows.values()}
        assert by_scenario == {"": "Standard", "scnA": "Only in A", "scnB": "Only in B", "scnC": "Only in A"}
