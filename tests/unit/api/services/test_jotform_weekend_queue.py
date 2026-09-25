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

    @pytest.mark.asyncio
    async def test_an_option_names_the_filers_linked_to_it_in_the_viewed_scenario(self) -> None:
        # The dropdown marks a write-in already linked to a filing (kindred#2839
        # owner ask): staff linking another filer can see the write-in is taken,
        # though it stays offered -- a party can share one.
        repo = _repo(
            fetch_submissions=[
                _sub("s15", "write_in", write_in_key="k-liv"),
                _sub("s16", "write_in", write_in_key="k-liv"),
                _sub("s17", "write_in", write_in_key="k-sam"),
                _sub("s20"),
            ],
            fetch_answers=[
                *_answers("s15", "Olivia", "Chen"),
                *_answers("s16", "Riley", "Sam"),
                *_answers("s17", "Samuel", "Johnson"),
                *_answers("s20", "Emma", "Johnson"),
            ],
            fetch_live_write_ins=[
                _write_in("w1", "Liv C.", key="k-liv"),
                _write_in("w2", "Kitchen crew", unit="u_fern", unit_name="Fern 1"),
            ],
            # Samuel's write-in is placed only in Plan B: in the live view it is
            # not an option at all, and in Plan B it is linked.
            fetch_draft_write_ins=[
                _write_in("d1", "Sam J.", unit="u_oak", unit_name="Oak 2", key="k-sam", scenario="scn_b")
            ],
        )

        live = await _weekend(repo)
        plan = await _weekend(repo, scenario="scn_b")

        assert [(o.occupant_name, o.linked_filers) for o in live.write_in_options] == [
            ("Liv C.", ["Olivia Chen", "Riley Sam"]),
            ("Kitchen crew", []),
        ]
        assert [(o.occupant_name, o.linked_filers) for o in plan.write_in_options] == [("Sam J.", ["Samuel Johnson"])]

    @pytest.mark.asyncio
    async def test_one_filers_two_filings_name_them_once(self) -> None:
        repo = _repo(
            fetch_submissions=[
                _sub("s21", "write_in", write_in_key="k-liv"),
                _sub("s22", "write_in", write_in_key="k-liv", submitted_at="2026-09-02 09:00:00"),
            ],
            fetch_answers=[*_answers("s21", "Olivia", "Chen"), *_answers("s22", "Olivia", "Chen")],
            fetch_live_write_ins=[_write_in("w1", "Liv C.", key="k-liv")],
        )

        [option] = (await _weekend(repo)).write_in_options

        assert option.linked_filers == ["Olivia Chen"]


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
    async def test_a_write_in_whose_copy_holds_another_filings_link_is_not_suggested_to_it(self) -> None:
        # Scan of #2839: the viewed row is unkeyed, but its live copy (same unit
        # and name) carries Samuel's link. Clicking Link for Sam would adopt
        # Samuel's key -- merging two filings and dropping Sam's own link.
        repo = _repo(
            fetch_submissions=[
                _sub("s18", "write_in", write_in_key="k-sam"),
                _sub("s19", "write_in", write_in_key="k-samuel"),
            ],
            fetch_answers=[*_answers("s18", "Sam", "Johnson"), *_answers("s19", "Samuel", "Johnson")],
            fetch_live_write_ins=[_write_in("w1", "Sam Johnson", key="k-samuel")],
            fetch_draft_write_ins=[
                _write_in("d1", "Sam Johnson", unit="u_oak", unit_name="Oak 2", key="k-sam", scenario="scn_b"),
                # Typed by hand in Plan A: no key, though the live board's copy has one.
                _write_in("d2", "Sam Johnson", scenario="scn_a"),
            ],
        )

        suggestions = (await _weekend(repo, scenario="scn_a")).write_in_link_suggestions

        # Samuel's own write-in, unplaced in Plan A, is still suggested; Sam is not.
        assert [(s.option_id, s.submission_id) for s in suggestions] == [("u_cedar/Sam Johnson", "6600000000000000019")]

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

    @pytest.mark.asyncio
    async def test_a_filing_whose_link_was_dropped_everywhere_gets_a_fresh_key(self) -> None:
        # Scan of #2839: "k-gone" is carried by no row of the weekend -- the
        # write-in was removed everywhere, so the filing is back in Needs a
        # guest. A pull planned in that state drops the link by comparing
        # against "k-gone" (sync saveMatch); re-using it would let that pull
        # erase the link staff just re-made. Linking mints a fresh key, as it
        # did before key preservation.
        filing = _sub("s20", "write_in", write_in_key="k-gone")
        repo = _repo(
            fetch_submission=filing,
            fetch_submissions=[filing],
            fetch_live_write_ins=[_write_in("w1", "Pat Doe")],
        )

        await JotformAdminService(repo).link_write_in("6600000000000000020", "u_cedar", "Pat Doe", "staff@example.com")

        [stamp] = repo.set_write_in_key.await_args_list
        key = repo.update_submission.await_args.args[1]["write_in_key"]
        assert stamp.args[:2] == ("lodging_write_ins", "w1")
        assert stamp.args[2] == key
        assert key not in ("", "k-gone")

    @pytest.mark.asyncio
    async def test_a_key_another_filing_holds_on_the_target_is_adopted(self) -> None:
        # A party of several: the target already carries Riley's link, so the
        # linked filing joins it and nothing on the row is re-stamped.
        filing = _sub("s21", "write_in", write_in_key="k1")
        repo = _repo(
            fetch_submission=filing,
            fetch_submissions=[filing, _sub("s22", "write_in", write_in_key="k3")],
            fetch_live_write_ins=[_write_in("w1", "Pat Doe", key="k1")],
            fetch_draft_write_ins=[_write_in("d1", "Riley Sam", unit="u_fern", key="k3", scenario="scn_a")],
        )

        await JotformAdminService(repo).link_write_in("6600000000000000021", "u_fern", "Riley Sam", "staff@example.com")

        assert repo.set_write_in_key.await_args_list == []
        assert repo.update_submission.await_args.args[1]["write_in_key"] == "k3"


class TestSimilarNameSuggestions:
    """Staff mistype write-in names -- a nametag of "Emmy" typed "Emny". When
    no exact tier finds a write-in, the Suggested links offer the one write-in
    whose name is closest to the filer's (Jaro-Winkler >= 0.85), labelled as a
    similar name. Never the dropdown's pre-selection, never a link on its own."""

    @pytest.mark.asyncio
    async def test_a_typo_in_a_nametag_is_suggested_as_a_similar_name(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s30")],
            fetch_answers=_answers("s30", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[_write_in("w1", "Emny")],
        )

        queue = await _weekend(repo)

        [suggestion] = queue.write_in_link_suggestions
        assert (suggestion.option_id, suggestion.submission_id, suggestion.label) == (
            "u_cedar/Emny",
            "6600000000000000030",
            "Similar name: link to Emma Johnson's filing?",
        )
        # The dropdown stays exact: nothing is pre-selected for a similar name.
        [item] = queue.unmatched
        assert item.write_in_suggestion == ""
        repo.update_submission.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_tie_for_the_closest_name_suggests_nothing(self) -> None:
        # "Emmi" and "Emme" are equally close to "Emmy": no unique best hit.
        repo = _repo(
            fetch_submissions=[_sub("s31")],
            fetch_answers=_answers("s31", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[_write_in("w1", "Emmi"), _write_in("w2", "Emme", unit="u_fern", unit_name="Fern 1")],
        )

        assert (await _weekend(repo)).write_in_link_suggestions == []

    @pytest.mark.asyncio
    async def test_an_exact_hit_leaves_no_room_for_a_similar_one(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s32")],
            fetch_answers=_answers("s32", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[_write_in("w1", "Emmy"), _write_in("w2", "Emny", unit="u_fern", unit_name="Fern 1")],
        )

        suggestions = (await _weekend(repo)).write_in_link_suggestions

        assert [(s.occupant_name, s.label) for s in suggestions] == [("Emmy", "Link to Emma Johnson's filing")]

    @pytest.mark.asyncio
    async def test_an_ambiguous_exact_tier_suggests_no_similar_name_either(self) -> None:
        # Two exact "Emmy"s: the exact tier found something, just not one thing.
        repo = _repo(
            fetch_submissions=[_sub("s33")],
            fetch_answers=_answers("s33", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[
                _write_in("w1", "Emmy"),
                _write_in("w2", "Emmy", unit="u_fern", unit_name="Fern 1"),
                _write_in("w3", "Emny", unit="u_oak", unit_name="Oak 2"),
            ],
        )

        assert (await _weekend(repo)).write_in_link_suggestions == []

    @pytest.mark.asyncio
    async def test_a_similar_write_in_carrying_another_filings_link_is_never_suggested(self) -> None:
        # The closest name's live copy carries Olivia's link: suggesting it
        # would merge two filings. Nor does the runner-up take its place.
        repo = _repo(
            fetch_submissions=[_sub("s34"), _sub("s35", "write_in", write_in_key="k-olivia")],
            fetch_answers=[
                *_answers("s34", "Emma", "Johnson", nametag="Emmy"),
                *_answers("s35", "Olivia", "Chen"),
            ],
            fetch_live_write_ins=[_write_in("w1", "Emmyy", key="k-olivia")],
            fetch_draft_write_ins=[
                _write_in("d1", "Emmyy", scenario="scn_a"),
                _write_in("d2", "Emny", unit="u_oak", unit_name="Oak 2", scenario="scn_a"),
            ],
        )

        suggestions = (await _weekend(repo, scenario="scn_a")).write_in_link_suggestions

        assert all(s.submission_id != "6600000000000000034" for s in suggestions)

    @pytest.mark.asyncio
    async def test_a_write_in_that_exactly_names_another_filer_is_not_a_typo_of_this_one(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s36"), _sub("s37")],
            fetch_answers=[*_answers("s36", "Emma", "Johnson"), *_answers("s37", "Emmi", "Johnson")],
            fetch_live_write_ins=[_write_in("w1", "Emmi Johnson")],
        )

        suggestions = (await _weekend(repo)).write_in_link_suggestions

        assert [(s.submission_id, s.label) for s in suggestions] == [
            ("6600000000000000037", "Link to Emmi Johnson's filing")
        ]

    @pytest.mark.asyncio
    async def test_a_linked_filing_unplaced_here_gets_a_similar_name_too(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s38", "write_in", write_in_key="k1")],
            fetch_answers=_answers("s38", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[_write_in("w1", "Emma J.", key="k1")],
            fetch_draft_write_ins=[_write_in("d1", "Emny", unit="u_fern", unit_name="Fern 1", scenario="scn_a")],
        )

        [suggestion] = (await _weekend(repo, scenario="scn_a")).write_in_link_suggestions

        assert suggestion.label == "Similar name: link to Emma Johnson's filing? (linked in the live board)"

    @pytest.mark.asyncio
    async def test_a_filing_with_no_name_reads_the_queue_and_gets_no_similar_name(self) -> None:
        # A mapped form whose filer left every name field blank: no name to
        # compare, so no similar name -- and the weekend's queue still reads.
        repo = _repo(
            fetch_submissions=[_sub("s39")],
            fetch_answers=_answers("s39", "", ""),
            fetch_live_write_ins=[_write_in("w1", "Emny")],
        )

        queue = await _weekend(repo)

        assert queue.write_in_link_suggestions == []
        assert len(queue.unmatched) == 1

    @pytest.mark.asyncio
    async def test_a_write_in_closest_to_two_filers_is_suggested_to_neither(self) -> None:
        # "Emny" is the closest write-in for both filers (each nametag "Emmy"):
        # offering it to both would let two clicks merge two people onto it.
        repo = _repo(
            fetch_submissions=[_sub("s40"), _sub("s41")],
            fetch_answers=[
                *_answers("s40", "Emma", "Johnson", nametag="Emmy"),
                *_answers("s41", "Olivia", "Chen", nametag="Emmy"),
            ],
            fetch_live_write_ins=[_write_in("w1", "Emny")],
        )

        assert (await _weekend(repo)).write_in_link_suggestions == []

    @pytest.mark.asyncio
    async def test_one_filers_two_filings_still_get_their_similar_name(self) -> None:
        # The same filer twice is one person, not two claims on "Emny".
        repo = _repo(
            fetch_submissions=[_sub("s42"), _sub("s43")],
            fetch_answers=[
                *_answers("s42", "Emma", "Johnson", nametag="Emmy"),
                *_answers("s43", "Emma", "Johnson", nametag="Emmy"),
            ],
            fetch_live_write_ins=[_write_in("w1", "Emny")],
        )

        suggestions = (await _weekend(repo)).write_in_link_suggestions

        assert {(s.option_id, s.submission_id) for s in suggestions} == {
            ("u_cedar/Emny", "6600000000000000042"),
            ("u_cedar/Emny", "6600000000000000043"),
        }


# --- The filer's own row, and the board's name -> filing match -----------------
#
# Owner report on #2839 (2026-09-25): a write-in named like a filer ("Emny" for
# a nametag "Emmy") was suggested only in the separate Suggested links card,
# not on the filer's own row, and the board's write-in box never suggested the
# filing from a typed name at all. The row joins the suggestions by
# submission id (one list, one source of truth), so each says whether it is a
# similar name; and every filing still needing a guest carries its folded
# names in `suggest_write_in`'s tiers for the board to match a typed name.


class TestSuggestionsSayWhetherTheyAreSimilar:
    @pytest.mark.asyncio
    async def test_an_exact_name_is_not_similar(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s50")],
            fetch_answers=_answers("s50", "Emma", "Johnson"),
            fetch_live_write_ins=[_write_in("w1", "Emma Johnson")],
        )

        [suggestion] = (await _weekend(repo)).write_in_link_suggestions

        assert (suggestion.submission_id, suggestion.similar) == ("6600000000000000050", False)

    @pytest.mark.asyncio
    async def test_a_similar_name_says_so_and_still_pre_selects_nothing(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s51")],
            fetch_answers=_answers("s51", "Emma", "Johnson", nametag="Emmy"),
            fetch_live_write_ins=[_write_in("w1", "Emny")],
        )

        queue = await _weekend(repo)

        [suggestion] = queue.write_in_link_suggestions
        assert (suggestion.submission_id, suggestion.similar) == ("6600000000000000051", True)
        assert queue.unmatched[0].write_in_suggestion == ""


class TestFilerNamesForTheBoard:
    @pytest.mark.asyncio
    async def test_a_filing_needing_a_guest_carries_its_names_in_tier_order(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s52")],
            fetch_answers=_answers("s52", "Emma", "Johnson", nametag="Emmy"),
        )

        for queue in (await _weekend(repo), await JotformAdminService(repo).build_queue(YEAR)):
            [item] = queue.unmatched
            assert item.name_tiers == [["emma johnson"], ["emmy johnson"], ["emmy"], ["emma", "emmy"]]

    @pytest.mark.asyncio
    async def test_a_decided_filing_carries_none(self) -> None:
        repo = _repo(
            fetch_submissions=[_sub("s53", "ignored")],
            fetch_answers=_answers("s53", "Emma", "Johnson", nametag="Emmy"),
        )

        [item] = (await _weekend(repo)).resolved

        assert item.name_tiers == []


# --- One weekend's reads (kindred#2839 follow-up: queue actions feel slow) -----
#
# Measured on the dev database: the year's answers are ~90% of the queue's
# read time, and one weekend's are a fraction of them. The Requests tab and
# every staff action are one weekend's, so they ask PocketBase for that
# weekend alone. The in-memory weekend filter stays: a repository that
# returns more can never widen the answer.


def _guest(cm: int, first: str, last: str, session: int = WW_CM) -> SimpleNamespace:
    return SimpleNamespace(
        expand={
            "person": SimpleNamespace(cm_id=cm, first_name=first, preferred_name="", last_name=last),
            "session": SimpleNamespace(cm_id=session),
        }
    )


def _two_weekends() -> dict[str, list[Any]]:
    """A year with filings, guests and write-ins on both adult weekends."""
    return {
        "submissions": [
            _sub("s60"),
            _sub("s61", "staff", person_cm_id=1000005),
            _sub("s62", "write_in", write_in_key="k1"),
            _sub("s63", form="form_mw", session_cm_id=MW_CM),
            _sub("s64", "staff", form="form_mw", session_cm_id=MW_CM, person_cm_id=1000006),
        ],
        "answers": [
            *_answers("s60", "Emma", "Johnson", nametag="Emmy"),
            *_answers("s61", "Olivia", "Chen"),
            *_answers("s62", "Riley", "Sam"),
            *_answers("s63", "Emma", "Johnson"),
            *_answers("s64", "Liam", "Garcia"),
        ],
        "guests": [
            _guest(1000005, "Olivia", "Chen"),
            _guest(1000007, "Emma", "Johnston"),
            _guest(1000006, "Liam", "Garcia", session=MW_CM),
        ],
        "live": [
            _write_in("w1", "Riley Sam", key="k1"),
            _write_in("w2", "Emny"),
            _write_in("w3", "Emma Johnson", session=MW_CM),
        ],
        "drafts": [_write_in("d1", "Riley Sam", key="k1", scenario="scn_a")],
    }


def _session_of(row: Any) -> int:
    expand = getattr(row, "expand", None) or {}
    if "session" in expand:
        return int(expand["session"].cm_id)
    return int(row.session_cm_id)


def _answer_session(data: dict[str, list[Any]]) -> dict[str, int]:
    return {str(s.id): int(s.session_cm_id) for s in data["submissions"]}


def _scoping_repo(data: dict[str, list[Any]]) -> MagicMock:
    """A repository that honours `session_cm_id=` the way PocketBase will."""
    of_answer = _answer_session(data)

    def scoped(rows: list[Any], session: Any, key: Any = _session_of) -> list[Any]:
        return rows if session is None else [r for r in rows if key(r) == session]

    repo = _repo()
    repo.fetch_submissions = AsyncMock(
        side_effect=lambda year, session_cm_id=None: scoped(data["submissions"], session_cm_id)
    )
    repo.fetch_answers = AsyncMock(
        side_effect=lambda year, session_cm_id=None: scoped(
            data["answers"], session_cm_id, lambda a: of_answer[str(a.submission)]
        )
    )
    repo.fetch_enrolled_guests = AsyncMock(
        side_effect=lambda year, session_cm_id=None: scoped(data["guests"], session_cm_id)
    )
    repo.fetch_live_write_ins = AsyncMock(
        side_effect=lambda year, session_cm_id=None: scoped(data["live"], session_cm_id)
    )
    repo.fetch_draft_write_ins = AsyncMock(
        side_effect=lambda year, session_cm_id=None: scoped(data["drafts"], session_cm_id)
    )
    return repo


class TestOneWeekendsReads:
    @pytest.mark.asyncio
    async def test_the_requests_tab_asks_for_its_weekend_alone(self) -> None:
        repo = _scoping_repo(_two_weekends())

        await _weekend(repo, scenario="scn_a")

        for read in (
            repo.fetch_submissions,
            repo.fetch_answers,
            repo.fetch_enrolled_guests,
            repo.fetch_live_write_ins,
            repo.fetch_draft_write_ins,
        ):
            read.assert_awaited_once_with(YEAR, session_cm_id=WW_CM)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("scenario", ["", "scn_a", "scn_b"])
    async def test_the_scoped_reads_return_the_same_queue(self, scenario: str) -> None:
        # Parity: the year's rows filtered in memory, and the weekend's rows as
        # PocketBase returns them, are one queue.
        data = _two_weekends()
        year_wide = _repo(
            fetch_submissions=data["submissions"],
            fetch_answers=data["answers"],
            fetch_enrolled_guests=data["guests"],
            fetch_live_write_ins=data["live"],
            fetch_draft_write_ins=data["drafts"],
        )

        expected = await _weekend(year_wide, scenario=scenario)
        scoped = await _weekend(_scoping_repo(data), scenario=scenario)

        assert scoped.model_dump() == expected.model_dump()
        # The fixture exercises every list the scoped reads feed.
        assert expected.unmatched
        assert expected.resolved
        assert expected.write_ins

    @pytest.mark.asyncio
    async def test_the_year_wide_read_still_reads_the_year(self) -> None:
        repo = _scoping_repo(_two_weekends())

        queue = await JotformAdminService(repo).build_queue(YEAR)

        assert sorted(i.session_cm_id for i in queue.unmatched) == [WW_CM, MW_CM]
        for read in (repo.fetch_submissions, repo.fetch_answers, repo.fetch_enrolled_guests):
            assert read.await_args.kwargs.get("session_cm_id") is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "action",
        [
            pytest.param(lambda s: s.ignore("6600000000000000060", "staff@example.com"), id="ignore"),
            pytest.param(lambda s: s.unlink("6600000000000000060"), id="unlink"),
            pytest.param(lambda s: s.link("6600000000000000060", 1000007, "staff@example.com"), id="link"),
            pytest.param(
                lambda s: s.link_write_in("6600000000000000060", "u_cedar", "Emny", "staff@example.com"), id="write-in"
            ),
        ],
    )
    async def test_each_action_reads_its_filings_weekend_alone(self, action: Any) -> None:
        data = _two_weekends()
        repo = _scoping_repo(data)
        repo.fetch_submission = AsyncMock(return_value=data["submissions"][0])

        with patch("api.services.jotform_admin_service.lodging_cache"):
            await action(JotformAdminService(repo))

        for read in (
            repo.fetch_submissions,
            repo.fetch_answers,
            repo.fetch_enrolled_guests,
            repo.fetch_live_write_ins,
            repo.fetch_draft_write_ins,
        ):
            for call in read.await_args_list:
                assert call.kwargs.get("session_cm_id") == WW_CM, (read, call)
        repo.fetch_answers.assert_awaited()
