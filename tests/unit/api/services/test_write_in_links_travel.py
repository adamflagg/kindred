"""A write-in's Jotform link (`write_in_key`) travels with the write-in
through every path that copies write-in rows: scenario seeds, push and
unpush (kindred#2759 follow-up). Family Camp rows carry no key and see no
change. Fictional names only."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.lodging import PlacementCopyRequest, PushExecuteRequest
from api.services.jotform_bunking import JotformBunkingRows
from api.services.lodging_write_service import LodgingWriteService

ADULT = SimpleNamespace(id="sess_2", cm_id=1309001, session_type="adult")
FAMILY = SimpleNamespace(id="sess_1", cm_id=1309001, session_type="family")


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_session": ADULT,
        "count_draft_assignments": 0,
        "fetch_assignments": [],
        "fetch_draft_assignments": [],
        "fetch_slot_merges": [],
        "fetch_write_ins": [],
        "fetch_draft_write_ins": [],
        "create_write_in": SimpleNamespace(id="w_new"),
        "delete_write_in": None,
        "create_draft_write_in": SimpleNamespace(id="d_new"),
        "fetch_units": [
            SimpleNamespace(
                id="uc", code="cedar-9", name="Cedar 9", is_container=False, parent_unit="", sleeps=4, is_active=True
            )
        ],
        "create_push_event": SimpleNamespace(id="push_1"),
        "find_push_event": None,
        "update_push_event": None,
        "fetch_jotform_bunking_rows": JotformBunkingRows(forms=[], submissions=[], answers=[]),
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        setattr(repo, name, AsyncMock(return_value=value))
    return repo


def _wi(occ: str, key: str = "", ppl: int | None = None, id: str = "w1", unit: str = "uc") -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        unit=unit,
        occupant_name=occ,
        note="",
        party_size=ppl,
        session_cm_id=1309001,
        year=2026,
        write_in_key=key,
    )


def _linked_rows(key: str) -> JotformBunkingRows:
    return JotformBunkingRows(
        forms=[SimpleNamespace(id="form_ww", session_cm_id=1309001, field_map={"bunking_request": "21"})],
        submissions=[
            SimpleNamespace(
                id="sub_w",
                submission_id="6600000000000000020",
                form="form_ww",
                session_cm_id=1309001,
                person_cm_id=0,
                submitted_at="2026-08-31 09:00:00",
                match_status="write_in",
                write_in_key=key,
                jotform_status="ACTIVE",
            )
        ],
        answers=[SimpleNamespace(submission="sub_w", question_id="21", answer_text="Emma Johnson", answer_json=None)],
    )


class TestSeedsCarryTheLink:
    @pytest.mark.asyncio
    async def test_a_seed_from_the_live_board_copies_the_key(self) -> None:
        repo = _repo(fetch_write_ins=[_wi("Pat Doe", key="k1")])
        await LodgingWriteService(repo).copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=1309001, scenario="scn_1")
        )
        assert repo.create_draft_write_in.call_args.args[0]["write_in_key"] == "k1"

    @pytest.mark.asyncio
    async def test_a_scenario_to_scenario_copy_copies_the_key(self) -> None:
        repo = _repo(fetch_draft_write_ins=[_wi("Pat Doe", key="k1")])
        await LodgingWriteService(repo).copy_scenario_to_scenario(2026, 1309001, "scn_1", "scn_2")
        assert repo.create_draft_write_in.call_args.args[0]["write_in_key"] == "k1"


class TestPushCarriesTheLink:
    async def _push(self, repo: MagicMock, decision: str | None) -> Any:
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        decisions = {"cedar-9": decision} if decision else {}
        return await svc.execute_push(
            PushExecuteRequest(
                year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions=decisions
            ),
            pushed_by="staff@example.com",
        )

    @pytest.mark.asyncio
    async def test_an_added_linked_write_in_keeps_its_link_live_and_in_the_ledger(self) -> None:
        repo = _repo(fetch_draft_write_ins=[_wi("Pat Doe", key="k1", id="d1")])
        await self._push(repo, None)
        assert repo.create_write_in.call_args.args[0]["write_in_key"] == "k1"
        [change] = repo.create_push_event.call_args.args[0]["changes"]
        assert (change["action"], change["write_in_key"]) == ("add", "k1")

    @pytest.mark.asyncio
    async def test_a_link_only_difference_is_a_conflict_and_taking_the_scenario_moves_the_link(self) -> None:
        repo = _repo(
            fetch_write_ins=[_wi("Pat Doe", id="w1")],
            fetch_draft_write_ins=[_wi("Pat Doe", key="k1", id="d1")],
        )
        preview = await LodgingWriteService(repo).preview_push(2026, 1309001, "scn_1")
        assert [b.cls for b in preview.buildings] == ["conflict"]
        await self._push(repo, "scenario")
        repo.delete_write_in.assert_awaited_once_with("w1")
        assert repo.create_write_in.call_args.args[0]["write_in_key"] == "k1"
        removed = next(c for c in repo.create_push_event.call_args.args[0]["changes"] if c["action"] == "remove")
        assert removed["write_in_key"] == ""

    @pytest.mark.asyncio
    async def test_keeping_the_live_row_keeps_the_live_link(self) -> None:
        repo = _repo(
            fetch_write_ins=[_wi("Pat Doe", key="k-live", id="w1")],
            fetch_draft_write_ins=[_wi("Pat Doe", key="k-draft", id="d1")],
        )
        await self._push(repo, "live")
        repo.delete_write_in.assert_not_awaited()
        repo.create_write_in.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_family_push_is_unchanged_by_keys_nobody_set(self) -> None:
        repo = _repo(
            fetch_session=FAMILY,
            fetch_write_ins=[_wi("Olivia Chen", id="w1")],
            fetch_draft_write_ins=[_wi("Olivia Chen", id="d1")],
        )
        preview = await LodgingWriteService(repo).preview_push(2026, 1309001, "scn_1")
        assert [b.cls for b in preview.buildings] == ["match"]
        [row] = preview.buildings[0].live
        assert (row.write_in_key, row.bunking_request) == ("", None)
        repo.fetch_jotform_bunking_rows.assert_not_called()

    @pytest.mark.asyncio
    async def test_unpush_restores_a_removed_rows_link(self) -> None:
        ledger = SimpleNamespace(
            id="push_1",
            year=2026,
            session_cm_id=1309001,
            scenario_id="scn_1",
            unpushed_at="",
            changes=[
                {
                    "action": "remove",
                    "unit": "uc",
                    "unit_code": "cedar-9",
                    "occupant_name": "Pat Doe",
                    "note": "",
                    "party_size": None,
                    "write_in_key": "k1",
                }
            ],
        )
        repo = _repo(find_push_event=ledger)
        await LodgingWriteService(repo).unpush("push_1", 2026, 1309001)
        assert repo.create_write_in.call_args.args[0]["write_in_key"] == "k1"

    @pytest.mark.asyncio
    async def test_unpush_of_a_ledger_written_before_links_existed_restores_no_key(self) -> None:
        ledger = SimpleNamespace(
            id="push_1",
            year=2026,
            session_cm_id=1309001,
            scenario_id="scn_1",
            unpushed_at="",
            changes=[
                {
                    "action": "remove",
                    "unit": "uc",
                    "unit_code": "cedar-9",
                    "occupant_name": "Pat Doe",
                    "note": "",
                    "party_size": None,
                }
            ],
        )
        repo = _repo(find_push_event=ledger)
        await LodgingWriteService(repo).unpush("push_1", 2026, 1309001)
        assert repo.create_write_in.call_args.args[0]["write_in_key"] == ""


class TestPreviewShowsTheLinkedRequest:
    """The push deck and the compare modal read `preview_push`'s rows: a
    linked write-in carries the filing's bunking request, on adult weekends."""

    @pytest.mark.asyncio
    async def test_a_linked_row_carries_its_request_on_an_adult_weekend(self) -> None:
        repo = _repo(
            fetch_write_ins=[_wi("Pat Doe", key="k1", id="w1")],
            fetch_draft_write_ins=[_wi("Pat Doe", key="k1", id="d1"), _wi("Kitchen crew", id="d2")],
            fetch_jotform_bunking_rows=_linked_rows("k1"),
        )
        preview = await LodgingWriteService(repo).preview_push(2026, 1309001, "scn_1")
        rows = {
            (side, r.occupant_name): r
            for b in preview.buildings
            for side in ("live", "draft")
            for r in getattr(b, side)
        }
        linked = rows[("draft", "Pat Doe")]
        assert linked.write_in_key == "k1"
        assert linked.bunking_request is not None
        assert linked.bunking_request.current_text == "Emma Johnson"
        assert rows[("live", "Pat Doe")].bunking_request is not None
        assert rows[("draft", "Kitchen crew")].bunking_request is None

    @pytest.mark.asyncio
    async def test_a_family_weekend_never_reads_jotform(self) -> None:
        repo = _repo(
            fetch_session=FAMILY,
            fetch_draft_write_ins=[_wi("Olivia Chen", key="k1", id="d1")],
            fetch_jotform_bunking_rows=_linked_rows("k1"),
        )
        preview = await LodgingWriteService(repo).preview_push(2026, 1309001, "scn_1")
        assert preview.buildings[0].draft[0].bunking_request is None
        repo.fetch_jotform_bunking_rows.assert_not_called()
