"""One filer, one decision (kindred#2839 follow-up, owner-approved).

When staff link, ignore, unlink or restore one filing, the same decision goes
to every OTHER filing of that weekend by an identical submitter -- the same
folded first and last name from the form. Linking and ignoring reach only
siblings still waiting (unmatched, or a cancelled registration): a sibling
already decided (auto, staff, ignored, write-in) is left alone. Unlinking and
restoring reach only siblings carrying the SAME link. The result names the
siblings it moved, so the tab can say so. Fictional names only.
"""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.jotform_admin_service import JotformAdminService

YEAR = 2026
WW_CM = 1000002
MW_CM = 1000003
WW = SimpleNamespace(cm_id=WW_CM, name="Women's Weekend", session_type="adult")
MW = SimpleNamespace(cm_id=MW_CM, name="Men's Weekend", session_type="adult")
FORM = SimpleNamespace(
    id="form_ww", session_cm_id=WW_CM, form_id="261700000000001", field_map={"first_name": "3", "last_name": "4"}
)
FORM_MW = SimpleNamespace(
    id="form_mw", session_cm_id=MW_CM, form_id="261700000000002", field_map={"first_name": "3", "last_name": "4"}
)
EMMA = 1000005
OLIVIA = 1000006


@pytest.fixture(autouse=True)
def background_warm() -> Iterator[MagicMock]:
    with (
        patch("api.services.jotform_admin_service.schedule_lodging_warm") as warm,
        patch("api.services.jotform_admin_service.lodging_cache"),
    ):
        yield warm


def _sub(record_id: str, status: str = "unmatched", **extra: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "id": record_id,
        "submission_id": f"66000000000000000{record_id[-2:]}",
        "form": "form_ww",
        "session_cm_id": WW_CM,
        "submitted_at": f"2026-08-{record_id[-2:]} 09:00:00",
        "match_status": status,
        "person_cm_id": 0,
        "jotform_status": "ACTIVE",
        "year": YEAR,
        "registration_status": "",
        "write_in_key": "",
    }
    fields.update(extra)
    return SimpleNamespace(**fields)


def _answers(record_id: str, first: str, last: str) -> list[SimpleNamespace]:
    return [
        SimpleNamespace(
            submission=record_id, question_id=qid, question_type="control_textbox", answer_text=text, answer_json=None
        )
        for qid, text in (("3", first), ("4", last))
    ]


def _guest(cm: int, first: str, last: str, session: int = WW_CM) -> SimpleNamespace:
    return SimpleNamespace(
        expand={
            "person": SimpleNamespace(cm_id=cm, first_name=first, last_name=last, preferred_name=""),
            "session": SimpleNamespace(cm_id=session),
        }
    )


def _repo(
    clicked: SimpleNamespace, subs: list[SimpleNamespace], answers: list[SimpleNamespace], **over: Any
) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_adult_sessions": [WW, MW],
        "fetch_forms": [FORM, FORM_MW],
        "fetch_submissions": subs,
        "fetch_answers": answers,
        "fetch_enrolled_guests": [_guest(EMMA, "Emma", "Johnson"), _guest(OLIVIA, "Olivia", "Chen")],
        "fetch_submission": clicked,
        "update_submission": None,
        "fetch_live_write_ins": [],
        "fetch_draft_write_ins": [],
        "fetch_weekend_scenarios": [],
        "set_write_in_key": None,
    }
    defaults.update(over)
    for name, value in defaults.items():
        setattr(repo, name, AsyncMock(return_value=value))
    return repo


def _writes(repo: MagicMock) -> dict[str, dict[str, Any]]:
    """Every update_submission call, by record id."""
    return {call.args[0]: call.args[1] for call in repo.update_submission.await_args_list}


class TestLinkToAGuest:
    @pytest.mark.asyncio
    async def test_the_same_filers_waiting_filings_are_linked_too(self) -> None:
        # s02 is the same filer typed with other case, accents and spacing;
        # s03 matched a cancelled registration. Both are still waiting.
        clicked = _sub("s01")
        subs = [clicked, _sub("s02"), _sub("s03", "cancelled", registration_status="Cancelled")]
        answers = [
            *_answers("s01", "Emma", "Johnson"),
            *_answers("s02", "  émma ", "JOHNSON"),
            *_answers("s03", "Emma", "Johnson"),
        ]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).link("6600000000000000001", EMMA, "staff@example.com")

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02", "s03"}
        for record_id in ("s02", "s03"):
            assert (writes[record_id]["match_status"], writes[record_id]["person_cm_id"]) == ("staff", EMMA)
            assert writes[record_id]["linked_by"] == "staff@example.com"
        # The cancelled match's registration status goes with it, as on the clicked row.
        assert writes["s03"]["registration_status"] == ""
        assert result.action == "linked"
        assert [(f.submission_id, f.submitted_at) for f in result.also] == [
            ("6600000000000000002", "2026-08-02 09:00:00"),
            ("6600000000000000003", "2026-08-03 09:00:00"),
        ]
        # Named as that filing typed it, so staff can tell which one moved.
        assert result.also[0].submitted_name == "émma JOHNSON"

    @pytest.mark.asyncio
    async def test_a_decided_sibling_is_left_alone(self) -> None:
        clicked = _sub("s01")
        subs = [
            clicked,
            _sub("s04", "auto", person_cm_id=EMMA),
            _sub("s05", "staff", person_cm_id=OLIVIA),
            _sub("s06", "ignored"),
            _sub("s07", "write_in", write_in_key="k1"),
        ]
        answers = [*(a for rid in ("s01", "s04", "s05", "s06", "s07") for a in _answers(rid, "Emma", "Johnson"))]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).link("6600000000000000001", EMMA, "staff@example.com")

        assert set(_writes(repo)) == {"s01"}
        assert result.also == []

    @pytest.mark.asyncio
    async def test_a_different_name_or_another_weekend_is_never_grouped(self) -> None:
        clicked = _sub("s01")
        subs = [
            clicked,
            _sub("s08"),  # one letter off: a different filer as far as this rule goes
            _sub("s09"),  # same first name only
            _sub("s10", form="form_mw", session_cm_id=MW_CM),  # same name, Men's Weekend
        ]
        answers = [
            *_answers("s01", "Emma", "Johnson"),
            *_answers("s08", "Emma", "Johnston"),
            *_answers("s09", "Emma", "Chen"),
            *_answers("s10", "Emma", "Johnson"),
        ]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).link("6600000000000000001", EMMA, "staff@example.com")

        assert set(_writes(repo)) == {"s01"}
        assert result.also == []

    @pytest.mark.asyncio
    async def test_a_filing_with_no_name_groups_with_nothing(self) -> None:
        clicked = _sub("s01")
        subs = [clicked, _sub("s02")]
        answers = [*_answers("s01", "", ""), *_answers("s02", "", "")]
        repo = _repo(clicked, subs, answers)

        await JotformAdminService(repo).link("6600000000000000001", EMMA, "staff@example.com")

        assert set(_writes(repo)) == {"s01"}


class TestLinkToAWriteIn:
    @pytest.mark.asyncio
    async def test_the_same_filers_waiting_filings_get_the_same_write_in_key(self) -> None:
        clicked = _sub("s01")
        subs = [clicked, _sub("s02"), _sub("s03", "staff", person_cm_id=EMMA)]
        answers = [*(a for rid in ("s01", "s02", "s03") for a in _answers(rid, "Pat", "Doe"))]
        live = SimpleNamespace(
            id="w1",
            unit="u_cedar",
            occupant_name="Pat Doe",
            session_cm_id=WW_CM,
            year=YEAR,
            write_in_key="",
            expand={"unit": SimpleNamespace(id="u_cedar", name="Cedar 3")},
        )
        repo = _repo(clicked, subs, answers, fetch_live_write_ins=[live])

        result = await JotformAdminService(repo).link_write_in(
            "6600000000000000001", "u_cedar", "Pat Doe", "staff@example.com"
        )

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02"}
        key = writes["s01"]["write_in_key"]
        assert key
        assert (writes["s02"]["match_status"], writes["s02"]["write_in_key"]) == ("write_in", key)
        assert result.action == "linked"
        assert [f.submission_id for f in result.also] == ["6600000000000000002"]


class TestIgnore:
    @pytest.mark.asyncio
    async def test_the_same_filers_waiting_filings_are_ignored_too(self) -> None:
        clicked = _sub("s01")
        subs = [clicked, _sub("s02"), _sub("s03", "staff", person_cm_id=EMMA)]
        answers = [*(a for rid in ("s01", "s02", "s03") for a in _answers(rid, "Emma", "Johnson"))]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).ignore("6600000000000000001", "staff@example.com")

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02"}
        assert writes["s02"]["match_status"] == "ignored"
        assert (result.action, [f.submission_id for f in result.also]) == ("ignored", ["6600000000000000002"])


class TestUnlinkAndRestore:
    @pytest.mark.asyncio
    async def test_restoring_restores_the_same_filers_other_ignored_filings(self) -> None:
        clicked = _sub("s01", "ignored")
        subs = [clicked, _sub("s02", "ignored"), _sub("s03")]
        answers = [*(a for rid in ("s01", "s02", "s03") for a in _answers(rid, "Emma", "Johnson"))]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).unlink("6600000000000000001")

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02"}
        assert writes["s02"]["match_status"] == "unmatched"
        assert (result.action, [f.submission_id for f in result.also]) == ("restored", ["6600000000000000002"])

    @pytest.mark.asyncio
    async def test_unlinking_a_guest_unlinks_only_siblings_linked_to_that_guest(self) -> None:
        clicked = _sub("s01", "staff", person_cm_id=EMMA)
        subs = [
            clicked,
            _sub("s02", "staff", person_cm_id=EMMA),
            _sub("s03", "staff", person_cm_id=OLIVIA),  # a different decision: left alone
            _sub("s04", "auto", person_cm_id=EMMA),  # the pull's match, not a staff link
            _sub("s05", "ignored"),
        ]
        answers = [*(a for rid in ("s01", "s02", "s03", "s04", "s05") for a in _answers(rid, "Emma", "Johnson"))]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).unlink("6600000000000000001")

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02"}
        assert (writes["s02"]["match_status"], writes["s02"]["person_cm_id"]) == ("unmatched", 0)
        assert (result.action, [f.submission_id for f in result.also]) == ("unlinked", ["6600000000000000002"])

    @pytest.mark.asyncio
    async def test_unlinking_a_write_in_unlinks_only_siblings_on_the_same_write_in(self) -> None:
        clicked = _sub("s01", "write_in", write_in_key="k1")
        subs = [
            clicked,
            _sub("s02", "write_in", write_in_key="k1"),
            _sub("s03", "write_in", write_in_key="k2"),
        ]
        answers = [*(a for rid in ("s01", "s02", "s03") for a in _answers(rid, "Pat", "Doe"))]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).unlink("6600000000000000001")

        writes = _writes(repo)
        assert set(writes) == {"s01", "s02"}
        assert (writes["s02"]["match_status"], writes["s02"]["write_in_key"]) == ("unmatched", "")
        assert [f.submission_id for f in result.also] == ["6600000000000000002"]

    @pytest.mark.asyncio
    async def test_a_same_link_sibling_under_another_name_is_left_alone(self) -> None:
        clicked = _sub("s01", "staff", person_cm_id=EMMA)
        subs = [clicked, _sub("s02", "staff", person_cm_id=EMMA)]
        answers = [*_answers("s01", "Emma", "Johnson"), *_answers("s02", "Em", "Johnson")]
        repo = _repo(clicked, subs, answers)

        result = await JotformAdminService(repo).unlink("6600000000000000001")

        assert set(_writes(repo)) == {"s01"}
        assert result.also == []
