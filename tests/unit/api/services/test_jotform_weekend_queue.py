"""The adult weekend's Requests tab (kindred#2828 ruling 2026-09-25): one
weekend's Jotform queue, read in the scenario being viewed.

Who a filing belongs to -- a guest, ignored, a cancelled registration -- reads
the same in every scenario. A write-in link follows the scenario: "placed in
<unit>" where a row of the viewed scenario carries the link's key, "not placed"
otherwise. Unlinked write-ins get suggested links. Fictional names only.
"""

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

YEAR = 2026
WW_CM = 1000002
MW_CM = 1000003
WW = SimpleNamespace(cm_id=WW_CM, name="Women's Weekend", session_type="adult")
MW = SimpleNamespace(cm_id=MW_CM, name="Men's Weekend", session_type="adult")
FORM = SimpleNamespace(
    id="form_ww",
    session_cm_id=WW_CM,
    form_id="261700000000001",
    field_map={"first_name": "3", "last_name": "4", "nametag_name": "5"},
)
FORM_MW = SimpleNamespace(
    id="form_mw",
    session_cm_id=MW_CM,
    form_id="261700000000002",
    field_map={"first_name": "3", "last_name": "4", "nametag_name": "5"},
)
PLAN_A = SimpleNamespace(id="scn_a", name="Plan A", year=YEAR)
PLAN_B = SimpleNamespace(id="scn_b", name="Plan B", year=YEAR)


@pytest.fixture(autouse=True)
def background_warm() -> Iterator[MagicMock]:
    with patch("api.services.jotform_admin_service.schedule_lodging_warm") as warm:
        yield warm


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_adult_sessions": [WW, MW],
        "fetch_forms": [FORM, FORM_MW],
        "fetch_submissions": [],
        "fetch_answers": [],
        "fetch_enrolled_guests": [],
        "fetch_submission": None,
        "update_submission": None,
        "fetch_live_write_ins": [],
        "fetch_draft_write_ins": [],
        "fetch_weekend_scenarios": [PLAN_A, PLAN_B],
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
        "session_cm_id": WW_CM,
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
    session: int = WW_CM,
    scenario: str = "",
) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "id": record_id,
        "unit": unit,
        "occupant_name": occupant,
        "session_cm_id": session,
        "year": YEAR,
        "write_in_key": key,
        "expand": {"unit": SimpleNamespace(id=unit, name=unit_name)},
    }
    if scenario:
        fields["scenario"] = scenario
    return SimpleNamespace(**fields)


async def _weekend(repo: MagicMock, scenario: str = "") -> Any:
    return await JotformAdminService(repo).build_queue(YEAR, session_cm_id=WW_CM, scenario=scenario)


class TestWeekendScope:
    @pytest.mark.asyncio
    async def test_only_the_named_weekends_filings_are_listed(self) -> None:
        ww = _sub("s01")
        mw = _sub("s02", form="form_mw", session_cm_id=MW_CM)
        repo = _repo(
            fetch_submissions=[ww, mw],
            fetch_answers=[*_answers("s01", "Emma", "Johnson"), *_answers("s02", "Liam", "Garcia")],
        )

        queue = await _weekend(repo)

        assert [i.submitted_name for i in queue.unmatched] == ["Emma Johnson"]
        assert (queue.session_cm_id, queue.scenario) == (WW_CM, "")

    @pytest.mark.asyncio
    async def test_a_weekend_that_is_not_an_adult_weekend_is_not_found(self) -> None:
        # Family Camp has no Jotform queue: its share requests come from CampMinder.
        with pytest.raises(JotformNotFoundError):
            await JotformAdminService(_repo()).build_queue(YEAR, session_cm_id=1000001)

    @pytest.mark.asyncio
    async def test_a_scenario_needs_its_weekend(self) -> None:
        with pytest.raises(JotformValidationError):
            await JotformAdminService(_repo()).build_queue(YEAR, scenario="scn_a")

    @pytest.mark.asyncio
    async def test_a_scenario_that_is_not_this_weekends_is_refused(self) -> None:
        # fetch_weekend_scenarios is scoped to (year, weekend): another
        # weekend's scenario, or one that does not exist, is not in it.
        repo = _repo(fetch_weekend_scenarios=[PLAN_A])

        with pytest.raises(JotformNotFoundError):
            await _weekend(repo, scenario="scn_other")
        repo.fetch_weekend_scenarios.assert_awaited_with(YEAR, WW_CM)

    @pytest.mark.asyncio
    async def test_the_year_wide_read_is_unchanged(self) -> None:
        ww = _sub("s01")
        mw = _sub("s02", form="form_mw", session_cm_id=MW_CM)
        repo = _repo(fetch_submissions=[ww, mw])

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert sorted(i.session_cm_id for i in queue.unmatched) == [WW_CM, MW_CM]
        assert queue.session_cm_id is None
        repo.fetch_weekend_scenarios.assert_not_awaited()


class TestScenarioIndependentLists:
    @pytest.mark.asyncio
    async def test_guest_links_ignored_and_cancelled_read_the_same_in_every_scenario(self) -> None:
        subs = [
            _sub("s03", "staff", person_cm_id=1000005),
            _sub("s04", "ignored"),
            _sub("s05", "cancelled", person_cm_id=1000006, registration_status="cancelled"),
        ]
        answers = [
            *_answers("s03", "Emma", "Ohnson"),
            *_answers("s04", "Test", "Entry"),
            *_answers("s05", "Liam", "Garcia"),
        ]
        live = await _weekend(_repo(fetch_submissions=subs, fetch_answers=answers))
        plan = await _weekend(_repo(fetch_submissions=subs, fetch_answers=answers), scenario="scn_a")

        assert [i.submitted_name for i in live.resolved] == ["Emma Ohnson", "Test Entry"]
        assert live.resolved == plan.resolved
        assert [i.submitted_name for i in live.cancelled] == ["Liam Garcia"]
        assert live.cancelled == plan.cancelled


class TestWriteInPlacement:
    @pytest.mark.asyncio
    async def test_live_view_places_a_link_the_live_board_carries(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s06", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s06", "Pat", "Doe"),
            fetch_live_write_ins=[_write_in("w1", "Pat D.", key="k1")],
            fetch_draft_write_ins=[
                _write_in("d1", "Pat D.", key="k1", unit="u_fern", unit_name="Fern 1", scenario="scn_a")
            ],
        )

        [item] = (await _weekend(repo)).write_ins

        assert (item.write_in_placed, item.write_in_name, item.write_in_unit) == (True, "Pat D.", "Cedar 3")

    @pytest.mark.asyncio
    async def test_a_scenario_view_reads_the_scenarios_own_row(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s06", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s06", "Pat", "Doe"),
            fetch_live_write_ins=[_write_in("w1", "Pat D.", key="k1")],
            fetch_draft_write_ins=[
                _write_in("d1", "Pat D.", key="k1", unit="u_fern", unit_name="Fern 1", scenario="scn_a")
            ],
        )

        [item] = (await _weekend(repo, scenario="scn_a")).write_ins

        assert (item.write_in_placed, item.write_in_unit) == (True, "Fern 1")

    @pytest.mark.asyncio
    async def test_a_link_the_viewed_scenario_does_not_carry_is_not_placed_but_still_linked(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s06", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s06", "Pat", "Doe"),
            fetch_live_write_ins=[_write_in("w1", "Pat D.", key="k1")],
            fetch_draft_write_ins=[_write_in("d2", "Pat D.", key="k1", scenario="scn_b")],
        )

        queue = await _weekend(repo, scenario="scn_a")

        assert queue.unmatched == []
        [item] = queue.write_ins
        assert (item.submitted_name, item.write_in_placed, item.write_in_name, item.write_in_unit) == (
            "Pat Doe",
            False,
            "Pat D.",
            "",
        )

    @pytest.mark.asyncio
    async def test_a_key_no_row_carries_anywhere_still_needs_a_guest(self) -> None:
        # The server rule the tab keeps: the write-in is gone everywhere.
        repo = _repo(
            fetch_submissions=[_sub("s07", "write_in", write_in_key="k-gone")],
            fetch_answers=_answers("s07", "Pat", "Doe"),
        )

        queue = await _weekend(repo, scenario="scn_a")

        assert queue.write_ins == []
        assert [(i.submitted_name, i.match_status) for i in queue.unmatched] == [("Pat Doe", "unmatched")]


class TestViewedScenarioOptions:
    @pytest.mark.asyncio
    async def test_the_dropdown_lists_only_the_viewed_scenarios_write_ins(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s08")],
            fetch_answers=_answers("s08", "Robert", "Doe", nametag="Bobby"),
            fetch_live_write_ins=[_write_in("w1", "Kitchen crew", unit="u_fern", unit_name="Fern 1")],
            fetch_draft_write_ins=[
                _write_in("d1", "Bobby Doe", scenario="scn_a"),
                _write_in("d2", "Night nurse", unit="u_oak", unit_name="Oak 2", scenario="scn_b"),
                _write_in("d3", "Pat Kim", session=MW_CM, scenario="scn_a"),
            ],
        )

        live = await _weekend(repo)
        plan = await _weekend(repo, scenario="scn_a")

        assert [o.occupant_name for o in live.write_in_options] == ["Kitchen crew"]
        assert [o.occupant_name for o in plan.write_in_options] == ["Bobby Doe"]
        [live_item] = live.unmatched
        [plan_item] = plan.unmatched
        assert live_item.write_in_suggestion == ""
        assert plan_item.write_in_suggestion == "u_cedar/Bobby Doe"


class TestSuggestedLinks:
    @pytest.mark.asyncio
    async def test_an_unlinked_write_in_matching_one_linked_on_the_live_board_is_suggested(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s09", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s09", "Pat", "Doe"),
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", key="k1")],
            # Made in the scenario by hand, not copied: no key.
            fetch_draft_write_ins=[_write_in("d1", "pat doe", unit="u_fern", unit_name="Fern 1", scenario="scn_a")],
        )

        queue = await _weekend(repo, scenario="scn_a")

        [suggestion] = queue.write_in_link_suggestions
        assert (
            suggestion.option_id,
            suggestion.unit_id,
            suggestion.occupant_name,
            suggestion.submission_id,
            suggestion.filer_name,
            suggestion.linked_in,
            suggestion.label,
        ) == (
            "u_fern/pat doe",
            "u_fern",
            "pat doe",
            "6600000000000000009",
            "Pat Doe",
            "the live board",
            "Link to Pat Doe's filing (linked in the live board)",
        )

    @pytest.mark.asyncio
    async def test_one_linked_in_another_scenario_names_that_scenario(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s10", "write_in", write_in_key="k2")],
            fetch_answers=_answers("s10", "Olivia", "Chen", nametag="Liv"),
            fetch_live_write_ins=[_write_in("w1", "Liv Chen", unit="u_fern", unit_name="Fern 1")],
            fetch_draft_write_ins=[_write_in("d1", "O. Chen", key="k2", scenario="scn_b")],
        )

        [suggestion] = (await _weekend(repo)).write_in_link_suggestions

        # Matched on the filer's nametag + surname, as the dropdown pre-selects.
        assert (suggestion.occupant_name, suggestion.linked_in) == ("Liv Chen", "Plan B")
        assert suggestion.label == "Link to Olivia Chen's filing (linked in Plan B)"

    @pytest.mark.asyncio
    async def test_no_suggestion_for_a_filing_already_placed_in_the_viewed_scenario(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s11", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s11", "Pat", "Doe"),
            fetch_live_write_ins=[
                _write_in("w1", "Pat Doe", key="k1"),
                _write_in("w2", "Pat Doe", unit="u_fern", unit_name="Fern 1"),
            ],
        )

        assert (await _weekend(repo)).write_in_link_suggestions == []

    @pytest.mark.asyncio
    async def test_a_write_in_already_linked_is_never_a_candidate(self) -> None:
        repo = _repo(
            fetch_submissions=[
                _sub("s12", "write_in", write_in_key="k1"),
                _sub("s13", "write_in", write_in_key="k3"),
            ],
            fetch_answers=[*_answers("s12", "Pat", "Doe"), *_answers("s13", "Riley", "Sam")],
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", key="k1")],
            # In the scenario, "Pat Doe" is linked to a different filing.
            fetch_draft_write_ins=[_write_in("d1", "Pat Doe", key="k3", scenario="scn_a")],
        )

        assert (await _weekend(repo, scenario="scn_a")).write_in_link_suggestions == []

    @pytest.mark.asyncio
    async def test_an_unlinked_filing_matching_an_unlinked_write_in_is_suggested_too(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s14")],
            fetch_answers=_answers("s14", "Samuel", "Johnson", nametag="Sam"),
            fetch_draft_write_ins=[_write_in("d1", "Sam Johnson", scenario="scn_a")],
        )

        [suggestion] = (await _weekend(repo, scenario="scn_a")).write_in_link_suggestions

        assert (suggestion.submission_id, suggestion.linked_in, suggestion.label) == (
            "6600000000000000014",
            "",
            "Link to Samuel Johnson's filing",
        )

    @pytest.mark.asyncio
    async def test_the_year_wide_read_suggests_nothing(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s14")],
            fetch_answers=_answers("s14", "Samuel", "Johnson"),
            fetch_live_write_ins=[_write_in("w1", "Samuel Johnson")],
        )

        assert (await JotformAdminService(repo).build_queue(YEAR)).write_in_link_suggestions == []


class TestLinkingKeepsTheFilingsKey:
    @pytest.mark.asyncio
    async def test_linking_a_linked_filing_in_another_scenario_stamps_its_own_key(self) -> None:
        # The suggested link's click: the filing keeps the key its live-board
        # write-in carries, so linking it in a scenario does not unlink it there.
        filing = _sub("s15", "write_in", write_in_key="k1")
        repo = _repo(
            fetch_submission=filing,
            fetch_submissions=[filing],
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", key="k1")],
            fetch_draft_write_ins=[_write_in("d1", "pat doe", unit="u_fern", scenario="scn_a")],
        )

        await JotformAdminService(repo).link_write_in("6600000000000000015", "u_fern", "pat doe", "staff@example.com")

        assert [c.args[:3] for c in repo.set_write_in_key.await_args_list] == [("lodging_write_ins_draft", "d1", "k1")]
        assert repo.update_submission.await_args.args[1]["write_in_key"] == "k1"

    @pytest.mark.asyncio
    async def test_a_stale_key_on_the_target_is_replaced_by_the_filings_own(self) -> None:
        # "k-old" was left on the row by a filing since unlinked: nobody holds it.
        filing = _sub("s16", "write_in", write_in_key="k1")
        repo = _repo(
            fetch_submission=filing,
            fetch_submissions=[filing, _sub("s17", "unmatched")],
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", key="k1")],
            fetch_draft_write_ins=[_write_in("d1", "Pat Doe", unit="u_fern", key="k-old", scenario="scn_a")],
        )

        await JotformAdminService(repo).link_write_in("6600000000000000016", "u_fern", "Pat Doe", "staff@example.com")

        assert [c.args[:3] for c in repo.set_write_in_key.await_args_list] == [("lodging_write_ins_draft", "d1", "k1")]
        assert repo.update_submission.await_args.args[1]["write_in_key"] == "k1"
