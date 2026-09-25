"""Adult-weekend Jotform: cancelled registrations and write-in links
(kindred#2759 / #2828 follow-up). Fictional names only."""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.jotform_admin_service import (
    JotformAdminService,
    JotformNotFoundError,
    JotformValidationError,
)
from api.services.jotform_queue import QueueSubmission, WriteInRow, suggest_write_in, write_in_options

YEAR = 2026
WW = SimpleNamespace(cm_id=1000002, name="Women's Weekend", session_type="adult")
MW = SimpleNamespace(cm_id=1000003, name="Men's Weekend", session_type="adult")
FORM = SimpleNamespace(
    id="form_ww",
    session_cm_id=1000002,
    form_id="261700000000001",
    field_map={"first_name": "3", "last_name": "4", "nametag_name": "5"},
)


@pytest.fixture(autouse=True)
def background_warm() -> Iterator[MagicMock]:
    with patch("api.services.jotform_admin_service.schedule_lodging_warm") as warm:
        yield warm


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_adult_sessions": [WW, MW],
        "fetch_forms": [FORM],
        "fetch_submissions": [],
        "fetch_answers": [],
        "fetch_enrolled_guests": [],
        "fetch_submission": None,
        "update_submission": None,
        "fetch_live_write_ins": [],
        "fetch_draft_write_ins": [],
        "set_write_in_key": None,
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        setattr(repo, name, AsyncMock(return_value=value))
    return repo


def _sub(record_id: str, status: str = "unmatched", **extra: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "id": record_id,
        "submission_id": f"66000000000000000{record_id[-2:]}",
        "form": "form_ww",
        "session_cm_id": 1000002,
        "submitted_at": "2026-08-31 09:00:00",
        "match_status": status,
        "person_cm_id": 0,
        "jotform_status": "ACTIVE",
        "year": YEAR,
        "registration_status": "",
        "write_in_key": "",
    }
    fields.update(extra)
    return SimpleNamespace(**fields)


def _answers(record_id: str, first: str, last: str, nametag: str = "") -> list[SimpleNamespace]:
    rows = [
        SimpleNamespace(submission=record_id, question_id="3", question_type="control_textbox", answer_text=first),
        SimpleNamespace(submission=record_id, question_id="4", question_type="control_textbox", answer_text=last),
    ]
    if nametag:
        rows.append(
            SimpleNamespace(submission=record_id, question_id="5", question_type="control_textbox", answer_text=nametag)
        )
    for row in rows:
        row.answer_json = None
    return rows


def _write_in(
    record_id: str,
    occupant: str,
    *,
    unit: str = "u_cedar",
    unit_name: str = "Cedar 3",
    key: str = "",
    session: int = 1000002,
    scenario: str = "",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=record_id,
        unit=unit,
        occupant_name=occupant,
        session_cm_id=session,
        year=YEAR,
        write_in_key=key,
        scenario=scenario,
        expand={"unit": SimpleNamespace(id=unit, name=unit_name)},
    )


class TestCancelledRegistrations:
    @pytest.mark.asyncio
    async def test_a_cancelled_match_leaves_needs_a_guest_for_its_own_list(self) -> None:
        cancelled = _sub("s01", "cancelled", person_cm_id=1000006, registration_status="cancelled")
        repo = _repo(fetch_submissions=[cancelled], fetch_answers=_answers("s01", "Liam", "Garcia"))

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert queue.unmatched == []
        assert queue.resolved == []
        [item] = queue.cancelled
        assert (item.submitted_name, item.match_status, item.registration_status) == (
            "Liam Garcia",
            "cancelled",
            "cancelled",
        )

    @pytest.mark.asyncio
    async def test_another_registration_status_is_kept_for_the_queue(self) -> None:
        incomplete = _sub("s02", "cancelled", person_cm_id=1000007, registration_status="incomplete")
        repo = _repo(fetch_submissions=[incomplete], fetch_answers=_answers("s02", "Riley", "Sam"))

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert [i.registration_status for i in queue.cancelled] == ["incomplete"]

    @pytest.mark.asyncio
    async def test_a_cancelled_match_is_not_a_submission_for_has_submission_or_duplicates(self) -> None:
        cancelled = _sub("s03", "cancelled", person_cm_id=1000006, registration_status="cancelled")
        again = _sub("s04", "cancelled", person_cm_id=1000006, registration_status="cancelled")
        repo = _repo(fetch_submissions=[cancelled, again])

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert queue.duplicates == []


class TestWriteInQueue:
    @pytest.mark.asyncio
    async def test_a_linked_filing_is_listed_under_write_ins_with_the_write_ins_name(self) -> None:
        linked = _sub("s05", "write_in", write_in_key="k1")
        repo = _repo(
            fetch_submissions=[linked],
            fetch_answers=_answers("s05", "Pat", "Doe"),
            fetch_live_write_ins=[_write_in("w1", "Pat D.", key="k1")],
        )

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert queue.unmatched == []
        [item] = queue.write_ins
        assert (item.submitted_name, item.write_in_name, item.write_in_unit) == ("Pat Doe", "Pat D.", "Cedar 3")

    @pytest.mark.asyncio
    async def test_a_link_carried_only_by_a_scenario_is_still_a_link(self) -> None:
        linked = _sub("s06", "write_in", write_in_key="k2")
        repo = _repo(
            fetch_submissions=[linked],
            fetch_draft_write_ins=[_write_in("d1", "Pat Doe", key="k2", scenario="scn_1")],
        )

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert [i.write_in_name for i in queue.write_ins] == ["Pat Doe"]

    @pytest.mark.asyncio
    async def test_a_removed_write_in_returns_the_filing_to_needs_a_guest(self) -> None:
        dropped = _sub("s07", "write_in", write_in_key="k-gone")
        repo = _repo(
            fetch_submissions=[dropped],
            fetch_answers=_answers("s07", "Pat", "Doe"),
            # Another WEEKEND's row with the key keeps nothing alive here.
            fetch_live_write_ins=[_write_in("w9", "Pat Doe", key="k-gone", session=1000003)],
        )

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert queue.write_ins == []
        [item] = queue.unmatched
        assert (item.submitted_name, item.match_status) == ("Pat Doe", "unmatched")

    @pytest.mark.asyncio
    async def test_the_weekends_write_ins_are_offered_once_each_with_a_preselection(self) -> None:
        needs = _sub("s08")
        repo = _repo(
            fetch_submissions=[needs],
            fetch_answers=_answers("s08", "Robert", "Doe", nametag="Bobby"),
            fetch_live_write_ins=[
                _write_in("w1", "Bobby Doe"),
                _write_in("w2", "Kitchen crew", unit="u_fern", unit_name="Fern 1"),
                _write_in("w3", "Pat Kim", session=1000003),
            ],
            # The same write-in copied into a scenario is one option, not two.
            fetch_draft_write_ins=[_write_in("d1", "Bobby Doe", scenario="scn_1")],
        )

        queue = await JotformAdminService(repo).build_queue(YEAR)

        ww = [(o.occupant_name, o.unit_name) for o in queue.write_in_options if o.session_cm_id == 1000002]
        assert sorted(ww) == [("Bobby Doe", "Cedar 3"), ("Kitchen crew", "Fern 1")]
        assert [o.occupant_name for o in queue.write_in_options if o.session_cm_id == 1000003] == ["Pat Kim"]
        [item] = queue.unmatched
        chosen = next(o for o in queue.write_in_options if o.option_id == item.write_in_suggestion)
        assert chosen.occupant_name == "Bobby Doe"


def _q(first: str, last: str, nametag: str = "") -> QueueSubmission:
    return QueueSubmission(
        record_id="r",
        submission_id="6600000000000000001",
        session_cm_id=1000002,
        submitted_at="2026-08-31 09:00:00",
        first=first,
        last=last,
        nametag=nametag,
    )


def _opts(*names: str) -> list[Any]:
    return write_in_options(
        [
            WriteInRow(unit_id=f"u{i}", unit_name=f"Unit {i}", occupant_name=n, session_cm_id=1000002, write_in_key="")
            for i, n in enumerate(names)
        ]
    )


def _suggested(sub: QueueSubmission, options: list[Any]) -> str:
    found = suggest_write_in(sub, options)
    return next((o.occupant_name for o in options if o.option_id == found), "")


class TestWriteInPreselection:
    def test_first_and_last_folded(self) -> None:
        assert _suggested(_q("Emma", "Johnson"), _opts("EMMA JÖHNSON", "Liam Garcia")) == "EMMA JÖHNSON"

    def test_nametag_first_word_plus_surname(self) -> None:
        assert _suggested(_q("Samuel", "Johnson", nametag="Sam"), _opts("Sam Johnson", "Samantha Kim")) == "Sam Johnson"

    def test_nametag_alone_when_unique(self) -> None:
        assert _suggested(_q("Olivia", "Chen", nametag="Liv"), _opts("Liv", "Riley Sam")) == "Liv"

    def test_first_name_alone_when_unique(self) -> None:
        assert _suggested(_q("Riley", "Sam"), _opts("Riley", "Emma")) == "Riley"

    def test_an_ambiguous_tier_preselects_nothing(self) -> None:
        options = [
            *_opts("Liam"),
            *write_in_options(
                [WriteInRow(unit_id="u9", unit_name="Unit 9", occupant_name="liam", session_cm_id=1000002)]
            ),
        ]
        assert _suggested(_q("Liam", "Garcia"), options) == ""

    def test_another_weekends_write_in_is_never_preselected(self) -> None:
        other = write_in_options(
            [WriteInRow(unit_id="u1", unit_name="Unit 1", occupant_name="Emma Johnson", session_cm_id=1000003)]
        )
        assert suggest_write_in(_q("Emma", "Johnson"), other) == ""

    def test_no_resemblance_preselects_nothing(self) -> None:
        assert _suggested(_q("Emma", "Johnson"), _opts("Liam Garcia")) == ""


class TestLinkWriteIn:
    @pytest.mark.asyncio
    async def test_link_mints_a_key_on_every_copy_of_the_write_in_and_links_the_filing(self) -> None:
        sub = _sub("s10")
        live = _write_in("w1", "Pat Doe")
        draft = _write_in("d1", "Pat Doe", scenario="scn_1")
        elsewhere = _write_in("w2", "Pat Doe", unit="u_fern")
        repo = _repo(fetch_submission=sub, fetch_live_write_ins=[live, elsewhere], fetch_draft_write_ins=[draft])

        with patch("api.services.jotform_admin_service.lodging_cache") as cache:
            await JotformAdminService(repo).link_write_in(
                "6600000000000000010", "u_cedar", "Pat Doe", "staff@example.com"
            )

        stamped = {(c.args[0], c.args[1]) for c in repo.set_write_in_key.await_args_list}
        assert stamped == {("lodging_write_ins", "w1"), ("lodging_write_ins_draft", "d1")}
        keys = {c.args[2] for c in repo.set_write_in_key.await_args_list}
        assert len(keys) == 1
        [key] = keys
        assert key
        body = repo.update_submission.await_args.args[1]
        assert (body["match_status"], body["write_in_key"], body["person_cm_id"], body["linked_by"]) == (
            "write_in",
            key,
            0,
            "staff@example.com",
        )
        cache.invalidate_all.assert_called_once()

    @pytest.mark.asyncio
    async def test_a_second_filing_reuses_the_write_ins_key(self) -> None:
        repo = _repo(
            fetch_submission=_sub("s11"),
            fetch_live_write_ins=[_write_in("w1", "Doe family", key="k-doe")],
            fetch_draft_write_ins=[_write_in("d1", "Doe family", scenario="scn_1")],
        )

        await JotformAdminService(repo).link_write_in(
            "6600000000000000011", "u_cedar", "Doe family", "staff@example.com"
        )

        assert [c.args[:3] for c in repo.set_write_in_key.await_args_list] == [
            ("lodging_write_ins_draft", "d1", "k-doe")
        ]
        assert repo.update_submission.await_args.args[1]["write_in_key"] == "k-doe"

    @pytest.mark.asyncio
    async def test_a_write_in_that_is_not_on_this_weekends_board_is_refused(self) -> None:
        repo = _repo(
            fetch_submission=_sub("s12"),
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", session=1000003)],
        )

        with pytest.raises(JotformValidationError):
            await JotformAdminService(repo).link_write_in(
                "6600000000000000012", "u_cedar", "Pat Doe", "staff@example.com"
            )
        repo.update_submission.assert_not_awaited()
        repo.set_write_in_key.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_unknown_filing_is_not_found(self) -> None:
        with pytest.raises(JotformNotFoundError):
            await JotformAdminService(_repo()).link_write_in("6600000000000000099", "u", "Pat", "staff@example.com")

    @pytest.mark.asyncio
    async def test_unlinking_a_write_in_clears_its_key(self) -> None:
        repo = _repo(fetch_submission=_sub("s13", "write_in", write_in_key="k1"))

        await JotformAdminService(repo).unlink("6600000000000000013")

        body = repo.update_submission.await_args.args[1]
        assert (body["match_status"], body["write_in_key"]) == ("unmatched", "")

    @pytest.mark.asyncio
    async def test_the_board_checks_the_filing_belongs_to_the_weekend_before_writing(self) -> None:
        service = JotformAdminService(_repo(fetch_submission=_sub("s14")))
        await service.check_write_in_filing("6600000000000000014", YEAR, 1000002)
        with pytest.raises(JotformValidationError):
            await service.check_write_in_filing("6600000000000000014", YEAR, 1000003)
        with pytest.raises(JotformNotFoundError):
            await JotformAdminService(_repo()).check_write_in_filing("6600000000000000099", YEAR, 1000002)
