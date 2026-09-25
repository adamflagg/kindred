"""kindred#2759: the Jotform admin service. Fictional names only."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterator
from types import SimpleNamespace
from typing import Any, ClassVar
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.dependencies import lodging_cache
from api.schemas.jotform import JotformFormWrite
from api.services.jotform_admin_service import (
    JotformAdminService,
    JotformNotFoundError,
    JotformValidationError,
)
from api.services.lodging_repository import LodgingRepository

YEAR = 2026
WW = SimpleNamespace(cm_id=1000002, name="Women's Weekend", session_type="adult")
MW = SimpleNamespace(cm_id=1000003, name="Men's Weekend", session_type="adult")


@pytest.fixture(autouse=True)
def background_warm() -> Iterator[MagicMock]:
    """A staff write schedules a background re-warm of the roster cache; in a
    unit test that would start real PocketBase reads on the test's loop."""
    with patch("api.services.jotform_admin_service.schedule_lodging_warm") as warm:
        yield warm


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_adult_sessions": [WW, MW],
        "fetch_forms": [],
        "fetch_submissions": [],
        "fetch_answers": [],
        "fetch_enrolled_guests": [],
        "upsert_form": SimpleNamespace(id="form_ww"),
        "fetch_submission": None,
        "update_submission": None,
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        setattr(repo, name, AsyncMock(return_value=value))
    return repo


def _guest(cm: int, first: str, last: str, session: int = 1000002) -> SimpleNamespace:
    return SimpleNamespace(
        person_id=cm,
        expand={
            "person": SimpleNamespace(cm_id=cm, first_name=first, last_name=last, preferred_name=""),
            "session": SimpleNamespace(cm_id=session),
        },
    )


QUESTIONS = [
    {"question_id": "3", "text": "First Name", "type": "control_textbox", "order": 3},
    {"question_id": "4", "text": "Last Name", "type": "control_textbox", "order": 4},
    {"question_id": "21", "text": "Bunking request", "type": "control_textarea", "order": 21},
    {"question_id": "29", "text": "CPAP?", "type": "control_radio", "order": 29},
]

FORM = SimpleNamespace(
    id="form_ww",
    session_cm_id=1000002,
    form_id="261700000000001",
    field_map={"first_name": "3", "last_name": "4", "bunking_request": "21"},
    field_map_meta={
        "first_name": {"question_id": "3", "text": "First Name", "source": "carried"},
        "last_name": {"question_id": "4", "text": "Last Name", "source": "guessed"},
        "bunking_request": {
            "question_id": "21",
            "text": "Who would you like to room with?",
            "source": "staff",
            "flag": "wording_changed",
        },
        "cpap": {"question_id": "", "text": "", "flag": "needs_pick"},
    },
    questions=QUESTIONS,
    form_title="Women's Weekend 2026",
    enabled=True,
    last_pulled_at="2026-09-24 10:00:00.000Z",
    last_pull_status="ok · 1 submissions · 0 matched · 1 unmatched",
)


class TestForms:
    @pytest.mark.asyncio
    async def test_one_row_per_adult_weekend_whether_set_up_or_not(self) -> None:
        # kindred#2828: the questions come from the form's DEFINITION snapshot,
        # not from stored answers, so they exist before anyone submits.
        repo = _repo(
            fetch_forms=[FORM],
            fetch_submissions=[SimpleNamespace(id="s1", form="form_ww", jotform_status="ACTIVE")],
        )
        forms = await JotformAdminService(repo).build_forms(YEAR)
        assert [r.session_name for r in forms.rows] == ["Women's Weekend", "Men's Weekend"]
        ww, mw = forms.rows
        assert (ww.form_id, ww.enabled, ww.submission_count) == ("261700000000001", True, 1)
        assert ww.form_title == "Women's Weekend 2026"
        assert [q.question_id for q in ww.questions] == ["3", "4", "21", "29"]
        assert ww.field_map == {"first_name": "3", "last_name": "4", "bunking_request": "21"}
        meta = {role: (m.source, m.flag) for role, m in ww.field_map_meta.items()}
        assert meta == {
            "first_name": ("carried", None),
            "last_name": ("guessed", None),
            "bunking_request": ("staff", "wording_changed"),
            "cpap": (None, "needs_pick"),
        }
        repo.fetch_answers.assert_not_awaited()
        assert (mw.form_id, mw.enabled, mw.form_title, mw.questions) == ("", False, "", [])

    @pytest.mark.asyncio
    async def test_unreadable_meta_is_dropped_not_a_500(self) -> None:
        odd = SimpleNamespace(**{**vars(FORM), "field_map_meta": {"cpap": {"source": "psychic"}, "coming_with": 7}})
        forms = await JotformAdminService(_repo(fetch_forms=[odd])).build_forms(YEAR)
        assert forms.rows[0].field_map_meta == {}

    @pytest.mark.asyncio
    async def test_save_parses_the_link_drops_blank_roles_and_clears_the_roster_cache(self) -> None:
        repo = _repo()
        with patch("api.services.jotform_admin_service.lodging_cache") as cache:
            await JotformAdminService(repo).save_form(
                YEAR,
                1000002,
                JotformFormWrite(
                    form_ref="https://www.jotform.com/build/261700000000001",
                    field_map={"first_name": "3", "cpap": ""},
                    enabled=True,
                ),
            )
        repo.upsert_form.assert_awaited_once_with(
            year=YEAR,
            session_cm_id=1000002,
            form_id="261700000000001",
            field_map={"first_name": "3"},
            # No questions snapshot yet (a first save): the pull fills the wording in.
            field_map_meta={"first_name": {"question_id": "3", "text": "", "source": "staff"}},
            enabled=True,
            clear_definition=False,
        )
        cache.invalidate_all.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_marks_every_saved_role_staff_with_its_wording_now(self) -> None:
        # kindred#2828: what staff save is theirs, and the wording at save time
        # is what a later rewording is detected against.
        repo = _repo(fetch_forms=[FORM])
        await JotformAdminService(repo).save_form(
            YEAR,
            1000002,
            JotformFormWrite(
                form_ref="261700000000001",
                field_map={"first_name": "3", "last_name": "4", "bunking_request": "21", "cpap": "29"},
                enabled=True,
            ),
        )
        meta = repo.upsert_form.await_args.kwargs["field_map_meta"]
        assert meta == {
            "first_name": {"question_id": "3", "text": "First Name", "source": "staff"},
            "last_name": {"question_id": "4", "text": "Last Name", "source": "staff"},
            "bunking_request": {"question_id": "21", "text": "Bunking request", "source": "staff"},
            "cpap": {"question_id": "29", "text": "CPAP?", "source": "staff"},
        }
        assert repo.upsert_form.await_args.kwargs["clear_definition"] is False

    @pytest.mark.asyncio
    async def test_a_role_staff_cleared_stays_cleared(self) -> None:
        # Cleared, it is recorded as "staff chose no question", or the next pull
        # would guess it straight back. A role that never had a question and
        # still has none is left for the pull to resolve.
        repo = _repo(fetch_forms=[FORM])
        await JotformAdminService(repo).save_form(
            YEAR,
            1000002,
            JotformFormWrite(form_ref="261700000000001", field_map={"first_name": "3", "last_name": "4"}, enabled=True),
        )
        kwargs = repo.upsert_form.await_args.kwargs
        assert kwargs["field_map"] == {"first_name": "3", "last_name": "4"}
        assert kwargs["field_map_meta"]["bunking_request"] == {"question_id": "", "text": "", "source": "staff"}
        assert "cpap" not in kwargs["field_map_meta"]

    @pytest.mark.asyncio
    async def test_saving_a_different_form_drops_the_old_forms_mapping(self) -> None:
        # Question ids belong to one form: carried onto another form they
        # would name the wrong questions (or none), so a new form starts blank.
        # kindred#2828: its questions snapshot, title and meta go too; the next
        # pull reads the new form and resolves afresh.
        repo = _repo(fetch_forms=[FORM])
        await JotformAdminService(repo).save_form(
            YEAR,
            1000002,
            JotformFormWrite(form_ref="261700000000002", field_map={"first_name": "3"}, enabled=True),
        )
        repo.upsert_form.assert_awaited_once_with(
            year=YEAR,
            session_cm_id=1000002,
            form_id="261700000000002",
            field_map={},
            field_map_meta={},
            enabled=True,
            clear_definition=True,
        )

    @pytest.mark.asyncio
    async def test_saving_the_same_form_by_its_builder_link_keeps_the_mapping(self) -> None:
        repo = _repo(fetch_forms=[FORM])
        await JotformAdminService(repo).save_form(
            YEAR,
            1000002,
            JotformFormWrite(
                form_ref="https://www.jotform.com/build/261700000000001",
                field_map={"first_name": "3", "bunking_request": "21"},
                enabled=True,
            ),
        )
        kwargs = repo.upsert_form.await_args.kwargs
        assert (kwargs["form_id"], kwargs["field_map"], kwargs["clear_definition"]) == (
            "261700000000001",
            {"first_name": "3", "bunking_request": "21"},
            False,
        )

    @pytest.mark.asyncio
    async def test_save_refuses_a_non_adult_session_an_unknown_role_and_a_vanity_link(self) -> None:
        service = JotformAdminService(_repo())
        with pytest.raises(JotformNotFoundError):
            await service.save_form(YEAR, 1000099, JotformFormWrite(form_ref="261700000000001"))
        with pytest.raises(JotformValidationError, match="favourite_colour"):
            await service.save_form(
                YEAR, 1000002, JotformFormWrite(form_ref="261700000000001", field_map={"favourite_colour": "7"})
            )
        with pytest.raises(JotformValidationError, match="builder"):
            await service.save_form(YEAR, 1000002, JotformFormWrite(form_ref="https://form.jotform.com/Camp/WW-2026"))


class TestQueueAndLinks:
    SUB = SimpleNamespace(
        id="s1",
        submission_id="6600000000000000001",
        form="form_ww",
        session_cm_id=1000002,
        submitted_at="2026-08-31 09:00:00",
        match_status="unmatched",
        person_cm_id=0,
        jotform_status="ACTIVE",
        year=YEAR,
    )
    ANSWERS: ClassVar[list[SimpleNamespace]] = [
        SimpleNamespace(
            submission="s1",
            question_id="3",
            question_text="First Name",
            question_type="control_textbox",
            answer_text="Emma",
            answer_json=None,
            order=3,
        ),
        SimpleNamespace(
            submission="s1",
            question_id="4",
            question_text="Last Name",
            question_type="control_textbox",
            answer_text="Ohnson",
            answer_json=None,
            order=4,
        ),
    ]

    @pytest.mark.asyncio
    async def test_the_queue_suggests_and_lists_guests(self) -> None:
        repo = _repo(
            fetch_forms=[FORM],
            fetch_submissions=[self.SUB],
            fetch_answers=self.ANSWERS,
            fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson")],
        )
        queue = await JotformAdminService(repo).build_queue(YEAR)
        [item] = queue.unmatched
        assert (item.submitted_name, item.session_name) == ("Emma Ohnson", "Women's Weekend")
        assert item.suggestions[0].label == "Did you mean Emma Johnson?"
        assert [(g.person_cm_id, g.has_submission) for g in queue.guests] == [(1000005, False)]

    @pytest.mark.asyncio
    async def test_a_form_without_first_and_last_name_mapped_lists_no_submission(self) -> None:
        # kindred#2828: matching never ran for it, so listing every submission
        # as "needs a guest" would be noise. The form is reported once instead.
        unmapped = SimpleNamespace(**{**vars(FORM), "field_map": {"bunking_request": "21"}})
        resolved = SimpleNamespace(
            **{**vars(self.SUB), "id": "s3", "submission_id": "6600000000000000003", "match_status": "ignored"}
        )
        repo = _repo(
            fetch_forms=[unmapped],
            fetch_submissions=[self.SUB, resolved],
            fetch_answers=self.ANSWERS,
            fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson")],
        )
        queue = await JotformAdminService(repo).build_queue(YEAR)
        assert queue.unmatched == []
        assert [(u.session_cm_id, u.session_name) for u in queue.unmapped] == [(1000002, "Women's Weekend")]
        # A staff decision already made is still listed, so it can be undone.
        assert [r.submission_id for r in queue.resolved] == ["6600000000000000003"]

    @pytest.mark.asyncio
    async def test_a_mapped_form_is_not_reported_unmapped(self) -> None:
        repo = _repo(fetch_forms=[FORM], fetch_submissions=[self.SUB], fetch_answers=self.ANSWERS)
        queue = await JotformAdminService(repo).build_queue(YEAR)
        assert queue.unmapped == []
        assert len(queue.unmatched) == 1

    @pytest.mark.asyncio
    async def test_has_submission_is_per_weekend(self) -> None:
        # Enrolled at both weekends, filed only for Women's Weekend: the Men's
        # Weekend row must not claim a submission.
        filed = SimpleNamespace(
            id="s2",
            submission_id="6600000000000000002",
            form="form_ww",
            session_cm_id=1000002,
            submitted_at="2026-08-31 09:00:00",
            match_status="auto",
            person_cm_id=1000005,
            jotform_status="ACTIVE",
            year=YEAR,
        )
        repo = _repo(
            fetch_forms=[FORM],
            fetch_submissions=[filed],
            fetch_enrolled_guests=[
                _guest(1000005, "Emma", "Johnson"),
                _guest(1000005, "Emma", "Johnson", session=1000003),
            ],
        )
        queue = await JotformAdminService(repo).build_queue(YEAR)
        assert [(g.session_cm_id, g.has_submission) for g in queue.guests] == [(1000002, True), (1000003, False)]

    @pytest.mark.asyncio
    async def test_the_queue_never_picks_a_candidate_even_when_there_is_only_one(self) -> None:
        # Owner ruling: suggestions are labels for staff, never an auto-link.
        repo = _repo(
            fetch_forms=[FORM],
            fetch_submissions=[self.SUB],
            fetch_answers=self.ANSWERS,
            fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson")],
        )
        queue = await JotformAdminService(repo).build_queue(YEAR)
        [item] = queue.unmatched
        assert len(item.suggestions) == 1
        assert (item.match_status, item.person_cm_id, item.guest_name) == ("unmatched", 0, "")
        repo.update_submission.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_link_requires_an_enrolled_guest_of_that_weekend(self) -> None:
        repo = _repo(fetch_submission=self.SUB, fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson")])
        service = JotformAdminService(repo)
        with pytest.raises(JotformValidationError):
            await service.link("6600000000000000001", 1000099, "staff@example.com")
        with patch("api.services.jotform_admin_service.lodging_cache") as cache:
            await service.link("6600000000000000001", 1000005, "staff@example.com")
        body = repo.update_submission.await_args.args[1]
        assert (body["match_status"], body["person_cm_id"], body["linked_by"]) == (
            "staff",
            1000005,
            "staff@example.com",
        )
        assert body["linked_at"], "a staff link stamps when it was made"
        cache.invalidate_all.assert_called_once()

    @pytest.mark.asyncio
    async def test_link_refuses_a_guest_enrolled_only_in_another_weekend(self) -> None:
        repo = _repo(
            fetch_submission=self.SUB,
            fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson", session=1000003)],
        )
        with pytest.raises(JotformValidationError):
            await JotformAdminService(repo).link("6600000000000000001", 1000005, "staff@example.com")
        repo.update_submission.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ignore_and_unlink(self) -> None:
        repo = _repo(fetch_submission=self.SUB)
        service = JotformAdminService(repo)
        with patch("api.services.jotform_admin_service.lodging_cache"):
            await service.ignore("6600000000000000001", "staff@example.com")
            assert repo.update_submission.await_args.args[1]["match_status"] == "ignored"
            await service.unlink("6600000000000000001")
            assert repo.update_submission.await_args.args[1] == {
                "match_status": "unmatched",
                "person_cm_id": 0,
                "match_tier": 0,
                "linked_by": "",
                "linked_at": "",
            }

    @pytest.mark.asyncio
    async def test_an_unknown_submission_is_not_found(self) -> None:
        with pytest.raises(JotformNotFoundError):
            await JotformAdminService(_repo()).ignore("6600000000000000009", "staff@example.com")


_Write = Callable[[JotformAdminService], Awaitable[None]]


class TestStaffWritesClearTheCachedRosterRead:
    """D3: the roster's `fetch_jotform_bunking_rows` is cached per year, and a
    staff link/ignore/unlink changes whose card a request lands on. Every write
    must drop that cached read, or the board shows the old answer until the TTL.

    Exercised against the REAL singleton cache and the REAL cached read, not a
    patched cache: a PocketBase re-read after the write is the proof."""

    @pytest.fixture(autouse=True)
    def _clean_cache(self) -> Iterator[None]:
        lodging_cache.invalidate_all()
        yield
        lodging_cache.invalidate_all()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "write",
        [
            pytest.param(lambda s: s.link("6600000000000000001", 1000005, "staff@example.com"), id="link"),
            pytest.param(lambda s: s.ignore("6600000000000000001", "staff@example.com"), id="ignore"),
            pytest.param(lambda s: s.unlink("6600000000000000001"), id="unlink"),
        ],
    )
    async def test_each_staff_write_forces_the_roster_to_re_read_jotform(
        self, write: _Write, background_warm: MagicMock
    ) -> None:
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []
        roster_repo = LodgingRepository(pb)
        await roster_repo.fetch_jotform_bunking_rows(YEAR)
        await roster_repo.fetch_jotform_bunking_rows(YEAR)
        reads_while_cached = pb.collection.return_value.get_full_list.call_count

        repo = _repo(
            fetch_submission=TestQueueAndLinks.SUB,
            fetch_enrolled_guests=[_guest(1000005, "Emma", "Johnson")],
        )
        await write(JotformAdminService(repo))

        await roster_repo.fetch_jotform_bunking_rows(YEAR)
        assert pb.collection.return_value.get_full_list.call_count > reads_while_cached
        background_warm.assert_called_once()
