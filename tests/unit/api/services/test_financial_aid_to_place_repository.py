"""The repository reads To place adds (campership SP11-rest): each line's description and flags, the
overrides in full, the lines left at family level, and the source registry. Fictional only."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_reconciliation import SplitPart
from api.services.financial_aid_to_place import LeftLine, LineDetail, OverrideRow, SourceRow

YEAR = 2027


def _repo(rows: list[Any]) -> tuple[FinancialAidDecisionsRepository, MagicMock]:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = rows
    return FinancialAidDecisionsRepository(pb), pb


@pytest.mark.asyncio
async def test_line_details_are_the_camp_aid_lines_descriptions_and_flags() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(transaction_cm_id=9001, effective_source_key="camp fa", flags=["implied_program_mismatch"]),
            SimpleNamespace(transaction_cm_id=9002, effective_source_key="camp fa", flags='["positive_amount"]'),
            SimpleNamespace(transaction_cm_id=9003, effective_source_key="camp fa", flags=None),
            SimpleNamespace(transaction_cm_id=9001, effective_source_key="camp fa", flags=["positive_amount"]),
        ]
    )
    assert await repo.fetch_line_details(YEAR) == {
        9001: LineDetail(9001, "camp fa", ("implied_program_mismatch", "positive_amount")),  # every row's flags
        9002: LineDetail(9002, "camp fa", ("positive_amount",)),
        9003: LineDetail(9003, "camp fa", ()),
    }
    pb.collection.assert_called_with("aid_postings")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["filter"] == f"year = {YEAR} && funder_type = 'camp'"
    assert set(query["fields"].split(",")) == {"transaction_cm_id", "effective_source_key", "flags"}


@pytest.mark.asyncio
async def test_override_rows_are_read_whole_with_their_split() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(
                id="ovr000000009001",
                transaction_cm_id=9001,
                attributed_person_cm_id=0,
                attributed_session_cm_id=0,
                program_family="",
                source_key_override="",
                source="staff",
                note="Two campers",
                split=[{"person_cm_id": 1000011, "session_cm_id": 1000101, "program_family": "summer", "amount": "10"}],
            )
        ]
    )
    assert await repo.fetch_override_rows(YEAR) == {
        9001: OverrideRow(
            id="ovr000000009001",
            transaction_cm_id=9001,
            attributed_person_cm_id=0,
            attributed_session_cm_id=0,
            program_family="",
            source_key_override="",
            source="staff",
            note="Two campers",
            split=(SplitPart(1000011, 1000101, "summer", Decimal(10)),),
        )
    }
    pb.collection.assert_called_with("aid_attribution_overrides")


@pytest.mark.asyncio
async def test_only_to_place_dispositions_are_lines_left_at_family_level() -> None:
    repo, _ = _repo(
        [
            SimpleNamespace(id="dsp000000000001", transaction_cm_id=9001, flag="to_place", note="Pays it in June"),
            SimpleNamespace(id="dsp000000000002", transaction_cm_id=9002, flag="positive_amount", note="Let stand"),
        ]
    )
    assert await repo.fetch_left_lines(YEAR) == {9001: LeftLine("dsp000000000001", 9001, "Pays it in June")}


@pytest.mark.asyncio
async def test_source_rows_say_whether_each_description_is_classified_aid() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(
                description_key="camp fa",
                description="Camp FA",
                classified_by="config_file",
                counts_as_aid=True,
                funder_type="camp",
            ),
            SimpleNamespace(
                description_key="new description",
                description="New Description",
                classified_by="unclassified",
                counts_as_aid=False,
                funder_type="unknown",
            ),
        ]
    )
    assert await repo.fetch_source_rows() == {
        "camp fa": SourceRow("camp fa", "Camp FA", classified=True, counts_as_aid=True, funder_type="camp"),
        "new description": SourceRow(
            "new description", "New Description", classified=False, counts_as_aid=False, funder_type="unknown"
        ),
    }
    pb.collection.assert_called_with("aid_sources")
